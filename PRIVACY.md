# Privacy Design — Pingo

This document describes the privacy-protective design of Pingo and maps the
technical controls to the relevant **Australian Privacy Principles (APPs)** under
the Privacy Act 1988 (Cth).

> Scope note: Pingo is a learning project. This document covers the *technical
> measures* that support privacy by design. Full APP compliance for a production
> service would additionally require governance artefacts — a privacy policy,
> consent flows, a data breach response plan, and defined retention schedules —
> which are organisational, not code, and are out of scope here. The mappings
> below describe how the implemented controls *support* each principle, not a
> claim of certified compliance.

## Privacy-by-design summary

Pingo is built so that the server holds the minimum possible information:

1. **Message content is end-to-end encrypted** (AES-256-GCM, key derived from a
   shared room passphrase via PBKDF2). The server stores and relays ciphertext
   only and cannot read messages.
2. **Rooms are cryptographically partitioned.** The client derives a one-way
   room id (SHA-256 of the passphrase) and the server isolates each room using
   that id. Users in different rooms cannot see each other's presence, handles,
   typing activity, or messages.
3. **The server never receives the passphrase** — only its hash (room id) and
   ciphertext. It is a zero-knowledge relay.
4. **Data is minimised and ephemeral.** Messages live in memory, capped per room,
   and a room's data is deleted when its last member leaves.

## Mapping to the Australian Privacy Principles

### APP 3 / APP 5 — Collection and notification
- **Control:** Pingo collects only a self-chosen display handle and ciphertext. No
  email, real name, account, or device identifiers are collected. The landing
  screen states plainly that the server cannot read messages.
- **Effect:** Minimal collection reduces the data that could ever be exposed.

### APP 6 — Use and disclosure
- **Control:** Room partitioning ensures message content and metadata (who is
  present, who is sending, timing) are disclosed only to members of the same
  room. A party with a different (or no) passphrase receives nothing — not even
  the existence of other users.
- **Effect:** This was a deliberate fix to an earlier design where presence and
  sender metadata leaked to anyone connected. Metadata is treated as sensitive,
  not just content.

### APP 11 — Security of personal information
- **Controls:**
  - End-to-end encryption (AES-256-GCM) protects content confidentiality and
    integrity, including against a compromised server.
  - PBKDF2 key stretching (150k iterations) resists brute-forcing the room key.
  - Transport is expected to run over TLS in deployment.
  - Server hardening: input validation, rate limiting, connection caps, security
    headers (helmet/CSP), and structured security-event logging for detection.
- **Effect:** Defence in depth across the client, transport, and server.

### APP 11.2 — Destruction / de-identification when no longer needed
- **Control:** Message history is held only in memory, capped per room, and a
  room's entire state is destroyed when the last participant disconnects. Nothing
  is persisted to disk.
- **Effect:** Data is not retained beyond its purpose. (A production system with
  persistence would need an explicit, documented retention schedule.)

### Data minimisation (cross-cutting principle)
- The server is designed to know as little as possible: it cannot read messages,
  does not learn the passphrase, and does not link handles to any identity.

## Honest limitations

- **Shared-key model.** Anyone with the room passphrase can read that room's
  messages; this is group privacy, not per-user E2EE, and there is no forward
  secrecy.
- **Metadata within a room is visible to that room.** Members see each other's
  handles and timing — appropriate for a chat, but not anonymous.
- **Handles are unauthenticated** and can be spoofed within a room.
- **No governance layer.** As noted above, organisational APP obligations
  (policy, consent records, breach notification) are not implemented.

## Why this matters

The design demonstrates *privacy by design and by default* — protective behaviour
is the built-in path, not an opt-in. The strongest illustration is the room
partitioning fix: the original build leaked presence/sender metadata to any
connected client, and the redesign closed that by making the passphrase a real
trust boundary enforced server-side, without the server ever learning the secret.
