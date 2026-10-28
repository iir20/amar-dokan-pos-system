
import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { Language } from '../types';

interface InstallPromptProps {
  lang: Language;
}

const InstallPrompt: React.FC<InstallPromptProps> = ({ lang }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
      // Show our customized install prompt
      setShow(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // If app is already installed, don't show
    if (window.matchMedia('(display-mode: standalone)').matches) {
        setShow(false);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
    } else {
      console.log('User dismissed the install prompt');
    }
    
    setDeferredPrompt(null);
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 animate-bounce-slight">
      <div className="bg-emerald-900 text-white p-4 rounded-xl shadow-2xl border border-emerald-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg">
                <Download size={24} />
            </div>
            <div>
                <p className="font-bold text-sm">
                    {lang === 'bn' ? 'অ্যাপ হিসেবে ইনস্টল করুন' : 'Install App'}
                </p>
                <p className="text-xs text-emerald-200">
                    {lang === 'bn' ? 'দ্রুত প্রবেশের জন্য ইনস্টল করুন' : 'Install for quick access'}
                </p>
            </div>
        </div>
        <div className="flex items-center gap-2">
            <button 
                onClick={handleInstallClick}
                className="bg-white text-emerald-900 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-emerald-50 transition"
            >
                {lang === 'bn' ? 'ইনস্টল' : 'Install'}
            </button>
            <button onClick={() => setShow(false)} className="text-emerald-400 hover:text-white p-1">
                <X size={18} />
            </button>
        </div>
      </div>
    </div>
  );
};

export default InstallPrompt;
