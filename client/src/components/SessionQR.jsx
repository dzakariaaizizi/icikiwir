import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

/**
 * SessionQR — session code + QR code bawah, centered
 */
export function SessionQR({ code, sessionName }) {
  const joinUrl = `${window.location.origin}/join?code=${code}`;
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1800);
    } catch {}
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {}
  };

  return (
    <div className="session-qr-card glass">
      {/* Top: kode sesi */}
      <div className="session-qr-top">
        <p className="session-qr-label">Kode Sesi</p>
        <div className="session-code-row">
          <span className="session-code">{code}</span>
          <button
            className={`btn-copy-code ${codeCopied ? 'copied' : ''}`}
            onClick={copyCode}
            title={codeCopied ? 'Tersalin!' : 'Salin kode'}
          >
            {codeCopied ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            )}
          </button>
        </div>
        {sessionName && <p className="session-qr-name">{sessionName}</p>}
      </div>

      {/* Middle: QR code, centered & larger */}
      <div className="session-qr-body">
        <div className="qr-wrap-center">
          <QRCodeSVG
            value={joinUrl}
            size={140}
            bgColor="transparent"
            fgColor="#f1f5f9"
            level="M"
          />
        </div>
        <p className="qr-hint">Scan untuk bergabung</p>
      </div>

      {/* Bottom: copy link */}
      <button
        id="btn-copy-invite-link"
        className={`btn-invite-link ${linkCopied ? 'copied' : ''}`}
        onClick={copyLink}
      >
        {linkCopied ? (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Link Tersalin!
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
            Salin Link Undangan
          </>
        )}
      </button>
    </div>
  );
}
