import { useState, useEffect } from 'react';

/**
 * Waveform animation — shown when music is playing
 */
export function Waveform({ playing = true, size = 'md' }) {
  const bars = size === 'sm' ? 5 : 7;
  return (
    <div className={`waveform ${playing ? '' : 'paused'}`} aria-label="Audio waveform">
      {Array.from({ length: bars }).map((_, i) => (
        <div key={i} className="waveform-bar" />
      ))}
    </div>
  );
}

/**
 * NowPlaying card — shared between host and guest views
 */
export function NowPlaying({
  track,
  isPlaying,
  progress = 0,
  duration = 0,
  compact = false,
  isGuessingGameEnabled = false,
  hasQueue = false
}) {
  const progressPct = duration > 0 ? Math.min((progress / duration) * 100, 100) : 0;

  const formatTime = (sec) => {
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    return `${m}:${ss}`;
  };

  if (!track) {
    return (
      <div className={`now-playing-empty ${compact ? 'compact' : ''}`}>
        <div className="empty-icon">🎵</div>
        <p className="empty-text">{hasQueue ? 'Belum ada lagu diputar' : 'Antrian kosong'}</p>
        <p className="empty-sub">
          {hasQueue
            ? 'Menunggu host memulai pemutaran'
            : (compact ? 'Belum ada lagu' : 'Tambahkan lagu untuk mulai. Minta rekan kerjamu scan QR code!')}
        </p>
      </div>
    );
  }

  return (
    <div className={`now-playing-card ${compact ? 'compact' : ''}`}>
      <div className="now-playing-inner">
        <div className="now-playing-thumb-wrap">
          <img
            src={track.thumbnail}
            alt={track.title}
            className="now-playing-thumb"
            onError={(e) => { e.target.src = `https://img.youtube.com/vi/${track.videoId}/mqdefault.jpg`; }}
          />
          <div className={`thumb-overlay ${isPlaying ? 'playing' : ''}`}>
            <Waveform playing={isPlaying} size="sm" />
          </div>
        </div>

        <div className="now-playing-info">
          <div className="now-playing-label">
            {isPlaying ? (
              <span className="badge badge-emerald">▶ Sedang diputar</span>
            ) : (
              <span className="badge badge-amber">⏸ Dijeda</span>
            )}
          </div>
          <h3 className="now-playing-title">{track.title}</h3>
          <p className="now-playing-author">{track.authorName}</p>
          <p className="now-playing-requester">
            <span className="requester-dot" style={{ background: isGuessingGameEnabled ? '#6b7280' : '' }} />
            diminta oleh <strong>{isGuessingGameEnabled ? '???' : track.requestedByNickname}</strong>
          </p>
        </div>
      </div>

      {!compact && (
        <div className="progress-section">
          <div className="progress-container">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
          <div className="progress-times">
            <span>{formatTime(progress)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
