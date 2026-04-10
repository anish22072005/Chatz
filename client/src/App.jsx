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
    return raw ? JSON.parse(raw) : null;
  });
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [chatError, setChatError] = useState("");

  const socketRef = useRef(null);
  const endRef = useRef(null);

  const isAuthed = Boolean(token && user);

  const sortedOnlineUsers = useMemo(() => {
    return [...onlineUsers].sort((a, b) => a.username.localeCompare(b.username));
  }, [onlineUsers]);

  useEffect(() => {
    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  useEffect(() => {
    async function loadMessages() {
      try {
        const response = await fetch(`${API_URL}/api/messages`, {
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
      setMessages((current) => [...current, message]);
    });

    socket.on("online_users", (users) => {
      setOnlineUsers(users || []);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthed, token]);

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
    setOnlineUsers([]);
    setChatError("");
  }

  function sendMessage(event) {
    event.preventDefault();
    setChatError("");

    const content = messageText.trim();
    if (!content || !socketRef.current) {
      return;
    }

    socketRef.current.emit("chat_message", { content }, (response) => {
      if (!response?.ok) {
        setChatError(response?.message || "Failed to send message");
      }
    });

    setMessageText("");
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
          <h3>Online</h3>
          <ul>
            {sortedOnlineUsers.map((u) => (
              <li key={u.id}>{u.username}</li>
            ))}
          </ul>
        </div>
        <button onClick={logout} className="logout-btn">Sign out</button>
      </aside>

      <section className="chat-shell">
        <header>
          <h1>Chat Room</h1>
          <p>{messages.length} messages synced from MongoDB</p>
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
            placeholder="Type your message..."
            maxLength={1000}
          />
          <button type="submit">Send</button>
        </form>

        {chatError ? <p className="error chat-error">{chatError}</p> : null}
      </section>
    </main>
  );
}
