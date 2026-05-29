/**
 * OfficeBeats — Session Store (in-memory)
 * Stores all active sessions. Can be swapped for Redis later.
 */

const sessions = new Map();

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

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

function createSession({ name, hostSocketId }) {
  let code;
  // Ensure unique code
  do {
    code = generateCode();
  } while (getSessionByCode(code));

  const sessionId = generateSessionId();
  const session = {
    id: sessionId,
    code,
    name: name || 'icikiwir',
    hostSocketId,
    guests: [],      // [{ id, nickname, socketId, activeSongCount, deviceId }]
    queue: [],       // [{ id, videoId, title, thumbnail, duration, requestedBy, requestedByNickname, addedAt }]
    currentTrack: null,
    isPlaying: false,
    maxSongsPerGuest: 3,  // Host can change this (1–10)
    deviceIds: [],        // Track device fingerprints to prevent duplicate users
    isGuessingGameEnabled: false,
    currentGuesses: {},   // { guestId: guessedGuestId }
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  sessions.set(sessionId, session);
  return session;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function getSessionByCode(code) {
  for (const session of sessions.values()) {
    if (session.code === code.toUpperCase()) return session;
  }
  return null;
}

function updateSession(sessionId, updater) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  updater(session);
  session.lastActivityAt = Date.now();
  return session;
}

function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

function addGuestToSession(sessionId, guest) {
  return updateSession(sessionId, (session) => {
    session.guests.push({ ...guest, activeSongCount: 0, score: 0, totalRequestedSongs: 0 });
    // Register device fingerprint
    if (guest.deviceId && !session.deviceIds.includes(guest.deviceId)) {
      session.deviceIds.push(guest.deviceId);
    }
  });
}

function isDeviceRegistered(sessionId, deviceId) {
  const session = sessions.get(sessionId);
  if (!session || !deviceId) return false;
  return session.deviceIds.includes(deviceId);
}

function updateSongLimit(sessionId, limit) {
  return updateSession(sessionId, (session) => {
    session.maxSongsPerGuest = Math.max(1, Math.min(10, limit));
  });
}

function removeGuestFromSession(sessionId, guestId) {
  return updateSession(sessionId, (session) => {
    const guest = session.guests.find((g) => g.id === guestId);
    // Free up the device fingerprint slot
    if (guest?.deviceId) {
      session.deviceIds = session.deviceIds.filter((d) => d !== guest.deviceId);
    }
    // Remove guest's songs from queue
    session.queue = session.queue.filter(
      (track) => track.requestedBy !== guestId
    );
    session.guests = session.guests.filter((g) => g.id !== guestId);
  });
}

function addTrackToQueue(sessionId, track) {
  return updateSession(sessionId, (session) => {
    const guest = session.guests.find((g) => g.id === track.requestedBy);
    if (guest) {
      guest.activeSongCount = (guest.activeSongCount || 0) + 1;
      guest.totalRequestedSongs = (guest.totalRequestedSongs || 0) + 1;
    }
    session.queue.push(track);
  });
}

function removeTrackFromQueue(sessionId, trackId) {
  return updateSession(sessionId, (session) => {
    const track = session.queue.find((t) => t.id === trackId);
    if (track) {
      const guest = session.guests.find((g) => g.id === track.requestedBy);
      if (guest && guest.activeSongCount > 0) guest.activeSongCount--;
    }
    session.queue = session.queue.filter((t) => t.id !== trackId);
  });
}

function dequeueNext(sessionId) {
  let nextTrack = null;
  let roundResults = null;

  updateSession(sessionId, (session) => {
    if (session.currentTrack) {
      // Decrement guest song count for completed track
      const guest = session.guests.find((g) => g.id === session.currentTrack.requestedBy);
      if (guest && guest.activeSongCount > 0) guest.activeSongCount--;

      // Calculate scores if guessing game is enabled
      if (session.isGuessingGameEnabled) {
        const correctRequesterId = session.currentTrack.requestedBy;
        const correctGuessers = [];

        for (const [guesserId, guessedId] of Object.entries(session.currentGuesses)) {
          if (guessedId === correctRequesterId) {
            correctGuessers.push(guesserId);
            const guesser = session.guests.find(g => g.id === guesserId);
            if (guesser) {
              guesser.score = (guesser.score || 0) + 10;
            }
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

    // Reset guesses for the next track
    session.currentGuesses = {};

    nextTrack = session.queue.shift() || null;
    session.currentTrack = nextTrack;
    session.isPlaying = nextTrack !== null;
  });
  return { nextTrack, roundResults };
}

function toggleGuessingGame(sessionId, enabled) {
  return updateSession(sessionId, (session) => {
    session.isGuessingGameEnabled = enabled;
    if (!enabled) {
      session.currentGuesses = {};
    }
  });
}

function recordGuess(sessionId, guestId, guessedGuestId) {
  return updateSession(sessionId, (session) => {
    if (session.isGuessingGameEnabled && session.currentTrack) {
      // Prevent guessing if it's the user's own song
      if (session.currentTrack.requestedBy !== guestId) {
        session.currentGuesses[guestId] = guessedGuestId;
      }
    }
  });
}

// Auto-cleanup expired sessions every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActivityAt > SESSION_TTL_MS) {
      sessions.delete(id);
      console.log(`[SessionStore] Expired session ${id} (${session.code})`);
    }
  }
}, 30 * 60 * 1000);

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
};
