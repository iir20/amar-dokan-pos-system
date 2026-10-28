// Phase 6 — Bangla voice for INVENTORY (the Phase 3 voice system was
// POS-only). Same hard rule as VoicePos: every voice action has a
// visible text fallback (typed command input + tappable buttons) and
// voice never gates an inventory action — the search box, the add form
// and the stock controls work fully with voice off or unsupported.
//
// Commands (Bangla or English): search ("চাল খুঁজুন"), add
// ("চাল যোগ কর"), stock ("চালের স্টক ২০ কর"). A spoken barcode is a
// search. The parent owns the actual mutations; this panel only parses
// and dispatches, then speaks/shows the Bangla confirmation it is given
// back via `lastResult`.
import React, { useState } from 'react';
import { Language, Product } from '../types';
import { isSpeechSynthesisSupported, isSpeechRecognitionSupported, speakBangla, listenOnce } from '../services/voice';
import { parseInventoryVoiceCommand, inventoryConfirmText } from '../shared/phase6';

interface Props {
  lang: Language;
  products: Product[];
  onSearch: (query: string) => void;
  onRequestAdd: (name: string) => void;
  onSetStock: (product: Product, stock: number) => Promise<void>;
}

const VoiceInventory: React.FC<Props> = ({ lang, products, onSearch, onRequestAdd, onSetStock }) => {
  const [typedCommand, setTypedCommand] = useState('');
  const [listening, setListening] = useState(false);
  const [listenError, setListenError] = useState('');
  const [lastSpoken, setLastSpoken] = useState('');

  const supported = isSpeechSynthesisSupported();
  const recognitionSupported = isSpeechRecognitionSupported();

  const say = (text: string) => {
    setLastSpoken(text);
    speakBangla(text);
  };

  const applyCommandText = async (raw: string) => {
    const cmd = parseInventoryVoiceCommand(raw);
    if (cmd.kind === 'search' && cmd.query) {
      onSearch(cmd.query);
      say(lang === 'bn' ? `খুঁজছি: ${cmd.query}` : `Searching: ${cmd.query}`);
      return;
    }
    if (cmd.kind === 'add') {
      onRequestAdd(cmd.query);
      say(inventoryConfirmText('added', cmd.query || (lang === 'bn' ? 'পণ্য' : 'product')));
      return;
    }
    if (cmd.kind === 'stock' && cmd.query) {
      const needle = cmd.query.toLocaleLowerCase();
      // Two-way includes: "চালের" (possessive suffix) must still find
      // the product "চাল", and vice versa.
      const matches = (name: string) => {
        const lower = (name || '').toLocaleLowerCase();
        return lower === needle || lower.includes(needle) || needle.includes(lower);
      };
      const match =
        products.find((p) => p.barcode === cmd.query) || products.find((p) => matches(p.name) || matches(p.nameBn));
      if (!match) {
        setListenError(lang === 'bn' ? `পণ্য পাওয়া যায়নি: ${cmd.query}` : `Product not found: ${cmd.query}`);
        return;
      }
      await onSetStock(match, cmd.quantity);
      say(inventoryConfirmText('stock', lang === 'bn' ? match.nameBn || match.name : match.name, cmd.quantity));
      return;
    }
    setListenError(
      lang === 'bn' ? 'বুঝতে পারিনি — আবার বলুন বা লিখুন।' : 'Could not understand — please speak again or type it.',
    );
  };

  return (
    <div data-testid="voice-inventory" className="border rounded-lg bg-amber-50 p-3 space-y-2">
      <p className="text-sm font-bold text-gray-800">
        {lang === 'bn' ? '🎤 ইনভেন্টরি ভয়েস (বাংলা)' : '🎤 Inventory voice (Bangla)'}
      </p>
      {!supported && !recognitionSupported && (
        <p className="text-xs text-gray-600">
          {lang === 'bn'
            ? 'এই ডিভাইসে ভয়েস সাপোর্ট নেই — নিচের লেখা ইনপুট দিয়ে একই কাজ করা যাবে।'
            : 'Voice is not supported on this device — the text input below does the same job.'}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          data-testid="voice-inventory-listen"
          disabled={!recognitionSupported || listening}
          className="bg-white border px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
          onClick={async () => {
            setListening(true);
            setListenError('');
            try {
              const cmd = await listenOnce(lang);
              // Reuse the same text pipeline: rebuild a command string
              // from the parsed result so voice and typed input behave
              // identically.
              if (cmd.kind === 'add' && cmd.query) await applyCommandText(`${cmd.query} যোগ কর`);
              else if (cmd.kind === 'total')
                setListenError(
                  lang === 'bn' ? 'ইনভেন্টরিতে মোট দেখা যায় না।' : 'Totals are not an inventory command.',
                );
              else if (cmd.query) await applyCommandText(cmd.query);
              else setListenError(lang === 'bn' ? 'বুঝতে পারিনি।' : 'Could not understand.');
            } catch {
              setListenError(lang === 'bn' ? 'শুনতে পাইনি — লিখে দিন।' : 'Could not hear you — please type it.');
            } finally {
              setListening(false);
            }
          }}
        >
          🎤 {listening ? (lang === 'bn' ? 'শুনছি…' : 'Listening…') : lang === 'bn' ? 'বলে খুঁজুন' : 'Speak a command'}
        </button>
      </div>
      {/* Text fallback — always visible, always works. */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!typedCommand.trim()) return;
          void applyCommandText(typedCommand);
          setTypedCommand('');
        }}
      >
        <input
          data-testid="voice-inventory-text-input"
          value={typedCommand}
          onChange={(e) => setTypedCommand(e.target.value)}
          placeholder={
            lang === 'bn'
              ? 'যেমন: চাল খুঁজুন / চাল যোগ কর / চালের স্টক ২০ কর'
              : 'e.g. search rice / add rice / stock rice 20'
          }
          className="flex-1 border rounded px-2 py-2 text-sm bg-white"
        />
        <button
          data-testid="voice-inventory-text-submit"
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
        <p data-testid="voice-inventory-last-spoken" className="text-sm text-gray-800 bg-white border rounded p-2">
          🔊 {lastSpoken}
        </p>
      )}
      <p className="text-[11px] text-gray-500">
        {lang === 'bn'
          ? 'ভয়েস বন্ধ থাকলেও সার্চ বক্স, যোগ করুন ফর্ম ও স্টক বোতাম দিয়ে ইনভেন্টরি সম্পূর্ণ ব্যবহার করা যায়।'
          : 'With voice off, the search box, add form and stock controls keep inventory fully usable.'}
      </p>
    </div>
  );
};

export default VoiceInventory;
