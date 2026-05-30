import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { connectSocket, disconnectSocket } from '../socket';
import { NowPlaying } from '../components/NowPlaying';
import { QueueList } from '../components/QueueList';
import { useToast } from '../context/ToastContext';
import './GuestView.css';

/**
 * Generate a stable device fingerprint stored in localStorage.
 * Combines a random UUID with some browser signals.
 * This is NOT cryptographically strong — it's a UX convenience lock.
 */
function getDeviceId() {
  const KEY = 'ob_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * Get stored identity for this device+session (if already joined before).
 */
function getStoredIdentity(sessionCode) {
  try {
    const raw = localStorage.getItem(`ob_guest_${sessionCode}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveIdentity(sessionCode, data) {
  try {
    localStorage.setItem(`ob_guest_${sessionCode}`, JSON.stringify(data));
  } catch {}
}

function clearIdentity(sessionCode) {
  try { localStorage.removeItem(`ob_guest_${sessionCode}`); } catch {}
}

export default function GuestView() {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const code = searchParams.get('code') || '';

  // Device fingerprint (stable per browser)
  const deviceId = useRef(getDeviceId());

  // Check if this device already joined this session
  const storedIdentity = getStoredIdentity(code);

  // Join state
  const [joined, setJoined] = useState(false);
  const [nickname, setNickname] = useState(storedIdentity?.nickname || '');
  const [joining, setJoining] = useState(false);
  const [myGuestId, setMyGuestId] = useState(null);
  const [deviceBlocked, setDeviceBlocked] = useState(false);

  // Session state
  const [session, setSession] = useState(null);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [connected, setConnected] = useState(false);
  const [songLimit, setSongLimit] = useState(3);  // Synced from session.maxSongsPerGuest

  // Submit state
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [validating, setValidating] = useState(false);
  const [preview, setPreview] = useState(null);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('submit'); // 'submit' | 'queue'

  const socketRef = useRef(null);
  const urlInputRef = useRef(null);

  // Socket connection
  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('guest:joined', ({ guestId, nickname: nick, session }) => {
      setMyGuestId(guestId);
      setNickname(nick);
      setSession(session);
      setSongLimit(session.maxSongsPerGuest || 3);
      setCurrentTrack(session.currentTrack);
      setIsPlaying(session.isPlaying);
      setJoined(true);
      setJoining(false);
      // Persist identity for this device+session
      saveIdentity(code, { guestId, nickname: nick });
      addToast(`Selamat datang, ${nick}! 🎵`, 'success');
    });

    socket.on('room:updated', (session) => {
      setSession(session);
      setSongLimit(session.maxSongsPerGuest || 3);
      if (session.currentTrack) {
        setCurrentTrack(session.currentTrack);
        setIsPlaying(session.isPlaying);
      }
    });

    socket.on('playback:next', ({ track }) => {
      setCurrentTrack(track);
      setIsPlaying(track !== null);
    });

    socket.on('playback:state', ({ isPlaying }) => {
      setIsPlaying(isPlaying);
    });

    socket.on('queue:validating', () => {
      setValidating(true);
    });

    socket.on('queue:add:success', ({ track }) => {
      setSubmitting(false);
      setValidating(false);
      setYoutubeUrl('');
      setPreview(null);
      setSubmitError('');
      addToast('Lagu berhasil ditambahkan ke antrian! 🎶', 'success');
      setActiveTab('queue');
    });

    socket.on('queue:add:rejected', ({ reason }) => {
      setSubmitting(false);
      setValidating(false);
      setSubmitError(reason);
    });

    socket.on('session:closed', ({ message }) => {
      clearIdentity(code);  // Clear stored identity when session closes
      addToast(message, 'info');
      navigate('/');
    });

    socket.on('host:disconnected', ({ message }) => {
      addToast(message + ' Tunggu host kembali.', 'info');
    });

    socket.on('error', ({ message }) => {
      // Check if the error is a device block
      if (message.includes('Perangkat ini sudah terdaftar')) {
        setDeviceBlocked(true);
      }
      addToast(message, 'error');
      setJoining(false);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('guest:joined');
      socket.off('room:updated');
      socket.off('playback:next');
      socket.off('playback:state');
      socket.off('queue:validating');
      socket.off('queue:add:success');
      socket.off('queue:add:rejected');
      socket.off('session:closed');
      socket.off('host:disconnected');
      socket.off('error');
      disconnectSocket();
    };
  }, []);

  function handleJoin(e) {
    e.preventDefault();
    if (!socketRef.current?.connected) {
      addToast('Sedang terhubung ke server... coba lagi.', 'error');
      return;
    }
    setJoining(true);
    socketRef.current.emit('guest:join', {
      code: code || searchParams.get('code') || '',
      nickname: nickname.trim(),
      deviceId: deviceId.current,
    });
  }

  async function handleValidateUrl(e) {
    e.preventDefault();
    if (!youtubeUrl.trim()) return;

    setValidating(true);
    setSubmitError('');
    setPreview(null);

    try {
      const res = await axios.post('/api/validate', { url: youtubeUrl.trim() });
      if (res.data.valid) {
        setPreview(res.data);
      } else {
        setSubmitError(res.data.reason);
      }
    } catch {
      setSubmitError('Gagal memvalidasi link. Periksa koneksi internet.');
    } finally {
      setValidating(false);
    }
  }

  function handleSubmitTrack() {
    if (!preview || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    socketRef.current?.emit('queue:add', { url: youtubeUrl.trim() });
  }

  function clearPreview() {
    setPreview(null);
    setYoutubeUrl('');
    setSubmitError('');
    urlInputRef.current?.focus();
  }

  // My active song count + dynamic limit from session
  const myGuest = session?.guests?.find((g) => g.id === myGuestId);
  const mySongCount = myGuest?.activeSongCount || 0;
  const atLimit = mySongCount >= songLimit;

  // ──── DEVICE BLOCKED SCREEN ────
  if (deviceBlocked) {
    const handleResetDevice = () => {
      // Hapus device ID lama dan buat yang baru — seolah perangkat baru
      const KEY = 'ob_device_id';
      const newId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem(KEY, newId);
      // Hapus juga identity tersimpan untuk sesi ini
      localStorage.removeItem(`ob_guest_${code}`);
      // Reload halaman agar bisa join ulang
      window.location.reload();
    };

    return (
      <div className="guest-join-page">
        <div className="guest-join-bg">
          <div className="bg-orb orb-1" />
          <div className="bg-orb orb-2" />
        </div>
        <div className="guest-join-card glass-strong animate-slideUp" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>
            Perangkat Sudah Terdaftar
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 24 }}>
            Perangkat ini sudah digunakan untuk bergabung ke sesi ini sebelumnya.
            Satu perangkat hanya boleh satu pengguna per sesi.
          </p>
          <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }} onClick={() => navigate('/')}>
            Kembali ke Beranda
          </button>
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={handleResetDevice}
          >
            Pakai Perangkat Ini
          </button>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 10, lineHeight: 1.6 }}>
            Pengguna sebelumnya dari perangkat ini akan dikeluarkan dari sesi.
          </p>
        </div>
      </div>
    );
  }

  // ──── JOIN SCREEN ────
  if (!joined) {
    return (
      <div className="guest-join-page">
        <div className="guest-join-bg">
          <div className="bg-orb orb-1" />
          <div className="bg-orb orb-2" />
        </div>

        <div className="guest-join-card glass-strong animate-slideUp">
          <div className="join-logo">
            <div className="logo-icon-sm">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <span>icikiwir</span>
          </div>

          <div className="join-header">
            <h1>Gabung ke Sesi</h1>
            {code && (
              <div className="join-code-display">
                <span className="code-label">Kode Sesi</span>
                <span className="code-value">{code}</span>
              </div>
            )}
            <p>Masukkan nama panggilanmu untuk mulai request lagu</p>
          </div>

          <form onSubmit={handleJoin} className="join-form-inner">
            <div className="input-group">
              <label htmlFor="guest-nickname">Nama Panggilan</label>
              <input
                id="guest-nickname"
                className="input-field"
                type="text"
                placeholder="cth: Dito, Tim Design, dll"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={20}
                autoFocus
              />
              <span className="input-hint">Boleh dikosongkan — nama acak akan dibuat otomatis</span>
            </div>

            <button
              id="btn-guest-join"
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '16px' }}
              disabled={joining || !connected}
            >
              {joining ? (
                <>
                  <span className="animate-spin">⟳</span>
                  Bergabung...
                </>
              ) : !connected ? (
                <>
                  <span className="animate-spin">⟳</span>
                  Menghubungkan...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                  Masuk ke Sesi
                </>
              )}
            </button>
          </form>

          <p className="join-note">Tidak perlu akun. Tidak perlu install apapun.</p>
        </div>
      </div>
    );
  }

  // ──── GUEST DASHBOARD ────
  return (
    <div className="guest-page">
      {/* Header */}
      <header className="guest-header glass">
        <div className="guest-header-left">
          <div className="logo-icon-sm accent">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div>
            <span className="guest-session-name">{session?.name || 'icikiwir'}</span>
            <div className="guest-status-row">
              <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
              <span className="guest-nickname-chip">{nickname}</span>
            </div>
          </div>
        </div>

        <div className="guest-song-counter">
          <span className={`song-count ${atLimit ? 'at-limit' : ''}`}>
            {mySongCount}/{songLimit}
          </span>
          <span className="song-count-label">lagumu</span>
        </div>
      </header>

      {/* Now Playing Banner */}
      <div className="guest-now-playing glass">
        <NowPlaying
          track={currentTrack}
          isPlaying={isPlaying}
          compact={true}
        />
      </div>

      {/* Tabs */}
      <div className="guest-tabs">
        <button
          id="tab-submit"
          className={`guest-tab ${activeTab === 'submit' ? 'active' : ''}`}
          onClick={() => setActiveTab('submit')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          Request Lagu
        </button>
        <button
          id="tab-queue"
          className={`guest-tab ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          Antrian
          {session?.queue?.length > 0 && (
            <span className="tab-badge">{session.queue.length}</span>
          )}
        </button>
      </div>

      {/* Tab Content */}
      <div className="guest-content">
        {activeTab === 'submit' && (
          <div className="submit-panel animate-fadeIn">
            {atLimit ? (
              <div className="limit-warning">
                <div className="limit-icon">⏳</div>
                <h3>Limit Antrian Tercapai</h3>
                <p>Kamu sudah punya {songLimit} lagu di antrian. Tunggu salah satunya selesai diputar, lalu kamu bisa tambah lagi!</p>
              </div>
            ) : (
              <>
                <div className="submit-instructions">
                  <h2>Tambah Lagu</h2>
                  <ol className="submit-steps">
                    <li>
                      <span className="step-num">1</span>
                      <span>Buka YouTube di tab lain, cari lagu yang kamu mau</span>
                    </li>
                    <li>
                      <span className="step-num">2</span>
                      <span>Salin link dari address bar browser</span>
                    </li>
                    <li>
                      <span className="step-num">3</span>
                      <span>Paste link di sini dan konfirmasi</span>
                    </li>
                  </ol>
                </div>

                {!preview ? (
                  <form onSubmit={handleValidateUrl} className="url-form">
                    <div className="url-input-wrap">
                      <div className="url-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22.54 6.42a2.78 2.78 0 00-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 00-1.95 1.96A29 29 0 001 12a29 29 0 00.46 5.58A2.78 2.78 0 003.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 001.95-1.95A29 29 0 0023 12a29 29 0 00-.46-5.58z" />
                          <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" />
                        </svg>
                      </div>
                      <input
                        id="youtube-url-input"
                        ref={urlInputRef}
                        className="input-field url-input"
                        type="url"
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={youtubeUrl}
                        onChange={(e) => {
                          setYoutubeUrl(e.target.value);
                          setSubmitError('');
                        }}
                        autoComplete="off"
                      />
                    </div>

                    {submitError && (
                      <div className="submit-error animate-fadeIn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        {submitError}
                      </div>
                    )}

                    <button
                      id="btn-validate-url"
                      type="submit"
                      className="btn btn-primary"
                      style={{ width: '100%', justifyContent: 'center' }}
                      disabled={validating || !youtubeUrl.trim()}
                    >
                      {validating ? (
                        <>
                          <span className="animate-spin">⟳</span>
                          Mengecek video...
                        </>
                      ) : (
                        <>
                          Cek Video
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  <div className="preview-card animate-fadeIn">
                    <div className="preview-header">
                      <div className="preview-check">✓</div>
                      <span>Video ditemukan!</span>
                    </div>

                    <div className="preview-content">
                      <img
                        src={preview.thumbnail}
                        alt={preview.title}
                        className="preview-thumb"
                        onError={(e) => {
                          e.target.src = `https://img.youtube.com/vi/${preview.videoId}/mqdefault.jpg`;
                        }}
                      />
                      <div className="preview-info">
                        <p className="preview-title">{preview.title}</p>
                        <p className="preview-author">{preview.authorName}</p>
                        <p className="preview-by">
                          <span className="requester-dot small" />
                          akan ditambahkan atas namamu
                        </p>
                      </div>
                    </div>

                    {submitError && (
                      <div className="submit-error animate-fadeIn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        {submitError}
                      </div>
                    )}

                    <div className="preview-actions">
                      <button className="btn btn-secondary" onClick={clearPreview}>
                        Ganti Link
                      </button>
                      <button
                        id="btn-confirm-add"
                        className="btn btn-primary"
                        onClick={handleSubmitTrack}
                        disabled={submitting}
                        style={{ flex: 1 }}
                      >
                        {submitting ? (
                          <>
                            <span className="animate-spin">⟳</span>
                            Menambahkan...
                          </>
                        ) : (
                          <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="16" />
                              <line x1="8" y1="12" x2="16" y2="12" />
                            </svg>
                            Tambah ke Antrian
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'queue' && (
          <div className="queue-panel animate-fadeIn">
            <QueueList
              queue={session?.queue || []}
              isHost={false}
              currentTrack={currentTrack}
            />
          </div>
        )}
      </div>
    </div>
  );
}
