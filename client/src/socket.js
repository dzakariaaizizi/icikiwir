import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.PROD ? window.location.origin : (import.meta.env.VITE_SERVER_URL || 'http://localhost:3001');

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: false,
      // Unlimited reconnection attempts — mobile browsers can drop connection
      // for extended periods (backgrounded, screen off, network switch)
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.3,
      // Keep-alive: prevent idle connection from being killed by mobile OS
      timeout: 20000,
    });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  if (socket && socket.connected) {
    socket.disconnect();
    socket = null;
  }
}
