// Phase 3 — Full Bangla Voice POS panel.
//
// Every voice action has a visible text fallback: the spoken text is
// shown on screen, and the same actions exist as tappable buttons and a
// plain text input. With voice off or unsupported, the POS is fully
// usable — voice only adds convenience, never gates a sale.
//
// On-device Bangla recognition accuracy on a low-end Android phone is
// UNVERIFIED (no phone/microphone in this sandbox) — see docs/phase3.md.
import React, { useState } from 'react';
import { Language, CartItem } from '../types';
import { TRANSLATIONS } from '../constants';
import {
  isSpeechSynthesisSupported,
  isSpeechRecognitionSupported,
  speakItem,
  speakTotal,
  listenOnce,
  parseVoiceInput,
} from '../services/voice';

interface Props {
  lang: Language;
  cart: CartItem[];
  total: number;
  change: number;
  onVoiceAdd: (query: string, quantity: number) => void;
  onVoiceCheckout: () => void;
  onVoiceClear: () => void;
}

const VoicePos: React.FC<Props> = ({ lang, cart, total, change, onVoiceAdd, onVoiceCheckout, onVoiceClear }) => {
  const t = TRANSLATIONS[lang];
  const [lastSpoken, setLastSpoken] = useState('');
  const [listening, setListening] = useState(false);
  const [listenError, setListenError] = useState('');
  const [typedCommand, setTypedCommand] = useState('');

  const supported = isSpeechSynthesisSupported();
  const recognitionSupported = isSpeechRecognitionSupported();

  const applyCommand = (raw: string) => {
    const cmd = parseVoiceInput(raw);
    if (cmd.kind === 'add' && cmd.query) onVoiceAdd(cmd.query, cmd.quantity);
    else if (cmd.kind === 'total') {
      const { text } = speakTotal(total, change);
      setLastSpoken(text);
    } else if (cmd.kind === 'checkout') onVoiceCheckout();
    else if (cmd.kind === 'clear') onVoiceClear();
    else
      setListenError(
        lang === 'bn' ? 'বুঝতে পারিনি — আবার বলুন বা লিখুন।' : 'Could not understand — please speak again or type it.',
      );
  };

  return (
    <div data-testid="voice-pos" className="border-t bg-amber-50 p-3 space-y-2">
      <p className="text-sm font-bold text-gray-800">{t.voicePos}</p>
      {!supported && !recognitionSupported && <p className="text-xs text-gray-600">{t.voiceUnsupported}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          data-testid="voice-speak-total"
          className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-bold"
          onClick={() => {
            const { text } = speakTotal(total, change);
            setLastSpoken(text);
          }}
        >
          🔊 {t.speakTotal}
        </button>
        <button
          data-testid="voice-speak-cart"
          className="bg-white border px-3 py-2 rounded-lg text-sm font-bold"
          onClick={() => {
            if (cart.length === 0) {
              setLastSpoken(lang === 'bn' ? 'কার্ট খালি।' : 'Cart is empty.');
              return;
            }
            const first = cart[0];
            const { text } = speakItem(lang === 'bn' ? first.nameBn : first.name, first.price);
            setLastSpoken(text);
          }}
        >
          🔊 {lang === 'bn' ? 'পণ্যের নাম ও দাম শোনান' : 'Speak item names & prices'}
        </button>
        <button
          data-testid="voice-listen"
          disabled={!recognitionSupported || listening}
          className="bg-white border px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
          onClick={async () => {
            setListening(true);
            setListenError('');
            try {
              const cmd = await listenOnce(lang);
              if (cmd.kind === 'add' && cmd.query) onVoiceAdd(cmd.query, cmd.quantity);
              else if (cmd.kind === 'total') {
                const { text } = speakTotal(total, change);
                setLastSpoken(text);
              } else if (cmd.kind === 'checkout') onVoiceCheckout();
              else if (cmd.kind === 'clear') onVoiceClear();
              else setListenError(lang === 'bn' ? 'বুঝতে পারিনি।' : 'Could not understand.');
            } catch (e: any) {
              setListenError(
                e?.message === 'UNSUPPORTED'
                  ? t.voiceUnsupported
                  : lang === 'bn'
                    ? 'শুনতে পাইনি — লিখে দিন।'
                    : 'Could not hear you — please type it.',
              );
            } finally {
              setListening(false);
            }
          }}
        >
          🎤 {listening ? (lang === 'bn' ? 'শুনছি…' : 'Listening…') : t.voiceInput}
        </button>
      </div>
      {/* Text fallback for voice input — always visible and tappable. */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!typedCommand.trim()) return;
          applyCommand(typedCommand);
          setTypedCommand('');
        }}
      >
        <input
          data-testid="voice-text-input"
          value={typedCommand}
          onChange={(e) => setTypedCommand(e.target.value)}
          placeholder={lang === 'bn' ? 'যেমন: ২ টা চাল যোগ কর / মোট কত' : 'e.g. add 2 rice / total'}
          className="flex-1 border rounded px-2 py-2 text-sm bg-white"
        />
        <button
          data-testid="voice-text-submit"
          type="submit"
          className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-bold"
        >
          {lang === 'bn' ? 'চালান' : 'Run'}
        </button>
      </form>
      {listenError && (
        <p role="alert" className="text-xs text-red-700">
          {listenError}
        </p>
      )}
      {lastSpoken && (
        <p data-testid="voice-last-spoken" className="text-sm text-gray-800 bg-white border rounded p-2">
          🔊 {lastSpoken}
        </p>
      )}
      <p className="text-[11px] text-gray-500">
        {lang === 'bn'
          ? 'ভয়েস বন্ধ থাকলেও উপরের বোতাম ও লেখা ইনপুট দিয়ে POS সম্পূর্ণ ব্যবহার করা যায়।'
          : 'With voice off, the buttons and text input above keep the POS fully usable.'}
      </p>
    </div>
  );
};

export default VoicePos;
