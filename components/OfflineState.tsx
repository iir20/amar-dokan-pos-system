// Phase 5 — intentional offline mode: a designed state, not a broken
// error screen. Shows what still works, the pending-sync count, and the
// one action that matters (review the outbox).
import React from 'react';
import { AdButton } from './ui';

interface Props {
  lang: 'en' | 'bn';
  pendingCount: number;
  onReviewOutbox: () => void;
}

const OfflineState: React.FC<Props> = ({ lang, pendingCount, onReviewOutbox }) => (
  <div
    data-testid="offline-state"
    role="status"
    className="px-4 py-3 bg-amber-50 border-b border-amber-200 text-amber-900 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between"
  >
    <div className="flex items-start gap-2">
      <span aria-hidden="true" className="text-lg leading-none mt-0.5">
        📶
      </span>
      <div>
        <p className="text-sm font-bold">
          {lang === 'bn' ? 'অফলাইন মোড — দোকান চলছে' : 'Offline mode — the shop keeps running'}
        </p>
        <p className="text-xs mt-0.5">
          {lang === 'bn'
            ? `বিক্রি ও মজুদ স্থানীয়ভাবে সংরক্ষিত হচ্ছে; ইন্টারনেট ফিরলে স্বয়ংক্রিয়ভাবে সিঙ্ক হবে। সিঙ্ক বাকি: ${pendingCount}টি`
            : `Sales and stock are saved locally and will sync automatically when you reconnect. Pending sync: ${pendingCount}`}
        </p>
      </div>
    </div>
    <AdButton
      variant="ghost"
      onClick={onReviewOutbox}
      className="!min-h-[40px] shrink-0"
      ariaLabel={lang === 'bn' ? 'আউটবক্স দেখুন' : 'Review outbox'}
    >
      {lang === 'bn' ? `আউটবক্স দেখুন (${pendingCount})` : `Review Outbox (${pendingCount})`}
    </AdButton>
  </div>
);

export default OfflineState;
