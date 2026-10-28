
import React, { useState, useEffect } from 'react';
import { Language, User, Staff, Permission } from '../types';
import { TRANSLATIONS, APP_LOGO } from '../constants';
import { StorageService } from '../services/storage';
import { Store, MapPin, Phone, Lock, User as UserIcon, Save, Crown, Calendar, Clock, AlertCircle, CheckCircle2, Percent, Users, Plus, Trash2, Shield, UserCog, Edit, X, Camera } from 'lucide-react';
import SubscriptionModal from './SubscriptionModal';

interface ProfileProps {
  lang: Language;
  isOwner: boolean;
}

const Profile: React.FC<ProfileProps> = ({ lang, isOwner }) => {
  const t = TRANSLATIONS[lang];
  const [user, setUser] = useState<User | null>(null);
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [formData, setFormData] = useState<Partial<User>>({});
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [showUpsell, setShowUpsell] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  
  // Staff State
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [newStaff, setNewStaff] = useState({ name: '', username: '', pin: '', permissions: [] as Permission[] });

  useEffect(() => {
    loadAll();
  }, [isOwner]);

  const loadAll = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      await fetchUser();
      if (isOwner) {
        await fetchStaff();
      } else {
        await fetchCurrentStaff();
      }
    } catch (e: any) {
      setLoadError(e?.body?.error === 'UNAUTHORIZED'
        ? 'Your session has expired. Please log out and log in again.'
        : 'Could not load your profile. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUser = async () => {
      const currentUser = await StorageService.getCurrentUser();
      if (currentUser) {
          setUser(currentUser);
          if (isOwner) {
              // SECURITY FIX: Do not display the hashed PIN.
              setFormData({ ...currentUser, pin: '' });
          }
      }
  };

  const fetchCurrentStaff = async () => {
      const staff = await StorageService.getCurrentStaff();
      setCurrentStaff(staff);
  };

  const fetchStaff = async () => {
      try {
        const staff = await StorageService.getStaff();
        setStaffList(staff);
      } catch (e) {
        // Non-fatal: staff list failing shouldn't block the rest of the profile page.
        setStaffList([]);
      }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return; 
    setSaveError('');
    
    if (formData) {
      const payload = { ...formData };
      if (!payload.pin || payload.pin.trim() === '') {
          delete payload.pin;
      }

      try {
        const updated = await StorageService.updateUser(payload);
        if (!updated) throw new Error('Profile update did not return a saved profile.');
        setUser(updated);
        setFormData({ ...updated, pin: '' });
        setMessage(t.profileUpdated);
        setTimeout(() => setMessage(''), 3000);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Could not save your profile. Please try again.');
      }
    }
  };

  const handleProfilePicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          if (file.size > 500000) { // 500KB Limit
              alert("Image too large. Please use an image under 500KB.");
              return;
          }
          const reader = new FileReader();
          reader.onloadend = () => {
              // Create an image element to resize it (Simple Canvas approach)
              const img = new Image();
              img.src = reader.result as string;
              img.onload = () => {
                  const canvas = document.createElement('canvas');
                  const ctx = canvas.getContext('2d');
                  // Max size 300x300
                  const maxSize = 300;
                  let width = img.width;
                  let height = img.height;
                  
                  if (width > height) {
                      if (width > maxSize) {
                          height *= maxSize / width;
                          width = maxSize;
                      }
                  } else {
                      if (height > maxSize) {
                          width *= maxSize / height;
                          height = maxSize;
                      }
                  }
                  canvas.width = width;
                  canvas.height = height;
                  ctx?.drawImage(img, 0, 0, width, height);
                  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                  setFormData({ ...formData, profilePicture: dataUrl });
              };
          };
          reader.readAsDataURL(file);
      }
  };

  // ... (Existing Staff Logic remains same) ...
  const handleSaveStaff = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!isOwner) return;
      if (!newStaff.name || !newStaff.username || !newStaff.pin) return;
      
      if (editingStaffId) {
          await StorageService.updateStaff(editingStaffId, newStaff);
      } else {
          await StorageService.addStaff(newStaff);
      }
      
      setIsStaffModalOpen(false);
      setNewStaff({ name: '', username: '', pin: '', permissions: [] });
      setEditingStaffId(null);
      fetchStaff();
  };

  const openEditStaff = (staff: Staff) => {
      setNewStaff({
          name: staff.name,
          username: staff.username,
           pin: '',
          permissions: staff.permissions
      });
      setEditingStaffId(staff.id);
      setIsStaffModalOpen(true);
  };

  const openAddStaff = () => {
      setNewStaff({ name: '', username: '', pin: '', permissions: [] });
      setEditingStaffId(null);
      setIsStaffModalOpen(true);
  };

  const deleteStaff = async (id: string) => {
      if (!isOwner) return;
      if(window.confirm('Delete this staff member?')) {
          await StorageService.deleteStaff(id);
          fetchStaff();
      }
  };

  const togglePermission = (perm: Permission) => {
      setNewStaff(prev => {
          if (prev.permissions.includes(perm)) {
              return { ...prev, permissions: prev.permissions.filter(p => p !== perm) };
          }
          return { ...prev, permissions: [...prev.permissions, perm] };
      });
  };

  const getDaysLeft = (expiryDateString?: string) => {
      if (!expiryDateString) return 0;
      const expiry = new Date(expiryDateString);
      const now = new Date();
      if (expiry < now) return 0;
      const diffTime = Math.abs(expiry.getTime() - now.getTime());
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
  };

  if (isLoading) {
    return (
      <div className="p-6 h-full flex flex-col items-center justify-center gap-3 text-gray-400">
        <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">Loading profile...</p>
      </div>
    );
  }

  if (loadError || !user) {
    return (
      <div className="p-6 h-full flex flex-col items-center justify-center gap-4 text-center">
        <AlertCircle size={40} className="text-red-400" />
        <div>
          <p className="text-gray-700 font-medium">{loadError || 'Could not load your profile.'}</p>
          <p className="text-gray-400 text-sm mt-1">You can still log out from the sidebar.</p>
        </div>
        <button
          onClick={loadAll}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition"
        >
          Try Again
        </button>
      </div>
    );
  }

  const daysLeft = getDaysLeft(user.subscriptionExpiry);
  const isPremium = user.plan === 'premium';
  const isExpired = isPremium && daysLeft === 0;

  // --- STAFF VIEW (READ ONLY) ---
  if (!isOwner && currentStaff) {
      // (Existing Staff View Code - Shortened for brevity, keep original)
      return (
          <div className="p-6 h-full flex flex-col items-center overflow-y-auto">
             <h2 className="text-2xl font-bold text-gray-800 mb-6">{t.profile}</h2>
             <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6 text-center">
                 <UserIcon size={40} className="mx-auto text-emerald-600" />
                 <h3 className="text-xl font-bold mt-2">{currentStaff.name}</h3>
                 <p className="text-sm text-gray-500">Staff Account</p>
             </div>
          </div>
      );
  }

  // --- OWNER VIEW (FULL ACCESS) ---
  return (
    <div className="p-4 md:p-6 h-full flex flex-col items-center overflow-y-auto">
      {showUpsell && (
        <SubscriptionModal 
            lang={lang} 
            onClose={() => setShowUpsell(false)} 
            onSuccess={fetchUser} 
        />
      )}

      <div className="w-full max-w-2xl space-y-6">
        <h2 className="text-2xl font-bold text-gray-800">{t.profile}</h2>
        
        {/* --- SUBSCRIPTION STATUS CARD --- */}
        <div className={`rounded-xl shadow-md border overflow-hidden relative ${
            isPremium && !isExpired
              ? 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white border-emerald-500' 
              : 'bg-white border-gray-200'
        }`}>
            {/* ... Existing Subscription Card Code ... */}
             <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${isPremium && !isExpired ? 'text-emerald-200' : 'text-gray-500'}`}>
                            {t.currentPlan}
                        </p>
                        <div className="flex items-center gap-2">
                            {isPremium ? (
                                <Crown size={28} className={isPremium && !isExpired ? 'text-yellow-300 fill-yellow-300' : 'text-gray-400'} />
                            ) : (
                                <Store size={28} className="text-gray-400" />
                            )}
                            <h3 className={`text-2xl font-bold ${isPremium && !isExpired ? 'text-white' : 'text-gray-800'}`}>
                                {isPremium ? t.premium : t.freePlan}
                            </h3>
                        </div>
                    </div>
                    <button onClick={() => setShowUpsell(true)} className={`px-4 py-2 rounded-lg font-bold text-sm ${isPremium && !isExpired ? 'bg-white text-emerald-700' : 'bg-emerald-600 text-white'}`}>{isPremium ? t.renewPlan : t.upgradeToPremium}</button>
                </div>
            </div>
        </div>

        {/* --- STAFF MANAGEMENT SECTION --- */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <Users size={20} className="text-emerald-600" />
                    {t.staffManagement}
                </h3>
                <button onClick={openAddStaff} className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg font-bold hover:bg-emerald-100">
                    <Plus size={14} /> {t.addStaff}
                </button>
            </div>
            {staffList.length === 0 ? <div className="text-center py-6 text-gray-400 text-sm">No staff members.</div> : (
                <div className="space-y-3">
                    {staffList.map(staff => (
                        <div key={staff.id} className="flex justify-between items-center p-3 border rounded-lg hover:bg-gray-50">
                            <div><p className="font-bold text-gray-800 text-sm">{staff.name}</p><p className="text-xs text-gray-500">@{staff.username}</p></div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => openEditStaff(staff)} className="text-gray-400 hover:text-blue-500 p-2"><Edit size={16} /></button>
                                <button onClick={() => deleteStaff(staff.id)} className="text-gray-400 hover:text-red-500 p-2"><Trash2 size={16} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* --- EDIT PROFILE FORM --- */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
            <div className="flex flex-col items-center mb-8 relative">
                <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-emerald-50 shadow-inner relative group">
                    {formData.profilePicture ? (
                        <img src={formData.profilePicture} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-300">
                            <UserIcon size={40} />
                        </div>
                    )}
                    <label className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                        <Camera size={24} className="text-white" />
                        <input type="file" accept="image/*" className="hidden" onChange={handleProfilePicUpload} />
                    </label>
                </div>
                <p className="text-xs text-gray-400 mt-2">Tap to change profile picture</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* ... Existing Inputs (StoreName, Username, etc) ... */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t.storeName}</label>
                        <div className="relative">
                            <Store className="absolute left-3 top-2.5 text-gray-400" size={18} />
                            <input type="text" className="w-full pl-10 p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" value={formData.storeName || ''} onChange={e => setFormData({...formData, storeName: e.target.value})} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t.username}</label>
                        <div className="relative">
                            <UserIcon className="absolute left-3 top-2.5 text-gray-400" size={18} />
                            <input type="text" className="w-full pl-10 p-2 border rounded-lg bg-gray-50 text-gray-500" value={formData.username || ''} disabled />
                        </div>
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t.storeAddress}</label>
                        <div className="relative">
                            <MapPin className="absolute left-3 top-2.5 text-gray-400" size={18} />
                            <input type="text" className="w-full pl-10 p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" value={formData.address || ''} onChange={e => setFormData({...formData, address: e.target.value})} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t.storePhone}</label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-2.5 text-gray-400" size={18} />
                            <input type="text" className="w-full pl-10 p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" value={formData.phone || ''} onChange={e => setFormData({...formData, phone: e.target.value})} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t.vatRate}</label>
                        <div className="relative">
                            <Percent className="absolute left-3 top-2.5 text-gray-400" size={18} />
                            <input type="number" min="0" max="100" className="w-full pl-10 p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" value={formData.defaultVatRate || ''} onChange={e => setFormData({...formData, defaultVatRate: Number(e.target.value)})} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t.pin}</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-2.5 text-gray-400" size={18} />
                            <input type="text" maxLength={20} placeholder="Enter new PIN to update" className="w-full pl-10 p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none placeholder:text-gray-300" value={formData.pin || ''} onChange={e => setFormData({...formData, pin: e.target.value})} />
                        </div>
                    </div>
                </div>

                {message && (
                    <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg text-sm font-medium text-center">
                        {message}
                    </div>
                )}
                {saveError && (
                    <div role="alert" className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm font-medium text-center">
                        {saveError}
                    </div>
                )}

                <button type="submit" className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition flex items-center justify-center gap-2">
                    <Save size={20} /> {t.updateProfile}
                </button>
            </form>
        </div>
      </div>

      {/* Staff Modal (Existing) */}
      {isStaffModalOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
               {/* ... (Existing Modal Content) ... */}
               <div className="bg-white rounded-xl shadow-lg w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                  <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                      <h3 className="text-xl font-bold text-gray-800">{editingStaffId ? 'Edit Staff' : t.addStaff}</h3>
                      <button onClick={() => setIsStaffModalOpen(false)}><X size={20} className="text-gray-500"/></button>
                  </div>
                  <div className="p-6 overflow-y-auto">
                    <form onSubmit={handleSaveStaff} className="space-y-4">
                        <input type="text" required placeholder="Full Name" className="w-full p-2 border rounded" value={newStaff.name} onChange={e => setNewStaff({...newStaff, name: e.target.value})} />
                        <input type="text" required placeholder="Username" className="w-full p-2 border rounded" value={newStaff.username} onChange={e => setNewStaff({...newStaff, username: e.target.value})} />
                        <input type="text" required placeholder="PIN" className="w-full p-2 border rounded" value={newStaff.pin} onChange={e => setNewStaff({...newStaff, pin: e.target.value})} />
                        <div className="space-y-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
                             {['manage_inventory', 'view_reports', 'manage_settings', 'manage_staff', 'process_sale', 'manage_expenses', 'manage_restaurant'].map(perm => (
                                 <label key={perm} className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer"><input type="checkbox" checked={newStaff.permissions.includes(perm as Permission)} onChange={() => togglePermission(perm as Permission)} /> <span className="capitalize">{perm.replace('_', ' ')}</span></label>
                             ))}
                        </div>
                        <button type="submit" className="w-full py-2 bg-emerald-600 text-white rounded font-bold">{t.save}</button>
                    </form>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Profile;
