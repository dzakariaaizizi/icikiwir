import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import Home from './pages/Home';
import HostDashboard from './pages/HostDashboard';
import GuestView from './pages/GuestView';

function JoinRedirect() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code') || '';
  // QR code lands here — redirect home with code pre-filled via query param
  return <Navigate to={code ? `/?join=${code}` : '/'} replace />;
}

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/host/:sessionId" element={<HostDashboard />} />
          <Route path="/join" element={<JoinRedirect />} />
          <Route path="/join/:sessionId" element={<GuestView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
