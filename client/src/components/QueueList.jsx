import { getGuestColor } from '../utils/guestColors';

/**
 * QueueList — shared queue display component
 * isHost: shows delete buttons
 */
export function QueueList({ queue = [], isHost = false, onRemove, currentTrack, isGuessingGameEnabled = false }) {
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
        />
      ))}
    </div>
  );
}

function QueueItem({ track, position, isHost, onRemove, isGuessingGameEnabled }) {
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
