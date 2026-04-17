require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const Message = require("./models/Message");
const User = require("./models/User");
const authMiddleware = require("./middleware/auth");

const app = express();
const server = http.createServer(app);

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_ATTACHMENT_KINDS = ["image", "video", "audio"];

function normalizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") {
    return null;
  }

  const kind = String(attachment.kind || "").trim();
  const mimeType = String(attachment.mimeType || "").trim();
  const dataUrl = String(attachment.dataUrl || "").trim();
  const name = String(attachment.name || "").trim();
  const size = Number(attachment.size || 0);

  if (!ALLOWED_ATTACHMENT_KINDS.includes(kind)) {
    return null;
  }

  if (!/^data:/.test(dataUrl) || !mimeType || !/^image\//.test(mimeType) && !/^video\//.test(mimeType) && !/^audio\//.test(mimeType)) {
    return null;
  }

  if (size && size > MAX_ATTACHMENT_BYTES) {
    return null;
  }

  if (kind === "image" && !mimeType.startsWith("image/")) return null;
  if (kind === "video" && !mimeType.startsWith("video/")) return null;
  if (kind === "audio" && !mimeType.startsWith("audio/")) return null;

  return { kind, mimeType, dataUrl, name, size };
}

function attachmentPreviewText(attachment) {
  if (!attachment?.kind) {
    return "";
  }

  if (attachment.kind === "image") return "📷 Image";
  if (attachment.kind === "video") return "🎥 Video";
  if (attachment.kind === "audio") return "🎤 Voice note";
  return "Attachment";
}

const PORT = process.env.PORT || 5000;
const rawClientUrls = process.env.CLIENT_URLS || process.env.CLIENT_URL || "http://localhost:5173";
const allowedOrigins = rawClientUrls
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // Allow Chatz Netlify deployments without needing an exact per-branch URL.
  if (/^https:\/\/chatz[\w-]*\.netlify\.app$/i.test(origin)) {
    return true;
  }

  return false;
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  }
};

app.use(cors(corsOptions));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);

app.get("/api/messages/previews", authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.userId).select("blockedUsers").lean();
    const blockedSet = new Set((currentUser?.blockedUsers || []).map((id) => id.toString()));
    const currentUserId = String(req.user.userId);

    const messages = await Message.find({
      $or: [{ sender: req.user.userId }, { recipient: req.user.userId }]
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const latestByUser = new Map();

    for (const msg of messages) {
      const senderId = String(msg.sender || "");
      const recipientId = String(msg.recipient || "");
      const otherUserId = senderId === currentUserId ? recipientId : senderId;

      if (!otherUserId || otherUserId === currentUserId) {
        continue;
      }

      if (blockedSet.has(otherUserId) || latestByUser.has(otherUserId)) {
        continue;
      }

      latestByUser.set(otherUserId, {
        userId: otherUserId,
        content: String(msg.content || attachmentPreviewText(msg.attachment) || ""),
        createdAt: msg.createdAt,
        isMine: senderId === currentUserId,
        attachment: msg.attachment || null
      });
    }

    res.json({ previews: Array.from(latestByUser.values()) });
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch message previews" });
  }
});

app.get("/api/messages", authMiddleware, async (req, res) => {
  try {
    const otherUserId = String(req.query.userId || "").trim();
    if (!otherUserId) {
      return res.status(400).json({ message: "userId query param is required" });
    }

    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const currentUser = await User.findById(req.user.userId).select("blockedUsers").lean();
    const blockedSet = new Set((currentUser?.blockedUsers || []).map((id) => id.toString()));

    if (blockedSet.has(otherUserId)) {
      return res.json({ messages: [] });
    }

    const messages = await Message.find({
      $or: [
        { sender: req.user.userId, recipient: otherUserId },
        { sender: otherUserId, recipient: req.user.userId }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("sender", "username")
      .populate("recipient", "username")
      .lean();

    const normalized = messages
      .reverse()
      .filter((msg) => !blockedSet.has(msg.sender?._id?.toString() || ""))
      .map((msg) => ({
        id: msg._id,
        content: msg.content,
        attachment: msg.attachment || null,
        createdAt: msg.createdAt,
        sender: {
          id: msg.sender?._id,
          username: msg.sender?.username || "Unknown"
        },
        recipient: {
          id: msg.recipient?._id,
          username: msg.recipient?.username || "Unknown"
        }
      }));

    res.json({ messages: normalized });
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch messages" });
  }
});

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST"]
  }
});

const onlineUsers = new Map();

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication required"));
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = payload;
    return next();
  } catch (error) {
    return next(new Error("Invalid token"));
  }
});

io.on("connection", (socket) => {
  const { userId, username } = socket.user;
  socket.join(`user:${userId}`);

  onlineUsers.set(userId, username);
  io.emit("online_users", Array.from(onlineUsers.entries()).map(([id, name]) => ({ id, username: name })));

  socket.on("chat_message", async (payload, ack) => {
    try {
      const content = (payload?.content || "").trim();
      const recipientId = String(payload?.recipientId || "").trim();
      const attachment = normalizeAttachment(payload?.attachment);

      if (!content && !attachment) {
        if (typeof ack === "function") {
          ack({ ok: false, message: "Message cannot be empty" });
        }
        return;
      }

      if (!recipientId || recipientId === String(userId)) {
        if (typeof ack === "function") {
          ack({ ok: false, message: "Choose a valid recipient" });
        }
        return;
      }

      if (!mongoose.Types.ObjectId.isValid(recipientId)) {
        if (typeof ack === "function") {
          ack({ ok: false, message: "Invalid recipient" });
        }
        return;
      }

      const recipientExists = await User.exists({ _id: recipientId });
      if (!recipientExists) {
        if (typeof ack === "function") {
          ack({ ok: false, message: "Recipient does not exist" });
        }
        return;
      }

      const saved = await Message.create({
        sender: userId,
        recipient: recipientId,
        content,
        attachment
      });

      const recipientUser = await User.findById(recipientId).select("username").lean();

      const message = {
        id: saved._id,
        content: saved.content,
        attachment: saved.attachment || null,
        createdAt: saved.createdAt,
        sender: {
          id: userId,
          username
        },
        recipient: {
          id: recipientId,
          username: recipientUser?.username || "Unknown"
        }
      };

      io.to(`user:${userId}`).to(`user:${recipientId}`).emit("new_message", message);

      if (typeof ack === "function") {
        ack({ ok: true });
      }
    } catch (error) {
      if (typeof ack === "function") {
        ack({ ok: false, message: "Failed to send message" });
      }
    }
  });

  socket.on("disconnect", () => {
    User.findByIdAndUpdate(userId, { $set: { lastSeenAt: new Date() } }).catch(() => {});
    onlineUsers.delete(userId);
    io.emit("online_users", Array.from(onlineUsers.entries()).map(([id, name]) => ({ id, username: name })));
  });
});

async function bootstrap() {
  try {
    if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
      throw new Error("MONGODB_URI and JWT_SECRET must be set in .env");
    }

    await mongoose.connect(process.env.MONGODB_URI);
    server.listen(PORT, () => {
      // Keep startup logging concise and machine-readable for deployment logs.
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

bootstrap();
