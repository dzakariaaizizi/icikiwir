import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, ListMusic, Trophy, Info, Home, Music, Loader2 } from 'lucide-react';
import { connectSocket, disconnectSocket } from '../socket';
import { useToast } from '../context/ToastContext';

// Generate a stable device fingerprint
function getDeviceId() {
  const KEY = 'ob_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem(KEY, id);
  }
  return id;
}

function getStoredIdentity(sessionCode) {
  try {
    const raw = localStorage.getItem(`ob_guest_${sessionCode}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveIdentity(sessionCode, data) {
  localStorage.setItem(`ob_guest_${sessionCode}`, JSON.stringify(data));
}

const AVATAR_COLORS = [
  'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-green-500', 
  'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-blue-500', 
  'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-rose-500'
];

function getAvatarColor(str) {
  if (!str) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function GuestView() {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState('request');

  const [session, setSession] = useState(null);
  const [queue, setQueue] = useState([]);
  const [guests, setGuests] = useState([]);
  
  const [nickname, setNickname] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [validating, setValidating] = useState(false);
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  
  const [hasGuessed, setHasGuessed] = useState(false);
  const [submittedGuess, setSubmittedGuess] = useState(null);
  
  const socketRef = useRef(null);
  const deviceId = useRef(getDeviceId());
  const myGuestId = useRef(null);

  // SOCKET SETUP
  useEffect(() => {
    const code = searchParams.get('code') || '';
    const socket = connectSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      if (isJoined) {
        socket.emit('guest:reconnect', {
          guestId: myGuestId.current,
          deviceId: deviceId.current
        });
      }
    });

    socket.on('room:updated', (data) => {
      setSession(data.session);
      setQueue(data.queue);
      setGuests(data.guests);
    });

    socket.on('guest:joined', (data) => {
      setIsJoined(true);
      setJoining(false);
      myGuestId.current = data.guestId;
      saveIdentity(data.session.code, {
        guestId: data.guestId,
        nickname: data.nickname,
        code: data.session.code
      });
      addToast('Berhasil bergabung!', 'success');
    });

    socket.on('guest:join_failed', (data) => {
      setJoining(false);
      addToast(data.reason || 'Gagal bergabung.', 'error');
      if (data.reason.includes('dihapus') || data.reason.includes('tidak aktif')) {
        setIsJoined(false);
        localStorage.removeItem(`ob_guest_${code}`);
      }
    });

    socket.on('queue:add:success', () => {
      setSubmitting(false);
      setPreview(null);
      setYoutubeUrl('');
      setActiveTab('queue'); // auto switch to queue tab
      addToast('Lagu berhasil ditambahkan!', 'success');
    });

    socket.on('queue:add:rejected', (data) => {
      setSubmitting(false);
      setSubmitError(data.reason || 'Gagal menambahkan lagu.');
      addToast(data.reason || 'Gagal menambahkan lagu.', 'error');
    });

    socket.on('playback:started', (data) => {
      setHasGuessed(false);
      setSubmittedGuess(null);
      if (data.track) {
        addToast(`Memutar: ${data.track.title}`, 'info');
      }
    });

    return () => disconnectSocket();
  }, [addToast, isJoined, searchParams]);

  // AUTO-JOIN
  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) return;
    const stored = getStoredIdentity(code);
    if (stored && stored.guestId && !isJoined) {
      myGuestId.current = stored.guestId;
      setNickname(stored.nickname);
      setJoining(true);
      socketRef.current?.emit('guest:reconnect', {
        guestId: stored.guestId,
        deviceId: deviceId.current
      });
    }
  }, [searchParams, isJoined]);

  function handleJoin(e) {
    e.preventDefault();
    if (!nickname.trim()) return addToast('Masukkan nama kamu.', 'warning');
    setJoining(true);
    const code = searchParams.get('code') || '';
    socketRef.current.emit('guest:join', {
      code,
      nickname: nickname.trim(),
      deviceId: deviceId.current,
    });
  }

  async function checkLink() {
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

  function handleGuess(guestId, guestNickname) {
    if (hasGuessed || !socketRef.current?.connected) return;
    socketRef.current.emit('guest:guess', { guessedGuestId: guestId });
    setHasGuessed(true);
    setSubmittedGuess({ guestId, nickname: guestNickname });
    addToast(`Tebakan "${guestNickname}" terkirim! ⏳`, 'info');
  }

  // If not joined, show join screen
  if (!isJoined) {
    return (
      <div className="min-h-screen bg-[#07050A] flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-96 bg-fuchsia-500/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-cyan-500/10 blur-[120px] rounded-full pointer-events-none" />
        
        <div className="w-full max-w-sm glass-panel p-8 rounded-3xl z-10">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Music className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center text-white mb-2">Join OfficeBeats</h1>
          <p className="text-slate-400 text-center mb-8 text-sm">Enter your nickname to start requesting songs.</p>
          
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <input
                type="text"
                placeholder="Your Nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={20}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50 focus:bg-white/10 transition-all text-center font-medium"
              />
            </div>
            <button
              type="submit"
              disabled={joining || !nickname.trim()}
              className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {joining ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Enter Session'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Data mapping
  const currentTrack = session?.current_track;
  const myGuestInfo = guests.find(g => g.guestId === myGuestId.current);
  const maxQuota = session?.max_track_per_guest || 3;
  const myQuotaUsed = myGuestInfo?.addedCount || 0;
  
  const sortedGuests = [...guests].sort((a, b) => b.addedCount - a.addedCount);

  return (
    <div className="min-h-screen bg-[#07050A] flex flex-col lg:max-w-7xl mx-auto relative lg:p-6 lg:pb-0">
      
      {/* MOBILE HEADER (Sticky) */}
      <header className="lg:hidden sticky top-0 z-20 glass-panel border-b border-x-0 border-t-0 border-white/10 p-4 pb-3">
        <div className="flex justify-between items-center mb-3">
          <button onClick={() => navigate('/')} className="text-slate-400 hover:text-white transition-colors">
            <Home className="w-5 h-5" />
          </button>
          <div className="text-sm font-semibold tracking-wide text-gradient">OfficeBeats</div>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white/10 rounded-full border border-white/10">
            <div className={`w-2 h-2 rounded-full ${myQuotaUsed >= maxQuota ? 'bg-red-400' : 'bg-cyan-400'}`} />
            <span className="text-xs font-mono font-medium text-slate-200">{myQuotaUsed}/{maxQuota}</span>
          </div>
        </div>

        {/* Compact Now Playing */}
        {currentTrack ? (
          <div className="flex items-center gap-3 bg-white/5 rounded-xl p-2 relative overflow-hidden group">
            <div 
              className="absolute inset-0 bg-cover bg-center opacity-30 group-hover:scale-105 transition-transform duration-500"
              style={{ backgroundImage: `url(${currentTrack.thumbnail})` }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#07050A] to-transparent opacity-80" />
            
            <img src={currentTrack.thumbnail} alt="Cover" className="w-10 h-10 rounded-md object-cover relative z-10 shadow-lg" />
            <div className="relative z-10 flex-1 min-w-0">
              <h4 className="text-white text-sm font-semibold truncate leading-tight">{currentTrack.title}</h4>
              <p className="text-xs text-cyan-300 truncate">Now Playing</p>
            </div>
            {/* Animated EQ bars */}
            {session?.is_playing && (
              <div className="relative z-10 flex items-end gap-0.5 h-4 mr-2">
                {[1, 2, 3].map((i) => (
                  <motion.div 
                    key={i}
                    className="w-1 bg-cyan-400 rounded-t-sm"
                    animate={{ height: ['40%', '100%', '40%'] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-2 bg-white/5 rounded-xl border border-white/5">
            <p className="text-xs text-slate-500">Belum ada lagu yang diputar</p>
          </div>
        )}
      </header>

      {/* DESKTOP HEADER */}
      <header className="hidden lg:flex justify-between items-center mb-8 glass-panel p-4 px-6 rounded-3xl z-10">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-colors">
            <Home className="w-5 h-5" />
          </button>
          <div className="text-xl font-bold tracking-wide text-gradient">OfficeBeats</div>
        </div>
        <div className="flex items-center gap-3 px-4 py-2 bg-white/5 rounded-full border border-white/10 shadow-inner">
          <div className={`w-2 h-2 rounded-full ${myQuotaUsed >= maxQuota ? 'bg-red-400' : 'bg-cyan-400 animate-pulse'}`} />
          <span className="text-sm font-mono font-medium text-slate-200">Quota: <span className="text-white">{myQuotaUsed}/{maxQuota}</span></span>
        </div>
      </header>

      {/* MAIN CONTENT GRID */}
      <main className="flex-1 lg:grid lg:grid-cols-12 lg:gap-8 p-4 lg:p-0 pb-24 lg:pb-8 custom-scrollbar lg:overflow-hidden">
        
        {/* LEFT COLUMN: Leaderboard (Mobile Tab) & Desktop Now Playing */}
        <div className={`lg:col-span-3 flex flex-col gap-6 ${activeTab === 'leaderboard' ? 'block' : 'hidden lg:flex'}`}>
          {/* Desktop Now Playing */}
          {currentTrack ? (
            <div className="hidden lg:block glass-panel rounded-3xl overflow-hidden relative group h-64 shrink-0">
              <div 
                className="absolute inset-0 bg-cover bg-center opacity-40 group-hover:scale-105 transition-transform duration-700"
                style={{ backgroundImage: `url(${currentTrack.thumbnail})` }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#07050A] via-[#07050A]/60 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-6">
                <div className="flex items-center gap-2 mb-3">
                  {session?.is_playing && <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />}
                  <span className="text-xs font-semibold tracking-widest text-cyan-400 uppercase">
                    {session?.is_playing ? 'Now Playing' : 'Paused'}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-white leading-tight mb-1 line-clamp-2">{currentTrack.title}</h3>
              </div>
            </div>
          ) : (
            <div className="hidden lg:flex glass-panel rounded-3xl h-64 shrink-0 items-center justify-center text-center p-6 border-dashed border-2 border-white/5">
              <div>
                <Music className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">Belum ada lagu<br/>yang diputar</p>
              </div>
            </div>
          )}

          {/* Leaderboard Section */}
          <div className="glass-panel p-6 rounded-3xl flex-1 lg:overflow-hidden flex flex-col">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2 shrink-0">
              <Trophy className="w-5 h-5 text-yellow-500" /> Tastemakers
            </h2>
            <div className="space-y-3 lg:overflow-y-auto custom-scrollbar flex-1 pr-2">
              {sortedGuests.map((user, idx) => (
                <div key={user.guestId} className="flex items-center gap-3 bg-white/5 p-3 rounded-2xl border border-white/5 hover:bg-white/10 transition-colors">
                  <div className={`text-sm font-bold w-4 text-center ${idx === 0 ? 'text-yellow-500' : idx === 1 ? 'text-slate-300' : idx === 2 ? 'text-amber-700' : 'text-slate-600'}`}>
                    {idx + 1}
                  </div>
                  <div className={`w-8 h-8 rounded-full ${getAvatarColor(user.nickname)} flex items-center justify-center text-white font-bold text-xs uppercase`}>
                    {user.nickname.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-white text-sm font-medium truncate flex items-center gap-2">
                      {user.nickname}
                      {user.guestId === myGuestId.current && <span className="px-1.5 py-0.5 rounded text-[9px] bg-white/10 text-slate-300 uppercase tracking-wider">You</span>}
                    </h4>
                    <p className="text-xs text-slate-400 truncate">{user.addedCount} lagu ditambahkan</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* MIDDLE COLUMN: Request (Mobile Tab) */}
        <div className={`lg:col-span-6 flex flex-col gap-6 ${activeTab === 'request' ? 'block' : 'hidden lg:flex'}`}>
          <div className="glass-panel p-6 lg:p-8 rounded-3xl flex-1 flex flex-col lg:overflow-y-auto custom-scrollbar">
            <div className="space-y-2 mb-8 shrink-0">
              <h2 className="text-2xl font-bold text-white">Tambah ke Antrian</h2>
              <p className="text-sm text-slate-400">Masukkan link YouTube lagu yang ingin kamu putar.</p>
            </div>
            
            <AnimatePresence>
              {!hasGuessed && currentTrack && guests.length > 1 && (
                <motion.div
                  initial={{ opacity: 0, y: -20, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, scale: 0.95, height: 0 }}
                  className="mb-8 p-[1px] rounded-3xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-500 overflow-hidden shrink-0 shadow-lg shadow-violet-500/10"
                >
                  <div className="bg-[#07050A] rounded-[23px] p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-fuchsia-400" />
                        <span className="text-sm font-semibold text-white">Tebak Siapa Pengirim Lagu Ini?</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                      {guests.filter(g => g.guestId !== myGuestId.current).map((user) => (
                        <button 
                          key={user.guestId}
                          onClick={() => handleGuess(user.guestId, user.nickname)}
                          className="py-2 px-3 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors flex items-center justify-center gap-2"
                        >
                          <div className={`w-4 h-4 rounded-full ${getAvatarColor(user.nickname)} shrink-0`} />
                          <span className="truncate">{user.nickname}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            <AnimatePresence>
              {hasGuessed && currentTrack && submittedGuess && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-8 bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center gap-3"
                >
                  <div className={`w-8 h-8 rounded-full ${getAvatarColor(submittedGuess.nickname)} flex items-center justify-center text-white font-bold text-xs shrink-0`}>
                    {submittedGuess.nickname.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm text-white">Kamu menebak <span className="font-bold text-violet-400">{submittedGuess.nickname}</span></p>
                    <p className="text-xs text-slate-400">Tunggu lagu selesai untuk melihat hasilnya!</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative shrink-0 z-10 group">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                <Search className="w-5 h-5 text-slate-500 group-focus-within:text-violet-400 transition-colors" />
              </div>
              <input 
                type="text" 
                placeholder="https://youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={(e) => {
                  setYoutubeUrl(e.target.value);
                  setSubmitError('');
                  setPreview(null);
                }}
                onBlur={checkLink}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') checkLink();
                }}
                disabled={myQuotaUsed >= maxQuota}
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:border-violet-500/50 focus:bg-white/10 transition-all placeholder:text-slate-600 shadow-inner text-lg disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {validating && (
                <div className="absolute inset-y-0 right-4 flex items-center">
                  <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
                </div>
              )}
            </div>
            
            {submitError && (
              <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {submitError}
              </div>
            )}
            
            {myQuotaUsed >= maxQuota && !submitError && (
              <div className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm flex gap-2 items-center">
                <Info className="w-4 h-4 shrink-0" />
                Kuota request kamu habis (Maks: {maxQuota}). Tunggu lagumu diputar!
              </div>
            )}

            <AnimatePresence>
              {preview && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 24 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  className="overflow-hidden shrink-0"
                >
                  <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-4 shadow-xl">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <img 
                        src={preview.thumbnail} 
                        alt="Preview" 
                        className="w-full sm:w-32 sm:h-24 rounded-xl object-cover shadow-md bg-black"
                      />
                      <div className="flex-1 flex flex-col justify-center">
                        <h4 className="text-white text-lg font-medium line-clamp-2">{preview.title}</h4>
                      </div>
                    </div>
                    
                    <button 
                      onClick={handleSubmitTrack}
                      disabled={submitting || myQuotaUsed >= maxQuota}
                      className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
                    >
                      {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Plus className="w-5 h-5" /> Tambah ke Antrian</>}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            {!preview && !submitError && myQuotaUsed < maxQuota && (
              <div className="mt-8 flex-1 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-white/5 rounded-3xl min-h-[200px]">
                <Info className="w-8 h-8 text-slate-600 mb-3" />
                <p className="text-sm text-slate-500 max-w-xs">
                  Lagu yang direquest akan ditambahkan ke urutan paling bawah antrian.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Queue (Mobile Tab) */}
        <div className={`lg:col-span-3 flex flex-col gap-6 ${activeTab === 'queue' ? 'block' : 'hidden lg:flex'}`}>
          <div className="glass-panel p-6 rounded-3xl flex-1 flex flex-col lg:overflow-hidden">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center justify-between shrink-0">
              <span>Mendatang</span>
              <span className="text-xs font-mono text-slate-400 font-normal">{queue.length} lagu</span>
            </h2>
            <div className="space-y-3 lg:overflow-y-auto custom-scrollbar flex-1 pr-2">
              {queue.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-8">Belum ada lagu di antrian.</p>
              ) : queue.map((track, idx) => {
                const requester = guests.find(g => g.guestId === track.guest_id);
                const reqName = requester ? requester.nickname : 'Anon';
                return (
                  <div key={track.id} className="flex items-center gap-3 bg-white/5 p-2 rounded-2xl border border-white/5 hover:bg-white/10 transition-colors group">
                    <span className="text-xs font-mono text-slate-500 w-4 text-center group-hover:text-cyan-400 transition-colors">{idx + 1}</span>
                    <img src={track.thumbnail} alt={track.title} className="w-10 h-8 rounded-lg object-cover bg-black" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-medium text-white truncate">{track.title}</h4>
                    </div>
                    <div className={`w-6 h-6 rounded-full ${getAvatarColor(reqName)} flex items-center justify-center text-[10px] font-bold text-white border border-white/5 shrink-0 uppercase`} title={`Requested by ${reqName}`}>
                      {reqName.charAt(0)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

      </main>

      {/* MOBILE TAB NAVIGATION */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 glass-panel border-t border-x-0 border-b-0 border-white/10 pb-safe pt-2 px-6 z-20">
        <div className="flex justify-between items-center max-w-sm mx-auto mb-2">
          <button 
            onClick={() => setActiveTab('request')}
            className={`flex flex-col items-center gap-1 p-2 transition-colors ${activeTab === 'request' ? 'text-violet-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <Music className="w-6 h-6" />
            <span className="text-[10px] font-medium">Request</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('queue')}
            className={`flex flex-col items-center gap-1 p-2 transition-colors ${activeTab === 'queue' ? 'text-fuchsia-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <ListMusic className="w-6 h-6" />
            <span className="text-[10px] font-medium">Antrian</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('leaderboard')}
            className={`flex flex-col items-center gap-1 p-2 transition-colors ${activeTab === 'leaderboard' ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <Trophy className="w-6 h-6" />
            <span className="text-[10px] font-medium">Top Guest</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
