// Phase 2 — Bluetooth thermal printing for the native Android app.
//
// The receipt text is the SAME ESC/POS text the web app already generates
// (components/Invoice.tsx generateEscPosText, including the paper-cut
// command). On the web, or whenever Bluetooth is unavailable, the caller
// must fall back to the existing .txt download — this module never removes
// that path; it only adds a native one.
//
// Native path (Android only, via @capacitor-community/bluetooth-le):
//   1. initialise the BLE stack, 2. let the user pick a paired/nearby BLE
//      printer, 3. connect and discover services, 4. write the ESC/POS
//      bytes to the first writable characteristic found. Thermal printers
//      differ in service/characteristic UUIDs, so discovery is generic by
//      design: the first characteristic advertising `write` or
//      `writeWithoutResponse` wins. If no writable characteristic exists,
//      the error names that fact (NO_WRITABLE_CHARACTERISTIC) instead of
//      pretending the print succeeded.
//
// UNVERIFIED ON DEVICE: no phone or Bluetooth printer exists in this
// sandbox, so this path is code-reviewed + build-checked only. See
// docs/android.md for the on-device checklist the owner must run.

import { isNativePlatform } from './native';

export type PrintResult = { method: 'bluetooth' | 'download-fallback'; deviceName?: string };

function encodeEscPos(text: string): DataView {
  // ESC/POS printers expect raw bytes; the receipt text is ASCII plus the
  // ৳ sign, which is not ASCII — encode as UTF-8 and let the printer's
  // firmware handle it (most BLE thermal printers accept UTF-8 text; if a
  // specific printer garbles ৳, its vendor app documents a code-page
  // switch, which is a per-printer setting, not a code change here).
  return new DataView(new TextEncoder().encode(text).buffer);
}

/** Download fallback — identical to the pre-Phase-2 .txt download. */
export function downloadEscPosText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Print ESC/POS text over Bluetooth (native app only). Throws with a
 * plain-English message on every failure; callers show the message and
 * offer the .txt download. Never resolves successfully without writing.
 */
export async function printViaBluetooth(text: string): Promise<PrintResult> {
  if (!isNativePlatform()) {
    throw new Error('Bluetooth printing is only available in the installed Android app.');
  }
  const { BluetoothLe } = await import('@capacitor-community/bluetooth-le');
  await BluetoothLe.initialize();
  const device = await BluetoothLe.requestDevice({});
  await BluetoothLe.connect({ deviceId: device.deviceId });
  try {
    const services = await BluetoothLe.getServices({ deviceId: device.deviceId });
    for (const service of services.services) {
      for (const characteristic of service.characteristics) {
        const props = characteristic.properties;
        if (props.write || props.writeWithoutResponse) {
          await BluetoothLe.write({
            deviceId: device.deviceId,
            service: service.uuid,
            characteristic: characteristic.uuid,
            value: encodeEscPos(text),
          });
          return { method: 'bluetooth', deviceName: device.name };
        }
      }
    }
    throw new Error('NO_WRITABLE_CHARACTERISTIC: this printer exposes no writable BLE characteristic.');
  } finally {
    try {
      await BluetoothLe.disconnect({ deviceId: device.deviceId });
    } catch {}
  }
}
