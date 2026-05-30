import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { connectSocket, disconnectSocket } from '../socket';
import { useYouTubePlayer, updateMediaSession } from '../hooks/useYouTubePlayer';
import { NowPlaying } from '../components/NowPlaying';
import { QueueList } from '../components/QueueList';
import { SessionQR } from '../components/SessionQR';
import { useToast } from '../context/ToastContext';
import { guestAvatarStyle } from '../utils/guestColors';
import './HostDashboard.css';

export default function HostDashboard() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [session, setSession] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [volume, setVolume] = useState(80);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [connected, setConnected] = useState(false);
  const [songLimit, setSongLimit] = useState(3);   // Admin-controlled max songs per guest
  const [isGuessingGameEnabled, setIsGuessingGameEnabled] = useState(false);
  const [correctGuessPoints, setCorrectGuessPoints] = useState(10);
  const [queueModifyCost, setQueueModifyCost] = useState(20);
  const [activeTab, setActiveTab] = useState('queue');

  const socketRef           = useRef(null);
  const progressInterval    = useRef(null);
  const endedPollingInterval = useRef(null); // fallback: detect track end via polling
  const playerControls      = useRef(null);
  const isFirstConnect      = useRef(true);
  // Stable ref for emitting playback:ended — safe to call from inside intervals
  const emitEndedRef = useRef(() => socketRef.current?.emit('playback:ended'));

  // handleSkip forward-ref so the hook's onNextTrack handler is always current
  const handleSkipRef = useRef(null);

  // ── Fallback polling: emit playback:ended when getCurrentTime ≥ getDuration-1
  // This ensures track advance works even if Chrome suppresses the YT ENDED event
  // in background. Runs every 1 second while playing.
  function startEndedPolling() {
    stopEndedPolling();
    endedPollingInterval.current = setInterval(() => {
      const t = playerControls.current?.getCurrentTime?.() || 0;
      const d = playerControls.current?.getDuration?.()   || 0;
      if (d > 0 && t >= d - 1) {
        stopEndedPolling();
        emitEndedRef.current();
      }
    }, 1000);
  }

  function stopEndedPolling() {
    if (endedPollingInterval.current) {
      clearInterval(endedPollingInterval.current);
      endedPollingInterval.current = null;
    }
  }

  // YouTube Player — nowPlaying keeps Media Session metadata current inside the hook.
  // onNextTrack wires the OS ⏭ button directly to handleSkip.
  const ytPlayer = useYouTubePlayer({
    containerId: 'yt-player',
    nowPlaying:  currentTrack,         // hook updates Media Session metadata automatically
    onNextTrack: () => handleSkipRef.current?.(),  // always calls the latest handleSkip
    onPrevTrack: () => playerControls.current?.play?.(),
    onEnded: () => {
      // Primary path: YouTube ENDED event fires normally
      stopEndedPolling(); // cancel fallback so we don't double-emit
      socketRef.current?.emit('playback:ended');
    },
    onStateChange: (state) => {
      // YT.PlayerState: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
      if (state === 1) {
        setIsPlaying(true);
        setDuration(playerControls.current?.getDuration?.() || 0);
        startProgressTracking();
      } else if (state === 2) {
        setIsPlaying(false);
        stopProgressTracking();
      }
    },
  });
  playerControls.current = ytPlayer;

  function startProgressTracking() {
    stopProgressTracking();
    progressInterval.current = setInterval(() => {
      const t = playerControls.current?.getCurrentTime?.() || 0;
      const d = playerControls.current?.getDuration?.()   || 0;
      setProgress(t);
      if (d > 0) setDuration(d);
    }, 500);
    // Start fallback ended-detection alongside progress tracking
    startEndedPolling();
  }

  function stopProgressTracking() {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
    stopEndedPolling();
  }

  // Set volume when changed
  useEffect(() => {
    playerControls.current?.setVolume?.(volume);
  }, [volume]);

  // playbackState sync: keep Media Session in sync with isPlaying changes
  // (metadata is handled by the hook via nowPlaying; we only need playbackState here)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  // Socket setup
  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;
    isFirstConnect.current = true;

    // First connection: full register
    socket.on('connect', () => {
      setConnected(true);
      if (isFirstConnect.current) {
        isFirstConnect.current = false;
        socket.emit('host:register', { sessionId });
      } else {
        // Reconnect: re-attach to existing session to preserve state
        socket.emit('host:reconnect', { sessionId });
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
      stopProgressTracking();
    });

    // First-time registration response
    socket.on('host:registered', ({ session }) => {
      setSession(session);
      setSongLimit(session.maxSongsPerGuest || 3);
      setIsGuessingGameEnabled(session.isGuessingGameEnabled || false);
      setCorrectGuessPoints(session.correctGuessPoints !== undefined ? session.correctGuessPoints : 10);
      setQueueModifyCost(session.queueModifyCost !== undefined ? session.queueModifyCost : 20);
      if (session.currentTrack) {
        setCurrentTrack(session.currentTrack);
        setIsPlaying(session.isPlaying);
      }
    });

    // Reconnect response — restore full state from server
    socket.on('host:reconnected', ({ session }) => {
      setSession(session);
      setSongLimit(session.maxSongsPerGuest || 3);
      setIsGuessingGameEnabled(session.isGuessingGameEnabled || false);
      setCorrectGuessPoints(session.correctGuessPoints !== undefined ? session.correctGuessPoints : 10);
      setQueueModifyCost(session.queueModifyCost !== undefined ? session.queueModifyCost : 20);
      addToast('Koneksi pulih ✓', 'info');

      if (session.currentTrack) {
        setCurrentTrack(session.currentTrack);
        if (session.isPlaying) {
          playerControls.current?.loadAndPlay?.(session.currentTrack.videoId);
          setIsPlaying(true);
          startProgressTracking();
        } else {
          setIsPlaying(false);
        }
        // Media Session metadata is updated automatically by the hook (nowPlaying prop)
      }
    });

    socket.on('room:updated', (session) => {
      setSession(session);
      if (session.currentTrack) setCurrentTrack(session.currentTrack);
      if (session.maxSongsPerGuest) setSongLimit(session.maxSongsPerGuest);
      setIsGuessingGameEnabled(session.isGuessingGameEnabled || false);
      if (session.correctGuessPoints !== undefined) setCorrectGuessPoints(session.correctGuessPoints);
      if (session.queueModifyCost !== undefined) setQueueModifyCost(session.queueModifyCost);
    });

    // ── Core fix for background track advance ──────────────────────────────
    // loadAndPlay() is synchronous — no React state chain, no setTimeout.
    // The hook's onNextTrack and polling fallback ensure this fires even in background.
    socket.on('playback:next', ({ track }) => {
      setProgress(0);
      setDuration(0);
      stopEndedPolling(); // reset fallback for the new track

      if (!track) {
        setCurrentTrack(null);
        setIsPlaying(false);
        stopProgressTracking();
        addToast('Antrian habis. Tambah lagu baru!', 'info');
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
        return;
      }

      // Update UI state + trigger actual playback
      // The hook will automatically update Media Session metadata because
      // nowPlaying=currentTrack will re-run its useEffect after setCurrentTrack
      setCurrentTrack(track);
      setIsPlaying(true);
      playerControls.current?.loadAndPlay?.(track.videoId);
    });

    socket.on('guest:left', ({ nickname }) => {
      addToast(`${nickname} meninggalkan sesi`, 'info');
    });

    socket.on('game:roundResults', ({ track, requesterNickname, correctGuessers }) => {
      const correctCount = correctGuessers.length;
      if (correctCount > 0) {
        addToast(`Lagu ${track.title} diminta oleh ${requesterNickname}. ${correctCount} orang menebak benar!`, 'success');
      } else {
        addToast(`Lagu ${track.title} diminta oleh ${requesterNickname}. Tidak ada yang menebak benar.`, 'info');
      }
    });

    socket.on('queue:moved', ({ nickname, trackTitle, direction, cost }) => {
      addToast(`${nickname} membayar ${cost} poin untuk ${direction === 'up' ? 'menaikkan' : 'menurunkan'} lagu "${trackTitle}"`, 'success');
    });

    socket.on('error', ({ message }) => {
      addToast(message, 'error');
    });

    return () => {
      stopProgressTracking();
      socket.off('connect');
      socket.off('disconnect');
      socket.off('host:registered');
      socket.off('host:reconnected');
      socket.off('room:updated');
      socket.off('playback:next');
      socket.off('guest:left');
      socket.off('queue:moved');
      socket.off('error');
      disconnectSocket();
    };
  }, [sessionId]);

  const handlePlay = useCallback(() => {
    if (!currentTrack && session?.queue?.length > 0) {
      socketRef.current?.emit('playback:start');
    } else if (currentTrack) {
      playerControls.current?.play?.();
      setIsPlaying(true);
      socketRef.current?.emit('playback:state', { isPlaying: true, currentTime: progress });
      startProgressTracking();
    }
  }, [currentTrack, session, progress]);

  const handlePause = useCallback(() => {
    playerControls.current?.pause?.();
    setIsPlaying(false);
    socketRef.current?.emit('playback:state', { isPlaying: false, currentTime: progress });
    stopProgressTracking();
  }, [progress]);

  const handleSkip = useCallback(() => {
    socketRef.current?.emit('playback:skip');
    setProgress(0);
    setDuration(0);
    stopProgressTracking();
  }, []);
  // Keep the forward-ref up-to-date so the hook's onNextTrack always calls latest handleSkip
  handleSkipRef.current = handleSkip;

  const handleRemoveTrack = useCallback((trackId) => {
    socketRef.current?.emit('queue:remove', { trackId });
    addToast('Lagu dihapus dari antrian', 'info');
  }, []);

  const handleSetLimit = useCallback((newLimit) => {
    const clamped = Math.max(1, Math.min(10, newLimit));
    setSongLimit(clamped);
    socketRef.current?.emit('session:setLimit', { limit: clamped });
  }, []);

  const handleToggleGuessingGame = useCallback(() => {
    const newVal = !isGuessingGameEnabled;
    setIsGuessingGameEnabled(newVal);
    socketRef.current?.emit('session:toggleGuessingGame', { enabled: newVal });
    addToast(`Mode Tebak Request ${newVal ? 'diaktifkan' : 'dinonaktifkan'}`, 'info');
  }, [isGuessingGameEnabled]);

  const handleSetPointsConfig = useCallback((points, cost) => {
    const clampedPoints = Math.max(1, points);
    const clampedCost = Math.max(1, cost);
    setCorrectGuessPoints(clampedPoints);
    setQueueModifyCost(clampedCost);
    socketRef.current?.emit('session:updatePointsConfig', { correctGuessPoints: clampedPoints, queueModifyCost: clampedCost });
  }, []);

  const handleCloseSession = () => {
    if (window.confirm('Tutup sesi? Semua guest akan terputus.')) {
      socketRef.current?.emit('session:close');
      navigate('/');
      addToast('Sesi ditutup', 'info');
    }
  };

  const storedSession = JSON.parse(sessionStorage.getItem('ob_host_session') || '{}');
  const code = session?.code || storedSession?.code || '------';
  const sessionName = session?.name || 'icikiwir';
  const guestCount = session?.guests?.length || 0;
  const queueLength = session?.queue?.length || 0;

  const topGuessers = [...(session?.guests || [])]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .filter(g => (g.score || 0) > 0)
    .slice(0, 5);

  const topRequesters = [...(session?.guests || [])]
    .sort((a, b) => (b.totalRequestedSongs || 0) - (a.totalRequestedSongs || 0))
    .filter(g => (g.totalRequestedSongs || 0) > 0)
    .slice(0, 5);

  return (
    <div className="host-page">
      {/* Hidden YouTube player */}
      {/* YouTube player: 1×1 off-screen so Chrome treats it as active media (not throttled).
           width:0/height:0 causes browsers to classify the iframe as invisible and may
           suspend its JS execution — killing background playback. */}
      <div id="yt-player" style={{ position: 'fixed', top: '-2px', left: '-2px', width: '1px', height: '1px', pointerEvents: 'none', opacity: 0 }} />

      {/* Header */}
      <header className="host-header glass">
        <div className="host-header-left">
          <div className="logo-sm">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div>
            <span className="host-session-name">{sessionName}</span>
            <div className="host-status">
              <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
              <span>{connected ? 'Terhubung' : 'Terputus...'}</span>
            </div>
          </div>
        </div>

        <div className="host-header-right">
          <div className="host-stats">
            <span className="stat-chip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
              {guestCount} guest
            </span>
            <span className="stat-chip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              {queueLength} lagu
            </span>
          </div>
          <button className="btn btn-danger btn-sm" onClick={handleCloseSession} id="btn-close-session">
            Tutup Sesi
          </button>
        </div>
      </header>

      <div className="host-layout">
        {/* LEFT PANEL */}
        <aside className="host-sidebar">
          <SessionQR code={code} sessionName={sessionName} />

          {/* Playback Controls */}
          <div className="playback-card card">
            <h3 className="section-title">Kontrol Pemutaran</h3>

            <div className="playback-controls">
              <button
                id="btn-skip-prev"
                className="btn btn-icon skip-btn"
                onClick={handleSkip}
                title="Skip"
                disabled={!currentTrack && queueLength === 0}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 4 15 12 5 20 5 4" />
                  <line x1="19" y1="5" x2="19" y2="19" />
                </svg>
              </button>

              <button
                id="btn-play-pause"
                className={`btn btn-play ${isPlaying ? 'playing' : ''}`}
                onClick={isPlaying ? handlePause : handlePlay}
                disabled={!currentTrack && queueLength === 0}
              >
                {isPlaying ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                )}
              </button>

              <button
                className="btn btn-icon skip-btn"
                onClick={handleSkip}
                title="Next"
                disabled={!currentTrack && queueLength === 0}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 4 15 12 5 20 5 4" />
                  <line x1="19" y1="5" x2="19" y2="19" />
                </svg>
              </button>
            </div>

            {/* Volume */}
            <div className="volume-control">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                {volume > 0 && <path d="M15.54 8.46a5 5 0 010 7.07" />}
                {volume > 50 && <path d="M19.07 4.93a10 10 0 010 14.14" />}
              </svg>
              <input
                id="volume-slider"
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="volume-slider"
              />
              <span className="volume-value">{volume}%</span>
            </div>
          </div>

          {/* Guest List */}
          <div className="card">
            <h3 className="section-title">
              Guest Aktif
              <span className="badge badge-indigo" style={{ marginLeft: 8 }}>{guestCount}</span>
            </h3>
            {guestCount === 0 ? (
              <p className="empty-guests">Belum ada guest. Bagikan kode sesi!</p>
            ) : (
              <ul className="guest-list">
                {session?.guests?.map((g) => (
                  <li key={g.id} className="guest-item animate-slideIn">
                    <div
                      className="guest-avatar"
                      style={guestAvatarStyle(g.id)}
                    >
                      {g.nickname.charAt(0).toUpperCase()}
                    </div>
                    <div className="guest-info">
                      <span className="guest-name">{g.nickname}</span>
                      <span className={`guest-songs ${
                        g.activeSongCount >= songLimit ? 'at-limit' :
                        g.activeSongCount >= songLimit - 1 ? 'near-limit' : ''
                      }`}>
                        {g.activeSongCount || 0}/{songLimit} lagu
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Song Limit Control */}
            <div style={{ marginTop: 'var(--space-4)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-4)' }}>
              <div className="song-limit-control">
                <div className="limit-header">
                  <span className="limit-title">Maks lagu per guest</span>
                  <span className="limit-value-badge">{songLimit}</span>
                </div>
                <div className="limit-slider-row">
                  <button
                    className="limit-btn"
                    onClick={() => handleSetLimit(songLimit - 1)}
                    disabled={songLimit <= 1}
                    aria-label="Kurangi batas"
                  >−</button>
                  <input
                    id="limit-slider"
                    type="range"
                    min="1"
                    max="10"
                    value={songLimit}
                    onChange={(e) => handleSetLimit(Number(e.target.value))}
                    className="limit-slider"
                  />
                  <button
                    className="limit-btn"
                    onClick={() => handleSetLimit(songLimit + 1)}
                    disabled={songLimit >= 10}
                    aria-label="Tambah batas"
                  >+</button>
                </div>
                <p className="limit-desc">Berlaku langsung untuk semua guest aktif</p>
              </div>
            </div>

            {/* Guessing Game Toggle */}
            <div style={{ marginTop: 'var(--space-4)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-4)' }}>
              <div className="limit-header" style={{ marginBottom: '8px' }}>
                <span className="limit-title">Mode Tebak Request</span>
                <label className="switch">
                  <input type="checkbox" checked={isGuessingGameEnabled} onChange={handleToggleGuessingGame} />
                  <span className="slider round"></span>
                </label>
              </div>
              <p className="limit-desc">Sembunyikan nama peminta lagu dan biarkan guest menebak</p>
            </div>

            {/* Points Config Control */}
            {isGuessingGameEnabled && (
              <div style={{ marginTop: 'var(--space-4)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-4)' }}>
                <h4 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Pengaturan Poin
                </h4>
                
                {/* Correct Guess Points */}
                <div className="song-limit-control" style={{ marginBottom: '12px' }}>
                  <div className="limit-header">
                    <span className="limit-title">Poin Tebak Benar</span>
                    <span className="limit-value-badge">{correctGuessPoints} pts</span>
                  </div>
                  <div className="limit-slider-row">
                    <button
                      className="limit-btn"
                      onClick={() => handleSetPointsConfig(correctGuessPoints - 5, queueModifyCost)}
                      disabled={correctGuessPoints <= 5}
                      aria-label="Kurangi poin"
                    >−</button>
                    <input
                      type="range"
                      min="5"
                      max="50"
                      step="5"
                      value={correctGuessPoints}
                      onChange={(e) => handleSetPointsConfig(Number(e.target.value), queueModifyCost)}
                      className="limit-slider"
                    />
                    <button
                      className="limit-btn"
                      onClick={() => handleSetPointsConfig(correctGuessPoints + 5, queueModifyCost)}
                      disabled={correctGuessPoints >= 50}
                      aria-label="Tambah poin"
                    >+</button>
                  </div>
                </div>

                {/* Queue Modify Cost */}
                <div className="song-limit-control">
                  <div className="limit-header">
                    <span className="limit-title">Biaya Ubah Antrian</span>
                    <span className="limit-value-badge">{queueModifyCost} pts</span>
                  </div>
                  <div className="limit-slider-row">
                    <button
                      className="limit-btn"
                      onClick={() => handleSetPointsConfig(correctGuessPoints, queueModifyCost - 5)}
                      disabled={queueModifyCost <= 5}
                      aria-label="Kurangi biaya"
                    >−</button>
                    <input
                      type="range"
                      min="5"
                      max="100"
                      step="5"
                      value={queueModifyCost}
                      onChange={(e) => handleSetPointsConfig(correctGuessPoints, Number(e.target.value))}
                      className="limit-slider"
                    />
                    <button
                      className="limit-btn"
                      onClick={() => handleSetPointsConfig(correctGuessPoints, queueModifyCost + 5)}
                      disabled={queueModifyCost >= 100}
                      aria-label="Tambah biaya"
                    >+</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Leaderboard */}
          <div className="card">
            <h3 className="section-title">Leaderboard</h3>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <h4 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top Requesters</h4>
              {topRequesters.length === 0 ? (
                <p className="empty-guests" style={{ fontSize: '0.85rem' }}>Belum ada data.</p>
              ) : (
                <ul className="guest-list" style={{ gap: '8px' }}>
                  {topRequesters.map((g, i) => (
                    <li key={g.id} className="guest-item" style={{ padding: '6px' }}>
                      <div className="guest-avatar" style={{ width: '24px', height: '24px', fontSize: '0.8rem', ...guestAvatarStyle(g.id) }}>
                        {g.nickname.charAt(0).toUpperCase()}
                      </div>
                      <div className="guest-info" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="guest-name" style={{ fontSize: '0.9rem' }}>{i + 1}. {g.nickname}</span>
                        <span className="badge badge-indigo">{g.totalRequestedSongs} lagu</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top Guessers</h4>
              {topGuessers.length === 0 ? (
                <p className="empty-guests" style={{ fontSize: '0.85rem' }}>Belum ada data.</p>
              ) : (
                <ul className="guest-list" style={{ gap: '8px' }}>
                  {topGuessers.map((g, i) => (
                    <li key={g.id} className="guest-item" style={{ padding: '6px' }}>
                      <div className="guest-avatar" style={{ width: '24px', height: '24px', fontSize: '0.8rem', ...guestAvatarStyle(g.id) }}>
                        {g.nickname.charAt(0).toUpperCase()}
                      </div>
                      <div className="guest-info" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="guest-name" style={{ fontSize: '0.9rem' }}>{i + 1}. {g.nickname}</span>
                        <span className="badge badge-emerald">{g.score} pts</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>

        {/* MAIN PANEL */}
        <main className="host-main">
          {/* Now Playing */}
          <section className="host-now-playing">
            <NowPlaying
              track={currentTrack}
              isPlaying={isPlaying}
              progress={progress}
              duration={duration}
              isGuessingGameEnabled={isGuessingGameEnabled}
            />
          </section>

          {/* Queue */}
          <section className="host-queue-section card">
            <div className="queue-header">
              <h3 className="section-title">
                Antrian Lagu
                {queueLength > 0 && (
                  <span className="badge badge-indigo" style={{ marginLeft: 8 }}>{queueLength}</span>
                )}
              </h3>
            </div>
            <QueueList
              queue={session?.queue || []}
              isHost={true}
              onRemove={handleRemoveTrack}
              currentTrack={currentTrack}
              isGuessingGameEnabled={isGuessingGameEnabled}
            />
          </section>
        </main>
      </div>
    </div>
  );
}
