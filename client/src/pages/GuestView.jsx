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
  const [joined, setJoined] = useState(!!storedIdentity);
  const [nickname, setNickname] = useState(storedIdentity?.nickname || '');
  const [joining, setJoining] = useState(false);
  const [myGuestId, setMyGuestId] = useState(storedIdentity?.guestId || null);
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

  // Guessing game state
  const [myGuess, setMyGuess] = useState('');
  const [hasGuessed, setHasGuessed] = useState(false);
  const [submittedGuess, setSubmittedGuess] = useState(null);
  const [roundResult, setRoundResult] = useState(null);
  const prevTrackRef = useRef(null);

  // Play history (daftar lagu yang sudah diputar, disimpan lokal per sesi)
  const [playHistory, setPlayHistory] = useState(() => {
    try {
      const stored = localStorage.getItem(`ob_history_${code}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (code) {
      try {
        localStorage.setItem(`ob_history_${code}`, JSON.stringify(playHistory));
      } catch {}
    }
  }, [playHistory, code]);

  const socketRef = useRef(null);
  const urlInputRef = useRef(null);
  const currentTrackRef = useRef(null);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  // Socket connection
  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      // Auto-rejoin jika punya stored identity (setelah refresh/reconnect)
      const identity = getStoredIdentity(code);
      if (identity?.guestId && identity?.nickname) {
        socket.emit('guest:rejoin', {
          code,
          sessionId,
          guestId: identity.guestId,
          nickname: identity.nickname,
          deviceId: deviceId.current,
        });
      }
    });
    socket.on('disconnect', () => setConnected(false));

    // Response dari rejoin berhasil
    socket.on('guest:rejoined', ({ guestId, nickname: nick, session }) => {
      setMyGuestId(guestId);
      setNickname(nick);
      setSession(session);
      setSongLimit(session.maxSongsPerGuest || 3);
      setCurrentTrack(session.currentTrack);
      setIsPlaying(session.isPlaying);
      setJoined(true);
      setJoining(false);
      saveIdentity(code, { guestId, nickname: nick });
    });

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
    });

    socket.on('playback:next', ({ track, completed }) => {
      // Simpan lagu yang baru selesai ke history sebelum ganti
      const prev = currentTrackRef.current;
      if (prev && completed) {
        setPlayHistory((h) => {
          // Hindari duplikasi lagu yang sama berturut-turut di history dengan ID/waktu yang sama
          const alreadyExists = h.some(x => x.id === prev.id && Math.abs(x.playedAt - Date.now()) < 5000);
          if (alreadyExists) return h;
          return [{ ...prev, playedAt: Date.now() }, ...h].slice(0, 50);
        });
      }
      setCurrentTrack(track);
      setIsPlaying(track !== null);
      // Reset tebakan setiap lagu baru
      setHasGuessed(false);
      setMyGuess('');
      setSubmittedGuess(null);
      setRoundResult(null);
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

    socket.on('game:roundResults', (results) => {
      setRoundResult(results);
      setHasGuessed(false); // boleh lihat hasil tapi udah kelar
    });

    socket.on('queue:moved', ({ nickname: moveNickname, trackTitle, direction, cost }) => {
      addToast(`${moveNickname} membayar ${cost} poin untuk ${direction === 'up' ? 'menaikkan' : 'menurunkan'} lagu "${trackTitle}"`, 'success');
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
      if (message.includes('Sesi tidak ditemukan')) {
        clearIdentity(code);
        navigate('/');
      }
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
      socket.off('guest:rejoined');
      socket.off('room:updated');
      socket.off('playback:next');
      socket.off('playback:state');
      socket.off('queue:validating');
      socket.off('queue:add:success');
      socket.off('queue:add:rejected');
      socket.off('game:roundResults');
      socket.off('queue:moved');
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
    e?.preventDefault();
    if (!youtubeUrl.trim()) return;

    setValidating(true);
    setSubmitError('');
    setPreview(null);

    try {
      const url = youtubeUrl.trim();
      let videoId = null;
      const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
      ];
      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) { videoId = match[1]; break; }
      }

      if (!videoId) {
        setSubmitError('URL tidak valid atau format salah.');
        setValidating(false);
        return;
      }

      const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
      const oembed = await res.json();
      
      if (oembed.error || !oembed.title) {
        setSubmitError('Video tidak dapat ditemukan atau tidak diizinkan.');
      } else {
        setPreview({
          videoId,
          title: oembed.title,
          thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
        });
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

  function handleGuess(guestId, guestNickname) {
    if (hasGuessed || !socketRef.current?.connected) return;
    socketRef.current.emit('guest:guess', { guessedGuestId: guestId });
    setHasGuessed(true);
    setSubmittedGuess({ guestId, nickname: guestNickname });
    addToast(`Tebakan "${guestNickname}" terkirim! ⏳`, 'info');
  }

  const handleMoveTrack = useCallback((trackId, direction) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('queue:move', { trackId, direction });
  }, []);

  // My active song count + dynamic limit from session
  const myGuest = session?.guests?.find((g) => g.id === myGuestId);
  const mySongCount = myGuest?.activeSongCount || 0;
  const atLimit = mySongCount >= songLimit;
  const myScore = myGuest?.score || 0;
  const queueModifyCost = session?.queueModifyCost !== undefined ? session.queueModifyCost : 20;

  // ──── DEVICE BLOCKED SCREEN ────
  if (deviceBlocked) {
    const handleResetDevice = () => {
      const KEY = 'ob_device_id';
      const oldDeviceId = localStorage.getItem(KEY);
      const newId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem(KEY, newId);
      localStorage.removeItem(`ob_guest_${code}`);

      // Beritahu server agar hapus device ID lama dari sesi
      const tempSocket = connectSocket();
      tempSocket.emit('device:reset', { code, oldDeviceId });
      // Reload setelah server konfirmasi, atau timeout 1.5 detik
      const reloadTimer = setTimeout(() => window.location.reload(), 1500);
      tempSocket.once('device:reset:ok', () => {
        clearTimeout(reloadTimer);
        window.location.reload();
      });
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
  // Sort guests for Klasemen Request (by addedCount)
  const guestsByRequest = [...(session?.guests || [])].sort((a, b) => (b.addedCount || 0) - (a.addedCount || 0));
  
  // Sort guests for Klasemen Tebak (by score)
  const guestsByScore = [...(session?.guests || [])].sort((a, b) => (b.score || 0) - (a.score || 0));

  const iAmRequester = currentTrack?.requestedBy === myGuestId;
  const guestList = (session?.guests || []).filter((g) => g.id !== myGuestId);
  const requesterInList = guestList.some((g) => g.id === currentTrack?.requestedBy);
  const guessableGuests = (!iAmRequester && !requesterInList && currentTrack?.requestedBy)
    ? [...guestList, { id: currentTrack.requestedBy, nickname: currentTrack.requestedByNickname || '?' }]
    : guestList;

  return (
    <div className="guest-dashboard">
      {/* Header Full Width */}
      <header className="dashboard-header glass">
        <div className="header-left">
          <span className="session-name">{session?.name || 'icikiwir'}</span>
          <span className="guest-nickname">{nickname}</span>
          <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
        </div>
        <div className="header-right">
          <div className="quota-pill">
            <span className={`song-count ${atLimit ? 'at-limit' : ''}`}>
              {mySongCount}/{songLimit}
            </span>
            <span className="label">lagumu</span>
          </div>
        </div>
      </header>

      <div className="dashboard-grid">
        
        {/* KOLOM KIRI */}
        <div className="dash-col col-left">
          <div className="dash-panel flex-1">
            <h3 className="panel-title">Klasemen Request</h3>
            <div className="panel-content scrollable">
              {guestsByRequest.slice(0, 5).map((g, i) => (
                <div key={g.id} className="list-item">
                  <span className="rank">#{i+1}</span>
                  <span className="name">{g.nickname} {g.id === myGuestId && '(You)'}</span>
                  <span className="stat">{g.addedCount} lagu</span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="dash-panel flex-1">
            <h3 className="panel-title">Klasemen Tebak</h3>
            <div className="panel-content scrollable">
              {guestsByScore.slice(0, 5).map((g, i) => (
                <div key={g.id} className="list-item">
                  <span className="rank">#{i+1}</span>
                  <span className="name">{g.nickname} {g.id === myGuestId && '(You)'}</span>
                  <span className="stat score-stat">{g.score || 0} pts</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* KOLOM TENGAH */}
        <div className="dash-col col-middle">
          <div className="dash-panel">
            <h3 className="panel-title">Request Lagu</h3>
            <div className="panel-content">
              {atLimit ? (
                <div className="limit-warning" style={{ margin: 0, padding: '16px' }}>
                  <p>Limit lagumu sudah habis. Tunggu lagumu diputar!</p>
                </div>
              ) : (
                <>
                  {!preview ? (
                    <>
                      <div className="input-group" style={{ position: 'relative' }}>
                        <input
                          type="text"
                          className="input-field"
                          placeholder="https://youtube.com/watch?v=..."
                          value={youtubeUrl}
                          onChange={(e) => {
                            setYoutubeUrl(e.target.value);
                            setSubmitError('');
                            setPreview(null);
                          }}
                          onBlur={handleValidateUrl}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleValidateUrl(e);
                          }}
                          disabled={validating || submitting}
                          style={{ paddingRight: '120px' }}
                        />
                        <button
                          onClick={handleValidateUrl}
                          disabled={validating || submitting}
                          style={{
                            position: 'absolute',
                            right: '8px',
                            top: '8px',
                            bottom: '8px',
                            background: 'transparent',
                            border: 'none',
                            color: '#a78bfa',
                            fontWeight: '600',
                            cursor: 'pointer',
                            padding: '0 16px',
                            borderRadius: '8px'
                          }}
                        >
                          Cek Video &gt;
                        </button>
                      </div>
                      {validating && <p className="text-hint">Memeriksa link...</p>}
                      {submitError && <p className="text-error">{submitError}</p>}
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontWeight: '600', marginBottom: '16px' }}>
                        <div style={{ width: '20px', height: '20px', borderRadius: '50%', border: '1px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </div>
                        Video ditemukan!
                      </div>
                      <div className="preview-card" style={{ background: 'transparent', padding: '0', border: 'none', boxShadow: 'none' }}>
                        <img src={preview.thumbnail} alt="" className="preview-thumb" style={{ width: '120px', height: '68px' }} />
                        <div className="preview-info">
                          <strong style={{ fontSize: '1rem', marginBottom: '4px' }}>{preview.title}</strong>
                          <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>{preview.authorName}</div>
                          <div style={{ fontSize: '0.8rem', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                            <span style={{ width: '6px', height: '6px', background: '#8b5cf6', borderRadius: '50%' }}></span>
                            akan ditambahkan atas namamu
                          </div>
                        </div>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                        <button 
                          className="btn btn-secondary"
                          onClick={() => { setPreview(null); setYoutubeUrl(''); }}
                          disabled={submitting}
                          style={{ flex: 1, background: '#374151', border: 'none', color: '#fff', fontWeight: '600', padding: '12px', borderRadius: '12px', cursor: 'pointer' }}
                        >
                          Ganti Link
                        </button>
                        <button 
                          className="btn btn-primary" 
                          onClick={handleSubmitTrack}
                          disabled={submitting}
                          style={{ flex: 2, background: '#8b5cf6', border: 'none', color: '#fff', fontWeight: '600', padding: '12px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}
                        >
                          {submitting ? 'Menambahkan...' : (
                            <>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                              Tambah ke Antrian
                            </>
                          )}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {session?.isGuessingGameEnabled && currentTrack && (
            <div className="dash-panel">
              <h3 className="panel-title">Tebak Lagu</h3>
              <div className="panel-content">
                {roundResult ? (
                  <div className="guess-result">
                    <p>{roundResult.correctGuessers?.includes(myGuestId) ? '🎉 Tebakanmu benar!' : `❌ Jawabannya: ${roundResult.requesterNickname || '?'}`}</p>
                  </div>
                ) : iAmRequester ? (
                  <p className="text-hint text-center py-4">Lagu kamu sedang diputar! Biarkan temanmu menebak.</p>
                ) : hasGuessed && submittedGuess ? (
                  <p className="text-hint text-center py-4">Tebakanmu: <strong>{submittedGuess.nickname}</strong>. Tunggu hasilnya!</p>
                ) : (
                  <div className="guess-grid">
                    {guessableGuests.map(g => (
                      <button
                        key={g.id}
                        className="btn-guess"
                        onClick={() => {
                          if (!hasGuessed && socketRef.current) {
                            socketRef.current.emit('guest:guess', { guessedGuestId: g.id });
                            setHasGuessed(true);
                            setSubmittedGuess({ guestId: g.id, nickname: g.nickname });
                            addToast('Tebakan terkirim!', 'info');
                          }
                        }}
                      >
                        {g.nickname}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="dash-panel flex-1">
            <h3 className="panel-title">Daftar Antrian</h3>
            <div className="panel-content scrollable">
              {(!session?.queue || session.queue.length === 0) ? (
                <p className="text-hint text-center py-8">Antrian kosong.</p>
              ) : (
                <div className="queue-list-compact" style={{ gap: '8px' }}>
                  {session.queue.map((track, i) => {
                    const req = session.guests?.find(g => g.id === track.requestedBy);
                    const isGuessing = session.isGuessingGameEnabled;
                    return (
                      <div key={track.id} className="queue-item-compact" style={{ background: 'var(--bg-primary)', border: '1px solid rgba(255,255,255,0.06)', padding: '12px', borderRadius: '12px', gap: '16px' }}>
                        <span style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(99, 102, 241, 0.5)', borderRadius: '50%', color: '#a78bfa', fontSize: '0.9rem', fontWeight: 'bold', background: 'rgba(99, 102, 241, 0.1)', flexShrink: 0 }}>
                          {i + 1}
                        </span>
                        <img src={track.thumbnail} alt="" className="q-thumb" style={{ width: '64px', height: '48px', borderRadius: '8px', flexShrink: 0 }} />
                        <div className="q-info" style={{ flex: 1, minWidth: 0 }}>
                          <div className="q-title" style={{ fontSize: '1rem', fontWeight: '600', color: '#fff', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
                          <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                            {track.authorName} <span style={{ margin: '0 4px' }}>•</span> {isGuessing ? '???' : (req ? req.nickname : 'Anon')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <button disabled style={{ background: 'rgba(255,255,255,0.03)', border: 'none', borderRadius: '4px', padding: '4px 8px', color: 'rgba(255,255,255,0.1)' }}>▲</button>
                          <button disabled style={{ background: 'rgba(255,255,255,0.03)', border: 'none', borderRadius: '4px', padding: '4px 8px', color: 'rgba(255,255,255,0.1)' }}>▼</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* KOLOM KANAN */}
        <div className="dash-col col-right">
          <div className="dash-panel">
            <h3 className="panel-title">Sedang Dimainkan</h3>
            <div className="panel-content">
              <NowPlaying
                track={currentTrack}
                isPlaying={isPlaying}
                compact={true}
                isGuessingGameEnabled={false}
                hasQueue={false}
              />
            </div>
          </div>

          <div className="dash-panel flex-1">
            <h3 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#8b5cf6' }}>
                <path d="M9 18V5l12-2v13"></path>
                <circle cx="6" cy="18" r="3"></circle>
                <circle cx="18" cy="16" r="3"></circle>
              </svg>
              Riwayat Lagu Dimainkan
            </h3>
            <div className="panel-content scrollable">
              {playHistory.length === 0 ? (
                <p className="text-hint text-center py-8">Belum ada lagu yang diputar.</p>
              ) : (
                <div className="history-list">
                  {playHistory.map((track, i) => (
                    <div key={track.id + i} className="history-item" style={{ background: 'var(--bg-primary)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <img src={track.thumbnail} alt="" className="h-thumb" style={{ width: '56px', height: '42px' }} />
                      <div className="h-info">
                        <div className="h-title" style={{ fontSize: '0.95rem', marginBottom: '2px', color: '#fff' }}>{track.title}</div>
                        <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                          {track.authorName} <span style={{ color: '#6b7280', margin: '0 4px' }}>•</span> <span style={{ color: '#6b7280' }}>diminta {track.requestedByNickname || 'Anon'}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: '500' }}>
                        {track.playedAt ? new Date(track.playedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(':', '.') : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
