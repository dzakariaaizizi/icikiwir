# 🎵 OfficeBeats

Sistem antrian musik kolaboratif untuk kantor. Satu speaker, semua bisa request lagu.

## Cara Kerja

- **Host** buka di laptop yang terhubung ke speaker → buat sesi → bagikan QR/kode ke rekan kerja
- **Guest** scan QR atau ketik kode → masuk dengan nickname → paste link YouTube → lagu masuk antrian
- Musik diputar otomatis dari antrian secara berurutan di browser host

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite |
| Backend | Node.js + Express + Socket.io |
| Real-time | WebSocket (Socket.io) |
| Storage | In-memory (no DB needed) |
| Music | YouTube IFrame API + oEmbed |

## Development

### Prasyarat
- Node.js 18+
- npm

### Install & Jalankan

```bash
# Clone & install semua dependencies
cd Officebeats
npm install
cd server && npm install
cd ../client && npm install
cd ..

# Jalankan keduanya sekaligus (dari root)
npm run dev
```

- **Frontend** → http://localhost:5173
- **Backend** → http://localhost:3001

## Deploy ke Production

### Backend → Railway / Render

1. Push folder `server/` ke GitHub
2. Deploy ke Railway/Render sebagai Node.js app
3. Set environment variable:
   ```
   CLIENT_ORIGIN=https://your-frontend.vercel.app
   PORT=3001
   ```
4. Catat URL backend (misal: `https://officebeats-server.railway.app`)

### Frontend → Vercel

1. Push folder `client/` ke GitHub (atau seluruh repo)
2. Deploy ke Vercel, set **Root Directory** ke `client`
3. Set environment variable di Vercel dashboard:
   ```
   VITE_SERVER_URL=https://officebeats-server.railway.app
   ```
4. Update `client/vercel.json` dengan URL backend yang benar

## Catatan Penting

- **YouTube Premium di browser host** sangat direkomendasikan untuk menghindari iklan yang memotong musik
- Beberapa video YouTube (terutama dari label besar) tidak bisa di-embed — sistem akan otomatis menolak link tersebut
- Sesi otomatis kedaluwarsa setelah 8 jam tidak aktif
- Setiap guest maksimal 3 lagu aktif di antrian

## Struktur Proyek

```
Officebeats/
├── server/
│   ├── index.js          # Express + Socket.io server
│   ├── sessionStore.js   # In-memory session management
│   └── youtubeValidator.js # YouTube oEmbed validation
└── client/
    └── src/
        ├── pages/
        │   ├── Home.jsx         # Landing page
        │   ├── HostDashboard.jsx # Host view
        │   └── GuestView.jsx    # Guest view
        ├── components/
        │   ├── NowPlaying.jsx   # Now playing card
        │   ├── QueueList.jsx    # Queue display
        │   └── SessionQR.jsx    # QR code + share
        ├── hooks/
        │   └── useYouTubePlayer.js # YouTube IFrame hook
        └── context/
            └── ToastContext.jsx    # Toast notifications
```
