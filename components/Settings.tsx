// Wave 2 (Item 4) — real settings screen.
//
// Language (via the App-level callback, so the whole app switches),
// theme (light / dark / high-contrast) and font-size scaling (via
// services/theme, applied to <html> immediately and persisted),
// voice/sound confirmation toggles (persisted preferences — see note
// below), live sync status (outbox depth + online state from
// services/amarSync), and store-profile customisation (store name,
// photo/logo, location, contact) saved through the existing
// PUT /profile API via StorageService.updateUser.
//
// NOTE on voice/sound toggles: the preference itself is stored here
// (localStorage keys amar-voice-confirm / amar-sound-confirm, default
// on) and is the single place a future voice-service change reads
// from. services/voice.ts is outside this item's file ownership, so
// the speak calls themselves do not consult these keys yet — the
// toggles are real persisted settings, not a claim that every speak
// call is already gated.
import React, { useState, useEffect } from 'react';
import { Language, User, Translation } from '../types';
import { TRANSLATIONS } from '../constants';
import { StorageService } from '../services/storage';
import { api, getApiBase, getApiOverride, setApiOverride, clearApiOverride, normalizeApiBase } from '../services/api';
import { isNativePlatform } from '../services/native';
import { openAppSettings } from '../services/permissions';
import { getTheme, setTheme, getFontScale, setFontScale, type FontScaleName } from '../services/theme';
import { getOutbox, subscribeToSync } from '../services/amarSync';
import type { ThemeName } from '../design/tokens';
import { Settings as SettingsIcon, Camera, Save, RefreshCw } from 'lucide-react';

export const VOICE_CONFIRM_KEY = 'amar-voice-confirm';
export const SOUND_CONFIRM_KEY = 'amar-sound-confirm';

export function getVoiceConfirmations(): boolean {
  if (typeof window === 'undefined') return true;
  const raw = window.localStorage.getItem(VOICE_CONFIRM_KEY);
  return raw === null ? true : raw === 'true';
}

export function getSoundConfirmations(): boolean {
  if (typeof window === 'undefined') return true;
  const raw = window.localStorage.getItem(SOUND_CONFIRM_KEY);
  return raw === null ? true : raw === 'true';
}

export function setVoiceConfirmations(on: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(VOICE_CONFIRM_KEY, on ? 'true' : 'false');
}

export function setSoundConfirmations(on: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SOUND_CONFIRM_KEY, on ? 'true' : 'false');
}

interface SettingsScreenProps {
  lang: Language;
  onLanguageChange?: (lang: Language) => void;
  isOwner?: boolean;
}

const THEMES: Array<{
  id: ThemeName;
  labelKey: 'settingsThemeLight' | 'settingsThemeDark' | 'settingsThemeHighContrast';
}> = [
  { id: 'light', labelKey: 'settingsThemeLight' },
  { id: 'dark', labelKey: 'settingsThemeDark' },
  { id: 'high-contrast', labelKey: 'settingsThemeHighContrast' },
];

const FONT_SCALES: Array<{
  id: FontScaleName;
  labelKey: 'settingsFontSmall' | 'settingsFontNormal' | 'settingsFontLarge' | 'settingsFontXLarge';
}> = [
  { id: 'small', labelKey: 'settingsFontSmall' },
  { id: 'normal', labelKey: 'settingsFontNormal' },
  { id: 'large', labelKey: 'settingsFontLarge' },
  { id: 'xlarge', labelKey: 'settingsFontXLarge' },
];

const SettingsScreen: React.FC<SettingsScreenProps> = ({ lang, onLanguageChange, isOwner = true }) => {
  const t = TRANSLATIONS[lang];
  const [theme, setThemeState] = useState<ThemeName>(() => getTheme());
  const [scale, setScaleState] = useState<FontScaleName>(() => getFontScale());
  const [voiceOn, setVoiceOn] = useState<boolean>(() => getVoiceConfirmations());
  const [soundOn, setSoundOn] = useState<boolean>(() => getSoundConfirmations());
  const [savedNote, setSavedNote] = useState('');

  // Sync status: live outbox depth + online state.
  const [syncPending, setSyncPending] = useState(0);
  const [syncFailed, setSyncFailed] = useState(0);
  const [syncOnline, setSyncOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const refreshSync = () => {
    const outbox = getOutbox();
    setSyncPending(outbox.filter((i) => i.status === 'pending').length);
    setSyncFailed(outbox.filter((i) => i.status === 'failed').length);
    setSyncOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
  };
  useEffect(() => {
    refreshSync();
    const unsub = subscribeToSync((state) => {
      setSyncPending(state.outboxCount);
      setSyncFailed(state.failedCount);
      setSyncOnline(state.isOnline);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Store-profile customisation (PUT /profile).
  const [profile, setProfile] = useState<Partial<User>>({});
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  useEffect(() => {
    StorageService.getCurrentUser()
      .then((u) => {
        if (u) setProfile({ ...u });
        setProfileLoaded(true);
      })
      .catch(() => setProfileLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickTheme = (next: ThemeName) => {
    setTheme(next);
    setThemeState(next);
    setSavedNote(t.settingsSaved);
  };
  const pickScale = (next: FontScaleName) => {
    setFontScale(next);
    setScaleState(next);
    setSavedNote(t.settingsSaved);
  };
  const toggleVoice = (on: boolean) => {
    setVoiceConfirmations(on);
    setVoiceOn(on);
    setSavedNote(t.settingsSaved);
  };
  const toggleSound = (on: boolean) => {
    setSoundConfirmations(on);
    setSoundOn(on);
    setSavedNote(t.settingsSaved);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500000) {
      setProfileError('Image too large. Please use an image under 500KB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new Image();
      img.src = reader.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const maxSize = 300;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxSize) {
            height *= maxSize / width;
            width = maxSize;
          }
        } else if (height > maxSize) {
          width *= maxSize / height;
          height = maxSize;
        }
        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);
        setProfile((prev) => ({ ...prev, profilePicture: canvas.toDataURL('image/jpeg', 0.8) }));
      };
    };
    reader.readAsDataURL(file);
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setProfileError('');
    setProfileMessage('');
    try {
      const updated = await StorageService.updateUser({
        storeName: profile.storeName,
        address: profile.address,
        phone: profile.phone,
        zila: profile.zila,
        upozila: profile.upozila,
        thana: profile.thana,
        profilePicture: profile.profilePicture,
      });
      if (!updated) throw new Error('Profile update did not return a saved profile.');
      setProfile({ ...updated });
      setProfileMessage(t.settingsProfileSaved);
    } catch (err: any) {
      setProfileError(err?.message || t.settingsSaveFailed);
    }
  };

  const inputCls = 'w-full p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none';

  return (
    <div data-testid="settings-screen" className="p-4 md:p-6 h-full overflow-y-auto">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <SettingsIcon size={24} className="text-emerald-600" /> {t.settings}
        </h2>

        {/* Language */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-3">
          <h3 className="font-bold text-gray-800">{t.settingsLanguage}</h3>
          <div className="flex gap-2">
            <button
              data-testid="settings-lang-en"
              onClick={() => onLanguageChange?.('en')}
              className={`px-4 py-2 rounded-lg font-bold text-sm ${lang === 'en' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700'}`}
            >
              English
            </button>
            <button
              data-testid="settings-lang-bn"
              onClick={() => onLanguageChange?.('bn')}
              className={`px-4 py-2 rounded-lg font-bold text-sm ${lang === 'bn' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700'}`}
            >
              বাংলা
            </button>
          </div>
        </section>

        {/* Theme + font size */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div>
            <h3 className="font-bold text-gray-800 mb-2">{t.settingsTheme}</h3>
            <div className="flex flex-wrap gap-2">
              {THEMES.map((th) => (
                <button
                  key={th.id}
                  data-testid={`settings-theme-${th.id}`}
                  onClick={() => pickTheme(th.id)}
                  className={`px-4 py-2 rounded-lg font-bold text-sm ${theme === th.id ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                >
                  {t[th.labelKey]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="font-bold text-gray-800 mb-2">{t.settingsFontSize}</h3>
            <div className="flex flex-wrap gap-2">
              {FONT_SCALES.map((fs) => (
                <button
                  key={fs.id}
                  data-testid={`settings-font-${fs.id}`}
                  onClick={() => pickScale(fs.id)}
                  className={`px-4 py-2 rounded-lg font-bold text-sm ${scale === fs.id ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                >
                  {t[fs.labelKey]}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Voice / sound confirmations */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              data-testid="settings-voice-toggle"
              type="checkbox"
              checked={voiceOn}
              onChange={(e) => toggleVoice(e.target.checked)}
              className="w-5 h-5 accent-emerald-600"
            />
            <span className="font-medium text-gray-800">{t.settingsVoiceConfirm}</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              data-testid="settings-sound-toggle"
              type="checkbox"
              checked={soundOn}
              onChange={(e) => toggleSound(e.target.checked)}
              className="w-5 h-5 accent-emerald-600"
            />
            <span className="font-medium text-gray-800">{t.settingsSoundConfirm}</span>
          </label>
        </section>

        {/* Sync status */}
        <section
          data-testid="settings-sync-status"
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-2"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-800">{t.settingsSyncStatus}</h3>
            <button
              data-testid="settings-sync-refresh"
              onClick={refreshSync}
              className="flex items-center gap-1 text-xs bg-gray-100 px-3 py-1.5 rounded-lg font-bold text-gray-700"
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <p className="text-sm text-gray-700">
            <span className={`font-bold ${syncOnline ? 'text-emerald-700' : 'text-amber-700'}`}>
              {syncOnline ? t.settingsSyncOnline : t.settingsSyncOffline}
            </span>
          </p>
          <p className="text-sm text-gray-600">
            {t.settingsSyncPending}: <strong>{syncPending}</strong> · {t.settingsSyncFailed}:{' '}
            <strong>{syncFailed}</strong>
          </p>
        </section>

        {/* Server address (native backend connection) */}
        <ServerAddressSection lang={lang} t={t} inputCls={inputCls} />

        {/* App permissions (native Android only — see services/permissions.ts).
            The web build keeps browser site settings + manual/text
            fallbacks, so this section is not rendered on the web. */}
        {isNativePlatform() && <PermissionsSection t={t} />}

        {/* Store-profile customisation (PUT /profile) */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-bold text-gray-800 mb-4">{t.settingsProfileCustom}</h3>
          {!profileLoaded ? (
            <p className="text-sm text-gray-400">Loading profile...</p>
          ) : !isOwner ? (
            <p className="text-sm text-gray-500">Only the store owner can edit the store profile.</p>
          ) : (
            <form onSubmit={handleProfileSave} className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full overflow-hidden border bg-gray-100 flex items-center justify-center relative group">
                  {profile.profilePicture ? (
                    <img src={profile.profilePicture} alt="Store" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-gray-400 text-xs">{t.settingsPhoto}</span>
                  )}
                  <label className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    <Camera size={20} className="text-white" />
                    <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                  </label>
                </div>
                <p className="text-xs text-gray-400">{t.settingsPhotoHint}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.storeName}</label>
                <input
                  data-testid="settings-store-name"
                  type="text"
                  className={inputCls}
                  value={profile.storeName || ''}
                  onChange={(e) => setProfile({ ...profile, storeName: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.storeAddress}</label>
                <input
                  data-testid="settings-store-address"
                  type="text"
                  className={inputCls}
                  value={profile.address || ''}
                  onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.settingsZila}</label>
                  <input
                    data-testid="settings-zila"
                    type="text"
                    className={inputCls}
                    value={profile.zila || ''}
                    onChange={(e) => setProfile({ ...profile, zila: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.settingsUpozila}</label>
                  <input
                    data-testid="settings-upozila"
                    type="text"
                    className={inputCls}
                    value={profile.upozila || ''}
                    onChange={(e) => setProfile({ ...profile, upozila: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.settingsThana}</label>
                  <input
                    data-testid="settings-thana"
                    type="text"
                    className={inputCls}
                    value={profile.thana || ''}
                    onChange={(e) => setProfile({ ...profile, thana: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.storePhone}</label>
                <input
                  data-testid="settings-store-phone"
                  type="text"
                  className={inputCls}
                  value={profile.phone || ''}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                />
              </div>
              {profileMessage && (
                <p className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg text-sm font-medium text-center">
                  {profileMessage}
                </p>
              )}
              {profileError && (
                <p role="alert" className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm font-medium text-center">
                  {profileError}
                </p>
              )}
              <button
                data-testid="settings-profile-save"
                type="submit"
                className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition flex items-center justify-center gap-2"
              >
                <Save size={20} /> {t.save}
              </button>
            </form>
          )}
        </section>

        {savedNote && (
          <p
            data-testid="settings-saved-note"
            className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg text-sm font-medium text-center"
          >
            {savedNote}
          </p>
        )}
      </div>
    </div>
  );
};

// App permissions (native Android only). Reports the checked state for
// camera and microphone (both have a check API); Bluetooth has no check
// API, so its row states the honest rule — its state is only known
// after a Bluetooth Print attempt — instead of inventing a status.
// This section never requests a permission itself: permissions are
// requested at the point of use (Scan / voice / Bluetooth Print), and
// this section only opens the system Settings page. Rendered only on
// native builds; the web build keeps browser site settings.
const PermissionsSection: React.FC<{ t: Translation }> = ({ t }) => {
  const [camera, setCamera] = useState('');
  const [mic, setMic] = useState('');
  const check = async () => {
    try {
      const { Camera } = await import('@capacitor/camera');
      const c = (await Camera.checkPermissions()).camera;
      setCamera(c === 'granted' || c === 'limited' ? t.permGranted : t.permNotGranted);
    } catch {
      setCamera(t.permNotGranted);
    }
    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
      const m = (await SpeechRecognition.checkPermissions()).speechRecognition;
      setMic(m === 'granted' ? t.permGranted : t.permNotGranted);
    } catch {
      setMic(t.permNotGranted);
    }
  };
  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section
      data-testid="settings-permissions"
      className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-2"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-800">{t.permTitle}</h3>
        <button
          data-testid="settings-permissions-refresh"
          onClick={() => {
            void check();
          }}
          className="text-xs bg-gray-100 px-3 py-1.5 rounded-lg font-bold text-gray-700"
        >
          Refresh
        </button>
      </div>
      <p className="text-sm text-gray-700" data-testid="settings-permission-camera">
        Camera: <strong>{camera || '…'}</strong> — {t.permRationaleCamera}
      </p>
      <p className="text-sm text-gray-700" data-testid="settings-permission-microphone">
        Microphone: <strong>{mic || '…'}</strong> — {t.permRationaleMicrophone}
      </p>
      <p className="text-sm text-gray-700" data-testid="settings-permission-bluetooth">
        Bluetooth: {t.permRationaleBluetooth}
      </p>
      <button
        data-testid="settings-permissions-open-settings"
        onClick={() => {
          void openAppSettings();
        }}
        className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold"
      >
        {t.permOpenSettings}
      </button>
    </section>
  );
};

export default SettingsScreen;

// Server address (native backend connection) — see services/api.ts
// for the resolution order. The override here wins over the build
// default (VITE_API_BASE_URL); clearing it returns to the default.
// On the web the current base is the relative '/api' (this server);
// inside the Android app a missing base is shown as an explicit
// warning, never hidden, because login cannot work without it.
const ServerAddressSection: React.FC<{ lang: Language; t: Translation; inputCls: string }> = ({ t, inputCls }) => {
  const [override, setOverride] = useState<string>(() => getApiOverride() ?? '');
  const [resolved, setResolved] = useState(() => getApiBase());
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [testNote, setTestNote] = useState('');
  const [testFailed, setTestFailed] = useState(false);
  const native = isNativePlatform();

  const refresh = () => setResolved(getApiBase());

  const handleSave = () => {
    setNote('');
    setNoteError('');
    const trimmed = override.trim();
    if (trimmed !== '' && !normalizeApiBase(trimmed)) {
      setNoteError(t.settingsSaveFailed);
      return;
    }
    setApiOverride(trimmed);
    refresh();
    setNote(t.settingsServerSaved);
  };

  const handleReset = () => {
    clearApiOverride();
    setOverride('');
    setNote('');
    setNoteError('');
    refresh();
    setNote(t.settingsServerSaved);
  };

  const handleTest = async () => {
    setTestNote('');
    setTestFailed(false);
    try {
      await api.get('/health');
      setTestNote(t.settingsServerReachable);
    } catch (err: any) {
      setTestFailed(true);
      setTestNote(err?.code === 'API_BASE_NOT_CONFIGURED' ? t.settingsServerMissing : t.settingsServerUnreachable);
    }
  };

  return (
    <section
      data-testid="settings-server-address"
      className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-3"
    >
      <h3 className="font-bold text-gray-800">{t.settingsServerTitle}</h3>
      <p className="text-sm text-gray-600">{t.settingsServerHint}</p>
      <p className="text-sm text-gray-700">
        {t.settingsServerCurrent}: <strong data-testid="settings-server-current">{resolved.base ?? '—'}</strong>
        {native && <span className="text-xs text-gray-500"> (app)</span>}
      </p>
      {resolved.error === 'NATIVE_API_BASE_MISSING' && (
        <p
          data-testid="settings-server-missing"
          role="alert"
          className="bg-amber-50 text-amber-800 px-4 py-2 rounded-lg text-sm font-medium"
        >
          {t.settingsServerMissing}
        </p>
      )}
      <input
        data-testid="settings-server-input"
        type="text"
        className={inputCls}
        value={override}
        onChange={(e) => setOverride(e.target.value)}
        placeholder={t.settingsServerPlaceholder}
      />
      {note && (
        <p className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg text-sm font-medium text-center">{note}</p>
      )}
      {noteError && (
        <p role="alert" className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm font-medium text-center">
          {noteError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          data-testid="settings-server-save"
          onClick={handleSave}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold text-sm"
        >
          {t.settingsServerSave}
        </button>
        <button
          data-testid="settings-server-reset"
          onClick={handleReset}
          className="px-4 py-2 rounded-lg bg-gray-100 font-bold text-sm"
        >
          {t.settingsServerReset}
        </button>
        <button
          data-testid="settings-server-test"
          onClick={() => void handleTest()}
          className="px-4 py-2 rounded-lg bg-gray-100 font-bold text-sm"
        >
          {t.settingsServerTest}
        </button>
      </div>
      {testNote && (
        <p
          data-testid="settings-server-test-result"
          className={`px-4 py-2 rounded-lg text-sm font-medium ${testFailed ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}
        >
          {testNote}
        </p>
      )}
    </section>
  );
};
