/**
 * OfficeBeats — Main Server
 * Express + Socket.io server for real-time collaborative music queue
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const { validateYouTubeUrl } = require('./youtubeValidator');
const store = require('./sessionStore');

const app = express();
const server = http.createServer(app);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const io = new Server(server, {
  cors: {
    origin: [CLIENT_ORIGIN, 'http://localhost:5173', 'http://localhost:4173'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 10000,
  pingTimeout: 25000,
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
});

app.use(cors({
  origin: [CLIENT_ORIGIN, 'http://localhost:5173', 'http://localhost:4173'],
  credentials: true,
}));
app.use(express.json());

const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

app.post('/api/session', async (req, res) => {
  try {
    const { name } = req.body;
    const session = await store.createSession({ name: name || 'icikiwir', hostSocketId: null });
    res.json({ sessionId: session.id, code: session.code, name: session.name });
  } catch (err) {
    console.error('[API] createSession error:', err);
    res.status(500).json({ error: 'Gagal membuat sesi.' });
  }
});

app.get('/api/session/:code', async (req, res) => {
  try {
    const session = await store.getSessionByCode(req.params.code.toUpperCase());
    if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan. Periksa kode lagi.' });
    res.json({
      sessionId: session.id,
      code: session.code,
      name: session.name,
      guestCount: (session.guests || []).length,
      isActive: true,
    });
  } catch (err) {
    console.error('[API] getSession error:', err);
    res.status(500).json({ error: 'Gagal mengambil sesi.' });
  }
});

app.post('/api/validate', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ valid: false, reason: 'URL tidak boleh kosong.' });
  const result = await validateYouTubeUrl(url);
  res.json(result);
});

// Catchall React router
app.get(/^(?!\/api|\/health).*$/, (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateGuestId() { return 'g_' + Math.random().toString(36).substring(2, 10); }
function generateTrackId() { return 't_' + Math.random().toString(36).substring(2, 12); }
function generateRandomNickname() {
  const adj = ['Cool', 'Happy', 'Jazzy', 'Groovy', 'Mellow', 'Funky', 'Chill', 'Sunny'];
  const noun = ['Panda', 'Bear', 'Fox', 'Wolf', 'Eagle', 'Shark', 'Tiger', 'Lion'];
  return adj[Math.floor(Math.random() * adj.length)] + noun[Math.floor(Math.random() * noun.length)];
}

function sanitizeSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    code: session.code,
    name: session.name,
    maxSongsPerGuest: session.maxSongsPerGuest || 3,
    isGuessingGameEnabled: session.isGuessingGameEnabled || false,
    guests: (session.guests || []).map((g) => ({
      id: g.id,
      nickname: g.nickname,
      activeSongCount: g.activeSongCount || 0,
      score: g.score || 0,
      totalRequestedSongs: g.totalRequestedSongs || 0,
    })),
    queue: session.queue || [],
    currentTrack: session.currentTrack || null,
    isPlaying: session.isPlaying || false,
  };
}

// ── Server-side playback timer ────────────────────────────────────────────────
const playbackTimers = new Map();

function clearPlaybackTimer(sessionId) {
  if (playbackTimers.has(sessionId)) {
    clearTimeout(playbackTimers.get(sessionId));
    playbackTimers.delete(sessionId);
  }
}

async function scheduleNextTrack(sessionId, durationSeconds) {
  clearPlaybackTimer(sessionId);
  if (!durationSeconds || durationSeconds <= 0) return;
  const ms = (durationSeconds + 3) * 1000;
  const timerId = setTimeout(async () => {
    playbackTimers.delete(sessionId);
    const { nextTrack } = await store.dequeueNext(sessionId);
    const session = await store.getSession(sessionId);
    if (!session) return;
    io.to(sessionId).emit('room:updated', sanitizeSession(session));
    io.to(sessionId).emit('playback:next', { track: nextTrack, completed: true });
    console.log(`[Timer] Auto-advanced for session ${sessionId}`);
    if (nextTrack?.duration) scheduleNextTrack(sessionId, nextTrack.duration);
  }, ms);
  playbackTimers.set(sessionId, timerId);
}

// ── Socket.io ─────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  socket.on('host:register', async ({ sessionId }) => {
    try {
      const session = await store.getSession(sessionId);
      if (!session) return socket.emit('error', { message: 'Sesi tidak ditemukan.' });
      await store.updateSession(sessionId, (s) => { s.hostSocketId = socket.id; });
      socket.join(sessionId);
      socket.data.role = 'host';
      socket.data.sessionId = sessionId;
      const updated = await store.getSession(sessionId);
      socket.emit('host:registered', { session: sanitizeSession(updated) });
      console.log(`[Socket] Host registered for session ${session.code}`);
    } catch (err) { console.error('[host:register]', err); }
  });

  socket.on('host:reconnect', async ({ sessionId }) => {
    try {
      const session = await store.getSession(sessionId);
      if (!session) return socket.emit('error', { message: 'Sesi tidak ditemukan atau sudah berakhir.' });
      await store.updateSession(sessionId, (s) => { s.hostSocketId = socket.id; });
      socket.join(sessionId);
      socket.data.role = 'host';
      socket.data.sessionId = sessionId;
      const updated = await store.getSession(sessionId);
      socket.emit('host:reconnected', { session: sanitizeSession(updated) });
      console.log(`[Socket] Host RE-connected for session ${session.code}`);
    } catch (err) { console.error('[host:reconnect]', err); }
  });

  socket.on('device:reset', async ({ code, oldDeviceId }) => {
    try {
      const session = await store.getSessionByCode(code);
      if (!session || !oldDeviceId) return;
      await store.updateSession(session.id, (s) => {
        s.deviceIds = (s.deviceIds || []).filter((d) => d !== oldDeviceId);
      });
      socket.emit('device:reset:ok');
    } catch (err) { console.error('[device:reset]', err); }
  });

  socket.on('guest:rejoin', async ({ code, sessionId, guestId, nickname, deviceId }) => {
    try {
      const session = await store.getSessionByCode(code) || await store.getSession(sessionId);
      if (!session) return socket.emit('error', { message: 'Sesi tidak ditemukan.' });

      // Cek apakah guest masih ada di sesi
      const existingGuest = (session.guests || []).find((g) => g.id === guestId);
      if (existingGuest) {
        // Update socketId guest dengan yang baru
        await store.updateSession(session.id, (s) => {
          const g = s.guests.find((g) => g.id === guestId);
          if (g) { g.socketId = socket.id; g.deviceId = deviceId || g.deviceId; }
        });
      } else {
        // Guest sudah dihapus (disconnect terlalu lama), tambah ulang
        await store.addGuestToSession(session.id, {
          id: guestId,
          nickname: nickname,
          socketId: socket.id,
          deviceId: deviceId || null,
        });
      }

      socket.join(session.id);
      socket.data.role = 'guest';
      socket.data.sessionId = session.id;
      socket.data.guestId = guestId;
      socket.data.nickname = nickname;
      socket.data.deviceId = deviceId || null;

      const updated = await store.getSession(session.id);
      const fullSession = sanitizeSession(updated);
      socket.emit('guest:rejoined', { guestId, nickname, session: fullSession });
      io.to(session.id).emit('room:updated', fullSession);
      console.log(`[Socket] Guest "${nickname}" RE-joined session ${session.code}`);
    } catch (err) { console.error('[guest:rejoin]', err); }
  });

  socket.on('guest:join', async ({ code, nickname, deviceId }) => {
    try {
      const session = await store.getSessionByCode(code);
      if (!session) return socket.emit('error', { message: 'Kode sesi tidak valid. Coba lagi.' });

      if (deviceId && await store.isDeviceRegistered(session.id, deviceId)) {
        return socket.emit('error', {
          message: 'Perangkat ini sudah terdaftar di sesi ini. Satu perangkat hanya boleh satu pengguna.',
        });
      }

      const finalNickname = (nickname || '').trim() || generateRandomNickname();
      const guestId = generateGuestId();

      await store.addGuestToSession(session.id, {
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

      const updated = await store.getSession(session.id);
      const fullSession = sanitizeSession(updated);
      socket.emit('guest:joined', { guestId, nickname: finalNickname, session: fullSession });
      io.to(session.id).emit('room:updated', fullSession);
      console.log(`[Socket] Guest "${finalNickname}" joined session ${session.code}`);
    } catch (err) { console.error('[guest:join]', err); }
  });

  socket.on('queue:add', async ({ url }) => {
    try {
      if (socket.data.role !== 'guest') return;
      const { sessionId, guestId, nickname } = socket.data;
      const session = await store.getSession(sessionId);
      if (!session) return socket.emit('error', { message: 'Sesi tidak ditemukan.' });

      const guest = (session.guests || []).find((g) => g.id === guestId);
      if (!guest) return socket.emit('error', { message: 'Kamu tidak terdaftar dalam sesi ini.' });
      const limit = session.maxSongsPerGuest || 3;
      if ((guest.activeSongCount || 0) >= limit) {
        return socket.emit('queue:add:rejected', {
          reason: `Kamu sudah punya ${limit} lagu di antrian. Tunggu salah satunya selesai dulu ya!`,
        });
      }

      socket.emit('queue:validating');
      const validation = await validateYouTubeUrl(url);
      if (!validation.valid) return socket.emit('queue:add:rejected', { reason: validation.reason });

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

      await store.addTrackToQueue(sessionId, track);
      const updated = sanitizeSession(await store.getSession(sessionId));
      socket.emit('queue:add:success', { track });
      io.to(sessionId).emit('room:updated', updated);
      console.log(`[Socket] Track added: "${track.title}" by ${nickname}`);
    } catch (err) { console.error('[queue:add]', err); }
  });

  socket.on('queue:remove', async ({ trackId }) => {
    try {
      if (socket.data.role !== 'host') return;
      const { sessionId } = socket.data;
      await store.removeTrackFromQueue(sessionId, trackId);
      const updated = sanitizeSession(await store.getSession(sessionId));
      io.to(sessionId).emit('room:updated', updated);
    } catch (err) { console.error('[queue:remove]', err); }
  });

  socket.on('playback:started', async ({ duration }) => {
    try {
      if (socket.data.role !== 'host') return;
      const { sessionId } = socket.data;
      if (duration && duration > 0) await scheduleNextTrack(sessionId, duration);
    } catch (err) { console.error('[playback:started]', err); }
  });

  socket.on('playback:skip', async () => {
    try {
      if (socket.data.role !== 'host') return;
      const { sessionId } = socket.data;
      clearPlaybackTimer(sessionId);
      const { nextTrack } = await store.dequeueNext(sessionId);
      const updated = sanitizeSession(await store.getSession(sessionId));
      io.to(sessionId).emit('room:updated', updated);
      io.to(sessionId).emit('playback:next', { track: nextTrack, completed: false });
    } catch (err) { console.error('[playback:skip]', err); }
  });

  socket.on('playback:ended', async () => {
    try {
      if (socket.data.role !== 'host') return;
      const { sessionId } = socket.data;
      clearPlaybackTimer(sessionId);
      const { nextTrack, roundResults } = await store.dequeueNext(sessionId);
      const updated = sanitizeSession(await store.getSession(sessionId));
      io.to(sessionId).emit('room:updated', updated);
      if (roundResults) io.to(sessionId).emit('game:roundResults', roundResults);
      io.to(sessionId).emit('playback:next', { track: nextTrack, completed: true });
    } catch (err) { console.error('[playback:ended]', err); }
  });

  socket.on('playback:state', async ({ isPlaying, currentTime }) => {
    try {
      if (socket.data.role !== 'host') return;
      const { sessionId } = socket.data;
      await store.updateSession(sessionId, (s) => { s.isPlaying = isPlaying; });
      socket.to(sessionId).emit('playback:state', { isPlaying, currentTime });
    } catch (err) { console.error('[playback:state]', err); }
  });

  socket.on('playback:start', async () => {
    try {
      if (socket.data.role !== 'host') return;
      const { sessionId } = socket.data;
      const session = await store.getSession(sessionId);
      if (!session) return;
      if (!session.currentTrack && (session.queue || []).length > 0) {
        const { nextTrack } = await store.dequeueNext(sessionId);
        const updated = sanitizeSession(await store.getSession(sessionId));
        io.to(sessionId).emit('room:updated', updated);
        io.to(sessionId).emit('playback:next', { track: nextTrack, completed: false });
      } else {
        await store.updateSession(sessionId, (s) => { s.isPlaying = true; });
        io.to(sessionId).emit('playback:state', { isPlaying: true, currentTime: 0 });
      }
    } catch (err) { console.error('[playback:start]', err); }
  });

  socket.on('session:setLimit', async ({ limit }) => {
    try {
      if (socket.data.role !== 'host') return;
      const { sessionId } = socket.data;
      const newLimit = Math.max(1, Math.min(10, Number(limit)));
      await store.updateSongLimit(sessionId, newLimit);
      const updated = sanitizeSession(await store.getSession(sessionId));
      io.to(sessionId).emit('room:updated', updated);
    } catch (err) { console.error('[session:setLimit]', err); }
  });

  socket.on('session:toggleGuessingGame', async ({ enabled }) => {
    try {
      if (socket.data.role !== 'host') return;
      const { sessionId } = socket.data;
      await store.toggleGuessingGame(sessionId, enabled);
      const updated = sanitizeSession(await store.getSession(sessionId));
      io.to(sessionId).emit('room:updated', updated);
    } catch (err) { console.error('[session:toggleGuessingGame]', err); }
  });

  socket.on('guest:guess', async ({ guessedGuestId }) => {
    try {
      if (socket.data.role !== 'guest') return;
      const { sessionId, guestId } = socket.data;
      if (!guessedGuestId || !sessionId || !guestId) return;

      const session = await store.getSession(sessionId);
      if (!session?.isGuessingGameEnabled) return;
      if (!session.currentTrack) return;
      // Tidak boleh tebak kalau lagu adalah milik sendiri
      if (session.currentTrack.requestedBy === guestId) return;
      // Cek sudah tebak belum
      if (session.currentGuesses?.[guestId]) return;

      await store.recordGuess(sessionId, guestId, guessedGuestId);
      socket.emit('guest:guessAck', { guessedGuestId });
    } catch (err) { console.error('[guest:guess]', err); }
  });

  socket.on('session:close', async () => {
    try {
      if (socket.data.role !== 'host') return;
      const { sessionId } = socket.data;
      clearPlaybackTimer(sessionId);
      io.to(sessionId).emit('session:closed', { message: 'Host telah menutup sesi.' });
      await store.deleteSession(sessionId);
      io.in(sessionId).socketsLeave(sessionId);
    } catch (err) { console.error('[session:close]', err); }
  });

  socket.on('disconnect', async () => {
    try {
      const { role, sessionId, guestId, nickname } = socket.data || {};
      if (!sessionId) return;

      if (role === 'guest' && guestId) {
        // Tunggu 30 detik sebelum hapus guest — beri kesempatan reconnect/refresh
        setTimeout(async () => {
          try {
            const session = await store.getSession(sessionId);
            if (!session) return;
            // Cek apakah guest sudah reconnect (socketId sudah beda)
            const guest = (session.guests || []).find((g) => g.id === guestId);
            if (guest && guest.socketId === socket.id) {
              // Socket masih sama = belum reconnect, hapus sekarang
              await store.removeGuestFromSession(sessionId, guestId);
              const updated = await store.getSession(sessionId);
              if (updated) {
                io.to(sessionId).emit('room:updated', sanitizeSession(updated));
                io.to(sessionId).emit('guest:left', { guestId, nickname });
              }
            }
          } catch (err) { console.error('[disconnect grace]', err); }
        }, 30000); // 30 detik grace period
      }

      if (role === 'host') {
        io.to(sessionId).emit('host:disconnected', { message: 'Host terputus dari sesi.' });
      }

      console.log(`[Socket] Disconnected: ${socket.id} (${role || 'unknown'})`);
    } catch (err) { console.error('[disconnect]', err); }
  });
});

// ── Start Server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🎵 OfficeBeats server running on port ${PORT}`);
  console.log(`   Client origin: ${CLIENT_ORIGIN}\n`);
});
