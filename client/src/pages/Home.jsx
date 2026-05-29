import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useToast } from '../context/ToastContext';
import './Home.css';

export default function Home() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [searchParams] = useSearchParams();

  const [creating, setCreating] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [joinCode, setJoinCode] = useState('');
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [joining, setJoining] = useState(false);

  // Pre-fill join code from QR redirect (?join=CODE)
  useEffect(() => {
    const qrCode = searchParams.get('join');
    if (qrCode) {
      setJoinCode(qrCode.toUpperCase());
      setShowJoinForm(true);
    }
  }, []);

  async function handleCreateSession(e) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await axios.post('/api/session', {
        name: sessionName.trim() || 'icikiwir',
      });
      const { sessionId, code } = res.data;
      // Store session info for host
      sessionStorage.setItem('ob_host_session', JSON.stringify({ sessionId, code }));
      navigate(`/host/${sessionId}`);
    } catch (err) {
      addToast('Gagal membuat sesi. Coba lagi.', 'error');
      setCreating(false);
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) return addToast('Masukkan kode sesi.', 'error');

    setJoining(true);
    try {
      const res = await axios.get(`/api/session/${code}`);
      const { sessionId } = res.data;
      navigate(`/join/${sessionId}?code=${code}`);
    } catch (err) {
      if (err.response?.status === 404) {
        addToast('Kode sesi tidak ditemukan. Cek lagi!', 'error');
      } else {
        addToast('Gagal bergabung. Coba lagi.', 'error');
      }
      setJoining(false);
    }
  }

  return (
    <div className="home-page">
      {/* Animated background */}
      <div className="home-bg">
        <div className="bg-orb orb-1" />
        <div className="bg-orb orb-2" />
        <div className="bg-orb orb-3" />
        <div className="bg-grid" />
      </div>

      <div className="home-content">
        {/* Logo + Hero */}
        <div className="hero animate-fadeIn">
          <div className="logo">
            <div className="logo-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <span className="logo-text">icikiwir</span>
          </div>

          <h1 className="hero-title">
            Musik kantor yang <span className="text-gradient">kolaboratif</span>
          </h1>
          <p className="hero-desc">
            Satu speaker, semua bisa request. Host putar musik dari laptop,
            rekan kerja tambah lagu dari HP masing-masing — real-time, tanpa ribet.
          </p>

          <div className="hero-features">
            {[
              { icon: '⚡', text: 'Real-time sync' },
              { icon: '📱', text: 'Tanpa install app' },
              { icon: '🔗', text: 'Link YouTube langsung' },
              { icon: '👥', text: 'Sampai 20 guest' },
            ].map(({ icon, text }) => (
              <div key={text} className="feature-chip">
                <span>{icon}</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action Cards */}
        <div className="action-cards animate-slideUp">
          {/* HOST CARD */}
          <div className={`action-card host-card ${showCreateForm ? 'expanded' : ''}`}>
            <div className="action-card-header">
              <div className="action-icon host-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <div>
                <h2>Buat Sesi</h2>
                <p>Kamu adalah host — laptop kamu jadi speaker</p>
              </div>
            </div>

            {!showCreateForm ? (
              <button
                id="btn-create-session"
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setShowCreateForm(true)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                Buat Sesi Baru
              </button>
            ) : (
              <form onSubmit={handleCreateSession} className="create-form animate-fadeIn">
                <div className="input-group">
                  <label htmlFor="session-name">Nama Sesi (opsional)</label>
                  <input
                    id="session-name"
                    className="input-field"
                    type="text"
                    placeholder="cth: Musik Lantai 3 🎶"
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    maxLength={40}
                    autoFocus
                  />
                </div>
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowCreateForm(false)}>
                    Batal
                  </button>
                  <button
                    id="btn-submit-create"
                    type="submit"
                    className="btn btn-primary"
                    disabled={creating}
                  >
                    {creating ? (
                      <>
                        <span className="animate-spin">⟳</span>
                        Membuat...
                      </>
                    ) : (
                      'Mulai Sesi →'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="divider-or">
            <span>atau</span>
          </div>

          {/* GUEST CARD */}
          <div className={`action-card guest-card ${showJoinForm ? 'expanded' : ''}`}>
            <div className="action-card-header">
              <div className="action-icon guest-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87" />
                  <path d="M16 3.13a4 4 0 010 7.75" />
                </svg>
              </div>
              <div>
                <h2>Gabung Sesi</h2>
                <p>Request lagu dari HP atau laptop kamu</p>
              </div>
            </div>

            {!showJoinForm ? (
              <button
                id="btn-show-join"
                className="btn btn-secondary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setShowJoinForm(true)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                Masukkan Kode Sesi
              </button>
            ) : (
              <form onSubmit={handleJoin} className="join-form animate-fadeIn">
                <div className="input-group">
                  <label htmlFor="join-code">Kode Sesi</label>
                  <input
                    id="join-code"
                    className="input-field code-input"
                    type="text"
                    placeholder="cth: AB3X7K"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    maxLength={6}
                    autoFocus
                    autoComplete="off"
                  />
                </div>
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowJoinForm(false)}>
                    Batal
                  </button>
                  <button
                    id="btn-submit-join"
                    type="submit"
                    className="btn btn-primary"
                    disabled={joining || !joinCode.trim()}
                  >
                    {joining ? (
                      <>
                        <span className="animate-spin">⟳</span>
                        Bergabung...
                      </>
                    ) : (
                      'Gabung →'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Footer note & Credit */}
        <div className="home-footer animate-fadeIn">
          <p>Tidak perlu akun. Tidak perlu install. Cukup browser.</p>
          <a
            href="https://instagram.com/dzakariazizi"
            target="_blank"
            rel="noopener noreferrer"
            className="credit-link"
          >
            made by zi
          </a>
        </div>
      </div>
    </div>
  );
}
