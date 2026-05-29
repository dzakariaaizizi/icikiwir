/**
 * OfficeBeats — YouTube URL Validator
 * Uses YouTube oEmbed API to check if a video is embeddable
 * and fetches metadata (title, thumbnail).
 */

const fetch = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

/**
 * Extract YouTube video ID from various URL formats
 */
function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/, // bare video ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }

  return null;
}

/**
 * Validate a YouTube URL and fetch metadata via oEmbed
 * @returns {Promise<{ valid: boolean, videoId?: string, title?: string, thumbnail?: string, authorName?: string, reason?: string }>}
 */
async function validateYouTubeUrl(url) {
  const videoId = extractVideoId(url);

  if (!videoId) {
    return { valid: false, reason: 'URL tidak valid. Pastikan kamu paste link YouTube yang benar.' };
  }

  const oEmbedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

  try {
    const response = await fetch(oEmbedUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'OfficeBeats/1.0' },
    });

    if (response.status === 401) {
      return {
        valid: false,
        reason: 'Video ini tidak bisa diputar di OfficeBeats karena diblokir oleh pemilik konten (label musik).',
      };
    }

    if (response.status === 404) {
      return {
        valid: false,
        reason: 'Video tidak ditemukan. Mungkin sudah dihapus atau diprivate.',
      };
    }

    if (!response.ok) {
      return {
        valid: false,
        reason: `Tidak bisa memvalidasi video (error ${response.status}). Coba lagi.`,
      };
    }

    const data = await response.json();

    // oEmbed success means the video is embeddable
    return {
      valid: true,
      videoId,
      title: data.title || 'Unknown Title',
      thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      authorName: data.author_name || 'Unknown Artist',
    };
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return { valid: false, reason: 'Timeout saat memvalidasi video. Periksa koneksi internet.' };
    }
    console.error('[YouTube Validator]', err.message);
    return { valid: false, reason: 'Gagal memvalidasi link. Coba lagi.' };
  }
}

module.exports = { validateYouTubeUrl, extractVideoId };
