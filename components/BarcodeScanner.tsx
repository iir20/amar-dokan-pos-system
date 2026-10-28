// Phase 6 — camera barcode scanning with ZXing (@zxing/browser,
// BrowserMultiFormatReader: works in desktop Chrome, Android Chrome
// and the Capacitor WebView, which is Chrome-based).
//
// GRACEFUL DEGRADATION (never a dead end): when there is no camera,
// when permission is denied, or when ZXing cannot start, the panel
// shows exactly why and points at the manual barcode entry next to it
// — a barcode product never requires a camera, and a no-camera device
// never loses barcode lookup. Camera scanning on a real device is NOT
// provable in headless Chromium, so it carries a manual-verification
// note in docs/phase6.md instead of a faked test.
import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

interface Props {
  onDetected: (code: string) => void;
  onClose: () => void;
}

const BarcodeScanner: React.FC<Props> = ({ onDetected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('NO_CAMERA');
        setStarting(false);
        return;
      }
      try {
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result, err) => {
          if (cancelled) return;
          if (result) {
            const code = result.getText().trim();
            if (code) {
              try {
                controls.stop();
              } catch {}
              onDetected(code);
            }
          } else if (err && err.name !== 'NotFoundException') {
            // NotFoundException is the normal "no barcode in frame yet"
            // signal — ignore it, keep scanning.
          }
        });
        controlsRef.current = controls;
        if (!cancelled) setStarting(false);
      } catch {
        if (!cancelled) {
          setError('CAMERA_UNAVAILABLE');
          setStarting(false);
        }
      }
    };
    void start();
    return () => {
      cancelled = true;
      try {
        controlsRef.current?.stop();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div data-testid="barcode-scanner" className="border rounded-lg bg-black/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-800">📷 Scan barcode</p>
        <button
          data-testid="barcode-scanner-close"
          onClick={() => {
            try {
              controlsRef.current?.stop();
            } catch {}
            onClose();
          }}
          className="text-sm font-bold text-gray-600 underline"
        >
          Close
        </button>
      </div>
      {error === 'NO_CAMERA' && (
        <p
          data-testid="barcode-scanner-no-camera"
          role="alert"
          className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2"
        >
          No camera is available on this device. Use the manual barcode entry below — type the printed code and tap Look
          up.
        </p>
      )}
      {error === 'CAMERA_UNAVAILABLE' && (
        <p
          data-testid="barcode-scanner-unavailable"
          role="alert"
          className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2"
        >
          Camera could not be started (permission denied or in use). Use the manual barcode entry below instead.
        </p>
      )}
      {error === '' && (
        <>
          <video
            ref={videoRef}
            data-testid="barcode-scanner-video"
            className="w-full max-h-64 bg-black rounded"
            muted
            playsInline
          />
          {starting && <p className="text-xs text-gray-500">Starting camera… point it at the printed barcode.</p>}
          {!starting && <p className="text-xs text-gray-500">Point the camera at the barcode on the product label.</p>}
        </>
      )}
    </div>
  );
};

export default BarcodeScanner;
