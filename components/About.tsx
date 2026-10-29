// ADDITIONAL SCOPE — About screen, reachable from the main menu.
// Every string comes from TRANSLATIONS (both locales) so the screen is
// fully Bangla + English; no hard-coded user-facing copy lives here.
// The tour follows the real menu order (POS, Inventory, Dashboard,
// Online Orders, Settings/Profile) and the specifications section states
// the online/data behaviour honestly: product adds need a connection
// and are never queued silently offline (see services/api.ts).
import React from 'react';
import { Language } from '../types';
import { TRANSLATIONS } from '../constants';

interface Props {
  lang: Language;
}

const About: React.FC<Props> = ({ lang }) => {
  const t = TRANSLATIONS[lang];
  const tour = [
    { title: t.aboutTourPosTitle, body: t.aboutTourPosDesc },
    { title: t.aboutTourInventoryTitle, body: t.aboutTourInventoryDesc },
    { title: t.aboutTourDashboardTitle, body: t.aboutTourDashboardDesc },
    { title: t.aboutTourOrdersTitle, body: t.aboutTourOrdersDesc },
    { title: t.aboutTourSettingsTitle, body: t.aboutTourSettingsDesc },
  ];
  return (
    <div data-testid="about-screen" className="p-4 md:p-6 pb-24 h-full flex flex-col overflow-auto">
      <h2 className="text-2xl font-bold text-gray-800">{t.aboutTitle}</h2>

      <section className="mt-6 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-lg font-bold text-gray-800">{t.aboutWhatTitle}</h3>
        <p className="text-sm text-gray-700 mt-2 leading-relaxed">{t.aboutWhatBody}</p>
      </section>

      <section className="mt-4 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-lg font-bold text-gray-800">{t.aboutTourTitle}</h3>
        <p className="text-sm text-gray-600 mt-2">{t.aboutTourIntro}</p>
        <ol className="mt-4 space-y-4">
          {tour.map((step) => (
            <li key={step.title} className="border-l-4 border-emerald-500 pl-3">
              <p className="text-sm font-bold text-gray-800">{step.title}</p>
              <p className="text-sm text-gray-700 mt-1 leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-4 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-lg font-bold text-gray-800">{t.aboutSpecTitle}</h3>
        <p className="text-sm text-gray-500 mt-2">{t.aboutVersion}</p>
        <h4 className="text-sm font-bold text-gray-800 mt-4">{t.aboutFeaturesTitle}</h4>
        <p className="text-sm text-gray-700 mt-1 leading-relaxed">{t.aboutFeaturesBody}</p>
        <h4 className="text-sm font-bold text-gray-800 mt-4">{t.aboutRequirementsTitle}</h4>
        <p className="text-sm text-gray-700 mt-1 leading-relaxed">{t.aboutRequirementsBody}</p>
        <h4 className="text-sm font-bold text-gray-800 mt-4">{t.aboutSyncTitle}</h4>
        <p className="text-sm text-gray-700 mt-1 leading-relaxed">{t.aboutSyncBody}</p>
        <h4 className="text-sm font-bold text-gray-800 mt-4">{t.aboutSupportTitle}</h4>
        <p className="text-sm text-gray-700 mt-1 leading-relaxed">{t.aboutSupportBody}</p>
      </section>
    </div>
  );
};

export default About;
