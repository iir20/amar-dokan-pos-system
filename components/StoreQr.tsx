// Owner "Store QR" screen: view, print and share this store's own
// QR code, plus an in-app scan entry for another store's QR.
//
// The QR encodes <origin>/s/<storeCode> (services/storeQr.ts). The
// code comes from POST /api/store-qr, which backfills legacy stores;
// the owner never types a code, and a code is never derived from the
// internal store id. The QR image itself is rendered locally with the
// already-installed @zxing/browser QR writer — no third-party QR
// service ever sees the store URL.
import React, { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeSvgWriter } from '@zxing/browser';
import { Language } from '../types';
import { TRANSLATIONS } from '../constants';
import { StorageService } from '../services/storage';
import { buildStoreQrUrl } from '../services/storeQr';
import { QrCode, Copy, Share2, Printer, ScanLine } from 'lucide-react';
import StoreScan from './StoreScan';
import Storefront from './Storefront';

interface StoreQrProps {
  lang: Language;
}

const StoreQr: React.FC<StoreQrProps> = ({ lang }) => {
  const t = TRANSLATIONS[lang];
  const [code, setCode] = useState<string | null>(null);
  const [storeName, setStoreName] = useState('');
  const [loadError, setLoadError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    StorageService.ensureStoreQr()
      .then((res) => {
        if (!cancelled) setCode(res.storeCode);
      })
      .catch(() => {
        if (!cancelled) setLoadError(t.storeQrLoadFailed);
      });
    StorageService.getCurrentUser()
      .then((u) => {
        if (!cancelled && u) setStoreName(u.storeName || '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const url = code ? buildStoreQrUrl(window.location.origin, code) : '';

  useEffect(() => {
    if (!url || !qrRef.current) return;
    try {
      const writer = new BrowserQRCodeSvgWriter();
      const svg = writer.write(url, 240, 240);
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', 'auto');
      qrRef.current.innerHTML = '';
      qrRef.current.appendChild(svg);
    } catch {
      // The URL text below remains usable (copy/share) even if the
      // SVG render fails on an unusual device.
    }
  }, [url]);

  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const shareLink = async () => {
    if (!url) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: storeName || 'Amar Dokan', text: storeName || undefined, url });
        return;
      }
    } catch {
      // Sharing cancelled or unavailable — fall through to copy.
    }
    await copyLink();
  };

  const printQr = () => {
    if (!url) return;
    const svgHtml = qrRef.current?.innerHTML || '';
    const win = window.open('', '_blank');
    if (!win) {
      window.print();
      return;
    }
    win.document.write(
      `<html><head><title>${storeName || 'Store QR'}</title></head><body style="text-align:center;font-family:sans-serif;padding:40px">` +
        `<h1>${storeName || ''}</h1><div style="max-width:320px;margin:20px auto">${svgHtml}</div>` +
        `<p style="word-break:break-all">${url}</p><p>Scan this code to open this store only.</p>` +
        `</body></html>`,
    );
    win.document.close();
    win.focus();
    win.print();
  };

  if (scannedCode) {
    return (
      <div className="space-y-3">
        <button onClick={() => setScannedCode(null)} className="text-sm font-bold text-emerald-700 underline">
          ← {t.storeQrScan}
        </button>
        <Storefront lang={lang} code={scannedCode} onExit={() => setScannedCode(null)} />
      </div>
    );
  }

  return (
    <div data-testid="store-qr-screen" className="bg-white rounded-xl shadow-sm border p-4 space-y-4">
      <h3 className="font-bold text-gray-800 flex items-center gap-2">
        <QrCode size={20} className="text-emerald-600" /> {t.storeQrTitle}
      </h3>
      <p className="text-sm text-gray-600">{t.storeQrHint}</p>

      {loadError && (
        <p data-testid="store-qr-error" className="text-sm text-red-600">
          {loadError}
        </p>
      )}

      {code && (
        <>
          <div ref={qrRef} data-testid="store-qr-code" className="max-w-[240px] mx-auto bg-white" />
          <p data-testid="store-qr-url" className="text-xs text-gray-600 break-all text-center">
            {url}
          </p>
          {copied && <p className="text-sm text-emerald-700 text-center">{t.storeQrCopied}</p>}
          <div className="flex flex-wrap gap-2 justify-center">
            <button
              data-testid="store-qr-copy"
              onClick={() => void copyLink()}
              className="px-4 py-2 rounded-lg bg-gray-100 font-bold text-sm flex items-center gap-1"
            >
              <Copy size={14} /> {t.storeQrCopy}
            </button>
            <button
              data-testid="store-qr-share"
              onClick={() => void shareLink()}
              className="px-4 py-2 rounded-lg bg-gray-100 font-bold text-sm flex items-center gap-1"
            >
              <Share2 size={14} /> {t.storeQrShare}
            </button>
            <button
              data-testid="store-qr-print"
              onClick={printQr}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold text-sm flex items-center gap-1"
            >
              <Printer size={14} /> {t.storeQrPrint}
            </button>
          </div>
        </>
      )}

      <div className="border-t pt-3">
        {showScan ? (
          <StoreScan lang={lang} onStoreCode={(c) => setScannedCode(c)} onClose={() => setShowScan(false)} />
        ) : (
          <button
            data-testid="store-qr-scan-button"
            onClick={() => setShowScan(true)}
            className="px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold text-sm flex items-center gap-1"
          >
            <ScanLine size={16} /> {t.storeQrScan}
          </button>
        )}
      </div>
    </div>
  );
};

export default StoreQr;
