// In-app scan entry for a store QR code.
//
// Reuses the existing scan chain (components/BarcodeScanner.tsx:
// native photo scan first, then the web ZXing live-video scan, then
// manual entry) — @zxing/browser's multi-format reader already
// decodes QR codes, so no new decoder is added. The scanned text is
// parsed with parseStoreQrUrl (services/storeQr.ts): only a /s/<code>
// URL yields a store. Anything else shows the "not a store QR"
// message and opens NO store — a wrong store is never guessed.
import React, { useState } from 'react';
import { Language } from '../types';
import { TRANSLATIONS } from '../constants';
import { parseStoreQrUrl } from '../services/storeQr';
import BarcodeScanner from './BarcodeScanner';

interface StoreScanProps {
  lang: Language;
  onStoreCode: (code: string) => void;
  onClose: () => void;
}

const StoreScan: React.FC<StoreScanProps> = ({ lang, onStoreCode, onClose }) => {
  const t = TRANSLATIONS[lang];
  const [notStore, setNotStore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [manual, setManual] = useState('');

  const handleDetected = (raw: string) => {
    const code = parseStoreQrUrl(raw);
    if (code) {
      onStoreCode(code);
    } else {
      setNotStore(true);
    }
  };

  const handleManual = () => {
    const code = parseStoreQrUrl(manual);
    if (code) {
      onStoreCode(code);
    } else {
      setNotStore(true);
    }
  };

  return (
    <div data-testid="store-scan" className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-800">{t.storeQrScanTitle}</h3>
        <button onClick={onClose} className="text-sm font-bold text-gray-500 underline">
          ✕
        </button>
      </div>

      {notStore ? (
        <div data-testid="store-scan-not-store" className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm text-amber-800">{t.storeQrNotStore}</p>
          <button
            data-testid="store-scan-retry"
            onClick={() => {
              setNotStore(false);
              setAttempt((a) => a + 1);
            }}
            className="mt-2 px-3 py-1.5 rounded-lg bg-amber-600 text-white font-bold text-xs"
          >
            {t.storefrontTryAgain}
          </button>
        </div>
      ) : (
        <div key={attempt}>
          <BarcodeScanner onDetected={handleDetected} onClose={onClose} />
        </div>
      )}

      <div className="border-t pt-3 space-y-2">
        <input
          data-testid="store-scan-manual"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="/s/… or full store QR link"
          className="w-full p-2 border rounded-lg text-sm"
        />
        <button
          data-testid="store-scan-manual-submit"
          onClick={handleManual}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold text-sm"
        >
          {t.storeQrOpenStore}
        </button>
      </div>
    </div>
  );
};

export default StoreScan;
