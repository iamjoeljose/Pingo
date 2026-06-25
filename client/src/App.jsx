import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { encryptMessage, decryptMessage, deriveRoomId } from "./crypto";

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
  const [room, setRoom] = useState("");
  // intro phases: "intro" (big animation) -> "form" (entry form revealed)
  const [phase, setPhase] = useState("intro");

  useEffect(() => {
    const t = setTimeout(() => setPhase("form"), 3800);
    return () => clearTimeout(t);
  }, []);

  const go = () => {
    const n = name.trim();
    const r = room.trim();
    if (!n || !r) return;
    onEnter(n, r);
  };

  const letters = "pingo".split("");

  return (
    <div className="landing">
      <div className="grid-bg" />
      <div className="orb orb-a" />
      <div className="orb orb-b" />

      <div className={`landing-inner ${phase === "form" ? "is-form" : "is-intro"}`}>
        <div className="intro-mark">
          <div className="intro-word">
            <span className="intro-prompt">&gt;_</span>
            {letters.map((ch, i) => (
              <span key={i} className="intro-letter" style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
                {ch}
              </span>
            ))}
          </div>
          <div className="intro-line" />
          <div className="intro-status">establishing secure channel…</div>
        </div>

        <div className="enter-card">
          <div className="enter-field">
            <label className="enter-label">Your name</label>
            <input
              className="enter-input"
              placeholder="e.g. Joel"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go()}
              maxLength={32}
              autoFocus={phase === "form"}
            />
          </div>

          <div className="enter-field">
            <label className="enter-label">Room key</label>
            <input
              className="enter-input"
              type="password"
              placeholder="a shared secret only your group knows"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go()}
              maxLength={128}
            />
            <p className="enter-hint">
              Everyone who enters the same room key can chat together. Use a different key for a
              different private group.
            </p>
          </div>

          <button className="enter-btn" onClick={go} disabled={!name.trim() || !room.trim()}>
            Start chatting <span className="arrow">→</span>
          </button>

          <p className="enc-note">Messages are end-to-end encrypted. The server only ever sees scrambled text.</p>
        </div>

        <footer className="landing-foot">
          © 2026 Pingo · Built by Joel Jose{" "}
          <a className="gh-link" href="https://github.com/iamjoeljose" target="_blank" rel="noopener noreferrer">
            @iamjoeljose
          </a>
        </footer>
      </div>
    </div>
  );
}

// ---------- Chat screen ----------
function Chat({ username, roomKey, onLeave }) {
  const [text, setText] = useState("");
  const [chat, setChat] = useState([]);
  const [online, setOnline] = useState([]);
  const [typingUser, setTypingUser] = useState("");
  const [rateError, setRateError] = useState("");
  const [connected, setConnected] = useState(socket.connected);
  const [showPeople, setShowPeople] = useState(false); // mobile drawer

  const listRef = useRef(null);
  const typingTimeout = useRef(null);
  const me = username.trim() || "Me";

  const decryptIncoming = async (m) => {
    try {
      const text = await decryptMessage(roomKey, m.cipher);
      return { id: m.id, user: m.user, text, time: m.time, ok: true };
    } catch {
      return { id: m.id, user: m.user, text: "🔒 encrypted — different room key", time: m.time, ok: false };
    }
  };

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onHistory = async (msgs) => {
      const decrypted = await Promise.all(msgs.map(decryptIncoming));
      setChat(decrypted);
    };
    const onMessage = async (m) => {
      const d = await decryptIncoming(m);
      setChat((prev) => [...prev, d]);
    };
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

    const joinRoom = async () => {
      const roomId = await deriveRoomId(roomKey);
      socket.emit("join", { roomId, name: me });
    };
    if (socket.connected) joinRoom();
    socket.on("connect", joinRoom);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("history", onHistory);
      socket.off("chat:message", onMessage);
      socket.off("online", onOnline);
      socket.off("typing", onTyping);
      socket.off("error:rate", onRate);
      socket.off("connect", joinRoom);
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, roomKey]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, typingUser]);

  const handleTyping = (e) => {
    setText(e.target.value);
    if (me) socket.emit("typing", me);
  };

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      const cipher = await encryptMessage(roomKey, t);
      socket.emit("chat:message", { user: me, cipher });
      setText("");
    } catch {
      setRateError("Encryption failed — message not sent.");
      setTimeout(() => setRateError(""), 3000);
    }
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

  const PeopleList = () => (
    <>
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
    </>
  );

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
          <div className="side-enc">end-to-end encrypted</div>
          <PeopleList />
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
            <div className="bar-left">
              <button className="people-toggle" onClick={() => setShowPeople(true)} aria-label="Show people">
                ☰
              </button>
              <div className="bar-title"># encrypted room</div>
            </div>
            <div className="status">
              <span className={`dot ${connected ? "on" : "off"}`} />
              <span className="count">{uniqueOnline.length}</span>
            </div>
          </header>

          <div ref={listRef} className="stream">
            {grouped.length === 0 && (
              <div className="empty">
                <div className="empty-art">🔒</div>
                <p>No messages yet. Anything you send is encrypted before it leaves your browser.</p>
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
                  <div className={`bubble ${m.ok ? "" : "locked"}`}>{m.text}</div>
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
                placeholder="Type a message…"
                value={text}
                onChange={handleTyping}
                onKeyDown={handleKey}
                rows={1}
                maxLength={1000}
              />
              <button className="send" onClick={send} disabled={!text.trim()} aria-label="Send message">↑</button>
            </div>
            <div className="chat-copyright">
              © 2026 Pingo · Built by Joel Jose{" "}
              <a className="gh-link" href="https://github.com/iamjoeljose" target="_blank" rel="noopener noreferrer">
                @iamjoeljose
              </a>
            </div>
          </footer>
        </main>

        {/* Mobile people drawer */}
        {showPeople && (
          <div className="drawer-overlay" onClick={() => setShowPeople(false)}>
            <div className="drawer" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-head">
                <span>People</span>
                <button className="drawer-close" onClick={() => setShowPeople(false)} aria-label="Close">✕</button>
              </div>
              <div className="side-status">
                <span className={`dot ${connected ? "on" : "off"}`} />
                {connected ? "connected" : "connecting…"}
              </div>
              <div className="side-enc">end-to-end encrypted</div>
              <PeopleList />
              <button className="leave-btn full" onClick={onLeave}>leave room</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Root ----------
export default function App() {
  const [username, setUsername] = useState("");
  const [roomKey, setRoomKey] = useState("");
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const enter = (name, room) => {
    setUsername(name);
    setRoomKey(room);
    localStorage.setItem("name", name);
    if (!socket.connected) socket.connect();
    setLeaving(true);
    setTimeout(() => setEntered(true), 500);
  };

  const leave = () => {
    socket.disconnect();
    setRoomKey("");
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
          <Chat username={username} roomKey={roomKey} onLeave={leave} />
        </div>
      )}
    </div>
  );
}

const css = `
:root {
  --bg: #0b0f14; --panel: #11161d; --panel-2: #161d26; --line: #1f2937;
  --text: #e5e9f0; --muted: #7c8896; --accent: #6ee7b7;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
.app { min-height: 100dvh; display: grid; place-items: center; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.fade-out { animation: fadeOut 0.5s ease forwards; }
.fade-in { animation: fadeIn 0.5s ease; width: 100%; display: grid; place-items: center; }
@keyframes fadeOut { to { opacity: 0; transform: scale(0.98); } }
@keyframes fadeIn { from { opacity: 0; transform: scale(1.01); } to { opacity: 1; transform: none; } }

/* ---------------- LANDING ---------------- */
.landing { position: fixed; inset: 0; width: 100vw; min-height: 100dvh; display: grid; place-items: center; overflow-y: auto; padding: 32px 20px; }
.grid-bg { position: absolute; inset: 0; background-image: linear-gradient(#1b2735 1px, transparent 1px), linear-gradient(90deg, #1b2735 1px, transparent 1px); background-size: 48px 48px; mask-image: radial-gradient(ellipse 120% 90% at 50% 45%, #000 35%, transparent 90%); -webkit-mask-image: radial-gradient(ellipse 120% 90% at 50% 45%, #000 35%, transparent 90%); opacity: 0.35; }
.orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.3; }
.orb-a { width: 620px; height: 620px; background: #1d4ed8; top: -180px; left: -140px; animation: float1 14s ease-in-out infinite; }
.orb-b { width: 520px; height: 520px; background: #0f766e; bottom: -180px; right: -120px; animation: float2 16s ease-in-out infinite; }
@keyframes float1 { 50% { transform: translate(40px, 30px); } }
@keyframes float2 { 50% { transform: translate(-30px, -40px); } }

.landing-inner { position: relative; z-index: 2; width: 100%; max-width: 540px; display: flex; flex-direction: column; }

/* Intro wordmark animation */
.intro-mark { text-align: center; }
.intro-word { display: flex; align-items: center; justify-content: center; gap: 2px; font-family: var(--mono); font-weight: 700; letter-spacing: 2px; }
.intro-prompt { color: var(--accent); margin-right: 8px; opacity: 0; animation: promptIn 0.5s ease 0.05s forwards; }
.intro-letter { display: inline-block; opacity: 0; transform: translateY(18px) scale(1.4); filter: blur(8px); color: var(--text); animation: letterIn 0.6s cubic-bezier(.2,.8,.2,1) forwards; }
@keyframes promptIn { to { opacity: 1; } }
@keyframes letterIn { to { opacity: 1; transform: none; filter: blur(0); } }
.intro-line { height: 2px; width: 0; margin: 0 auto; background: linear-gradient(90deg, transparent, var(--accent), transparent); animation: lineGrow 0.7s ease 0.9s forwards; }
@keyframes lineGrow { to { width: 70%; } }
.intro-status { font-family: var(--mono); font-size: 13px; color: var(--muted); opacity: 0; animation: statusIn 0.5s ease 1.3s forwards; }
@keyframes statusIn { to { opacity: 0.8; } }

.is-intro { justify-content: center; min-height: 70vh; }
.is-intro .intro-word { font-size: 64px; }
.is-intro .intro-line { margin-top: 18px; }
.is-intro .intro-status { margin-top: 16px; }
.is-intro .enter-card, .is-intro .landing-foot { opacity: 0; height: 0; overflow: hidden; pointer-events: none; margin: 0; padding: 0; border: none; }

.is-form .intro-word { font-size: 32px; transition: font-size 0.6s cubic-bezier(.2,.8,.2,1); }
.is-form .intro-line { width: 55%; transition: width 0.6s ease; }
.is-form .intro-status { display: none; }
.is-form .intro-mark { margin-bottom: 30px; transition: margin 0.5s ease; }
.is-form .enter-card { animation: riseIn 0.6s ease 0.1s both; }
.is-form .landing-foot { animation: riseIn 0.6s ease 0.3s both; }
@keyframes riseIn { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }

.enter-card { background: #0e141be0; backdrop-filter: blur(10px); border: 1px solid var(--line); border-radius: 22px; padding: 38px 36px; box-shadow: 0 24px 60px #00000066; }
.enter-field { margin-bottom: 22px; }
.enter-label { display: block; font-size: 14px; color: var(--text); margin-bottom: 9px; font-weight: 500; }
.enter-input { width: 100%; padding: 16px 16px; font-size: 16px; background: #0b0f14; border: 1px solid var(--line); border-radius: 13px; color: var(--text); outline: none; transition: border-color 0.2s; }
.enter-input:focus { border-color: var(--accent); }
.enter-hint { font-size: 13px; color: var(--muted); margin: 10px 2px 0; line-height: 1.55; }
.enter-btn { width: 100%; padding: 16px; border: none; border-radius: 13px; font-size: 16px; font-weight: 600; cursor: pointer; color: #fff; background: linear-gradient(180deg, #2563eb, #1d4ed8); transition: transform 0.1s ease, opacity 0.15s ease, box-shadow 0.2s ease; margin-top: 6px; }
.enter-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 24px #2563eb55; }
.enter-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.enter-btn .arrow { transition: transform 0.15s ease; display: inline-block; }
.enter-btn:hover:not(:disabled) .arrow { transform: translateX(4px); }
.enc-note { text-align: center; font-size: 13px; color: var(--muted); margin: 22px auto 0; line-height: 1.55; }
.landing-foot { text-align: center; font-size: 12px; color: var(--muted); margin-top: 26px; font-family: var(--mono); opacity: 0.7; }
.gh-link { color: var(--accent); text-decoration: none; transition: opacity 0.15s; }
.gh-link:hover { text-decoration: underline; }
.chat-copyright { text-align: center; font-size: 11px; color: var(--muted); font-family: var(--mono); margin-top: 8px; opacity: 0.6; }

/* ---------------- CHAT ---------------- */
.chat-screen { width: 100%; display: grid; place-items: center; padding: 16px; }
.shell { position: relative; width: 100%; max-width: 1180px; height: min(90dvh, 940px); display: grid; grid-template-columns: 280px 1fr; background: var(--panel); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; box-shadow: 0 24px 60px #00000066; }
.sidebar { display: flex; flex-direction: column; background: var(--panel-2); border-right: 1px solid var(--line); padding: 16px 14px; }
.side-head { display: flex; align-items: center; gap: 10px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
.side-status { display: flex; align-items: center; gap: 8px; font-size: 12px; font-family: var(--mono); color: var(--muted); padding: 12px 2px 4px; }
.side-enc { font-size: 11px; font-family: var(--mono); color: var(--accent); padding: 0 2px 12px; }
.side-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); font-family: var(--mono); margin: 6px 2px 8px; }
.side-users { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; min-height: 40px; }
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
.leave-btn.full { width: 100%; margin-top: 16px; padding: 11px; }

.main { display: flex; flex-direction: column; min-width: 0; }
.bar { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); }
.bar-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.people-toggle { display: none; background: none; border: none; color: var(--text); font-size: 20px; cursor: pointer; padding: 0; line-height: 1; }
.bar-title { font-family: var(--mono); font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); font-family: var(--mono); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot.on { background: #34d399; box-shadow: 0 0 10px #34d399aa; }
.dot.off { background: #f59e0b; }
.stream { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 6px; scroll-behavior: smooth; }
.stream::-webkit-scrollbar { width: 8px; }
.stream::-webkit-scrollbar-thumb { background: #232c38; border-radius: 8px; }
.empty { margin: auto; text-align: center; color: var(--muted); max-width: 300px; }
.empty-art { font-size: 30px; opacity: 0.7; margin-bottom: 8px; }
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
.bubble.locked { font-style: italic; color: var(--muted); font-family: var(--mono); font-size: 13px; }
.line.theirs .bubble { border-top-left-radius: 4px; }
.line.mine .bubble { background: linear-gradient(180deg, #2563eb, #1d4ed8); border-color: #2f6bff; border-top-right-radius: 4px; color: #fff; }
.bubble.typing { display: flex; gap: 4px; padding: 12px 14px; }
.bubble.typing .d { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite; }
.bubble.typing .d:nth-child(2) { animation-delay: 0.2s; }
.bubble.typing .d:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }
.toast { margin: 0 18px; padding: 8px 12px; font-size: 13px; font-family: var(--mono); color: #fecaca; background: #3f1d1d; border: 1px solid #7f1d1d; border-radius: 10px; }
.composer { border-top: 1px solid var(--line); padding: 12px 16px; }
.msg-row { display: flex; gap: 10px; align-items: flex-end; }
.msg-input { flex: 1; resize: none; max-height: 120px; padding: 12px 14px; font-size: 15px; line-height: 1.4; background: #0e141b; border: 1px solid var(--line); border-radius: 12px; color: var(--text); outline: none; font-family: inherit; }
.msg-input:focus { border-color: var(--accent); }
.send { width: 44px; height: 44px; flex-shrink: 0; border: none; border-radius: 12px; cursor: pointer; font-size: 18px; font-weight: 700; color: #fff; background: linear-gradient(180deg, #2563eb, #1d4ed8); transition: transform 0.08s ease, opacity 0.15s ease; }
.send:hover:not(:disabled) { transform: translateY(-1px); }
.send:disabled { opacity: 0.4; cursor: not-allowed; }

/* mobile drawer */
.drawer-overlay { position: absolute; inset: 0; background: #00000088; backdrop-filter: blur(2px); z-index: 20; animation: fadeIn 0.2s ease; }
.drawer { position: absolute; top: 0; left: 0; bottom: 0; width: 78%; max-width: 300px; background: var(--panel-2); border-right: 1px solid var(--line); padding: 18px 16px; display: flex; flex-direction: column; animation: slideIn 0.25s ease; }
@keyframes slideIn { from { transform: translateX(-100%); } to { transform: none; } }
.drawer-head { display: flex; align-items: center; justify-content: space-between; font-family: var(--mono); font-weight: 700; font-size: 15px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.drawer-close { background: none; border: none; color: var(--muted); font-size: 16px; cursor: pointer; }

@media (max-width: 760px) {
  .is-intro .intro-word { font-size: 44px; }
  .is-form .intro-word { font-size: 28px; }
  .enter-card { padding: 28px 22px; }
  .chat-screen { padding: 0; }
  .shell { grid-template-columns: 1fr; height: 100dvh; border-radius: 0; border: none; }
  .sidebar { display: none; }
  .people-toggle { display: block; }
  .bubble-wrap { max-width: 80%; }
  .stream { padding: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .line, .landing-inner, .fade-in, .fade-out, .orb, .drawer { animation: none; }
  .bubble.typing .d { animation: none; }
}
`;
