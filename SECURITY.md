# Security & Threat Model — Pingo

Pingo is a real-time group chat application (React + Socket.IO). This document
records the threats considered during development, the controls implemented
against them, and the limitations that remain. It is written in the spirit of a
lightweight threat model rather than a formal assurance document.

## 1. System overview

```
Browser (React client)  <-- WebSocket (Socket.IO) -->  Node.js server
                                                        in-memory message store
```

- Clients connect over a Socket.IO WebSocket.
- The server holds chat history in memory (capped) and broadcasts messages to all
  connected clients in a single shared channel.
- There is no authentication; participants self-assert a display name.

## 2. Assets

| Asset | Why it matters |
|-------|----------------|
| Message availability | The service should stay responsive under load/abuse. |
| Client integrity | Other users should not be able to inject code into a victim's browser. |
| Server stability | A single malicious client should not exhaust server resources. |

## 3. Trust boundaries

The key boundary is between the **untrusted client** and the **server**. Every
value arriving over a socket event (`message`, `user`, `name`) is attacker-
controlled and is treated as such — the server never assumes a value is
well-formed, in range, or benign.

## 4. Threats and controls (STRIDE-flavoured)

### Tampering / Injection — Cross-Site Scripting (XSS)
- **Threat:** A user sends `<script>…</script>` (or an event-handler payload) as a
  message; it executes in other users' browsers.
- **Primary control:** The React client renders message text as JSX, so React
  escapes it by default — payloads are displayed as inert text, never parsed as
  HTML. The app never uses `dangerouslySetInnerHTML`.
- **Defence in depth:** A Content-Security-Policy header (`script-src 'self'`)
  limits what could execute even if escaping were bypassed.
- **Detection:** Inbound values matching injection markers are logged as
  `suspicious_input` events before sanitisation.

### Denial of Service — message flooding
- **Threat:** A client spams messages to disrupt the channel or grow the store.
- **Control:** Per-socket rate limit (20 messages / 10s). Excess messages are
  dropped and an `error:rate` event is returned. Breaches log a
  `rate_limit_exceeded` event.

### Denial of Service — connection flooding
- **Threat:** A client opens many sockets from one host to exhaust resources.
- **Control:** Per-IP connection cap (10). Excess connections are disconnected and
  logged as `connection_flood` (severity high).

### Denial of Service — unbounded memory growth
- **Threat:** History grows without limit on a long-running process.
- **Control:** History is capped at the most recent 200 messages (ring-buffer
  behaviour via `shift()`), and per-message length is capped at 1000 chars.

### Spoofing — origin
- **Threat:** A malicious site embeds or calls the server on a victim's behalf.
- **Control:** CORS restricts Socket.IO and HTTP to the configured
  `CLIENT_ORIGIN`. `frame-ancestors 'none'` blocks framing (clickjacking).

### Information disclosure — HTTP headers / transport
- **Control:** `helmet` sets HSTS, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, and removes/normalises identifying headers.

## 5. Security event logging (detection)

The server emits structured, single-line JSON security events to stderr so they
can be separated from application output and ingested by a SIEM (e.g. Wazuh, ELK).
Each event carries a timestamp, event name, severity, socket id, and source IP.

Events: `client_connected`, `client_disconnected`, `suspicious_input`,
`rate_limit_exceeded`, `connection_flood`.

Example:
```json
{"ts":"2026-06-24T11:12:05.811Z","kind":"security","event":"suspicious_input","severity":"medium","socketId":"__uiyWoRA7JAeXe1AAAB","ip":"127.0.0.1","field":"message"}
```

This supports a basic blue-team workflow: a spike in `suspicious_input` or any
`connection_flood` event is an actionable signal, and the JSON shape is designed
for alerting rules rather than human-only reading.

## 6. Known limitations (accepted risk)

These are out of scope for a learning project and are stated honestly rather than
hidden:

- **No authentication.** Display names are self-asserted and spoofable; there is no
  notion of a verified identity.
- **No persistence or encryption at rest.** Messages live in memory and are lost on
  restart. Transport security (TLS) is assumed to be terminated by a proxy in any
  real deployment.
- **Single shared channel.** No private rooms or DMs, so there is no message
  confidentiality between users.
- **In-memory rate/connection state.** Counters reset on restart and are not shared
  across multiple server instances (would need a shared store like Redis to scale).

## 8. End-to-end encryption (E2EE)

As of the encryption release, message **content** is end-to-end encrypted in the
browser. This materially changes the threat model: the server is now a
**zero-knowledge relay** that stores and forwards ciphertext it cannot read.

### Scheme
- **Key derivation:** a room passphrase is stretched into a 256-bit key with
  PBKDF2-HMAC-SHA256 (150,000 iterations, random 16-byte salt per message).
- **Encryption:** AES-256-GCM, a 96-bit random IV per message. GCM is an
  authenticated cipher, so it provides confidentiality *and* integrity — a
  tampered ciphertext fails to decrypt rather than producing garbage.
- **Wire format:** each message is `{ iv, salt, ct }` (base64). The salt travels
  with the message so any client holding the passphrase can re-derive the key.
- All crypto uses the browser-native Web Crypto API (`crypto.subtle`); no keys or
  passphrases ever leave the client.

### What this defends against
- **A compromised or curious server.** The server, its logs, its memory, and its
  database (if one were added) contain only ciphertext. An attacker with full
  server access still cannot read messages without the room passphrase.
- **Tampering in transit or at the server.** GCM authentication causes any
  modified ciphertext to be rejected on decryption.

### Honest limitations (important)
- **Shared-key, not per-recipient.** Anyone who knows the room passphrase can read
  all messages in that room. This is group secrecy, not Signal-style per-user
  E2EE with forward secrecy.
- **No forward secrecy.** A leaked passphrase exposes past and future messages
  encrypted under it. Real ratcheting protocols (e.g. Double Ratchet) rotate keys
  per message; that is out of scope here.
- **Passphrase distribution is out of band.** Users must share the room key
  through some channel Pingo doesn't provide; the security of that channel is
  assumed, not enforced.
- **Metadata is not encrypted.** Sender handle, message timing, and online
  presence are still visible to the server.

### Consequence for earlier controls
Because the server can no longer see message text, the server-side
`suspicious_input` scan on message *content* no longer applies — that scan only
covers handles now. XSS defence for message content therefore rests entirely on
the client: React escapes rendered text by default, and the CSP provides defence
in depth. This is the correct trade-off — server content inspection and true E2EE
are fundamentally incompatible, and zero server knowledge was the goal.

## 7. Reporting

This is a personal/portfolio project. If you spot an issue, please open a GitHub
issue describing it.
