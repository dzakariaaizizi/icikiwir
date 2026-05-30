/**
 * OfficeBeats — Main Server
 * Express + Socket.io server for real-time collaborative music queue
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { validateYouTubeUrl } = require('./youtubeValidator');
const store = require('./sessionStore');
const { isDeviceRegistered, updateSongLimit } = require('./sessionStore');

const app = express();
const server = http.createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const io = new Server(server, {
  cors: {
    origin: [CLIENT_ORIGIN, 'http://localhost:5173', 'http://localhost:4173'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Keep connections alive on mobile — prevents OS from killing idle sockets
  pingInterval: 10000,   // send ping every 10s
  pingTimeout: 25000,    // wait 25s for pong before disconnecting
  // Allow brief network drops (e.g. mobile switching WiFi/cell) without full disconnect
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
  },
});

app.use(cors({
  origin: [CLIENT_ORIGIN, 'http://localhost:5173', 'http://localhost:4173'],
  credentials: true,
}));
app.use(express.json());

// Serve React client build
const path = require('path');
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));

// ──────────────────────────────────────────────
// REST API
// ──────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

/** POST /api/session — Create a new session (host) */
app.post('/api/session', (req, res) => {
  const { name } = req.body;
  // hostSocketId will be updated when socket connects
  const session = store.createSession({ name: name || 'icikiwir', hostSocketId: null });
  res.json({
    sessionId: session.id,
    code: session.code,
    name: session.name,
  });
});

/** GET /api/session/:code — Get session info by code */
app.get('/api/session/:code', (req, res) => {
  const session = store.getSessionByCode(req.params.code.toUpperCase());
  if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan. Periksa kode lagi.' });
  res.json({
    sessionId: session.id,
    code: session.code,
    name: session.name,
    guestCount: session.guests.length,
    isActive: true,
  });
});

/** POST /api/validate — Validate a YouTube link */
app.post('/api/validate', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ valid: false, reason: 'URL tidak boleh kosong.' });
  const result = await validateYouTubeUrl(url);
  res.json(result);
});

// ──────────────────────────────────────────────
// Socket.io
// ──────────────────────────────────────────────

function generateGuestId() {
  return 'g_' + Math.random().toString(36).substring(2, 10);
}

function generateTrackId() {
  return 't_' + Math.random().toString(36).substring(2, 12);
}

function generateRandomNickname() {
  const adjectives = ['Cool', 'Happy', 'Jazzy', 'Groovy', 'Mellow', 'Funky', 'Chill', 'Sunny'];
  const nouns = ['Panda', 'Bear', 'Fox', 'Wolf', 'Eagle', 'Shark', 'Tiger', 'Lion'];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}`;
}

// ── Server-side playback timer ─────────────────────────────────────────────
// Tracks a setTimeout per session so the server advances the queue automatically
// even when the host's browser is in the background and the socket is throttled.
const playbackTimers = new Map(); // sessionId → timeoutId

function clearPlaybackTimer(sessionId) {
  if (playbackTimers.has(sessionId)) {
    clearTimeout(playbackTimers.get(sessionId));
    playbackTimers.delete(sessionId);
  }
}

function scheduleNextTrack(sessionId, durationSeconds) {
  clearPlaybackTimer(sessionId);
  if (!durationSeconds || durationSeconds <= 0) return;

  const ms = (durationSeconds + 3) * 1000; // +3s buffer
  const timerId = setTimeout(() => {
    playbackTimers.delete(sessionId);
    const next = store.dequeueNext(sessionId);
    const session = store.getSession(sessionId);
    if (!session) return;
    const sanitized = sanitizeSession(session);
    io.to(sessionId).emit('room:updated', sanitized);
    io.to(sessionId).emit('playback:next', { track: next });
    console.log(`[Timer] Auto-advanced track for session ${sessionId}`);

    // If there's a next track and it has duration, schedule the one after
    if (next?.duration) scheduleNextTrack(sessionId, next.duration);
  }, ms);

  playbackTimers.set(sessionId, timerId);
  console.log(`[Timer] Scheduled next track in ${ms / 1000}s for session ${sessionId}`);
}
// ───────────────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ── HOST: Register as host for a session ──
  socket.on('host:register', ({ sessionId }) => {
    const session = store.getSession(sessionId);
    if (!session) return socket.emit('error', { message: 'Sesi tidak ditemukan.' });

    store.updateSession(sessionId, (s) => { s.hostSocketId = socket.id; });
    socket.join(sessionId);
    socket.data.role = 'host';
    socket.data.sessionId = sessionId;

    socket.emit('host:registered', {
      session: sanitizeSession(store.getSession(sessionId)),
    });
    console.log(`[Socket] Host registered for session ${session.code}`);
  });

  // ── HOST: Re-register after reconnect (mobile background / network switch) ──
  socket.on('host:reconnect', ({ sessionId }) => {
    const session = store.getSession(sessionId);
    if (!session) return socket.emit('error', { message: 'Sesi tidak ditemukan atau sudah berakhir.' });

    store.updateSession(sessionId, (s) => { s.hostSocketId = socket.id; });
    socket.join(sessionId);
    socket.data.role = 'host';
    socket.data.sessionId = sessionId;

    // Send full session state so host can recover playback position
    socket.emit('host:reconnected', {
      session: sanitizeSession(store.getSession(sessionId)),
    });
    console.log(`[Socket] Host RE-connected for session ${session.code}`);
  });

  // ── GUEST: Reset device registration (unregister old device ID from session) ──
  socket.on('device:reset', async ({ code, oldDeviceId }) => {
    const session = await store.getSession(
      (await store.getSessionByCode(code))?.id
    );
    if (!session || !oldDeviceId) return;
    await store.updateSession(session.id, (s) => {
      s.deviceIds = s.deviceIds.filter((d) => d !== oldDeviceId);
    });
    socket.emit('device:reset:ok');
  });

  // ── GUEST: Join a session ──
  socket.on('guest:join', async ({ code, nickname, deviceId }) => {
    const session = store.getSessionByCode(code);
    if (!session) return socket.emit('error', { message: 'Kode sesi tidak valid. Coba lagi.' });

    // Device fingerprint check — one user per device per session
    if (deviceId && isDeviceRegistered(session.id, deviceId)) {
      return socket.emit('error', {
        message: 'Perangkat ini sudah terdaftar di sesi ini. Satu perangkat hanya boleh satu pengguna.',
      });
    }

    const finalNickname = (nickname || '').trim() || generateRandomNickname();
    const guestId = generateGuestId();

    store.addGuestToSession(session.id, {
      id: guestId,
      nickname: finalNickname,
      socketId: socket.id,
      deviceId: deviceId || null,
    });

    socket.join(session.id);
    socket.data.role = 'guest';
    socket.data.sessionId = session.id;
    socket.data.guestId = guestId;
    socket.data.nickname = finalNickname;
    socket.data.deviceId = deviceId || null;

    const fullSession = sanitizeSession(store.getSession(session.id));

    // Confirm to guest
    socket.emit('guest:joined', {
      guestId,
      nickname: finalNickname,
      session: fullSession,
    });

    // Notify everyone in room
    io.to(session.id).emit('room:updated', fullSession);
    console.log(`[Socket] Guest "${finalNickname}" joined session ${session.code} (device: ${deviceId || 'unknown'})`);
  });

  // ── GUEST: Add a track to queue ──
  socket.on('queue:add', async ({ url }) => {
    if (socket.data.role !== 'guest') return;
    const { sessionId, guestId, nickname } = socket.data;
    const session = store.getSession(sessionId);
    if (!session) return socket.emit('error', { message: 'Sesi tidak ditemukan.' });

    // Check guest song limit (dynamic per session)
    const guest = session.guests.find((g) => g.id === guestId);
    if (!guest) return socket.emit('error', { message: 'Kamu tidak terdaftar dalam sesi ini.' });
    const limit = session.maxSongsPerGuest || 3;
    if (guest.activeSongCount >= limit) {
      return socket.emit('queue:add:rejected', {
        reason: `Kamu sudah punya ${limit} lagu di antrian. Tunggu salah satunya selesai dulu ya!`,
      });
    }

    // Validate URL
    socket.emit('queue:validating');
    const validation = await validateYouTubeUrl(url);
    if (!validation.valid) {
      return socket.emit('queue:add:rejected', { reason: validation.reason });
    }

    const track = {
      id: generateTrackId(),
      videoId: validation.videoId,
      title: validation.title,
      thumbnail: validation.thumbnail,
      authorName: validation.authorName,
      requestedBy: guestId,
      requestedByNickname: nickname,
      addedAt: Date.now(),
    };

    store.addTrackToQueue(sessionId, track);
    const updatedSession = sanitizeSession(store.getSession(sessionId));

    socket.emit('queue:add:success', { track });
    io.to(sessionId).emit('room:updated', updatedSession);
    console.log(`[Socket] Track added: "${track.title}" by ${nickname}`);
  });

  // ── HOST: Remove a track from queue ──
  socket.on('queue:remove', ({ trackId }) => {
    if (socket.data.role !== 'host') return;
    const { sessionId } = socket.data;
    store.removeTrackFromQueue(sessionId, trackId);
    io.to(sessionId).emit('room:updated', sanitizeSession(store.getSession(sessionId)));
  });

  // ── HOST: Track started — client sends duration so server can auto-advance ──
  socket.on('playback:started', ({ duration }) => {
    if (socket.data.role !== 'host') return;
    const { sessionId } = socket.data;
    if (duration && duration > 0) {
      scheduleNextTrack(sessionId, duration);
    }
  });

  // ── HOST: Skip current track ──
  socket.on('playback:skip', () => {
    if (socket.data.role !== 'host') return;
    const { sessionId } = socket.data;
    clearPlaybackTimer(sessionId); // cancel server timer
    const next = store.dequeueNext(sessionId);
    const session = sanitizeSession(store.getSession(sessionId));
    io.to(sessionId).emit('room:updated', session);
    io.to(sessionId).emit('playback:next', { track: next });
  });

  // ── HOST: Track ended — fallback jika client masih bisa emit ──
  socket.on('playback:ended', () => {
    if (socket.data.role !== 'host') return;
    const { sessionId } = socket.data;
    clearPlaybackTimer(sessionId); // cancel server timer agar tidak double-advance
    const next = store.dequeueNext(sessionId);
    const session = sanitizeSession(store.getSession(sessionId));
    io.to(sessionId).emit('room:updated', session);
    io.to(sessionId).emit('playback:next', { track: next });
  });

  // ── HOST: Sync playback state to guests ──
  socket.on('playback:state', ({ isPlaying, currentTime }) => {
    if (socket.data.role !== 'host') return;
    const { sessionId } = socket.data;
    store.updateSession(sessionId, (s) => { s.isPlaying = isPlaying; });
    socket.to(sessionId).emit('playback:state', { isPlaying, currentTime });
  });

  // ── HOST: Start playing (set first track from queue) ──
  socket.on('playback:start', () => {
    if (socket.data.role !== 'host') return;
    const { sessionId } = socket.data;
    const session = store.getSession(sessionId);
    if (!session) return;

    if (!session.currentTrack && session.queue.length > 0) {
      const next = store.dequeueNext(sessionId);
      const updatedSession = sanitizeSession(store.getSession(sessionId));
      io.to(sessionId).emit('room:updated', updatedSession);
      io.to(sessionId).emit('playback:next', { track: next });
    } else {
      store.updateSession(sessionId, (s) => { s.isPlaying = true; });
      io.to(sessionId).emit('playback:state', { isPlaying: true, currentTime: 0 });
    }
  });

  // ── HOST: Set song limit per guest ──
  socket.on('session:setLimit', ({ limit }) => {
    if (socket.data.role !== 'host') return;
    const { sessionId } = socket.data;
    const newLimit = Math.max(1, Math.min(10, Number(limit)));
    updateSongLimit(sessionId, newLimit);
    const session = sanitizeSession(store.getSession(sessionId));
    io.to(sessionId).emit('room:updated', session);
    console.log(`[Socket] Song limit set to ${newLimit} for session ${sessionId}`);
  });

  // ── HOST: Close session ──
  socket.on('session:close', () => {
    if (socket.data.role !== 'host') return;
    const { sessionId } = socket.data;
    clearPlaybackTimer(sessionId); // cancel any pending timer
    io.to(sessionId).emit('session:closed', { message: 'Host telah menutup sesi.' });
    store.deleteSession(sessionId);
    io.in(sessionId).socketsLeave(sessionId);
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    const { role, sessionId, guestId, nickname } = socket.data || {};
    if (!sessionId) return;

    if (role === 'guest' && guestId) {
      store.removeGuestFromSession(sessionId, guestId);
      const session = store.getSession(sessionId);
      if (session) {
        io.to(sessionId).emit('room:updated', sanitizeSession(session));
        io.to(sessionId).emit('guest:left', { guestId, nickname });
      }
    }

    if (role === 'host') {
      // Notify guests that host disconnected
      io.to(sessionId).emit('host:disconnected', { message: 'Host terputus dari sesi.' });
    }

    console.log(`[Socket] Disconnected: ${socket.id} (${role || 'unknown'})`);
  });
});

/** Strip sensitive data before sending to clients */
function sanitizeSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    code: session.code,
    name: session.name,
    maxSongsPerGuest: session.maxSongsPerGuest || 3,
    guests: session.guests.map((g) => ({
      id: g.id,
      nickname: g.nickname,
      activeSongCount: g.activeSongCount,
    })),
    queue: session.queue,
    currentTrack: session.currentTrack,
    isPlaying: session.isPlaying,
  };
}

// Catchall — semua route yang bukan /api atau /health dilayani oleh React
app.get(/^(?!\/api|\/health).*$/, (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ──────────────────────────────────────────────
// Start Server
// ──────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🎵 OfficeBeats server running on port ${PORT}`);
  console.log(`   Client origin: ${CLIENT_ORIGIN}\n`);
});
