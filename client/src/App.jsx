import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

const socket = io(SERVER_URL, {
  transports: ["websocket"],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});

const ACCENTS = ["#6ee7b7", "#7dd3fc", "#fca5a5", "#fcd34d", "#c4b5fd", "#f9a8d4", "#5eead4", "#fdba74"];
function accentFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}
function initials(name) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

// ---------- Landing screen ----------
function Landing({ onEnter }) {
  const [name, setName] = useState(() => localStorage.getItem("name") || "");
  const [typed, setTyped] = useState("");
  const full = "pingo";

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(full.slice(0, i));
      if (i >= full.length) clearInterval(id);
    }, 90);
    return () => clearInterval(id);
  }, []);

  const go = () => {
    const n = name.trim();
    if (!n) return;
    onEnter(n);
  };

  return (
    <div className="landing">
      <div className="grid-bg" />
      <div className="scanline" />
      <div className="orb orb-a" />
      <div className="orb orb-b" />

      <div className="landing-inner">
        <div className="logo-mark">&gt;_</div>
        <h1 className="logo-type">
          {typed}
          <span className="caret">█</span>
        </h1>
        <p className="tagline">A real-time chat console. Pick a handle and jump in.</p>

        <div className="enter-card">
          <label className="enter-label">$ whoami</label>
          <div className="enter-row">
            <span className="enter-prompt">&gt;</span>
            <input
              className="enter-input"
              placeholder="enter your handle…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go()}
              maxLength={32}
              autoFocus
            />
          </div>
          <button className="enter-btn" onClick={go} disabled={!name.trim()}>
            connect <span className="arrow">→</span>
          </button>
        </div>

        <div className="features">
          <span>⚡ live messaging</span>
          <span>👥 see who's online</span>
          <span>🔒 rate-limited &amp; validated</span>
        </div>
      </div>
    </div>
  );
}

// ---------- Chat screen ----------
function Chat({ username, onLeave }) {
  const [text, setText] = useState("");
  const [chat, setChat] = useState([]);
  const [online, setOnline] = useState([]);
  const [typingUser, setTypingUser] = useState("");
  const [rateError, setRateError] = useState("");
  const [connected, setConnected] = useState(socket.connected);

  const listRef = useRef(null);
  const typingTimeout = useRef(null);
  const me = username.trim() || "Me";

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onHistory = (msgs) => setChat(msgs);
    const onMessage = (msg) => setChat((prev) => [...prev, msg]);
    const onOnline = (users) => setOnline(users);
    const onTyping = (name) => {
      setTypingUser(name);
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => setTypingUser(""), 2000);
    };
    const onRate = (msg) => {
      setRateError(msg);
      setTimeout(() => setRateError(""), 3000);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("history", onHistory);
    socket.on("chat:message", onMessage);
    socket.on("online", onOnline);
    socket.on("typing", onTyping);
    socket.on("error:rate", onRate);

    socket.emit("setName", me);
    socket.emit("history:request");

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("history", onHistory);
      socket.off("chat:message", onMessage);
      socket.off("online", onOnline);
      socket.off("typing", onTyping);
      socket.off("error:rate", onRate);
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
    };
  }, [me]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, typingUser]);

  const handleTyping = (e) => {
    setText(e.target.value);
    if (me) socket.emit("typing", me);
  };

  const send = () => {
    const t = text.trim();
    if (!t) return;
    socket.emit("chat:message", { user: me, message: t });
    setText("");
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const grouped = useMemo(() => {
    return chat.map((m, i) => ({
      ...m,
      mine: m.user === me,
      firstInGroup: i === 0 || chat[i - 1].user !== m.user,
    }));
  }, [chat, me]);

  const uniqueOnline = useMemo(() => {
    const set = Array.from(new Set(online));
    set.sort((a, b) => (a === me ? -1 : b === me ? 1 : a.localeCompare(b)));
    return set;
  }, [online, me]);

  return (
    <div className="chat-screen">
      <div className="shell">
        <aside className="sidebar">
          <div className="side-head">
            <span className="prompt">&gt;_</span>
            <span className="title">pingo</span>
          </div>

          <div className="side-status">
            <span className={`dot ${connected ? "on" : "off"}`} />
            {connected ? "connected" : "connecting…"}
          </div>

          <div className="side-label">online — {uniqueOnline.length}</div>
          <div className="side-users">
            {uniqueOnline.map((u) => (
              <div key={u} className="user-row">
                <div className="avatar sm" style={{ "--accent": accentFor(u) }}>{initials(u)}</div>
                <span className="user-name">{u}{u === me && <span className="you-tag"> you</span>}</span>
                <span className="user-online" style={{ background: accentFor(u) }} />
              </div>
            ))}
          </div>

          <div className="side-foot">
            <div className="stat">
              <span className="stat-num">{chat.length}</span>
              <span className="stat-label">messages</span>
            </div>
            <button className="leave-btn" onClick={onLeave}>leave</button>
          </div>
        </aside>

        <main className="main">
          <header className="bar">
            <div className="bar-title"># general</div>
            <div className="status">
              <span className="count">{uniqueOnline.length} online</span>
            </div>
          </header>

          <div ref={listRef} className="stream">
            {grouped.length === 0 && (
              <div className="empty">
                <div className="empty-art">&gt;_</div>
                <p>No messages yet. Say something to get started.</p>
              </div>
            )}
            {grouped.map((m) => (
              <div key={m.id} className={`line ${m.mine ? "mine" : "theirs"}`}>
                {!m.mine && (
                  <div
                    className="avatar"
                    style={{ "--accent": accentFor(m.user), visibility: m.firstInGroup ? "visible" : "hidden" }}
                  >
                    {initials(m.user)}
                  </div>
                )}
                <div className="bubble-wrap">
                  {m.firstInGroup && (
                    <div className="who">
                      {m.mine ? "you" : m.user}
                      <span className="time">
                        {new Date(m.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  )}
                  <div className="bubble">{m.message}</div>
                </div>
              </div>
            ))}

            {typingUser && typingUser !== me && (
              <div className="line theirs">
                <div className="avatar" style={{ "--accent": accentFor(typingUser) }}>{initials(typingUser)}</div>
                <div className="bubble-wrap">
                  <div className="bubble typing">
                    <span className="d" /><span className="d" /><span className="d" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {rateError && <div className="toast">⚠ {rateError}</div>}

          <footer className="composer">
            <div className="msg-row">
              <textarea
                className="msg-input"
                placeholder="Type a message — Enter to send, Shift+Enter for newline"
                value={text}
                onChange={handleTyping}
                onKeyDown={handleKey}
                rows={1}
                maxLength={1000}
              />
              <button className="send" onClick={send} disabled={!text.trim()} aria-label="Send message">↑</button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

// ---------- Root ----------
export default function App() {
  const [username, setUsername] = useState("");
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);

const enter = (name) => {
    setUsername(name);
    localStorage.setItem("name", name);
    if (!socket.connected) socket.connect();
    setLeaving(true);
    setTimeout(() => setEntered(true), 600);
  };

  const leave = () => {
    socket.disconnect();
    setEntered(false);
    setLeaving(false);
  };

  return (
    <div className="app">
      <style>{css}</style>
      {!entered ? (
        <div className={leaving ? "fade-out" : ""}>
          <Landing onEnter={enter} />
        </div>
      ) : (
        <div className="fade-in">
          <Chat username={username} onLeave={leave} />
        </div>
      )}
    </div>
  );
}

const css = `
:root {
  --bg: #0b0f14;
  --panel: #11161d;
  --panel-2: #161d26;
  --line: #1f2937;
  --text: #e5e9f0;
  --muted: #7c8896;
  --accent: #6ee7b7;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
.app {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  overflow: hidden;
}

.fade-out { animation: fadeOut 0.6s ease forwards; }
.fade-in { animation: fadeIn 0.6s ease; width: 100%; display: grid; place-items: center; }
@keyframes fadeOut { to { opacity: 0; transform: scale(0.96); } }
@keyframes fadeIn { from { opacity: 0; transform: scale(1.02); } to { opacity: 1; transform: none; } }

.landing { position: relative; width: 100dvw; height: 100dvh; display: grid; place-items: center; overflow: hidden; }
.grid-bg {
  position: absolute; inset: 0;
  background-image: linear-gradient(#1b2735 1px, transparent 1px), linear-gradient(90deg, #1b2735 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse 70% 60% at 50% 45%, #000 30%, transparent 75%);
  -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 45%, #000 30%, transparent 75%);
  animation: drift 22s linear infinite; opacity: 0.5;
}
@keyframes drift { from { background-position: 0 0, 0 0; } to { background-position: 44px 44px, 44px 44px; } }
.scanline { position: absolute; left: 0; right: 0; height: 140px; background: linear-gradient(180deg, transparent, #6ee7b714, transparent); animation: scan 6s linear infinite; pointer-events: none; }
@keyframes scan { from { top: -140px; } to { top: 100%; } }
.orb { position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.35; }
.orb-a { width: 380px; height: 380px; background: #1d4ed8; top: -80px; left: -60px; animation: float1 12s ease-in-out infinite; }
.orb-b { width: 320px; height: 320px; background: #0f766e; bottom: -90px; right: -50px; animation: float2 14s ease-in-out infinite; }
@keyframes float1 { 50% { transform: translate(40px, 30px); } }
@keyframes float2 { 50% { transform: translate(-30px, -40px); } }
.landing-inner { position: relative; z-index: 2; text-align: center; padding: 24px; max-width: 520px; width: 100%; animation: pop 0.7s cubic-bezier(.2,.8,.2,1); }
@keyframes pop { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
.logo-mark { font-family: var(--mono); font-size: 40px; color: var(--accent); text-shadow: 0 0 24px #6ee7b766; margin-bottom: 8px; }
.logo-type { font-family: var(--mono); font-size: 38px; font-weight: 700; margin: 0; letter-spacing: 1px; min-height: 48px; }
.caret { animation: caretBlink 1s steps(1) infinite; color: var(--accent); }
@keyframes caretBlink { 50% { opacity: 0; } }
.tagline { color: var(--muted); font-size: 15px; margin: 12px 0 28px; }
.enter-card { background: #0e141bcc; backdrop-filter: blur(8px); border: 1px solid var(--line); border-radius: 16px; padding: 20px; text-align: left; box-shadow: 0 20px 50px #00000055; }
.enter-label { font-family: var(--mono); font-size: 12px; color: var(--accent); display: block; margin-bottom: 10px; }
.enter-row { display: flex; align-items: center; gap: 8px; background: #0b0f14; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; transition: border-color 0.2s; }
.enter-row:focus-within { border-color: var(--accent); }
.enter-prompt { font-family: var(--mono); color: var(--accent); }
.enter-input { flex: 1; background: transparent; border: none; outline: none; color: var(--text); font-family: var(--mono); font-size: 15px; }
.enter-btn { margin-top: 14px; width: 100%; padding: 12px; border: none; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; color: #fff; background: linear-gradient(180deg, #2563eb, #1d4ed8); transition: transform 0.1s ease, opacity 0.15s ease, box-shadow 0.2s ease; }
.enter-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 24px #2563eb55; }
.enter-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.enter-btn .arrow { transition: transform 0.15s ease; display: inline-block; }
.enter-btn:hover:not(:disabled) .arrow { transform: translateX(4px); }
.features { display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; margin-top: 24px; font-size: 12px; color: var(--muted); font-family: var(--mono); }

.chat-screen { width: 100%; display: grid; place-items: center; padding: 16px; }
.shell {
  width: 100%; max-width: 1180px; height: min(90dvh, 940px);
  display: grid; grid-template-columns: 280px 1fr;
  background: var(--panel); border: 1px solid var(--line); border-radius: 16px;
  overflow: hidden; box-shadow: 0 24px 60px #00000066;
}

.sidebar { display: flex; flex-direction: column; background: var(--panel-2); border-right: 1px solid var(--line); padding: 16px 14px; }
.side-head { display: flex; align-items: center; gap: 10px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
.side-status { display: flex; align-items: center; gap: 8px; font-size: 12px; font-family: var(--mono); color: var(--muted); padding: 12px 2px; }
.side-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); font-family: var(--mono); margin: 6px 2px 8px; }
.side-users { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.side-users::-webkit-scrollbar { width: 6px; }
.side-users::-webkit-scrollbar-thumb { background: #232c38; border-radius: 6px; }
.user-row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 10px; transition: background 0.15s; }
.user-row:hover { background: #0e141b; }
.user-name { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.you-tag { font-size: 11px; color: var(--muted); font-family: var(--mono); }
.user-online { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 8px currentColor; }
.side-foot { display: flex; align-items: center; justify-content: space-between; padding-top: 14px; margin-top: 8px; border-top: 1px solid var(--line); }
.stat { display: flex; flex-direction: column; }
.stat-num { font-size: 18px; font-weight: 700; font-family: var(--mono); color: var(--accent); }
.stat-label { font-size: 11px; color: var(--muted); }
.leave-btn { background: #0e141b; border: 1px solid var(--line); color: var(--muted); font-family: var(--mono); font-size: 12px; padding: 7px 14px; border-radius: 9px; cursor: pointer; transition: all 0.15s; }
.leave-btn:hover { border-color: #7f1d1d; color: #fca5a5; }

.main { display: flex; flex-direction: column; min-width: 0; }
.bar { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--line); }
.bar-title { font-family: var(--mono); font-size: 15px; font-weight: 700; }
.prompt { font-family: var(--mono); color: var(--accent); font-weight: 700; }
.title { font-family: var(--mono); letter-spacing: 0.5px; font-size: 14px; }
.status { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); font-family: var(--mono); }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot.on { background: #34d399; box-shadow: 0 0 10px #34d399aa; }
.dot.off { background: #f59e0b; }
.stream { flex: 1; overflow-y: auto; padding: 22px 28px; display: flex; flex-direction: column; gap: 6px; scroll-behavior: smooth; }
.stream::-webkit-scrollbar { width: 8px; }
.stream::-webkit-scrollbar-thumb { background: #232c38; border-radius: 8px; }
.empty { margin: auto; text-align: center; color: var(--muted); }
.empty-art { font-family: var(--mono); font-size: 32px; color: var(--accent); opacity: 0.6; margin-bottom: 8px; }
.line { display: flex; gap: 10px; align-items: flex-end; animation: rise 0.18s ease-out; }
.line.mine { flex-direction: row-reverse; }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.avatar { width: 32px; height: 32px; flex-shrink: 0; border-radius: 10px; display: grid; place-items: center; font-size: 12px; font-weight: 700; font-family: var(--mono); background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); }
.avatar.sm { width: 30px; height: 30px; font-size: 11px; border-radius: 9px; }
.bubble-wrap { max-width: 68%; display: flex; flex-direction: column; }
.line.mine .bubble-wrap { align-items: flex-end; }
.who { font-size: 11px; color: var(--muted); margin: 0 4px 3px; font-family: var(--mono); display: flex; gap: 8px; }
.time { opacity: 0.6; }
.bubble { padding: 9px 13px; border-radius: 14px; line-height: 1.45; font-size: 14px; background: var(--panel-2); border: 1px solid var(--line); word-break: break-word; white-space: pre-wrap; }
.line.theirs .bubble { border-top-left-radius: 4px; }
.line.mine .bubble { background: linear-gradient(180deg, #2563eb, #1d4ed8); border-color: #2f6bff; border-top-right-radius: 4px; color: #fff; }
.bubble.typing { display: flex; gap: 4px; padding: 12px 14px; }
.bubble.typing .d { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite; }
.bubble.typing .d:nth-child(2) { animation-delay: 0.2s; }
.bubble.typing .d:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }
.toast { margin: 0 20px; padding: 8px 12px; font-size: 13px; font-family: var(--mono); color: #fecaca; background: #3f1d1d; border: 1px solid #7f1d1d; border-radius: 10px; }
.composer { border-top: 1px solid var(--line); padding: 14px 20px; }
.msg-row { display: flex; gap: 10px; align-items: flex-end; }
.msg-input { flex: 1; resize: none; max-height: 140px; padding: 12px 14px; font-size: 14px; line-height: 1.4; background: #0e141b; border: 1px solid var(--line); border-radius: 12px; color: var(--text); outline: none; font-family: inherit; }
.msg-input:focus { border-color: var(--accent); }
.send { width: 44px; height: 44px; flex-shrink: 0; border: none; border-radius: 12px; cursor: pointer; font-size: 18px; font-weight: 700; color: #fff; background: linear-gradient(180deg, #2563eb, #1d4ed8); transition: transform 0.08s ease, opacity 0.15s ease; }
.send:hover:not(:disabled) { transform: translateY(-1px); }
.send:disabled { opacity: 0.4; cursor: not-allowed; }

@media (max-width: 760px) {
  .chat-screen { padding: 0; }
  .shell { grid-template-columns: 1fr; height: 100dvh; border-radius: 0; border: none; }
  .sidebar { display: none; }
  .bubble-wrap { max-width: 82%; }
  .logo-type { font-size: 30px; }
}
@media (prefers-reduced-motion: reduce) {
  .line, .landing-inner, .fade-in, .fade-out { animation: none; }
  .grid-bg, .scanline, .orb, .caret, .bubble.typing .d { animation: none; }
}
`;