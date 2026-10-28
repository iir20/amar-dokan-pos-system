
import React, { useState, useEffect } from 'react';
import { Crown, Check, X, Loader2, CreditCard, Smartphone } from 'lucide-react';
import { StorageService } from '../services/storage';
import { Language, SubscriptionPackage, SubscriptionRequest, GlobalPricingConfig, CategoryPricing } from '../types';
import { TRANSLATIONS, LIMITS, DEFAULT_GLOBAL_PRICING } from '../constants';

interface SubscriptionModalProps {
  lang: Language;
  onClose: () => void;
  onSuccess: () => void;
}

const SubscriptionModal: React.FC<SubscriptionModalProps> = ({ lang, onClose, onSuccess }) => {
  const t = TRANSLATIONS[lang];
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedPackage, setSelectedPackage] = useState<SubscriptionPackage>('monthly');
  const [paymentNumber, setPaymentNumber] = useState('');
  const [trxId, setTrxId] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Dynamic Config State
  const [adminNumbers, setAdminNumbers] = useState({ bkash: 'Loading...', nagad: 'Loading...' });
  const [categoryPricing, setCategoryPricing] = useState<CategoryPricing>(DEFAULT_GLOBAL_PRICING.grocery);
  const [userCategory, setUserCategory] = useState<string>('grocery');

  useEffect(() => {
      // Fetch dynamic settings and user info when modal opens
      const init = async () => {
          const user = await StorageService.getCurrentUser();
          const settings = await StorageService.getPaymentSettings();
          const globalConfig = await StorageService.getPricingConfig();

          if (user) {
              setUserCategory(user.storeCategory);
              // Fallback to grocery if category config is missing for some reason
              const specificPricing = globalConfig[user.storeCategory] || globalConfig['grocery'];
              setCategoryPricing(specificPricing);
          }

          setAdminNumbers({
              bkash: settings.bkash,
              nagad: settings.nagad
          });
      };
      init();
  }, []);

  const handlePackageSelect = (pkg: SubscriptionPackage) => {
      setSelectedPackage(pkg);
      setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
        const user = await StorageService.getCurrentUser();
        if (!user) return;

        const request: SubscriptionRequest = {
            id: Date.now().toString(),
            userId: user.id, // Store Owner ID
            username: user.username,
            storeName: user.storeName,
            storeCategory: user.storeCategory,
            ownerName: user.username, 
            package: selectedPackage,
            amount: categoryPricing[selectedPackage].price, // Use dynamic price based on category
            paymentNumber,
            trxId,
            status: 'pending',
            date: new Date().toISOString()
        };

        await StorageService.createSubscriptionRequest(request);
        
        setLoading(false);
        onSuccess(); // Triggers app user reload
        onClose();
        alert(t.pendingApproval);
    } catch (err) {
        console.error(err);
        setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl transform transition-all flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-emerald-600 p-6 text-center text-white relative shrink-0">
            <button onClick={onClose} className="absolute top-4 right-4 text-emerald-200 hover:text-white">
                <X size={24} />
            </button>
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 backdrop-blur-sm">
                <Crown size={24} className="text-yellow-300 fill-yellow-300" />
            </div>
            <h2 className="text-xl font-bold">{t.upgradeToPremium}</h2>
            <p className="text-emerald-100 mt-1 text-sm capitalize">{userCategory} Store Plan</p>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
            {step === 1 ? (
                // Step 1: Select Package
                <div className="space-y-4">
                    <h3 className="font-bold text-gray-800 text-center mb-4">Choose your plan</h3>
                    
                    <button 
                        onClick={() => handlePackageSelect('monthly')}
                        className="w-full border-2 border-emerald-100 hover:border-emerald-500 rounded-xl p-4 flex justify-between items-center transition bg-emerald-50/50"
                    >
                        <div className="text-left">
                            <p className="font-bold text-gray-800">{lang === 'bn' ? categoryPricing.monthly.labelBn : categoryPricing.monthly.label}</p>
                            <p className="text-xs text-gray-500">Full access for {categoryPricing.monthly.durationDays} days</p>
                        </div>
                        <div className="text-xl font-bold text-emerald-600">৳{categoryPricing.monthly.price}</div>
                    </button>

                    <button 
                        onClick={() => handlePackageSelect('yearly')}
                        className="w-full border-2 border-emerald-500 bg-emerald-50 rounded-xl p-4 flex justify-between items-center transition relative overflow-hidden"
                    >
                         <div className="absolute top-0 right-0 bg-yellow-400 text-[10px] font-bold px-2 py-0.5 rounded-bl-lg">POPULAR</div>
                        <div className="text-left">
                            <p className="font-bold text-gray-800">{lang === 'bn' ? categoryPricing.yearly.labelBn : categoryPricing.yearly.label}</p>
                            <p className="text-xs text-gray-500">Full access for {categoryPricing.yearly.durationDays} days</p>
                        </div>
                        <div className="text-xl font-bold text-emerald-600">৳{categoryPricing.yearly.price}</div>
                    </button>

                    <button 
                        onClick={() => handlePackageSelect('2yearly')}
                        className="w-full border-2 border-emerald-100 hover:border-emerald-500 rounded-xl p-4 flex justify-between items-center transition bg-emerald-50/50"
                    >
                        <div className="text-left">
                            <p className="font-bold text-gray-800">{lang === 'bn' ? categoryPricing['2yearly'].labelBn : categoryPricing['2yearly'].label}</p>
                            <p className="text-xs text-gray-500">Best value</p>
                        </div>
                        <div className="text-xl font-bold text-emerald-600">৳{categoryPricing['2yearly'].price}</div>
                    </button>

                    <div className="mt-6 space-y-2">
                        <h4 className="font-semibold text-sm text-gray-600 mb-2">{t.planFeatures}:</h4>
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                             <Check size={16} className="text-emerald-500" /> {t.unlimited} {t.inventory}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                             <Check size={16} className="text-emerald-500" /> {t.unlimited} {t.totalSales}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                             <Check size={16} className="text-emerald-500" /> {t.downloadReport}
                        </div>
                    </div>
                </div>
            ) : (
                // Step 2: Payment Form
                <form onSubmit={handleSubmit} className="space-y-4">
                     <button type="button" onClick={() => setStep(1)} className="text-xs text-gray-500 hover:text-emerald-600 mb-2 underline">← Back to plans</button>
                     
                     <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-4">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-medium text-gray-600">Selected Plan:</span>
                            <span className="font-bold text-emerald-700">{lang==='bn' ? categoryPricing[selectedPackage].labelBn : categoryPricing[selectedPackage].label}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-gray-600">Amount to Pay:</span>
                            <span className="text-xl font-bold text-emerald-700">৳{categoryPricing[selectedPackage].price}</span>
                        </div>
                     </div>

                     <div className="space-y-3 mb-6">
                        <p className="text-sm text-gray-600 font-medium">Send money to any number below:</p>
                        <div className="flex gap-2 text-xs font-mono bg-emerald-50 p-2 rounded border border-emerald-100">
                            <span className="font-bold text-pink-600 w-16 inline-block">Bkash:</span> 
                            <span className="text-gray-800">{adminNumbers.bkash}</span>
                        </div>
                        <div className="flex gap-2 text-xs font-mono bg-emerald-50 p-2 rounded border border-emerald-100">
                            <span className="font-bold text-orange-600 w-16 inline-block">Nagad:</span> 
                            <span className="text-gray-800">{adminNumbers.nagad}</span>
                        </div>
                     </div>

                     <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Sent Money Number (আপনার নাম্বার)</label>
                        <div className="relative">
                            <Smartphone className="absolute left-3 top-2.5 text-gray-400" size={18} />
                            <input 
                                type="tel" required
                                className="w-full pl-10 p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                                placeholder="01XXXXXXXXX"
                                value={paymentNumber}
                                onChange={e => setPaymentNumber(e.target.value)}
                            />
                        </div>
                     </div>

                     <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Transaction ID (TrxID)</label>
                        <div className="relative">
                            <CreditCard className="absolute left-3 top-2.5 text-gray-400" size={18} />
                            <input 
                                type="text" required
                                className="w-full pl-10 p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none uppercase"
                                placeholder="e.g. 9H7J6K..."
                                value={trxId}
                                onChange={e => setTrxId(e.target.value)}
                            />
                        </div>
                     </div>

                     <button 
                        type="submit"
                        disabled={loading}
                        className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg shadow-emerald-200 flex items-center justify-center gap-2 mt-4"
                    >
                        {loading ? <Loader2 className="animate-spin" /> : <Check size={20} />}
                        {t.submitRequest}
                    </button>
                </form>
            )}
        </div>
      </div>
    </div>
  );
};

export default SubscriptionModal;
