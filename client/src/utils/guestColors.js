/**
 * Guest color palette — each user gets a distinct, vivid color
 * based on a simple hash of their guest ID.
 */

const GUEST_COLORS = [
  { bg: 'rgba(99,102,241,0.9)',   glow: 'rgba(99,102,241,0.35)'  }, // indigo
  { bg: 'rgba(16,185,129,0.9)',   glow: 'rgba(16,185,129,0.35)'  }, // emerald
  { bg: 'rgba(245,158,11,0.9)',   glow: 'rgba(245,158,11,0.35)'  }, // amber
  { bg: 'rgba(239,68,68,0.9)',    glow: 'rgba(239,68,68,0.35)'   }, // red
  { bg: 'rgba(59,130,246,0.9)',   glow: 'rgba(59,130,246,0.35)'  }, // blue
  { bg: 'rgba(168,85,247,0.9)',   glow: 'rgba(168,85,247,0.35)'  }, // purple
  { bg: 'rgba(20,184,166,0.9)',   glow: 'rgba(20,184,166,0.35)'  }, // teal
  { bg: 'rgba(249,115,22,0.9)',   glow: 'rgba(249,115,22,0.35)'  }, // orange
  { bg: 'rgba(236,72,153,0.9)',   glow: 'rgba(236,72,153,0.35)'  }, // pink
  { bg: 'rgba(132,204,22,0.9)',   glow: 'rgba(132,204,22,0.35)'  }, // lime
];

/**
 * Get a stable color for a guest based on their ID.
 * Same ID always → same color, across all clients.
 */
export function getGuestColor(guestId = '') {
  const idStr = String(guestId || '');
  let hash = 0;
  for (let i = 0; i < idStr.length; i++) {
    hash = (hash * 31 + idStr.charCodeAt(i)) & 0xffffffff;
  }
  return GUEST_COLORS[Math.abs(hash) % GUEST_COLORS.length];
}

/**
 * Returns inline style object for a guest avatar.
 */
export function guestAvatarStyle(guestId) {
  const color = getGuestColor(guestId);
  return {
    background: color.bg,
    boxShadow: `0 0 10px ${color.glow}`,
  };
}
