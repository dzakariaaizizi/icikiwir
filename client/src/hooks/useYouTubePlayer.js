import { useEffect, useRef } from 'react';

/**
 * Updates Media Session API metadata and action handlers.
 *
 * Guard: if a handler value is `undefined` (not provided), we skip that
 * setActionHandler call entirely — never pass null accidentally, because
 * setActionHandler(action, null) REMOVES the button from the OS notification.
 *
 * @param {object|null} track      - { title, authorName, thumbnail, videoId }
 * @param {boolean}     isPlaying  - Current playback state
 * @param {object}      handlers   - { onPlay, onPause, onNextTrack, onPreviousTrack }
 */
export function updateMediaSession(track, isPlaying, handlers = {}) {
  if (!('mediaSession' in navigator)) return;

  if (track) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  track.title     || 'Officebeats',
      artist: track.authorName || '',
      album:  'Officebeats Session',
      artwork: [
        {
          src:   track.thumbnail || `https://img.youtube.com/vi/${track.videoId}/mqdefault.jpg`,
          sizes: '320x180',
          type:  'image/jpeg',
        },
      ],
    });
  } else {
    navigator.mediaSession.metadata = null;
  }

  navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

  // Only touch a handler when explicitly provided — undefined means "leave as-is"
  const setHandler = (action, fn) => {
    if (fn === undefined) return;
    try { navigator.mediaSession.setActionHandler(action, fn); } catch {}
  };

  setHandler('play',          handlers.onPlay);
  setHandler('pause',         handlers.onPause);
  setHandler('stop',          handlers.onPause);
  setHandler('nexttrack',     handlers.onNextTrack);
  setHandler('previoustrack', handlers.onPreviousTrack);
}

/**
 * Hook that wraps the YouTube IFrame Player API.
 *
 * Background-safe design decisions:
 *  1. Player iframe has real dimensions (1×1 px, off-screen) so Chrome does NOT
 *     classify it as "invisible media" and throttle/suspend it.
 *  2. No setTimeout anywhere — pending video flushed synchronously in onReady.
 *  3. Exposes loadAndPlay(videoId) for synchronous background-safe track changes.
 *  4. Accepts `nowPlaying` and `onNextTrack` to keep Media Session metadata and
 *     action handlers always current directly inside the hook.
 *
 * @param {Function}    onEnded      - Callback when video ends naturally
 * @param {Function}    onStateChange - Callback with raw YT.PlayerState value
 * @param {string}      containerId  - ID of the div YT replaces with an iframe
 * @param {object|null} nowPlaying   - { title, authorName, thumbnail, videoId }
 *                                     When provided, hook updates Media Session
 *                                     metadata whenever it changes.
 * @param {Function}    onNextTrack  - Handler for Media Session "nexttrack" action
 * @param {Function}    onPrevTrack  - Handler for Media Session "previoustrack" action
 */
export function useYouTubePlayer({
  onEnded,
  onStateChange,
  containerId  = 'yt-player',
  nowPlaying   = null,
  onNextTrack  = null,
  onPrevTrack  = null,
}) {
  const playerRef      = useRef(null);
  const readyRef       = useRef(false);
  const pendingVideo   = useRef(null);

  // Keep callbacks in refs so YT event closures never go stale
  const onEndedRef       = useRef(onEnded);
  const onStateChangeRef = useRef(onStateChange);
  const onNextTrackRef   = useRef(onNextTrack);
  const onPrevTrackRef   = useRef(onPrevTrack);

  useEffect(() => { onEndedRef.current       = onEnded;       }, [onEnded]);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { onNextTrackRef.current   = onNextTrack;   }, [onNextTrack]);
  useEffect(() => { onPrevTrackRef.current   = onPrevTrack;   }, [onPrevTrack]);

  // ── Media Session: update metadata + action handlers when track changes ──────
  // Runs inside the hook so callers don't need to remember to call updateMediaSession.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    // Update metadata
    if (nowPlaying) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:  nowPlaying.title      || 'Officebeats',
        artist: nowPlaying.authorName || '',
        album:  'Officebeats Session',
        artwork: [
          {
            src:   nowPlaying.thumbnail ||
                   `https://img.youtube.com/vi/${nowPlaying.videoId}/mqdefault.jpg`,
            sizes: '320x180',
            type:  'image/jpeg',
          },
        ],
      });
    } else {
      navigator.mediaSession.metadata = null;
    }

    // Register action handlers — always non-null so OS shows the buttons
    const setHandler = (action, fn) => {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch {}
    };

    setHandler('play', () => {
      playerRef.current?.playVideo?.();
    });
    setHandler('pause', () => {
      playerRef.current?.pauseVideo?.();
    });
    // nexttrack — always registered; calls the ref so it's always current
    setHandler('nexttrack', () => {
      if (onNextTrackRef.current) onNextTrackRef.current();
    });
    // previoustrack — always registered
    setHandler('previoustrack', () => {
      if (onPrevTrackRef.current) onPrevTrackRef.current();
      else {
        // Default: seek to beginning of current track
        playerRef.current?.seekTo?.(0, true);
      }
    });
  }, [nowPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Initialize YouTube IFrame API once ──────────────────────────────────────
  useEffect(() => {
    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
        readyRef.current  = false;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function initPlayer() {
    if (playerRef.current) return;
    const container = document.getElementById(containerId);
    if (!container) return;

    playerRef.current = new window.YT.Player(containerId, {
      height: '1',
      width:  '1',
      playerVars: {
        autoplay:       1,
        controls:       0,
        disablekb:      1,
        fs:             0,
        modestbranding: 1,
        rel:            0,
        playsinline:    1,
      },
      events: {
        onReady: () => {
          readyRef.current = true;
          if (pendingVideo.current) {
            const vid = pendingVideo.current;
            pendingVideo.current = null;
            try { playerRef.current.loadVideoById(vid); } catch {}
          }
        },
        onStateChange: (e) => {
          if (onStateChangeRef.current) onStateChangeRef.current(e.data);
          if (e.data === window.YT.PlayerState.ENDED) {
            if (onEndedRef.current) onEndedRef.current();
          }
        },
        onError: (e) => {
          console.error('[YouTube Player] Error:', e.data);
          // Auto-advance on any error (embed blocked, not found, etc.)
          if (onEndedRef.current) onEndedRef.current();
        },
      },
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Load a new video and start playing immediately.
   * Background-safe: synchronous, no React state, no setTimeout.
   */
  const loadAndPlay = (videoId) => {
    if (!videoId) return;
    if (playerRef.current && readyRef.current) {
      try { playerRef.current.loadVideoById(videoId); } catch (err) {
        console.error('[YouTube Player] loadVideoById error:', err);
      }
    } else {
      pendingVideo.current = videoId;
    }
  };

  const play = () => {
    if (playerRef.current && readyRef.current) {
      try { playerRef.current.playVideo(); } catch {}
    }
  };

  const pause = () => {
    if (playerRef.current && readyRef.current) {
      try { playerRef.current.pauseVideo(); } catch {}
    }
  };

  const setVolume = (vol) => {
    if (playerRef.current && readyRef.current) {
      try { playerRef.current.setVolume(vol); } catch {}
    }
  };

  const getCurrentTime = () => {
    if (playerRef.current && readyRef.current) {
      try { return playerRef.current.getCurrentTime() || 0; } catch {}
    }
    return 0;
  };

  const getDuration = () => {
    if (playerRef.current && readyRef.current) {
      try { return playerRef.current.getDuration() || 0; } catch {}
    }
    return 0;
  };

  return { loadAndPlay, play, pause, setVolume, getCurrentTime, getDuration };
}
