// Field-level encryption for genuinely sensitive columns (customer phone
// numbers) — this is what actually protects that data wherever it ends up:
// the live database, every local backup snapshot, and the OneDrive mirror,
// all of them, since it's applied before a value is ever written rather
// than layered onto specific files after the fact.
//
// AES-256-GCM: a random IV per value plus an auth tag, so two identical
// phone numbers never produce the same ciphertext and any tampering with a
// stored value is detected on decrypt rather than silently accepted.
'use strict';
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey() {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'DATA_ENCRYPTION_KEY is not set. Generate one with: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must decode to exactly 32 bytes (a base64-encoded 256-bit key).');
  }
  return key;
}

// Stored as "v1:<iv>:<authTag>:<ciphertext>", each base64. The version
// prefix lets the scheme change later without breaking rows written under
// this one.
function encryptField(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

// Rows written before this feature existed are still plain text — treated
// as already-decrypted rather than an error, so old data keeps working
// until it's next rewritten (see scripts/encrypt-existing-data.js to
// migrate it immediately instead of waiting for that).
function decryptField(stored) {
  if (stored == null) return stored;
  const parts = String(stored).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return stored;
  const [, ivB64, tagB64, ciphertextB64] = parts;
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

function isEncryptedField(stored) {
  return typeof stored === 'string' && stored.startsWith('v1:');
}

// Deterministic lookup for an otherwise-encrypted field (phone numbers):
// AES-GCM's random IV means the same phone encrypts to a different value
// every time, so the encrypted column itself can never be looked up by
// value. This HMAC is stored alongside it purely so login can find "does a
// user with this phone already exist" — it reveals nothing about the
// phone number itself (an HMAC can't be reversed), it just lets two equal
// inputs be recognised as equal.
function hashLookup(plaintext) {
  return crypto.createHmac('sha256', getKey()).update(String(plaintext)).digest('hex');
}

module.exports = { encryptField, decryptField, isEncryptedField, hashLookup };
