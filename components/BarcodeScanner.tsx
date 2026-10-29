// Phase 6 — camera barcode scanning, plus Phase 7 (Item 3) native
// Android path. Fallback chain, in order — a barcode product NEVER
// requires a camera, and no failure below is a dead end:
//   1. NATIVE (installed Android app): @capacitor/camera takePhoto
//      (the system camera UI, with the runtime CAMERA permission
//      requested on first use — see services/native.ts) + ZXing decode
//      of the captured photo. This replaces the old WebView-only path
//      on device, where getUserMedia inside the WebView failed with
//      "Camera could not be started (permission denied or in use)".
//      NOTE — honest limit: this is photo-based, not a live viewfinder.
//      The live-preview barcode plugin (@capacitor-community/
//      barcode-scanner) only supports Capacitor 5, not this project's
//      Capacitor 8, so it was deliberately NOT installed; a photo the
//      owner frames on the label decodes with the same ZXing engine.
//   2. WEB (browser/PWA): the existing ZXing live-video scan
//      (BrowserMultiFormatReader.decodeFromVideoDevice).
//   3. MANUAL: the Barcode box above this panel (type the printed code
//      + Look up) — referenced by EVERY error panel below.
//
// ERROR PATH (the photographed bug, fixed): a denied / unavailable /
// in-use camera used to collapse into one generic "could not be
// started" line. Now the failure is classified (services/native.ts)
// and the panel says exactly what happened and what to do: a denial
// on device names the exact Settings path (Settings → Apps → Amar
// Dokan POS → Permissions → Camera); an in-use camera names the
// conflicting-app cause; a photo with no barcode offers a retake.
// Every panel keeps the manual-entry fallback and a Retry/Retake
// button. Camera scanning on a real device is NOT provable in
// headless Chromium, so it carries a manual-verification note in
// docs/android.md instead of a faked test.
import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import {
  isNativePlatform,
  classifyCameraError,
  cameraFailureGuidance,
  type CameraFailureKind,
} from '../services/native';
import { ensurePermission, openAppSettings, permissionSettingsGuidance } from '../services/permissions';

interface Props {
  onDetected: (code: string) => void;
  onClose: () => void;
}

type ScanError = CameraFailureKind | 'NO_BARCODE_IN_PHOTO' | 'PERMISSION_PERMANENTLY_DENIED';

/** Decode a captured-photo URL/data-URL with ZXing. Throws NotFoundException when no barcode is in frame. */
async function decodePhoto(src: string): Promise<string> {
  const reader = new BrowserMultiFormatReader();
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'));
    img.src = src;
  });
  const result = await reader.decodeFromImageElement(img);
  return result.getText().trim();
}

const BarcodeScanner: React.FC<Props> = ({ onDetected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [error, setError] = useState<ScanError | ''>('');
  const [starting, setStarting] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const native = isNativePlatform();

  useEffect(() => {
    let cancelled = false;
    const stopVideo = () => {
      try {
        controlsRef.current?.stop();
      } catch {}
      controlsRef.current = null;
    };

    const startNative = async () => {
      // Permission first, via the shared point-of-use module: at most
      // two prompts per session; a permanent denial goes straight to
      // the Settings panel instead of re-prompting, and the manual
      // Barcode box stays available in every case.
      let outcome: string;
      try {
        outcome = (await ensurePermission('camera')).outcome;
      } catch {
        if (!cancelled) {
          setError('UNAVAILABLE');
          setStarting(false);
        }
        return;
      }
      if (outcome !== 'granted' && outcome !== 'not-required') {
        if (!cancelled) {
          setError(outcome === 'permanently-denied' ? 'PERMISSION_PERMANENTLY_DENIED' : 'PERMISSION_DENIED');
          setStarting(false);
        }
        return;
      }
      try {
        const { Camera } = await import('@capacitor/camera');
        const photo = await Camera.takePhoto({
          quality: 90,
          correctOrientation: true,
          saveToGallery: false,
          editable: 'no',
        });
        const src = photo.webPath || (photo.thumbnail ? `data:image/jpeg;base64,${photo.thumbnail}` : undefined);
        if (!src) throw new Error('NO_PHOTO_RETURNED');
        const code = await decodePhoto(src);
        if (cancelled) return;
        if (code) {
          onDetected(code);
        } else {
          setError('NO_BARCODE_IN_PHOTO');
          setStarting(false);
        }
      } catch (err) {
        if (cancelled) return;
        if ((err as any)?.name === 'NotFoundException') {
          setError('NO_BARCODE_IN_PHOTO');
        } else {
          setError(classifyCameraError(err));
        }
        setStarting(false);
      }
    };

    const startWeb = async () => {
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
      } catch (err) {
        if (!cancelled) {
          setError(classifyCameraError(err));
          setStarting(false);
        }
      }
    };

    setError('');
    setStarting(true);
    void (native ? startNative() : startWeb());
    return () => {
      cancelled = true;
      stopVideo();
    };
    // onDetected/onClose are parent callbacks; attempt drives Retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Panel copy per failure. The denial text differs by platform: the
  // Android Settings path only applies on device; on the web the
  // permission lives in the browser's site settings for this page.
  const errorPanel = (): { testid: string; text: string } | null => {
    if (error === '') return null;
    if (error === 'PERMISSION_DENIED' && !native) {
      return {
        testid: 'barcode-scanner-permission-denied',
        text: 'Camera permission is denied for this site. Allow it in your browser’s site settings for this page (address-bar site settings → Camera → Allow), then tap Retry. Until then, type the printed code in the Barcode box above and tap Look up.',
      };
    }
    if (error === 'PERMISSION_PERMANENTLY_DENIED') {
      return {
        testid: 'barcode-scanner-permission-permanent',
        text:
          permissionSettingsGuidance('camera', 'en') ??
          'Camera permission is permanently denied for Amar Dokan POS. Open the app settings, allow Camera, then tap Retry. Until then, type the printed code in the Barcode box above and tap Look up.',
      };
    }
    if (error === 'NO_BARCODE_IN_PHOTO') {
      return {
        testid: 'barcode-scanner-no-barcode',
        text: 'No barcode found in that photo — hold the label flat, fill the frame with the barcode, and retake. Or type the printed code in the Barcode box above and tap Look up.',
      };
    }
    const testid =
      error === 'PERMISSION_DENIED'
        ? 'barcode-scanner-permission-denied'
        : error === 'NO_CAMERA'
          ? 'barcode-scanner-no-camera'
          : error === 'CAMERA_IN_USE'
            ? 'barcode-scanner-in-use'
            : error === 'CANCELLED'
              ? 'barcode-scanner-cancelled'
              : 'barcode-scanner-unavailable';
    return { testid, text: cameraFailureGuidance(error) };
  };

  const panel = errorPanel();
  const showRetry =
    error === 'PERMISSION_DENIED' ||
    error === 'PERMISSION_PERMANENTLY_DENIED' ||
    error === 'CAMERA_IN_USE' ||
    error === 'UNAVAILABLE';
  const showRetake = error === 'NO_BARCODE_IN_PHOTO' || error === 'CANCELLED';

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
      {panel && (
        <>
          <p
            data-testid={panel.testid}
            role="alert"
            className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2"
          >
            {panel.text}
          </p>
          {(showRetry || showRetake) && (
            <button
              data-testid="barcode-scanner-retry"
              onClick={() => setAttempt((a) => a + 1)}
              className="bg-white border px-3 py-2 rounded-lg text-sm font-bold"
            >
              {showRetake ? '↻ Retake photo' : '↻ Retry'}
            </button>
          )}
          {error === 'PERMISSION_PERMANENTLY_DENIED' && (
            <button
              data-testid="barcode-scanner-open-settings"
              onClick={() => {
                void openAppSettings();
              }}
              className="bg-white border px-3 py-2 rounded-lg text-sm font-bold"
            >
              Open app settings
            </button>
          )}
        </>
      )}
      {error === '' && !native && (
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
      {error === '' && native && (
        <p className="text-xs text-gray-500">
          {starting
            ? 'Opening the camera — take a photo filling the frame with the barcode on the product label.'
            : 'Processing photo…'}
        </p>
      )}
      <p className="text-[11px] text-gray-500">
        No camera? Type the printed code in the Barcode box above and tap Look up — scanning never blocks a lookup.
      </p>
    </div>
  );
};

export default BarcodeScanner;
