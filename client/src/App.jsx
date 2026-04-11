import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const PROD_BACKEND_URL = "https://chatz-k70j.onrender.com";
const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? PROD_BACKEND_URL : "http://localhost:5000");
const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.PROD ? PROD_BACKEND_URL : "http://localhost:5000");

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

  const [messages, setMessages] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [messagePreviews, setMessagePreviews] = useState({});
  const [activeChatUserId, setActiveChatUserId] = useState("");
  const [messageText, setMessageText] = useState("");
  const [chatError, setChatError] = useState("");
  const [kickTarget, setKickTarget] = useState(null);
  const [kickLoading, setKickLoading] = useState(false);

  const socketRef = useRef(null);
  const endRef = useRef(null);
  const blockedIdsRef = useRef(new Set());

  const isAuthed = Boolean(token && user);

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
          isBlocked: Boolean(u?.isBlocked)
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
        content: message?.content || "",
        createdAt: message?.createdAt || new Date().toISOString(),
        isMine: senderId === me
      }
    }));
  }

  useEffect(() => {
    blockedIdsRef.current = blockedUserIds;
  }, [blockedUserIds]);

  useEffect(() => {
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
              content: typeof item?.content === "string" ? item.content : "",
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
        ? { username, email, password }
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
      setUser(data.user);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));

      setPassword("");
      setEmail("");
      setUsername("");
      setIdentifier("");
    } catch (error) {
      setAuthError(toFriendlyNetworkError(error, "Authentication failed"));
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
  }

  function sendMessage(event) {
    event.preventDefault();
    setChatError("");

    const content = messageText.trim();
    if (!content || !socketRef.current || !activeChatUserId) {
      return;
    }

    socketRef.current.emit("chat_message", { content, recipientId: activeChatUserId }, (response) => {
      if (!response?.ok) {
        setChatError(response?.message || "Failed to send message");
      }
    });

    setMessageText("");
  }

  async function confirmKickTarget() {
    if (!kickTarget || !token) {
      return;
    }

    setKickLoading(true);
    setChatError("");

    try {
      const response = await fetch(`${API_URL}/api/auth/users/${kickTarget.id}/block`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to kick out user");
      }

      setAllUsers((current) =>
        current.map((item) =>
          String(item.id) === String(kickTarget.id)
            ? { ...item, isBlocked: true }
            : item
        )
      );
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
      <aside className="sidebar">
        <div>
          <h2>Logged in as</h2>
          <p className="pill">{user.username}</p>
        </div>
        <div>
          <h3>Chats</h3>
          <ul>
            {chatCandidates.map((u) => (
              <li key={u.id} className="user-status-row">
                <button
                  type="button"
                  className={String(activeChatUserId) === String(u.id) ? "chat-user-btn active" : "chat-user-btn"}
                  onClick={() => setActiveChatUserId(String(u.id))}
                >
                  <div className="user-status-main">
                    <span
                      className={u.isOnline ? "status-dot online" : "status-dot offline"}
                      aria-label={u.isOnline ? "online" : "offline"}
                      title={u.isOnline ? "Online" : "Offline"}
                    />
                    <div className="chat-user-meta">
                      <span className="chat-user-name">{u.username}</span>
                      <span className="chat-user-preview">
                        {messagePreviews[u.id]
                          ? `${messagePreviews[u.id].isMine ? "You: " : ""}${messagePreviews[u.id].content}`
                          : "No messages yet"}
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

      <section className="chat-shell">
        <header>
          <h1>{activeChatUser ? `Chat with ${activeChatUser.username}` : "Select someone to chat"}</h1>
          <p>
            {activeChatUser
              ? `${messages.length} messages in this conversation`
              : "Choose one person from the left to start chatting"}
          </p>
        </header>

        <div className="messages">
          {messages.map((msg) => {
            const mine = msg.sender?.id === user.id;
            return (
              <article key={msg.id} className={mine ? "message mine" : "message"}>
                <h4>{msg.sender?.username || "Unknown"}</h4>
                <p>{msg.content}</p>
                <time>{new Date(msg.createdAt).toLocaleTimeString()}</time>
              </article>
            );
          })}
          <div ref={endRef} />
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <input
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            placeholder={activeChatUser ? `Message ${activeChatUser.username}...` : "Select a person first"}
            maxLength={1000}
            disabled={!activeChatUser}
          />
          <button type="submit" disabled={!activeChatUser}>Send</button>
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
