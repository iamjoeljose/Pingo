
# Pingo

A real-time group chat room built with **React 19 + Vite** on the client and **Express 5 + Socket.IO** on the server. Multiple people join a shared channel, pick a handle, and message each other live — with an online-user list and typing indicators.

## Stack

| Layer  | Tech |
|--------|------|
| Client | React 19, Vite, socket.io-client |
| Server | Node.js, Express 5, Socket.IO |
| Store  | In-memory (capped history) |

## Project structure


## Getting started

### 1. Server

```bash
cd server
npm install
cp .env.example .env      # adjust CLIENT_ORIGIN / PORT if needed
npm start
```

Runs on `http://localhost:3000` by default. Health check: `GET /health`.

### 2. Client

```bash
cd client
npm install
cp .env.example .env      # adjust VITE_SERVER_URL if needed
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`).

## Configuration

Both sides read from `.env` files (see `.env.example`):

- **server** — `CLIENT_ORIGIN` (allowed CORS origin), `PORT`
- **client** — `VITE_SERVER_URL` (Socket.IO server URL)

## Features

- Real-time messaging across a shared channel
- Live online-user list (deduplicated) with per-user accent colors
- Typing indicators
- Animated landing screen and two-panel chat layout
- Responsive down to mobile

## Security notes / threat model

This is a learning project, but it applies a few defensive basics worth calling out:

- **Input validation** — all incoming names and messages are trimmed, stripped of control characters, and length-capped server-side (names ≤ 32, messages ≤ 1000). The server never trusts client-supplied strings.
- **Rate limiting** — each socket is capped at 20 messages per 10s window to limit spam/flood. Offenders receive an `error:rate` event rather than having messages stored.
- **Bounded memory** — message history is capped (last 200) so the in-memory store can't grow without bound from a single long-lived process.
- **CORS** — the server only accepts connections from the configured `CLIENT_ORIGIN`.

### Known limitations (not yet addressed)

- Messages are stored in memory and lost on restart — no persistence.
- No authentication; usernames are self-asserted and spoofable.
- A single shared channel — no private rooms or direct messages.

## Possible next steps

- Persist messages (SQLite/Postgres) instead of in-memory.
- Add authentication and per-user identity.
- Add integration tests for the Socket.IO event flow.

## License

MIT
