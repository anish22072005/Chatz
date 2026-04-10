const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const exists = await User.findOne({
      $or: [{ username: username.trim() }, { email: email.trim().toLowerCase() }]
    });

    if (exists) {
      return res.status(409).json({ message: "Username or email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      passwordHash
    });

    const token = signToken(user);

    return res.status(201).json({
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (error) {
    return res.status(500).json({ message: "Registration failed" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ message: "Id and password are required" });
    }

    const user = await User.findOne({
      $or: [
        { email: identifier.trim().toLowerCase() },
        { username: identifier.trim() }
      ]
    });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = signToken(user);

    return res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (error) {
    return res.status(500).json({ message: "Login failed" });
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("_id username email");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ user });
  } catch (error) {
    return res.status(500).json({ message: "Unable to get user" });
  }
});

router.get("/users", authMiddleware, async (_req, res) => {
  try {
    const currentUser = await User.findById(_req.user.userId).select("blockedUsers").lean();
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const blockedSet = new Set((currentUser.blockedUsers || []).map((id) => id.toString()));
    const users = await User.find().sort({ username: 1 }).select("_id username").lean();

    return res.json({
      users: users.map((item) => ({
        id: item._id.toString(),
        username: item.username,
        isBlocked: blockedSet.has(item._id.toString())
      }))
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to fetch users" });
  }
});

router.post("/users/:id/block", authMiddleware, async (req, res) => {
  try {
    const targetId = req.params.id;
    const currentUserId = req.user.userId;

    if (targetId === currentUserId) {
      return res.status(400).json({ message: "You cannot block yourself" });
    }

    const targetExists = await User.exists({ _id: targetId });
    if (!targetExists) {
      return res.status(404).json({ message: "User not found" });
    }

    await User.findByIdAndUpdate(currentUserId, {
      $addToSet: { blockedUsers: targetId }
    });

    return res.json({ ok: true, blockedUserId: targetId });
  } catch (error) {
    return res.status(500).json({ message: "Unable to block user" });
  }
});

router.post("/users/:id/unblock", authMiddleware, async (req, res) => {
  try {
    const targetId = req.params.id;

    await User.findByIdAndUpdate(req.user.userId, {
      $pull: { blockedUsers: targetId }
    });

    return res.json({ ok: true, unblockedUserId: targetId });
  } catch (error) {
    return res.status(500).json({ message: "Unable to unblock user" });
  }
});

module.exports = router;
