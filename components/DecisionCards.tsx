// Phase 5 — dashboard decision cards. Each card shows a REAL number
// from a real API (forecast / expiry / sales profit / dues — the Phase 3
// insights, reused, never invented) and is ONE TAP from its action
// screen: tap -> the view that acts on it.
import React from 'react';
import { Language } from '../types';
import { TRANSLATIONS } from '../constants';
import { StorageService } from '../services/storage';
import { useApiData } from '../hooks/useApiData';
import { computeDecisionCards } from '../shared/phase5';
import { AdCard } from './ui';

export type AppView = 'dashboard' | 'pos' | 'inventory' | 'dueList' | 'phase3' | string;

const TITLES: Record<string, { en: string; bn: string }> = {
  'order-today': { en: 'Order this today', bn: 'আজই অর্ডার করুন' },
  'expiring-soon': { en: 'Expiring soon', bn: 'মেয়াদ শেষ হচ্ছে' },
  'top-profit': { en: 'Top profit makers', bn: 'সবচেয়ে লাভজনক' },
  'dues-to-collect': { en: 'Dues to collect', bn: 'বাকি আদায় করুন' },
};

const DecisionCards: React.FC<{ lang: Language; onNavigate: (view: AppView) => void }> = ({ lang, onNavigate }) => {
  const { data: forecastData } = useApiData(() => StorageService.getForecast(30, 7), []);
  const { data: expiryData } = useApiData(() => StorageService.getExpiryAlerts(), []);
  const { data: salesData } = useApiData(() => StorageService.getSales(), []);

  const forecastItems = (forecastData as any)?.items || [];
  const expiryAlerts = (expiryData as any)?.alerts || [];
  const sales = salesData || [];
  const cards = computeDecisionCards({ sales, forecastItems, expiryAlerts });
  const t = TRANSLATIONS[lang];

  return (
    <section aria-label={lang === 'bn' ? 'সিদ্ধান্ত কার্ড' : 'Decision cards'}>
      <h3 className="text-lg font-bold text-gray-800 mb-3">{lang === 'bn' ? 'আজকের সিদ্ধান্ত' : 'Decide today'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const title = TITLES[card.id][lang];
          return (
            <AdCard
              key={card.id}
              testid={`decision-${card.id}`}
              ariaLabel={`${title}: ${card.detail}. ${lang === 'bn' ? 'ট্যাপ করে অ্যাকশন স্ক্রিনে যান' : 'Tap to open the action screen'}`}
              onClick={() => onNavigate(card.targetView)}
              className="hover:shadow-md transition active:scale-[0.98]"
            >
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
              <p className="text-2xl font-bold text-gray-800 mt-1" data-testid={`decision-${card.id}-value`}>
                {card.id === 'top-profit' || card.id === 'dues-to-collect'
                  ? `৳${(card.value ?? 0).toLocaleString()}`
                  : (card.value ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1">{card.detail}</p>
              <p className="text-xs font-bold text-emerald-600 mt-2">
                {lang === 'bn' ? 'ট্যাপ করুন →' : 'Tap to act →'}{' '}
                {
                  t[
                    card.targetView === 'phase3'
                      ? 'depthPanel'
                      : card.targetView === 'inventory'
                        ? 'inventory'
                        : 'dueList'
                  ]
                }
              </p>
            </AdCard>
          );
        })}
      </div>
    </section>
  );
};

export default DecisionCards;
