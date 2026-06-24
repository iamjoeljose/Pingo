import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const httpServer = createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: CLIENT_ORIGIN }));

const io = new Server(httpServer, {
    cors: {
        origin: CLIENT_ORIGIN,
        methods: ["GET", "POST"],
    },
});

// --- Config / limits ---
const MAX_MESSAGE_LEN = 1000;
const MAX_NAME_LEN = 32;
const MAX_HISTORY = 200;          // cap stored history to avoid unbounded growth
const MSG_WINDOW_MS = 10_000;     // rate-limit window
const MSG_MAX_PER_WINDOW = 20;    // max messages per socket per window

const messages = [];
const onlineUsers = new Map(); // socket.id -> username

// Trim + collapse, strip control chars, enforce length.
function clean(input, maxLen) {
    if (typeof input !== "string") return "";
    return input
        .replace(/[\u0000-\u001F\u007F]/g, "") // strip control chars
        .trim()
        .slice(0, maxLen);
}

io.on("connection", (socket) => {
    console.log("✅ Client connected:", socket.id);

    // Per-socket rate-limit state
    let windowStart = Date.now();
    let countInWindow = 0;

    function rateLimited() {
        const now = Date.now();
        if (now - windowStart > MSG_WINDOW_MS) {
            windowStart = now;
            countInWindow = 0;
        }
        countInWindow += 1;
        return countInWindow > MSG_MAX_PER_WINDOW;
    }

  // Send history when the client asks for it (after its UI is ready)
    socket.on("history:request", () => {
        socket.emit("history", messages);
    });

    socket.on("setName", (name) => {
        const safe = clean(name, MAX_NAME_LEN) || "Anonymous";
        onlineUsers.set(socket.id, safe);
        io.emit("online", Array.from(onlineUsers.values()));
    });

    socket.on("typing", (name) => {
        const safe = clean(name, MAX_NAME_LEN);
        if (safe) socket.broadcast.emit("typing", safe);
    });

    socket.on("chat:message", (payload) => {
        if (rateLimited()) {
            socket.emit("error:rate", "You're sending messages too fast. Slow down.");
            return;
        }

        const message = clean(payload?.message, MAX_MESSAGE_LEN);
        if (!message) return; // ignore empty/whitespace-only

        const user = clean(payload?.user, MAX_NAME_LEN) || "Anonymous";

        const msg = {
            id: `${Date.now()}-${socket.id}-${countInWindow}`,
            user,
            message,
            time: Date.now(),
        };

        messages.push(msg);
        if (messages.length > MAX_HISTORY) messages.shift();

        io.emit("chat:message", msg);
    });

    socket.on("disconnect", () => {
        onlineUsers.delete(socket.id);
        io.emit("online", Array.from(onlineUsers.values()));
        console.log("❌ Client disconnected:", socket.id);
    });
});

app.get("/", (req, res) => {
    res.send("Socket.IO server is running 🚀");
});

app.get("/health", (req, res) => {
    res.json({ status: "ok", online: onlineUsers.size, messages: messages.length });
});

httpServer.listen(PORT, () => {
    console.log(`🚀 Server listening on http://localhost:${PORT}`);
});