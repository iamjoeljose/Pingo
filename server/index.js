import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";

const app = express();
const httpServer = createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                connectSrc: ["'self'", CLIENT_ORIGIN],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
            },
        },
        crossOriginResourcePolicy: { policy: "same-site" },
    })
);

app.use(cors({ origin: CLIENT_ORIGIN }));

// ---------------------------------------------------------------------------
// Structured security event logger (single-line JSON for SIEM ingestion).
// ---------------------------------------------------------------------------
function logSecurityEvent(event, severity, socket, details = {}) {
    const record = {
        ts: new Date().toISOString(),
        kind: "security",
        event,
        severity,
        socketId: socket?.id,
        ip: socket?.handshake?.address,
        ...details,
    };
    console.error(JSON.stringify(record));
}

// ---------------------------------------------------------------------------
// Config / limits
// ---------------------------------------------------------------------------
const MAX_MESSAGE_LEN = 1000;
const MAX_NAME_LEN = 32;
const MAX_HISTORY = 200;       // per room
const MSG_WINDOW_MS = 10_000;
const MSG_MAX_PER_WINDOW = 20;
const MAX_CONNECTIONS_PER_IP = 10;
const ROOM_ID_LEN = 24;

// Per-room state. Rooms are isolated: a socket only ever sees its own room.
// roomId -> { messages: [], users: Map<socketId, username> }
const rooms = new Map();
const connectionsByIp = new Map();

function getRoom(roomId) {
    if (!rooms.has(roomId)) rooms.set(roomId, { messages: [], users: new Map() });
    return rooms.get(roomId);
}
function roomUserList(roomId) {
    const room = rooms.get(roomId);
    return room ? Array.from(room.users.values()) : [];
}

const io = new Server(httpServer, {
    cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

function clean(input, maxLen) {
    if (typeof input !== "string") return "";
    return input.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLen);
}
function validRoomId(id) {
    return typeof id === "string" && /^[a-zA-Z0-9]{1,24}$/.test(id);
}

io.on("connection", (socket) => {
    const ip = socket.handshake.address;

    const current = (connectionsByIp.get(ip) || 0) + 1;
    connectionsByIp.set(ip, current);
    if (current > MAX_CONNECTIONS_PER_IP) {
        logSecurityEvent("connection_flood", "high", socket, { ip, count: current });
        socket.disconnect(true);
        return;
    }

    logSecurityEvent("client_connected", "info", socket, { connectionsFromIp: current });

    // The room this socket belongs to (set on join). Until then, the socket is
    // in no room and receives nothing.
    let roomId = null;
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

    // Join a room, identified by a hash of the passphrase (never the passphrase).
    socket.on("join", ({ roomId: rid, name }) => {
        if (!validRoomId(rid)) {
            logSecurityEvent("invalid_room", "low", socket);
            return;
        }
        roomId = rid.slice(0, ROOM_ID_LEN);
        socket.join(roomId);

        const safeName = clean(name, MAX_NAME_LEN) || "Anonymous";
        getRoom(roomId).users.set(socket.id, safeName);

        // Presence + history are scoped to THIS room only.
        io.to(roomId).emit("online", roomUserList(roomId));
        socket.emit("history", getRoom(roomId).messages);
    });

    socket.on("typing", (name) => {
        if (!roomId) return;
        const safe = clean(name, MAX_NAME_LEN);
        if (safe) socket.to(roomId).emit("typing", safe); // only this room
    });

    socket.on("chat:message", (payload) => {
        if (!roomId) return; // must join a room first
        if (rateLimited()) {
            logSecurityEvent("rate_limit_exceeded", "low", socket, { roomId });
            socket.emit("error:rate", "You're sending messages too fast. Slow down.");
            return;
        }

        const cipher = payload?.cipher;
        const isValidEnvelope =
            cipher &&
            typeof cipher.iv === "string" &&
            typeof cipher.salt === "string" &&
            typeof cipher.ct === "string" &&
            cipher.ct.length <= MAX_MESSAGE_LEN * 2;
        if (!isValidEnvelope) {
            logSecurityEvent("malformed_payload", "low", socket, { roomId });
            return;
        }

        const user = clean(payload?.user, MAX_NAME_LEN) || "Anonymous";
        const msg = {
            id: `${Date.now()}-${socket.id}-${countInWindow}`,
            user,
            cipher, // ciphertext only
            time: Date.now(),
        };

        const room = getRoom(roomId);
        room.messages.push(msg);
        if (room.messages.length > MAX_HISTORY) room.messages.shift();

        io.to(roomId).emit("chat:message", msg); // only this room
    });

    socket.on("disconnect", () => {
        if (roomId && rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.users.delete(socket.id);
            io.to(roomId).emit("online", roomUserList(roomId));
            // Drop empty rooms so nothing lingers in memory (data minimisation).
            if (room.users.size === 0) rooms.delete(roomId);
        }
        const left = (connectionsByIp.get(ip) || 1) - 1;
        if (left <= 0) connectionsByIp.delete(ip);
        else connectionsByIp.set(ip, left);
        logSecurityEvent("client_disconnected", "info", socket);
    });
});

app.get("/", (req, res) => {
    res.send("Pingo Socket.IO server is running 🚀");
});

app.get("/health", (req, res) => {
    let totalUsers = 0;
    for (const r of rooms.values()) totalUsers += r.users.size;
    res.json({ status: "ok", rooms: rooms.size, online: totalUsers });
});

httpServer.listen(PORT, () => {
    console.log(`🚀 Pingo server listening on http://localhost:${PORT}`);
});