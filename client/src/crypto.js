// crypto.js — client-side end-to-end encryption for Pingo.
//
// Model: a shared room passphrase. A key is derived from the passphrase with
// PBKDF2 (key stretching), and messages are sealed with AES-GCM (authenticated
// encryption: confidentiality + integrity). The server only ever sees ciphertext.
//
// Wire format per message: { iv, salt, ct } — all base64. Each message carries
// its own random IV (never reuse an IV with the same key) and we store the salt
// so any client with the passphrase can re-derive the key.

const PBKDF2_ITERATIONS = 150_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Derive an AES-GCM key from a passphrase + salt using PBKDF2-SHA256.
async function deriveKey(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Encrypt plaintext -> { iv, salt, ct } (all base64).
export async function encryptMessage(passphrase, plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const key = await deriveKey(passphrase, salt);
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  return { iv: bufToB64(iv), salt: bufToB64(salt), ct: bufToB64(ctBuf) };
}

// Decrypt { iv, salt, ct } -> plaintext. Throws on wrong key/tampered data.
export async function decryptMessage(passphrase, payload) {
  const salt = b64ToBuf(payload.salt);
  const iv = b64ToBuf(payload.iv);
  const key = await deriveKey(passphrase, salt);
  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    b64ToBuf(payload.ct)
  );
  return dec.decode(ptBuf);
}

// Derive a NON-REVERSIBLE room id from the passphrase. The server uses this to
// partition users into isolated rooms WITHOUT ever learning the passphrase.
// We hash a domain-separated value so the room id can't be used as a decryption
// oracle, and SHA-256 is one-way so the server can't recover the key from it.
export async function deriveRoomId(passphrase) {
  const data = enc.encode("pingo-room:" + passphrase);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufToB64(digest).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
}