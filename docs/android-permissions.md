# Android Permissions — Amar Dokan POS (Capacitor 8)

Complete native Android permission system. Scope: the installed Android app only (`android/`, app id `com.amardokan.pos`,
minSdk 24, targetSdk 36). The web build / PWA is untouched: on the web every call in `services/permissions.ts` returns the
neutral `not-required` outcome and the existing browser prompts + manual/text fallbacks keep working exactly as today.

Rule that governs everything below: **a permission is requested at the point of use only** — camera when the user taps
Scan, microphone when the user taps a voice button, Bluetooth when the user taps Bluetooth Print. Nothing is requested at
app start, and a denied permission never bricks a feature: every denial keeps its manual/text/download fallback.

## Permission table (app manifest: `android/app/src/main/AndroidManifest.xml`)

| Permission                                             | Why it exists (usage-verified)                                                                                                                                                                                                                 | Requested when                                         | Fallback if denied                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| `CAMERA`                                               | Native barcode photo: `Camera.takePhoto()` in `components/BarcodeScanner.tsx`, ZXing-decoded. `saveToGallery: false`, so no gallery write is involved.                                                                                         | User taps Scan (first use)                             | Type the printed code in the Barcode box + Look up |
| `RECORD_AUDIO`                                         | Native Bangla voice recognition: `@capacitor-community/speech-recognition` in `services/voice.ts` (`listenOnceNative`). Voice announcements are output only (`speechSynthesis`), which needs no mic permission and is not conflated with this. | User taps a voice listen button (first use)            | Type the command in the text box                   |
| `BLUETOOTH_SCAN` (Android 12+, API 31+)                | Find a BLE thermal printer: `BluetoothLe.requestDevice()` in `services/nativePrint.ts`.                                                                                                                                                        | User taps Bluetooth Print (first use)                  | ESC/POS `.txt` download (same receipt text)        |
| `BLUETOOTH_CONNECT` (Android 12+, API 31+)             | Connect to the chosen printer and write ESC/POS bytes to its writable characteristic (`services/nativePrint.ts`).                                                                                                                              | User taps Bluetooth Print (first use)                  | ESC/POS `.txt` download                            |
| `BLUETOOTH` + `BLUETOOTH_ADMIN` (`maxSdkVersion="30"`) | Legacy pair for Android 11 and below, where SCAN/CONNECT do not exist. Capped so they are never requested on 12+ devices.                                                                                                                      | User taps Bluetooth Print on an old device (first use) | ESC/POS `.txt` download                            |
| `INTERNET` (normal, pre-existing)                      | The app talks to its own server API over HTTPS. Not a runtime permission; no prompt.                                                                                                                                                           | Never (install-time)                                   | Offline-first AmarSync outbox                      |

Optional hardware, so the app still installs on devices without it (`android:required="false"`):

| Feature                         | Reason                                    |
| ------------------------------- | ----------------------------------------- |
| `android.hardware.camera`       | Manual barcode entry works with no camera |
| `android.hardware.microphone`   | Typed commands work with no mic           |
| `android.hardware.bluetooth_le` | `.txt` download works with no BLE printer |

## Deliberately NOT declared — with evidence

| Candidate                                                      | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location (`ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`)   | NOT declared in the app manifest. App code never uses location: no geolocation, map, or pin code exists in `services/`, `components/`, or `shared/`.                                                                                                                                                                                                                                                                                                                     | **Caveat the owner must know:** the BLE plugin's own manifest (`node_modules/@capacitor-community/bluetooth-le/android/src/main/AndroidManifest.xml`) still merges both location permissions into the merged manifest, and its Android plugin requests them: on Android 12+ `initialize()` requests `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` + `ACCESS_FINE_LOCATION` unless called with `{ androidNeverForLocation: true }`, and on Android 11 and below it requests location + legacy Bluetooth as its scan gate. So on a real device a Bluetooth Print tap may still show a location prompt that comes from the plugin, not from app code. Stripping it with `tools:node="remove"` was NOT done: it would break BLE discovery on Android 11 and below, where location is the plugin's scan gate, and that behaviour change cannot be verified without a device. Coordinator decision (see Integration notes): pass `androidNeverForLocation: true` in both `initialize()` calls together to drop location on 12+, or accept the plugin's location prompt. Never change one call alone. |
| Media / storage (`READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE`) | NOT declared. All photo/logo picks are `<input type="file" accept="image/*">` (`components/Settings.tsx` store photo, `components/Profile.tsx` profile picture, `components/AdminPanel.tsx` logo) — the system picker grants a one-time URI and needs no media permission on any Android version. Camera photos are never saved to the gallery (`saveToGallery: false`). Downloads (`.txt`, CSV, PDF) go through the WebView download mechanism, not app storage access. | Grep: no `READ_MEDIA`, no `getPhoto`/`pickImages` gallery call, no storage API in app code. The `photos` kind in `services/permissions.ts` therefore always resolves `not-required` and the caller just opens the picker.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST_NOTIFICATIONS`                                           | NOT declared. The app posts no system notifications. Order alerts and sync status are in-app UI only (the sync pill, the offline banner in `components/POS.tsx`).                                                                                                                                                                                                                                                                                                        | Grep: no `Notification` API, no local/push-notification plugin in `package.json` or `capacitor.config.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `BLUETOOTH_ADVERTISE`                                          | NOT declared. The app is a BLE central (scans and connects to a printer); it never advertises as a peripheral.                                                                                                                                                                                                                                                                                                                                                           | `services/nativePrint.ts` uses only `requestDevice` / `connect` / `write`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Contacts, SMS, and every other permission                      | NOT declared. No code path uses them.                                                                                                                                                                                                                                                                                                                                                                                                                                    | Full-repo grep for contacts / SMS / telephony APIs returns nothing in app code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Runtime flow (`services/permissions.ts` — new module, `native.ts` untouched)

`ensurePermission('camera' | 'microphone' | 'bluetooth' | 'photos')` returns a `PermissionResult` the caller branches on.
No other module needs to interpret raw plugin states.

### Camera / microphone (plugins expose check + request)

1. `checkPermissions()` first. Already granted (or `limited` for camera) → `granted`, no prompt appears.
2. System state `denied` (permanently denied / "don't ask again") → `permanently-denied` immediately, no prompt.
3. State `prompt` / `prompt-with-rationale` and fewer than 2 prompts shown this session → one system dialog.
4. That prompt denied → `denied-retryable`: show the rationale (`permissionRationale(kind, lang)`) + explain + a Retry button.
5. Retry shows prompt 2. Denied again → `permanently-denied`: **no third prompt is ever shown**, even if the system would still
   allow one. Show the exact Settings path (`permissionSettingsGuidance(kind, lang)`) + an "Open app settings" button.
6. Returning from Settings and tapping Retry re-checks (step 1), so a fresh grant is picked up without reinstalling.

The attempt counter is in-memory per kind per session (reset on app restart) and is exposed for tests
(`getPermissionAttempts`, `resetPermissionAttempts`). The pure transition (`shouldPrompt`, `resolvePermissionOutcome`) is
unit-tested in `tests/permissions.test.ts` without a device.

### Bluetooth (the plugin exposes no check API — the prompt IS the check)

`@capacitor-community/bluetooth-le` has no `checkPermissions` / `requestPermissions` JS API. Its Android plugin requests
the permission aliases itself inside `initialize()`. So `ensurePermission('bluetooth')` calls `BluetoothLe.initialize()`
with **no arguments — exactly the call `services/nativePrint.ts` already makes** — so the alias set can never disagree
between the check and the print:

- `initialize()` resolves → `granted` (a later print `initialize()` then succeeds without a second prompt).
- Rejects with "Permission denied." → first rejection `denied-retryable`, second consecutive rejection
  `permanently-denied` (same two-prompt cap; a permanently-denied alias set makes `initialize()` reject without a dialog).
- Rejects for any other reason (no BLE support, Bluetooth off) → `unavailable`, not a denial, with the message in `detail`.
  The caller falls back to the `.txt` download.

### Photos

Always `not-required` (web and native): the system picker needs no permission. The caller opens the picker. There is no
settings guidance for photos (`permissionSettingsGuidance('photos')` returns `null`) because there is nothing to re-enable.

### Strings (EN + BN, shared dict only)

All new strings live in the shared `TRANSLATIONS` in `constants.ts` with matching keys in `types.ts` (`permRationale*`,
`permSettings*`, `permOpenSettings`, `permTitle`, `permGranted`, `permNotGranted`). No local dicts. Rationale text is shown
in-app in the user's language before the first-use prompt; settings guidance is shown on permanent denial. Tests assert
every rationale and guidance string exists in both locales and that the Bangla text contains Bangla script.

## Settings deep link — what is real and what is not

`openAppSettings()` in `services/permissions.ts` is implemented via `BluetoothLe.openAppSettings()` from the
already-installed bluetooth-le plugin — no new dependency. Its Android implementation was verified in the plugin's Kotlin
source (`BluetoothLe.kt`): `Intent(ACTION_APPLICATION_DETAILS_SETTINGS)` with a `package:<appId>` URI — the documented
Android path to an app's system Settings page. It resolves `true` when the page opened, `false` on the web or on plugin
failure (then the caller shows the manual path).

**Honest limit:** the deep link lands on the app's Settings page, NOT on the individual permission toggle. The caller must
still show the `Permissions → <Camera | Microphone | Nearby devices>` step from the guidance text next to the button.
Note the Bluetooth toggle lives under the **Nearby devices** permission group on Android 12+, not under a "Bluetooth"
toggle — the `permSettingsBluetooth` strings say so.

## Integration status — WIRED by the coordinator (2026-10-29)

The wiring above is now applied, with two deliberate deviations recorded
here so a later reader does not "fix" them back:

1. **Barcode scan** — `startNative()` now calls `ensurePermission('camera')`
   instead of `ensureCameraPermission()`; `denied-retryable` shows the
   existing `PERMISSION_DENIED` panel + Retry (Retry re-runs the check,
   so the second prompt is the retry and a further denial becomes
   permanent); `permanently-denied` shows a new
   `PERMISSION_PERMANENTLY_DENIED` panel (`barcode-scanner-permission-permanent`)
   with the Settings guidance plus an `Open app settings` button
   (`barcode-scanner-open-settings`). The rationale is not shown as a
   separate pre-panel (the component has no `lang` prop; its panels are
   English-only today), but the denial panels carry the exact guidance.
   Web path unchanged.
2. **Voice** — `listenOnceNative()` now calls
   `ensurePermission('microphone')`; every non-granted outcome throws
   `PERMISSION_DENIED` and the existing VoicePos/VoiceInventory panels
   show their Settings guidance + typed fallback. No prompt loop: the
   module caps at two prompts per session.
3. **Bluetooth Print** — both `Invoice.handleBluetoothPrint()` and
   `ReceiptView.handleBluetooth()` gate on `ensurePermission('bluetooth')`
   first: retryable shows the rationale + retry hint, permanent shows
   the Settings guidance, and the ESC/POS `.txt` download stays
   available in all cases. `unavailable` falls through to the existing
   try/catch, which reports the failure + download fallback.
4. **Settings screen** — a native-only `PermissionsSection`
   (`settings-permissions`) renders after the Server address section
   (not after sync-status, to avoid disturbing the QR worker's section):
   checked camera/mic state (`settings-permission-camera` /
   `-microphone`), a Bluetooth row carrying the rationale text (no
   invented status — Bluetooth has no check API), a Refresh button, and
   an `openAppSettings()` button (`settings-permissions-open-settings`).
   It never requests a permission itself. It is not rendered on the web
   at all, so the web build keeps browser site settings + fallbacks.
5. **Location flag — NOT changed:** `BluetoothLe.initialize()` is still
   called with no arguments in both places. The pair-change described
   below remains available but unapplied, because it cannot be verified
   without a device.
6. **No manifest or workflow change was needed for wiring:** the manifest already declares every permission above, and no
   new plugin is installed. `npx cap sync android` after the wiring change only re-copies `dist`.

## Owner checklist — everything NOT verified in the sandbox (never claim as passed)

No phone, Android SDK, Bluetooth printer, camera, or microphone exists in this sandbox, and no Gradle build ran here. Run
all of this on a real device (debug APK: `npm run cap:sync` + `./gradlew assembleDebug` in `android/`) before describing
any of it as working, and record the device model + Android version for each pass:

1. Camera grant: tap Scan → exactly one system camera dialog (not at app start) → Allow → system camera opens → framed
   label photo decodes to the product in shop lighting.
2. Camera deny once: Deny → panel shows rationale + Retry, manual Barcode box still looks the product up.
3. Camera permanent denial: Deny, then Deny again ("don't ask again") → panel shows the exact Settings → Apps → Amar
   Dokan POS → Permissions → Camera path, no third prompt appears, and the "Open app settings" button lands on the app's
   Settings page; turning Camera on there + Retry (in-app) scans without reinstalling.
4. Camera in use / no camera: existing panels from `services/native.ts` still behave (other camera app open → in-use
   panel; no-camera device → manual entry only, app still installs and sells).
5. Microphone grant / deny / permanent denial: same three round-trips for a Bangla voice command in POS and in Inventory;
   typed input performs the same action in every denial case; no hang on a listening spinner.
6. Settings deep link on a real device: confirm `openAppSettings()` opens the app's Settings page (not a crash, not a
   browser tab) for camera, microphone, and Bluetooth denial panels.
7. Bluetooth on Android 12+: tap Bluetooth Print → one system prompt set (Nearby devices) → Allow → printer picked →
   receipt prints with correct totals. Then deny → `.txt` download still works; deny permanently → Settings path +
   Nearby devices toggle + Retry recovers.
8. Bluetooth on Android 11 or below: confirm what the plugin actually prompts (legacy Bluetooth + location per the
   plugin's alias set) and whether printing works there at all; decide from that evidence whether to keep plugin location
   behaviour or drop BLE printing for old Android — do not guess.
9. Photo/media on a real device: store-photo, profile-picture, and logo picks open the system picker with no permission
   dialog on Android 13+ and on an older device, and the chosen image saves (under 500KB rule unchanged).
10. Merged-manifest check: open the Merged Manifest in Android Studio (or `aapt2 dump xmltree`) for the built APK and
    confirm the final permission set matches the table above plus the disclosed plugin-merged location entries — and
    nothing else (no contacts, SMS, or advertising permissions).
11. No-permission regressions: fresh install → no permission dialog appears before the first Scan / voice / print tap;
    revoking all permissions in Settings leaves the app opening and selling via manual entry + typed commands + download.
12. Only after 1–11 pass may the permission system be described as verified, and only for the tested device models +
    Android versions.
