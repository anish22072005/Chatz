import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const PROD_BACKEND_URL = "https://chatz-k70j.onrender.com";
const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? PROD_BACKEND_URL : "http://localhost:5000");
const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.PROD ? PROD_BACKEND_URL : "http://localhost:5000");

const AVAILABLE_AVATAR_STYLES = [
  "micah",
  "adventurer-neutral",
  "bottts-neutral",
  "fun-emoji",
  "icons",
  "pixel-art-neutral"
];

function toFriendlyNetworkError(error, fallbackMessage) {
  if (error?.name === "TypeError" && /fetch/i.test(error?.message || "")) {
    return "Cannot reach backend API. Check deployment URL and CORS settings.";
  }
  return error?.message || fallbackMessage;
}

function FormField({ label, type = "text", value, onChange, placeholder }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </label>
  );
}

function buildAvatarUrl(seed, style = "micah") {
  const safeSeed = encodeURIComponent(String(seed || "user").trim() || "user");
  const safeStyle = AVAILABLE_AVATAR_STYLES.includes(style) ? style : "micah";
  return `https://api.dicebear.com/7.x/${safeStyle}/svg?seed=${safeSeed}&backgroundColor=5865f2,4752c4,2b2d31,232428&radius=50`;
}

function formatLastSeen(value) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "Last seen 1 mins ago";
  }

  const diffMinutes = Math.max(1, Math.floor((Date.now() - date.getTime()) / 60000));

  if (diffMinutes < 60) {
    return `Last seen ${diffMinutes} mins ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `Last seen ${diffHours} hrs ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `Last seen ${diffDays} days ago`;
}

function attachmentPreviewLabel(kind) {
  if (kind === "image") return "Image";
  if (kind === "video") return "Video";
  if (kind === "audio") return "Voice note";
  return "Attachment";
}

function isSupportedAttachment(file) {
  return Boolean(file && (file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/")));
}

function renderAttachment(attachment) {
  if (!attachment?.dataUrl || !attachment?.kind) {
    return null;
  }

  if (attachment.kind === "image") {
    return <img className="message-attachment message-image" src={attachment.dataUrl} alt={attachment.name || "Attached image"} />;
  }

  if (attachment.kind === "video") {
    return (
      <video className="message-attachment message-video" controls src={attachment.dataUrl}>
        Your browser does not support the video tag.
      </video>
    );
  }

  if (attachment.kind === "audio") {
    return <audio className="message-attachment message-audio" controls src={attachment.dataUrl} />;
  }

  return null;
}

function attachmentSummaryText(attachment) {
  if (!attachment?.kind) {
    return "";
  }

  if (attachment.kind === "image") return "📷 Image";
  if (attachment.kind === "video") return "🎥 Video";
  if (attachment.kind === "audio") return "🎤 Voice note";
  return "Attachment";
}

export default function App() {
  const [mode, setMode] = useState("login");
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("user");
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (_error) {
      localStorage.removeItem("user");
      localStorage.removeItem("token");
      return null;
    }
  });
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [avatarStyle, setAvatarStyle] = useState("micah");
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [messages, setMessages] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [messagePreviews, setMessagePreviews] = useState({});
  const [activeChatUserId, setActiveChatUserId] = useState("");
  const [messageText, setMessageText] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [chatError, setChatError] = useState("");
  const [kickTarget, setKickTarget] = useState(null);
  const [kickLoading, setKickLoading] = useState(false);
  const [friendSearch, setFriendSearch] = useState("");
  const [friendSearchResults, setFriendSearchResults] = useState([]);
  const [friendSearchLoading, setFriendSearchLoading] = useState(false);
  const [addingFriendId, setAddingFriendId] = useState("");

  const socketRef = useRef(null);
  const endRef = useRef(null);
  const fileInputRef = useRef(null);
  const recorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const blockedIdsRef = useRef(new Set());

  const isAuthed = Boolean(token && user);

  useEffect(() => {
    if (!welcomeMessage) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setWelcomeMessage("");
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [welcomeMessage]);

  useEffect(() => {
    if (!isAuthed) {
      setMobileSidebarOpen(false);
    }
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed) {
      setFriendSearchResults([]);
      return undefined;
    }

    const query = friendSearch.trim();
    if (!query) {
      setFriendSearchResults([]);
      setFriendSearchLoading(false);
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      setFriendSearchLoading(true);
      try {
        const response = await fetch(`${API_URL}/api/auth/users/search?query=${encodeURIComponent(query)}`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || "Failed to search users");
        }
        const users = Array.isArray(data.users) ? data.users : [];
        setFriendSearchResults(users.map((item) => ({
          id: String(item?.id || ""),
          username: typeof item?.username === "string" ? item.username : "",
          lastSeenAt: item?.lastSeenAt || null,
          avatarStyle: item?.avatarStyle || "micah",
          avatarUrl: item?.avatarUrl || buildAvatarUrl(item?.id || item?.username, item?.avatarStyle || "micah")
        })));
      } catch (error) {
        setChatError(toFriendlyNetworkError(error, "Failed to search users"));
      } finally {
        setFriendSearchLoading(false);
      }
    }, 260);

    return () => window.clearTimeout(timer);
  }, [friendSearch, isAuthed, token]);

  const usersWithStatus = useMemo(() => {
    const safeOnlineUsers = Array.isArray(onlineUsers) ? onlineUsers : [];
    const onlineIds = new Set(safeOnlineUsers.map((u) => String(u?.id || "")));
    const safeUsers = Array.isArray(allUsers) ? allUsers : [];

    return safeUsers
      .map((u, index) => {
        const name = typeof u?.username === "string" ? u.username.trim() : "";
        return {
          id: String(u?.id || name || `unknown-${index}`),
          username: name || "Unknown user",
          isOnline: onlineIds.has(String(u?.id || "")),
          isBlocked: Boolean(u?.isBlocked),
          lastSeenAt: u?.lastSeenAt || null,
          avatarStyle: u?.avatarStyle || "micah",
          avatarUrl: u?.avatarUrl || buildAvatarUrl(u?.id || name, u?.avatarStyle || "micah")
        };
      })
      .sort((a, b) => a.username.localeCompare(b.username));
  }, [allUsers, onlineUsers]);

  const blockedUserIds = useMemo(() => {
    return new Set(
      usersWithStatus
        .filter((u) => u.isBlocked)
        .map((u) => String(u.id))
    );
  }, [usersWithStatus]);

  const visibleUsers = useMemo(() => {
    return usersWithStatus.filter((u) => !u.isBlocked);
  }, [usersWithStatus]);

  const chatCandidates = useMemo(() => {
    return visibleUsers.filter((u) => String(u.id) !== String(user?.id || ""));
  }, [visibleUsers, user]);

  const activeChatUser = useMemo(() => {
    return chatCandidates.find((item) => String(item.id) === String(activeChatUserId)) || null;
  }, [chatCandidates, activeChatUserId]);

  function upsertPreview(message, currentUserId) {
    const senderId = String(message?.sender?.id || "");
    const recipientId = String(message?.recipient?.id || "");
    const me = String(currentUserId || "");
    const otherUserId = senderId === me ? recipientId : senderId;

    if (!otherUserId || !me || (senderId !== me && recipientId !== me)) {
      return;
    }

    setMessagePreviews((current) => ({
      ...current,
      [otherUserId]: {
        content: message?.content?.trim() || attachmentSummaryText(message?.attachment),
        createdAt: message?.createdAt || new Date().toISOString(),
        isMine: senderId === me
      }
    }));
  }

  useEffect(() => {
    blockedIdsRef.current = blockedUserIds;
  }, [blockedUserIds]);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (!messages.length) {
      return;
    }

    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  useEffect(() => {
    if (!chatCandidates.length) {
      setActiveChatUserId("");
      return;
    }

    const exists = chatCandidates.some((item) => String(item.id) === String(activeChatUserId));
    if (!exists) {
      setActiveChatUserId(String(chatCandidates[0].id));
    }
  }, [chatCandidates, activeChatUserId]);

  useEffect(() => {
    async function loadMessages() {
      if (!activeChatUserId) {
        setMessages([]);
        return;
      }

      try {
        const response = await fetch(`${API_URL}/api/messages?userId=${encodeURIComponent(activeChatUserId)}`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || "Failed to load messages");
        }
        setMessages(data.messages || []);
      } catch (error) {
        setChatError(toFriendlyNetworkError(error, "Failed to load messages"));
      }
    }

    if (isAuthed) {
      loadMessages();
    }
  }, [isAuthed, token, activeChatUserId]);

  useEffect(() => {
    async function loadUsers() {
      try {
        const response = await fetch(`${API_URL}/api/auth/users`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || "Failed to load users");
        }
        const normalizedUsers = Array.isArray(data.users)
          ? data.users.map((item) => ({
              id: String(item?.id || ""),
              username: typeof item?.username === "string" ? item.username : "",
              lastSeenAt: item?.lastSeenAt || null,
              avatarStyle: item?.avatarStyle || "micah",
              avatarUrl: item?.avatarUrl || buildAvatarUrl(item?.id || item?.username, item?.avatarStyle || "micah"),
              isBlocked: Boolean(item?.isBlocked)
            }))
          : [];
        setAllUsers(normalizedUsers);
      } catch (error) {
        setChatError(toFriendlyNetworkError(error, "Failed to load users"));
      }
    }

    if (isAuthed) {
      loadUsers();
    }
  }, [isAuthed, token]);

  useEffect(() => {
    async function loadPreviews() {
      try {
        const response = await fetch(`${API_URL}/api/messages/previews`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || "Failed to load message previews");
        }

        const normalized = Array.isArray(data.previews)
          ? data.previews.reduce((acc, item) => {
              const id = String(item?.userId || "");
              if (!id) {
                return acc;
              }

              acc[id] = {
                content: typeof item?.content === "string" ? item.content : attachmentSummaryText(item?.attachment),
                createdAt: item?.createdAt || "",
                isMine: Boolean(item?.isMine)
              };

              return acc;
            }, {})
          : {};

        setMessagePreviews(normalized);
      } catch (error) {
        setChatError(toFriendlyNetworkError(error, "Failed to load message previews"));
      }
    }

    if (isAuthed) {
      loadPreviews();
    }
  }, [isAuthed, token]);

  useEffect(() => {
    if (!isAuthed) {
      return undefined;
    }

    const socket = io(SOCKET_URL, {
      auth: { token }
    });

    socketRef.current = socket;

    socket.on("connect_error", (error) => {
      setChatError(error.message || "Socket connection failed");
    });

    socket.on("new_message", (message) => {
      const senderId = String(message?.sender?.id || "");
      const recipientId = String(message?.recipient?.id || "");
      const me = String(user?.id || "");
      if (blockedIdsRef.current.has(senderId)) {
        return;
      }
      const involvesMe = senderId === me || recipientId === me;
      const otherUserId = senderId === me ? recipientId : senderId;
      if (involvesMe && otherUserId) {
        upsertPreview(message, me);
      }
      if (!involvesMe || otherUserId !== String(activeChatUserId)) {
        return;
      }
      setMessages((current) => [...current, message]);
    });

    socket.on("online_users", (users) => {
      setOnlineUsers(Array.isArray(users) ? users : []);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthed, token, user, activeChatUserId]);

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthError("");

    const payload =
      mode === "register"
        ? { username, email, password, avatarStyle }
        : { identifier, password };

    const endpoint = mode === "register" ? "register" : "login";

    try {
      const response = await fetch(`${API_URL}/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Authentication failed");
      }

      setToken(data.token);
      setUser({
        ...data.user,
        avatarStyle: data.user?.avatarStyle || "micah",
        avatarUrl: data.user?.avatarUrl || buildAvatarUrl(data.user?.id || data.user?.username, data.user?.avatarStyle || "micah")
      });
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify({
        ...data.user,
        avatarStyle: data.user?.avatarStyle || "micah",
        avatarUrl: data.user?.avatarUrl || buildAvatarUrl(data.user?.id || data.user?.username, data.user?.avatarStyle || "micah")
      }));
      setWelcomeMessage(mode === "register" ? `Welcome, ${data.user.username}!` : `Welcome back, ${data.user.username}!`);

      setPassword("");
      setEmail("");
      setUsername("");
      setIdentifier("");
      setAvatarStyle("micah");
    } catch (error) {
      setAuthError(toFriendlyNetworkError(error, "Authentication failed"));
    }
  }

  async function saveAvatarStyle(nextStyle) {
    if (!token || !user || !AVAILABLE_AVATAR_STYLES.includes(nextStyle)) {
      return;
    }

    setAvatarSaving(true);
    setChatError("");

    try {
      const response = await fetch(`${API_URL}/api/auth/me/avatar`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ avatarStyle: nextStyle })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to update avatar");
      }

      const updatedUser = {
        ...user,
        ...data.user,
        avatarStyle: data.user?.avatarStyle || nextStyle,
        avatarUrl: data.user?.avatarUrl || buildAvatarUrl(user.id || user.username, nextStyle)
      };

      setUser(updatedUser);
      localStorage.setItem("user", JSON.stringify(updatedUser));
      setAvatarStyle(updatedUser.avatarStyle || "micah");
      setAvatarPickerOpen(false);
      setWelcomeMessage("Avatar updated");
    } catch (error) {
      setChatError(toFriendlyNetworkError(error, "Failed to update avatar"));
    } finally {
      setAvatarSaving(false);
    }
  }

  async function addFriend(targetUser) {
    const targetId = String(targetUser?.id || "").trim();
    if (!targetId || !token) {
      return;
    }

    setAddingFriendId(targetId);
    setChatError("");

    try {
      const response = await fetch(`${API_URL}/api/auth/friends/${targetId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to add friend");
      }

      const friend = data?.user
        ? {
            id: String(data.user.id || ""),
            username: typeof data.user.username === "string" ? data.user.username : "",
            lastSeenAt: data.user.lastSeenAt || null,
            avatarStyle: data.user.avatarStyle || "micah",
            avatarUrl: data.user.avatarUrl || buildAvatarUrl(data.user.id || data.user.username, data.user.avatarStyle || "micah"),
            isBlocked: false
          }
        : null;

      if (friend?.id) {
        setAllUsers((current) => {
          if (current.some((item) => String(item.id) === String(friend.id))) {
            return current;
          }
          return [...current, friend].sort((a, b) => String(a.username || "").localeCompare(String(b.username || "")));
        });
        setFriendSearchResults((current) => current.filter((item) => String(item.id) !== String(friend.id)));
        setFriendSearch("");
        setWelcomeMessage(`Added ${friend.username}`);
      }
    } catch (error) {
      setChatError(toFriendlyNetworkError(error, "Failed to add friend"));
    } finally {
      setAddingFriendId("");
    }
  }

  function clearPendingAttachment() {
    setPendingAttachment(null);
    setAttachmentError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Unable to read file"));
      reader.readAsDataURL(file);
    });
  }

  async function handleAttachmentSelect(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!isSupportedAttachment(file)) {
      setAttachmentError("Only image, video, or audio files are supported");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setAttachmentError("Attachment must be 20MB or smaller");
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setPendingAttachment({
        kind: file.type.startsWith("image/")
          ? "image"
          : file.type.startsWith("video/")
            ? "video"
            : "audio",
        mimeType: file.type,
        dataUrl,
        name: file.name,
        size: file.size
      });
      setAttachmentError("");
    } catch (error) {
      setAttachmentError(toFriendlyNetworkError(error, "Failed to load attachment"));
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  async function toggleVoiceNote() {
    if (isRecording) {
      stopRecording();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === "undefined") {
      setAttachmentError("Voice notes are not supported in this browser");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recordingChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const chunks = recordingChunksRef.current;
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setIsRecording(false);

        if (!chunks.length) {
          return;
        }

        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 20 * 1024 * 1024) {
          setAttachmentError("Voice note must be 20MB or smaller");
          return;
        }

        const dataUrl = await fileToDataUrl(blob);
        setPendingAttachment({
          kind: "audio",
          mimeType: blob.type || "audio/webm",
          dataUrl,
          name: "voice-note.webm",
          size: blob.size
        });
      };

      recorder.start();
      setIsRecording(true);
      setAttachmentError("");
    } catch (error) {
      setAttachmentError(toFriendlyNetworkError(error, "Unable to access microphone"));
      setIsRecording(false);
    }
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken("");
    setUser(null);
    setMessages([]);
    setAllUsers([]);
    setOnlineUsers([]);
    setMessagePreviews({});
    setActiveChatUserId("");
    setChatError("");
    setWelcomeMessage("");
  }

  function sendMessage(event) {
    event.preventDefault();
    setChatError("");

    const content = messageText.trim();
    if ((!content && !pendingAttachment) || !socketRef.current || !activeChatUserId) {
      return;
    }

    socketRef.current.emit("chat_message", {
      content,
      recipientId: activeChatUserId,
      attachment: pendingAttachment
    }, (response) => {
      if (!response?.ok) {
        setChatError(response?.message || "Failed to send message");
      }
    });

    setMessageText("");
    clearPendingAttachment();
  }

  async function confirmKickTarget() {
    if (!kickTarget || !token) {
      return;
    }

    setKickLoading(true);
    setChatError("");

    try {
      const response = await fetch(`${API_URL}/api/auth/friends/${kickTarget.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to kick out user");
      }

      setAllUsers((current) => current.filter((item) => String(item.id) !== String(kickTarget.id)));
      setMessages((current) =>
        current.filter((msg) => String(msg?.sender?.id || "") !== String(kickTarget.id))
      );
      if (String(activeChatUserId) === String(kickTarget.id)) {
        setActiveChatUserId("");
      }
      setMessagePreviews((current) => {
        const next = { ...current };
        delete next[String(kickTarget.id)];
        return next;
      });
      setKickTarget(null);
    } catch (error) {
      setChatError(toFriendlyNetworkError(error, "Failed to unfriend user"));
    } finally {
      setKickLoading(false);
    }
  }

  if (!isAuthed) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Chatz</h1>
          <p>Welcome to Chatz! Please sign in or create an account to get started.</p>

          <form onSubmit={handleAuthSubmit} className="auth-form">
            {mode === "register" ? (
              <>
                <FormField
                  label="Username"
                  value={username}
                  onChange={setUsername}
                  placeholder="Username"
                />
                <FormField
                  label="Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@example.com"
                />

                <div className="avatar-picker auth-avatar-picker">
                  <span>Choose avatar</span>
                  <div className="avatar-options">
                    {AVAILABLE_AVATAR_STYLES.map((style) => {
                      const selected = avatarStyle === style;
                      return (
                        <button
                          key={style}
                          type="button"
                          className={selected ? "avatar-option active" : "avatar-option"}
                          onClick={() => setAvatarStyle(style)}
                          aria-label={`Use ${style} avatar style`}
                        >
                          <img src={buildAvatarUrl(username || email || "new-user", style)} alt="" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <FormField
                label="Username or Email"
                value={identifier}
                onChange={setIdentifier}
                placeholder="your_username or you@example.com"
              />
            )}

            <FormField
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="at least 6 characters"
            />

            {authError ? <p className="error">{authError}</p> : null}

            <button type="submit">{mode === "register" ? "Create account" : "Sign in"}</button>
          </form>

          <p className="switcher">
            {mode === "register" ? "Already have an account?" : "New here?"}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "register" ? "login" : "register");
                setAuthError("");
              }}
            >
              {mode === "register" ? "Sign in" : "Create one"}
            </button>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="chat-page">
      <aside className={mobileSidebarOpen ? "sidebar open" : "sidebar"}>
        <div className="current-user-card">
          <h2>Logged in as</h2>
          <div className="current-user-row">
            <img className="user-avatar" src={user.avatarUrl || buildAvatarUrl(user.id || user.username, user.avatarStyle || "micah")} alt="" />
            <p className="pill">{user.username}</p>
            <button
              type="button"
              className="avatar-change-btn"
              onClick={() => setAvatarPickerOpen((prev) => !prev)}
            >
              {avatarPickerOpen ? "Close" : "Change avatar"}
            </button>
          </div>

          {avatarPickerOpen ? (
            <div className="avatar-picker">
              <div className="avatar-options">
                {AVAILABLE_AVATAR_STYLES.map((style) => {
                  const active = (user.avatarStyle || "micah") === style;
                  return (
                    <button
                      key={style}
                      type="button"
                      className={active ? "avatar-option active" : "avatar-option"}
                      onClick={() => saveAvatarStyle(style)}
                      disabled={avatarSaving}
                      aria-label={`Switch avatar to ${style}`}
                    >
                      <img src={buildAvatarUrl(user.id || user.username, style)} alt="" />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
        <div>
          <h3>Chats</h3>
          <div className="friend-search">
            <input
              value={friendSearch}
              onChange={(event) => setFriendSearch(event.target.value)}
              placeholder="Search users to add friend"
              maxLength={40}
            />
            {friendSearchLoading ? <p className="friend-search-note">Searching...</p> : null}
            {!friendSearchLoading && friendSearch.trim() && !friendSearchResults.length ? (
              <p className="friend-search-note">No users found</p>
            ) : null}
            {friendSearchResults.length ? (
              <ul className="friend-search-results">
                {friendSearchResults.map((item) => (
                  <li key={item.id} className="friend-search-row">
                    <div className="friend-search-user">
                      <img className="user-avatar" src={item.avatarUrl} alt="" />
                      <span>{item.username}</span>
                    </div>
                    <button
                      type="button"
                      className="add-friend-btn"
                      onClick={() => addFriend(item)}
                      disabled={addingFriendId === item.id}
                    >
                      {addingFriendId === item.id ? "Adding..." : "Add"}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <ul>
            {chatCandidates.map((u) => (
              <li key={u.id} className="user-status-row">
                <button
                  type="button"
                  className={String(activeChatUserId) === String(u.id) ? "chat-user-btn active" : "chat-user-btn"}
                  onClick={() => {
                    setActiveChatUserId(String(u.id));
                    setMobileSidebarOpen(false);
                  }}
                >
                  <div className="user-status-main">
                    <img className="user-avatar" src={u.avatarUrl || buildAvatarUrl(u.id || u.username, u.avatarStyle || "micah")} alt="" />
                    <span
                      className={u.isOnline ? "status-dot online" : "status-dot offline"}
                      aria-label={u.isOnline ? "online" : "offline"}
                      title={u.isOnline ? "Online" : "Offline"}
                    />
                    <div className="chat-user-meta">
                      <span className="chat-user-name">{u.username}</span>
                      <span className="chat-user-preview">
                        {u.isOnline ? "Online now" : formatLastSeen(u.lastSeenAt)}
                      </span>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  className="kick-btn"
                  onClick={() => setKickTarget({ id: u.id, username: u.username })}
                >
                  Unfriend
                </button>
              </li>
            ))}
          </ul>
        </div>
        <button onClick={logout} className="logout-btn">Sign out</button>
      </aside>

      {mobileSidebarOpen ? (
        <button
          type="button"
          className="mobile-sidebar-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="Close chats menu"
        />
      ) : null}

      <section className="chat-shell">
        {welcomeMessage ? <p className="welcome-banner">{welcomeMessage}</p> : null}
        <header>
          <div className="chat-header-user">
            <button
              type="button"
              className="mobile-sidebar-toggle"
              onClick={() => setMobileSidebarOpen((prev) => !prev)}
              aria-label="Open chats menu"
            >
              Chats
            </button>
            {activeChatUser ? (
              <img className="chat-header-avatar user-avatar" src={activeChatUser.avatarUrl || buildAvatarUrl(activeChatUser.id || activeChatUser.username, activeChatUser.avatarStyle || "micah")} alt="" />
            ) : null}
            <h1>{activeChatUser ? `Chat with ${activeChatUser.username}` : "Select someone to chat"}</h1>
          </div>
          <p>
            {activeChatUser
              ? (activeChatUser.isOnline ? "Online now" : formatLastSeen(activeChatUser.lastSeenAt))
              : "Choose one person from the left to start chatting"}
          </p>
        </header>

        {isRecording ? <p className="voice-note-status">Recording voice note...</p> : null}

        <div className="messages">
          {messages.map((msg) => {
            const mine = msg.sender?.id === user.id;
            const messageAttachment = msg.attachment || null;
            const isAudio = messageAttachment?.kind === "audio";
            return (
              <article key={msg.id} className={mine ? "message mine" : "message"}>
                <h4>{msg.sender?.username || "Unknown"}</h4>
                <p>{msg.content}</p>
                {renderAttachment(messageAttachment)}
                {!msg.content && messageAttachment && isAudio ? (
                  <span className="message-attachment-label">Voice note</span>
                ) : null}
                <time>{new Date(msg.createdAt).toLocaleTimeString()}</time>
              </article>
            );
          })}
          <div ref={endRef} />
        </div>

        <form className="composer" onSubmit={sendMessage}>
          {pendingAttachment ? (
            <div className="composer-attachment-preview">
              <span>{attachmentPreviewLabel(pendingAttachment.kind)}</span>
              <button type="button" className="composer-remove-attachment" onClick={clearPendingAttachment}>
                Remove
              </button>
            </div>
          ) : null}
          {attachmentError ? <p className="error chat-error">{attachmentError}</p> : null}
          <div className="composer-main-row">
            <input
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              placeholder={activeChatUser ? `Message ${activeChatUser.username}...` : "Select a person first"}
              maxLength={1000}
              disabled={!activeChatUser}
            />
            <button type="submit" disabled={!activeChatUser || (!messageText.trim() && !pendingAttachment)}>
              Send
            </button>
          </div>
          <div className="composer-actions">
            <button type="button" className="composer-action-btn" onClick={() => fileInputRef.current?.click()} disabled={!activeChatUser}>
              Image / Video
            </button>
            <button type="button" className={isRecording ? "composer-action-btn recording" : "composer-action-btn"} onClick={toggleVoiceNote} disabled={!activeChatUser}>
              {isRecording ? "Stop voice note" : "Voice note"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              hidden
              onChange={handleAttachmentSelect}
            />
          </div>
        </form>

        {chatError ? <p className="error chat-error">{chatError}</p> : null}
      </section>

      {kickTarget ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="kick-title">
            <h3 id="kick-title">Unfriend user?</h3>
            <p>
              Are you sure you want to remove {kickTarget.username} from your friend list?
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="dialog-cancel"
                onClick={() => setKickTarget(null)}
                disabled={kickLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="dialog-confirm"
                onClick={confirmKickTarget}
                disabled={kickLoading}
              >
                {kickLoading ? "Removing..." : "Yes, unfriend"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
