require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const Message = require("./models/Message");
const authMiddleware = require("./middleware/auth");

const app = express();
const server = http.createServer(app);

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

app.get("/api/messages", authMiddleware, async (_req, res) => {
  try {
    const messages = await Message.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("sender", "username")
      .lean();

    const normalized = messages.reverse().map((msg) => ({
      id: msg._id,
      content: msg.content,
      createdAt: msg.createdAt,
      sender: {
        id: msg.sender?._id,
        username: msg.sender?.username || "Unknown"
      }
    }));

    res.json({ messages: normalized });
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch messages" });
  }
});

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
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

  onlineUsers.set(userId, username);
  io.emit("online_users", Array.from(onlineUsers.entries()).map(([id, name]) => ({ id, username: name })));

  socket.on("chat_message", async (payload, ack) => {
    try {
      const content = (payload?.content || "").trim();

      if (!content) {
        if (typeof ack === "function") {
          ack({ ok: false, message: "Message cannot be empty" });
        }
        return;
      }

      const saved = await Message.create({
        sender: userId,
        content
      });

      const message = {
        id: saved._id,
        content: saved.content,
        createdAt: saved.createdAt,
        sender: {
          id: userId,
          username
        }
      };

      io.emit("new_message", message);

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
