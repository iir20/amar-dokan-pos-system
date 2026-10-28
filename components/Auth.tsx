

import React, { useState, useEffect } from 'react';
import { StorageService } from '../services/storage';
import { TRANSLATIONS, APP_LOGO } from '../constants';
import { Language, StoreCategory } from '../types';
import { Lock, Store, User as UserIcon, ShieldCheck, Tag, AlertOctagon, MapPin, ShoppingBag } from 'lucide-react';
import { useApiData } from '../hooks/useApiData';
import Loader from './Loader';

interface AuthProps {
  onLogin: () => void;
  lang: Language;
  setLang: (lang: Language) => void;
  onGoToMarketplace?: () => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin, lang, setLang, onGoToMarketplace }) => {
  const t = TRANSLATIONS[lang];
  const [isRegistering, setIsRegistering] = useState(false);
  const [checkingUser, setCheckingUser] = useState(true);

  // Retrieve Global Logo setting if available
  const { data: globalConfig } = useApiData(() => StorageService.getGlobalConfig(), []);
  const displayLogo = globalConfig?.logo || APP_LOGO;

  const [formData, setFormData] = useState({ 
      storeName: '', 
      username: '', 
      pin: '',
      storeCategory: 'grocery' as StoreCategory,
      zila: '',
      upozila: '',
      thana: ''
  });
  const [error, setError] = useState('');

  useEffect(() => {
    const checkUser = async () => {
        try {
            const user = await StorageService.getCurrentUser();
            if (!user) setIsRegistering(false);
        } catch {
            setError('Could not reach the POS server. Check your connection and try again.');
        } finally {
            setCheckingUser(false);
        }
    };
    checkUser();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isRegistering) {
      if (!formData.storeName || !formData.username || !formData.pin) {
        setError('All fields are required');
        return;
      }
      await StorageService.registerUser(formData);
      onLogin();
    } else {
      const result = await StorageService.loginUser(formData.username, formData.pin);
      if (result.success) {
        onLogin();
      } else {
        if (result.error === 'LOCKED') {
            setError('This account is temporarily locked. Wait 15 minutes before trying again.');
        } else if (result.error === 'AUTH_RATE_LIMITED') {
            setError('Too many attempts from this connection. Wait a little and try again.');
        } else if (result.error === 'CREDENTIAL_RESET_REQUIRED') {
            setError('This legacy administrator account must be explicitly reset before sign-in.');
        } else if (result.error === 'INVALID') {
            setError('Invalid username or PIN.');
        } else {
            setError(result.error || 'Could not sign in. Check your connection and try again.');
        }
      }
    }
  };

  if (checkingUser) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl animate-scale-in">
        <div className="text-center mb-8">
            <div className="relative inline-block group">
                <div className="absolute inset-0 bg-emerald-100 rounded-full blur-xl opacity-50 group-hover:opacity-75 transition-opacity"></div>
                <img src={displayLogo} alt="Logo" className="relative w-24 h-24 mx-auto mb-4 object-contain drop-shadow-md animate-slide-up" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 animate-fade-in">Amar Dokan POS</h1>
            <p className="text-gray-500 animate-fade-in [animation-delay:0.1s]">Store Management System</p>
        </div>

        <div className="flex justify-center gap-4 mb-6">
             <button onClick={() => setLang('en')} className={`px-3 py-1 text-xs rounded-full transition-all ${lang==='en' ? 'bg-gray-800 text-white shadow-md' : 'bg-gray-200 hover:bg-gray-300'}`}>English</button>
             <button onClick={() => setLang('bn')} className={`px-3 py-1 text-xs rounded-full transition-all ${lang==='bn' ? 'bg-gray-800 text-white shadow-md' : 'bg-gray-200 hover:bg-gray-300'}`}>বাংলা</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in [animation-delay:0.2s]">
          {isRegistering && (
            <>
                <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.storeName}</label>
                <div className="relative group">
                    <Store className="absolute left-3 top-2.5 text-gray-400 group-focus-within:text-emerald-500 transition-colors" size={18} />
                    <input
                    type="text"
                    className="w-full pl-10 p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                    value={formData.storeName}
                    onChange={e => setFormData({ ...formData, storeName: e.target.value })}
                    />
                </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.storeCategory}</label>
                    <div className="relative group">
                        <Tag className="absolute left-3 top-2.5 text-gray-400 group-focus-within:text-emerald-500 transition-colors" size={18} />
                        <select
                            className="w-full pl-10 p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white transition-shadow"
                            value={formData.storeCategory}
                            onChange={e => setFormData({ ...formData, storeCategory: e.target.value as StoreCategory })}
                        >
                            <option value="grocery">{t.catGrocery}</option>
                            <option value="medicine">{t.catMedicine}</option>
                            <option value="clothing">{t.catClothing}</option>
                            <option value="electronics">{t.catElectronics}</option>
                            <option value="restaurant">{t.catRestaurant}</option>
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Zila (District)</label>
                        <div className="relative group">
                            <MapPin className="absolute left-3 top-2.5 text-gray-400 group-focus-within:text-emerald-500 transition-colors" size={18} />
                            <input
                                type="text"
                                placeholder="e.g. Dhaka"
                                className="w-full pl-10 p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                                value={formData.zila}
                                onChange={e => setFormData({ ...formData, zila: e.target.value })}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Upozila</label>
                        <input
                            type="text"
                            placeholder="e.g. Savar"
                            className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                            value={formData.upozila}
                            onChange={e => setFormData({ ...formData, upozila: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Thana</label>
                        <input
                            type="text"
                            placeholder="e.g. Savar Model"
                            className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                            value={formData.thana}
                            onChange={e => setFormData({ ...formData, thana: e.target.value })}
                        />
                    </div>
                </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.username}</label>
            <div className="relative group">
              <UserIcon className="absolute left-3 top-2.5 text-gray-400 group-focus-within:text-emerald-500 transition-colors" size={18} />
              <input
                type="text"
                className="w-full pl-10 p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                value={formData.username}
                onChange={e => setFormData({ ...formData, username: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.pin}</label>
            <div className="relative group">
              <Lock className="absolute left-3 top-2.5 text-gray-400 group-focus-within:text-emerald-500 transition-colors" size={18} />
              <input
                type="password"
                maxLength={20}
                className="w-full pl-10 p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                value={formData.pin}
                onChange={e => setFormData({ ...formData, pin: e.target.value })}
              />
            </div>
          </div>

          {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg text-sm animate-pulse border border-red-100">
                  <AlertOctagon size={20} className="shrink-0" />
                  <span>{error}</span>
              </div>
          )}

          <button
            type="submit"
            className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-emerald-200"
          >
            {isRegistering ? t.register : t.login}
          </button>
        </form>

        <div className="mt-6 text-center space-y-4 animate-fade-in [animation-delay:0.3s]">
            {isRegistering ? (
                 <p className="text-sm text-gray-600">
                    Already have a store? <button onClick={() => setIsRegistering(false)} className="text-emerald-600 font-bold hover:underline">{t.login}</button>
                 </p>
            ) : (
                <p className="text-sm text-gray-600">
                    New user? <button onClick={() => setIsRegistering(true)} className="text-emerald-600 font-bold hover:underline">{t.register}</button>
                 </p>
            )}

            {onGoToMarketplace && (
                <button
                    onClick={onGoToMarketplace}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-emerald-200 text-emerald-700 font-semibold hover:bg-emerald-50 transition"
                >
                    <ShoppingBag size={18} />
                    <span>Shop as a Customer</span>
                </button>
            )}

            <div className="pt-4 border-t border-gray-100">
                <p className="text-[10px] text-gray-400 flex items-center justify-center gap-1">
                    <ShieldCheck size={12} />
                    <span>Store owner &amp; staff login</span>
                </p>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
