/**
 * OfficeBeats — Session Store (Redis-backed)
 * Drop-in replacement for the in-memory store.
 * Falls back to in-memory if REDIS_URL is not set (local dev).
 */

const SESSION_TTL_S = 8 * 60 * 60; // 8 hours in seconds

// ── Redis client setup ────────────────────────────────────────────────────────
let redisClient = null;
let useRedis = false;

async function initRedis() {
  if (!process.env.REDIS_URL) {
    console.log('[SessionStore] No REDIS_URL found, using in-memory store.');
    return;
  }
  try {
    const { createClient } = require('redis');
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => console.error('[Redis] Error:', err));
    await redisClient.connect();
    useRedis = true;
    console.log('[SessionStore] Connected to Redis ✓');
  } catch (err) {
    console.error('[SessionStore] Redis connection failed, falling back to memory:', err.message);
  }
}

initRedis();

// ── In-memory fallback ────────────────────────────────────────────────────────
const memSessions = new Map();

// ── Redis helpers ─────────────────────────────────────────────────────────────
async function redisGet(sessionId) {
  const raw = await redisClient.get(`session:${sessionId}`);
  return raw ? JSON.parse(raw) : null;
}

async function redisSet(session) {
  await redisClient.setEx(
    `session:${session.id}`,
    SESSION_TTL_S,
    JSON.stringify(session)
  );
}

async function redisDel(sessionId) {
  await redisClient.del(`session:${sessionId}`);
}

async function redisGetAll() {
  const keys = await redisClient.keys('session:*');
  if (!keys.length) return [];
  const values = await Promise.all(keys.map(k => redisClient.get(k)));
  return values.filter(Boolean).map(v => JSON.parse(v));
}

// ── Code ↔ sessionId index ────────────────────────────────────────────────────
// Redis: store code→id mapping separately for fast lookup
async function redisSetCodeIndex(code, sessionId) {
  await redisClient.setEx(`code:${code}`, SESSION_TTL_S, sessionId);
}
async function redisGetByCode(code) {
  const sessionId = await redisClient.get(`code:${code}`);
  if (!sessionId) return null;
  return redisGet(sessionId);
}
async function redisDelCodeIndex(code) {
  await redisClient.del(`code:${code}`);
}

// ── Core helpers ──────────────────────────────────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateSessionId() {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// ── Public API (async-safe — all functions return Promises) ───────────────────

async function createSession({ name, hostSocketId }) {
  let code;
  do { code = generateCode(); } while (await getSessionByCode(code));

  const sessionId = generateSessionId();
  const session = {
    id: sessionId,
    code,
    name: name || 'icikiwir',
    hostSocketId,
    guests: [],
    queue: [],
    currentTrack: null,
    isPlaying: false,
    maxSongsPerGuest: 3,
    deviceIds: [],
    isGuessingGameEnabled: false,
    currentGuesses: {},
    correctGuessPoints: 10,
    queueModifyCost: 20,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  if (useRedis) {
    await redisSet(session);
    await redisSetCodeIndex(code, sessionId);
  } else {
    memSessions.set(sessionId, session);
  }
  return session;
}

async function getSession(sessionId) {
  if (useRedis) return redisGet(sessionId);
  return memSessions.get(sessionId) || null;
}

async function getSessionByCode(code) {
  if (useRedis) return redisGetByCode(code.toUpperCase());
  for (const s of memSessions.values()) {
    if (s.code === code.toUpperCase()) return s;
  }
  return null;
}

async function updateSession(sessionId, updater) {
  let session = await getSession(sessionId);
  if (!session) return null;
  updater(session);
  session.lastActivityAt = Date.now();
  if (useRedis) await redisSet(session);
  else memSessions.set(sessionId, session);
  return session;
}

async function deleteSession(sessionId) {
  if (useRedis) {
    const session = await redisGet(sessionId);
    if (session) await redisDelCodeIndex(session.code);
    await redisDel(sessionId);
  } else {
    memSessions.delete(sessionId);
  }
}

async function addGuestToSession(sessionId, guest) {
  return updateSession(sessionId, (session) => {
    session.guests.push({ ...guest, activeSongCount: 0, score: 0, totalRequestedSongs: 0 });
    if (guest.deviceId && !session.deviceIds.includes(guest.deviceId)) {
      session.deviceIds.push(guest.deviceId);
    }
  });
}

async function isDeviceRegistered(sessionId, deviceId) {
  const session = await getSession(sessionId);
  if (!session || !deviceId) return false;
  return session.deviceIds.includes(deviceId);
}

async function updateSongLimit(sessionId, limit) {
  return updateSession(sessionId, (session) => {
    session.maxSongsPerGuest = Math.max(1, Math.min(10, limit));
  });
}

async function removeGuestFromSession(sessionId, guestId) {
  return updateSession(sessionId, (session) => {
    const guest = session.guests.find((g) => g.id === guestId);
    if (guest?.deviceId) {
      session.deviceIds = session.deviceIds.filter((d) => d !== guest.deviceId);
    }
    session.queue = session.queue.filter((t) => t.requestedBy !== guestId);
    session.guests = session.guests.filter((g) => g.id !== guestId);
  });
}

async function addTrackToQueue(sessionId, track) {
  return updateSession(sessionId, (session) => {
    const guest = session.guests.find((g) => g.id === track.requestedBy);
    if (guest) {
      guest.activeSongCount = (guest.activeSongCount || 0) + 1;
      guest.totalRequestedSongs = (guest.totalRequestedSongs || 0) + 1;
    }
    session.queue.push(track);
  });
}

async function removeTrackFromQueue(sessionId, trackId) {
  return updateSession(sessionId, (session) => {
    const track = session.queue.find((t) => t.id === trackId);
    if (track) {
      const guest = session.guests.find((g) => g.id === track.requestedBy);
      if (guest && guest.activeSongCount > 0) guest.activeSongCount--;
    }
    session.queue = session.queue.filter((t) => t.id !== trackId);
  });
}

async function dequeueNext(sessionId) {
  let nextTrack = null;
  let roundResults = null;

  await updateSession(sessionId, (session) => {
    if (session.currentTrack) {
      const guest = session.guests.find((g) => g.id === session.currentTrack.requestedBy);
      if (guest && guest.activeSongCount > 0) guest.activeSongCount--;

      if (session.isGuessingGameEnabled) {
        const correctRequesterId = session.currentTrack.requestedBy;
        const correctGuessers = [];
        for (const [guesserId, guessedId] of Object.entries(session.currentGuesses)) {
          if (guessedId === correctRequesterId) {
            correctGuessers.push(guesserId);
            const guesser = session.guests.find(g => g.id === guesserId);
            if (guesser) guesser.score = (guesser.score || 0) + (session.correctGuessPoints || 10);
          }
        }
        roundResults = {
          track: session.currentTrack,
          requesterId: correctRequesterId,
          requesterNickname: session.currentTrack.requestedByNickname,
          correctGuessers,
        };
      }
    }

    session.currentGuesses = {};
    nextTrack = session.queue.shift() || null;
    session.currentTrack = nextTrack;
    session.isPlaying = nextTrack !== null;
  });

  return { nextTrack, roundResults };
}

async function toggleGuessingGame(sessionId, enabled) {
  return updateSession(sessionId, (session) => {
    session.isGuessingGameEnabled = enabled;
    if (!enabled) session.currentGuesses = {};
  });
}

async function recordGuess(sessionId, guestId, guessedGuestId) {
  return updateSession(sessionId, (session) => {
    if (session.isGuessingGameEnabled && session.currentTrack) {
      if (session.currentTrack.requestedBy !== guestId) {
        session.currentGuesses[guestId] = guessedGuestId;
      }
    }
  });
}

async function updatePointsConfig(sessionId, correctGuessPoints, queueModifyCost) {
  return updateSession(sessionId, (session) => {
    session.correctGuessPoints = Math.max(1, Number(correctGuessPoints) || 10);
    session.queueModifyCost = Math.max(1, Number(queueModifyCost) || 20);
  });
}

// Auto-cleanup in-memory sessions (Redis handles its own TTL)
if (!useRedis) {
  setInterval(() => {
    const now = Date.now();
    const TTL_MS = SESSION_TTL_S * 1000;
    for (const [id, session] of memSessions.entries()) {
      if (now - session.lastActivityAt > TTL_MS) {
        memSessions.delete(id);
        console.log(`[SessionStore] Expired session ${id} (${session.code})`);
      }
    }
  }, 30 * 60 * 1000);
}

module.exports = {
  createSession,
  getSession,
  getSessionByCode,
  updateSession,
  deleteSession,
  addGuestToSession,
  removeGuestFromSession,
  addTrackToQueue,
  removeTrackFromQueue,
  dequeueNext,
  isDeviceRegistered,
  updateSongLimit,
  toggleGuessingGame,
  recordGuess,
  updatePointsConfig,
};
