import { getGuestColor } from '../utils/guestColors';

/**
 * QueueList — shared queue display component
 * isHost: shows delete buttons
 */
export function QueueList({
  queue = [],
  isHost = false,
  onRemove,
  currentTrack,
  isGuessingGameEnabled = false,
  myScore = 0,
  queueModifyCost = 20,
  onMove
}) {
  if (queue.length === 0) {
    return (
      <div className="queue-empty">
        <div className="queue-empty-icon">📭</div>
        <p>Antrian kosong</p>
        <span>Lagu berikutnya akan muncul di sini</span>
      </div>
    );
  }

  return (
    <div className="queue-list">
      {queue.map((track, index) => (
        <QueueItem
          key={track.id}
          track={track}
          position={index + 1}
          isHost={isHost}
          onRemove={onRemove}
          isGuessingGameEnabled={isGuessingGameEnabled}
          myScore={myScore}
          queueModifyCost={queueModifyCost}
          onMove={onMove}
          isLast={index === queue.length - 1}
        />
      ))}
    </div>
  );
}

function QueueItem({
  track,
  position,
  isHost,
  onRemove,
  isGuessingGameEnabled,
  myScore = 0,
  queueModifyCost = 20,
  onMove,
  isLast
}) {
  const isHidden = isGuessingGameEnabled;
  const dotColor = isHidden ? '#6b7280' : getGuestColor(track.requestedBy || '').bg;

  return (
    <div className="queue-item animate-slideIn">
      <div className="queue-position">{position}</div>

      <img
        src={track.thumbnail}
        alt={track.title}
        className="queue-thumb"
        onError={(e) => {
          e.target.src = `https://img.youtube.com/vi/${track.videoId}/mqdefault.jpg`;
        }}
      />

      <div className="queue-info">
        <p className="queue-title">{track.title}</p>
        <p className="queue-meta">
          <span className="queue-author">{track.authorName}</span>
          <span className="queue-divider">·</span>
          <span className="queue-requester">
            <span
              className="requester-dot small"
              style={{ background: dotColor }}
            />
            {isHidden ? '???' : track.requestedByNickname}
          </span>
        </p>
      </div>

      {!isHost && isGuessingGameEnabled && onMove && (
        <div className="queue-actions-guest" style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: 'auto', marginRight: '8px' }}>
          <button
            className="btn-move-up"
            disabled={position === 1 || myScore < queueModifyCost}
            onClick={() => onMove(track.id, 'up')}
            title={`Naikkan posisi (-${queueModifyCost} pts)`}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: 'none',
              borderRadius: '4px',
              color: (position === 1 || myScore < queueModifyCost) ? 'var(--text-muted, #9ca3af)' : 'var(--accent, #6366f1)',
              cursor: (position === 1 || myScore < queueModifyCost) ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              opacity: (position === 1 || myScore < queueModifyCost) ? 0.4 : 1,
              transition: 'background 0.2s'
            }}
          >
            ▲
          </button>
          <button
            className="btn-move-down"
            disabled={isLast || myScore < queueModifyCost}
            onClick={() => onMove(track.id, 'down')}
            title={`Turunkan posisi (-${queueModifyCost} pts)`}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: 'none',
              borderRadius: '4px',
              color: (isLast || myScore < queueModifyCost) ? 'var(--text-muted, #9ca3af)' : 'var(--accent, #6366f1)',
              cursor: (isLast || myScore < queueModifyCost) ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              opacity: (isLast || myScore < queueModifyCost) ? 0.4 : 1,
              transition: 'background 0.2s'
            }}
          >
            ▼
          </button>
        </div>
      )}

      {isHost && (
        <button
          className="btn btn-icon queue-delete"
          onClick={() => onRemove?.(track.id)}
          title="Hapus dari antrian"
          aria-label={`Hapus ${track.title} dari antrian`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
          </svg>
        </button>
      )}
    </div>
  );
}
