
import React, { useState, useEffect, useMemo } from 'react';
import { StorageService } from '../services/storage';
import { useApiData } from '../hooks/useApiData';
import { Store, DollarSign, Calendar, CreditCard, Loader2, Settings as SettingsIcon, Save, Filter, Search, Tag, Megaphone, Upload, Trash2, Plus, Users, Image as ImageIcon, TrendingUp, PieChart, Download, LockKeyhole, Unlock, KeyRound, X, ArrowUpDown, MapPin } from 'lucide-react';
import { GlobalPricingConfig, StoreCategory, GlobalConfig, Announcement, CategoryPricing, User } from '../types';
// Phase 2 — admin system-status view (live DB state, sync queue, last backup).
import SystemStatus from './SystemStatus';
import { DEFAULT_GLOBAL_PRICING, APP_LOGO } from '../constants';
// Wave 2 (second addition) — overview tab + branches tab.
import { getSyncSummary, subscribeToSync, retryFailedOutbox, flushOutbox } from '../services/amarSync';
import { toCents, fromCents } from '../utils/currency';

const AdminPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'requests' | 'users' | 'branches' | 'sales' | 'settings' | 'system' | 'status' | 'announcements'>('overview');
  const [processingId, setProcessingId] = useState<string | null>(null);
  
  // Realtime Data
  const { data: requestsData, refetch: refetchRequests } = useApiData(() => StorageService.getSubscriptionRequests(), []);
  const requests = requestsData || [];
  const { data: usersData, refetch: refetchUsers } = useApiData(() => StorageService.getAllUsers(), []);
  const users = usersData || [];
  const { data: salesData } = useApiData(() => StorageService.getAllSales(), []);
  const sales = salesData || [];
  const { data: announcementsData, refetch: refetchAnnouncements } = useApiData(() => StorageService.getAnnouncements(), []);
  const announcements = announcementsData || [];
  
  // --- Filtering State ---
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState(''); // For Subscription Requests

  // --- User Management State ---
  const [userSortBy, setUserSortBy] = useState<'date' | 'zila' | 'upozila' | 'thana'>('date');
  const [userSearchQuery, setUserSearchQuery] = useState(''); // For Registered Users

  // --- Sales Analysis Filters ---
  const [salesCategoryFilter, setSalesCategoryFilter] = useState<string>('all');
  const [salesStoreFilter, setSalesStoreFilter] = useState<string>('all');

  // --- Settings State ---
  const [paymentSettings, setPaymentSettings] = useState({ bkash: '', nagad: '' });
  const [globalPricing, setGlobalPricing] = useState<GlobalPricingConfig>(DEFAULT_GLOBAL_PRICING);

  // --- System Config State ---
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig>({});

  // --- Announcement State ---
  const [newAnnouncement, setNewAnnouncement] = useState<Partial<Announcement>>({ target: 'all', isActive: true });
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);

  // --- User Management Modal State ---
  const [userToReset, setUserToReset] = useState<User | null>(null);
  const [newPin, setNewPin] = useState('');

  // --- Wave 2 (second addition): overview + branches state ---
  // Branches/products APIs are own-store scoped (ownerOrStaff +
  // manage_settings / view_reports): this tab manages the signed-in
  // account's own store branches and low stock, NOT other stores'.
  // Per-store branch administration for other stores needs a new
  // admin endpoint — see worker report; it is not faked here.
  const { data: branchesData, refetch: refetchBranches } = useApiData(() => StorageService.getBranches(), []);
  const branches = branchesData || [];
  const { data: ownProductsData } = useApiData(() => StorageService.getProducts(), []);
  const ownProducts = ownProductsData || [];
  const [syncState, setSyncState] = useState({ outboxCount: 0, failedCount: 0, isOnline: true, isSyncing: false });
  const [syncMsg, setSyncMsg] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchMsg, setBranchMsg] = useState('');
  const [branchError, setBranchError] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | 'active' | 'locked' | 'expired'>('all');
  useEffect(() => subscribeToSync(setSyncState), []);

  useEffect(() => {
     if(activeTab === 'settings') {
         StorageService.getPaymentSettings().then(s => {
             setPaymentSettings({ bkash: s.bkash, nagad: s.nagad });
         });
         StorageService.getPricingConfig().then(p => {
             const merged = { ...DEFAULT_GLOBAL_PRICING, ...p };
             setGlobalPricing(merged);
         });
     }
     if(activeTab === 'system') {
         StorageService.getGlobalConfig().then((res: any) => {
             if(res) setGlobalConfig(res);
         });
     }
  }, [activeTab]);

  // --- DERIVED DATA ---
  const filteredRequests = requests.filter(req => {
      if (statusFilter !== 'all' && req.status !== statusFilter) return false;
      if (searchQuery) {
          const q = searchQuery.toLowerCase();
          return req.id.toLowerCase().includes(q) || 
                 req.username.toLowerCase().includes(q) ||
                 req.storeName.toLowerCase().includes(q) ||
                 req.paymentNumber.includes(q);
      }
      return true;
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Sorted & Filtered Users Logic
  const sortedUsers = useMemo(() => {
      let list = [...users];

      // 1. Filter by Search Query
      if (userSearchQuery.trim()) {
          const q = userSearchQuery.toLowerCase();
          list = list.filter(u => 
              u.storeName.toLowerCase().includes(q) ||
              u.username.toLowerCase().includes(q) ||
              (u.phone && u.phone.includes(q)) ||
              (u.zila && u.zila.toLowerCase().includes(q)) ||
              (u.upozila && u.upozila.toLowerCase().includes(q)) ||
              (u.thana && u.thana.toLowerCase().includes(q))
          );
      }

      // 1b. Filter by account status (Wave 2): active = not locked,
      // locked = isLocked, expired = subscriptionExpiry in the past.
      if (userStatusFilter === 'locked') list = list.filter((u) => u.isLocked);
      if (userStatusFilter === 'active') list = list.filter((u) => !u.isLocked);
      if (userStatusFilter === 'expired') {
          list = list.filter((u) => u.subscriptionExpiry && new Date(u.subscriptionExpiry).getTime() < Date.now());
      }

      // 2. Sort
      return list.sort((a, b) => {
          if (userSortBy === 'zila') return (a.zila || '').localeCompare(b.zila || '');
          if (userSortBy === 'upozila') return (a.upozila || '').localeCompare(b.upozila || '');
          if (userSortBy === 'thana') return (a.thana || '').localeCompare(b.thana || '');
          // Default to Newest First (based on ID timestamp if available, else standard sort)
          return (b.id || '').localeCompare(a.id || '');
      });
  }, [users, userSortBy, userSearchQuery, userStatusFilter]);

  // --- Wave 2 overview derivations (integer paisa for dues) ---
  const totalDuesOutstanding = useMemo(
      () => fromCents(sales.reduce((acc, s) => acc + toCents(s.dueAmount || 0), 0)),
      [sales],
  );
  const recentSales = useMemo(
      () => [...sales].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 8),
      [sales],
  );
  const lowStockOwn = useMemo(
      () => [...ownProducts].filter((p) => p.stock <= 5).sort((a, b) => a.stock - b.stock).slice(0, 10),
      [ownProducts],
  );
  const expiringSoon = useMemo(
      () =>
          users.filter((u) => {
              if (!u.subscriptionExpiry) return false;
              const ms = new Date(u.subscriptionExpiry).getTime() - Date.now();
              return ms >= 0 && ms <= 14 * 86400000;
          }),
      [users],
  );
  const syncSummary = getSyncSummary();

  const salesAnalytics = useMemo(() => {
      const storeCategoryMap = new Map<string, string>();
      const storeNameMap = new Map<string, string>();
      users.forEach(u => {
          storeCategoryMap.set(u.id, u.storeCategory);
          storeNameMap.set(u.id, u.storeName);
      });

      let filtered = sales;
      if (salesStoreFilter !== 'all') {
          filtered = filtered.filter(s => s.storeId === salesStoreFilter);
      }
      if (salesCategoryFilter !== 'all') {
          filtered = filtered.filter(s => {
             const cat = storeCategoryMap.get(s.storeId || '') || 'other';
             return cat === salesCategoryFilter;
          });
      }

      const byCategory: Record<string, number> = {};
      const byStore: Record<string, number> = {};

      filtered.forEach(s => {
          const cat = storeCategoryMap.get(s.storeId || '') || 'Unknown';
          const name = storeNameMap.get(s.storeId || '') || s.storeName || 'Unknown Store';
          
          byCategory[cat] = (byCategory[cat] || 0) + s.totalAmount;
          byStore[name] = (byStore[name] || 0) + s.totalAmount;
      });

      return {
          filteredData: filtered,
          byCategory,
          byStore,
          totalRevenue: filtered.reduce((acc, s) => acc + s.totalAmount, 0),
          totalProfit: filtered.reduce((acc, s) => acc + s.totalProfit, 0)
      };
  }, [sales, users, salesStoreFilter, salesCategoryFilter]);

  // --- ACTIONS ---

  const handleApprove = async (e: React.MouseEvent, id: string) => {
      e.stopPropagation(); e.preventDefault();
      if(window.confirm("Are you sure you want to APPROVE this request?")) {
          setProcessingId(id);
          try {
            await StorageService.approveSubscription(id);
            await Promise.all([refetchRequests(), refetchUsers()]);
            alert("Success: Request Approved!");
          } catch (error: any) {
              alert("Error: " + error.message);
          } finally {
              setProcessingId(null);
          }
      }
  };

  const handleDeny = async (e: React.MouseEvent, id: string) => {
      e.stopPropagation(); e.preventDefault();
      if(window.confirm("Are you sure you want to REJECT this request?")) {
          setProcessingId(id);
          try {
            await StorageService.rejectSubscription(id);
            await refetchRequests();
            alert("Success: Request Rejected.");
          } catch (error: any) {
              alert("Error: " + error.message);
          } finally {
              setProcessingId(null);
          }
      }
  };

  const handleDeleteUser = async (userId: string) => {
      if(window.confirm("DANGER: This will delete the user account permanently. Continue?")) {
          try {
              await StorageService.deleteUserAdmin(userId);
              alert("User deleted successfully.");
              refetchUsers();
          } catch (e) {
              alert("Failed to delete user");
          }
      }
  };

  const openResetModal = (u: User) => {
      setUserToReset(u);
      setNewPin('');
  };

  const handleConfirmReset = async () => {
      if (!userToReset || !newPin) return;
      if (newPin.length < 4) {
          alert("PIN must be at least 4 digits");
          return;
      }
      try {
          await StorageService.adminUnlockUser(userToReset.id, newPin);
          await refetchUsers();
          alert(`Success! Updated PIN for ${userToReset.username}. Account unlocked.`);
          setUserToReset(null);
      } catch (e) {
          alert("Failed to update user.");
      }
  };

  // --- Wave 2 handlers: sync retry + own-store branches ---
  // Every call below keeps its existing server permission check:
  // sync queue is local-device state; branch writes are ownerOrStaff +
  // requirePermission('manage_settings') on the server. Nothing here
  // widens access, and branch-delete refusals (BRANCH_NOT_EMPTY) are
  // shown verbatim instead of being worked around.
  const handleRetrySync = async () => {
      setSyncMsg('Retrying queued sales…');
      retryFailedOutbox();
      try {
          const r = await flushOutbox();
          setSyncMsg(
              r.failed > 0
                  ? `Synced ${r.synced}, ${r.failed} still failed — they stay queued. Tap Retry again when back online.`
                  : `Synced ${r.synced}. Queue is clear.`,
          );
      } catch (e: any) {
          setSyncMsg(`Retry failed: ${e?.message || 'unknown error'} — nothing was discarded.`);
      }
  };

  const handleAddBranch = async (e: React.FormEvent) => {
      e.preventDefault();
      setBranchError('');
      setBranchMsg('');
      if (!branchName.trim()) return;
      try {
          await StorageService.createBranch({ name: branchName.trim(), address: branchAddress.trim() || undefined });
          setBranchName('');
          setBranchAddress('');
          setBranchMsg('Branch added.');
          refetchBranches();
      } catch (err: any) {
          setBranchError(err?.message || 'Failed to add branch');
      }
  };

  const handleDeleteBranch = async (id: string) => {
      if (!window.confirm('Delete this branch? A branch with stock, sales, dues, counters, orders or shifts cannot be deleted.')) return;
      setBranchError('');
      setBranchMsg('');
      try {
          await StorageService.deleteBranch(id);
          setBranchMsg('Branch deleted.');
          refetchBranches();
      } catch (err: any) {
          setBranchError(err?.message || 'Failed to delete branch');
      }
  };

  const handlePriceChange = (category: StoreCategory, plan: keyof CategoryPricing, field: 'price', value: string) => {
      const numValue = parseFloat(value) || 0;
      setGlobalPricing(prev => ({
          ...prev,
          [category]: {
              ...prev[category],
              [plan]: {
                  ...prev[category][plan],
                  [field]: numValue
              }
          }
      }));
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          await StorageService.updatePaymentSettings(paymentSettings.bkash, paymentSettings.nagad);
          await StorageService.updatePricingConfig(globalPricing);
          alert("Settings & Pricing updated successfully!");
      } catch(err) {
          console.error(err);
          alert("Failed to update settings");
      }
  };

  const handleSaveSystemConfig = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          await StorageService.updateGlobalConfig(globalConfig);
          alert("System Config Updated! Reload to see logo changes.");
      } catch(e) {
          alert("Error saving config");
      }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              setGlobalConfig(prev => ({ ...prev, logo: reader.result as string }));
          };
          reader.readAsDataURL(file);
      }
  };

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newAnnouncement.title || !newAnnouncement.message) return;
      const target = selectedTargets.length === 0 ? 'all' : selectedTargets;
      const ann: Announcement = {
          id: Date.now().toString(),
          title: newAnnouncement.title!,
          message: newAnnouncement.message!,
          startDate: newAnnouncement.startDate || new Date().toISOString().split('T')[0],
          endDate: newAnnouncement.endDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
          target,
          isActive: true,
          createdAt: new Date().toISOString()
      };
      await StorageService.createAnnouncement(ann);
      setNewAnnouncement({ target: 'all', isActive: true, title: '', message: '' });
      setSelectedTargets([]);
      refetchAnnouncements();
      alert("Announcement Posted");
  };

  const deleteAnnouncement = async (id: string) => {
      if(window.confirm("Delete this notice?")) {
          await StorageService.deleteAnnouncement(id);
          refetchAnnouncements();
      }
  };

  return (
    <div className="p-4 md:p-6 h-full overflow-y-auto bg-slate-100">
      
      {/* PIN Reset Modal */}
      {userToReset && (
          <div className="fixed inset-0 bg-black/60 z-[999] flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in">
                  <div className="bg-gray-50 p-4 border-b flex justify-between items-center">
                      <h3 className="font-bold text-gray-800">
                          {userToReset.isLocked ? 'Unlock Account' : 'Reset PIN'}
                      </h3>
                      <button onClick={() => setUserToReset(null)} className="text-gray-400 hover:text-gray-600">
                          <X size={20} />
                      </button>
                  </div>
                  <div className="p-6">
                      <div className="text-center mb-6">
                           <div className={`w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-2 ${userToReset.isLocked ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                               {userToReset.isLocked ? <LockKeyhole size={24} /> : <KeyRound size={24} />}
                           </div>
                           <p className="text-sm text-gray-600">
                               Set new PIN for <strong>{userToReset.username}</strong>
                           </p>
                           {userToReset.isLocked && <p className="text-xs text-red-500 mt-1 font-bold">This account is currently LOCKED.</p>}
                      </div>
                      
                      <input 
                        type="text" 
                        placeholder="Enter New 4-Digit PIN"
                        className="w-full text-center text-2xl tracking-widest font-mono p-3 border rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 mb-6"
                        maxLength={8}
                        value={newPin}
                        onChange={(e) => setNewPin(e.target.value)}
                      />
                      
                      <button 
                        onClick={handleConfirmReset}
                        className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition"
                      >
                          {userToReset.isLocked ? 'Unlock & Reset' : 'Update PIN'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Admin Dashboard</h1>
        <p className="text-slate-500 text-sm md:text-base">System Overview & Management</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-6 md:mb-8">
          <div className="bg-white p-4 rounded-xl shadow-xs border border-slate-200 flex items-center gap-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
              <div className="bg-blue-100 p-3 rounded-full text-blue-600 shrink-0"><Store size={24} /></div>
              <div>
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wide">Total Stores</p>
                  <p className="text-2xl font-black text-slate-800">{users.length}</p>
              </div>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-xs border border-slate-200 flex items-center gap-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
              <div className="bg-orange-100 p-3 rounded-full text-orange-600 shrink-0"><Calendar size={24} /></div>
              <div>
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wide">Pending Requests</p>
                  <p className="text-2xl font-black text-slate-800">{requests.filter(r => r.status === 'pending').length}</p>
              </div>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-xs border border-slate-200 flex items-center gap-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
              <div className="bg-green-100 p-3 rounded-full text-green-600 shrink-0"><DollarSign size={24} /></div>
              <div>
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wide">Sub Revenue</p>
                  <p className="text-2xl font-black text-slate-800">৳{requests.filter(r => r.status === 'approved').reduce((acc, r) => acc + r.amount, 0).toLocaleString()}</p>
              </div>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-xs border border-slate-200 flex items-center gap-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
              <div className="bg-purple-100 p-3 rounded-full text-purple-600 shrink-0"><CreditCard size={24} /></div>
              <div>
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wide">Total Store Sales</p>
                  <p className="text-2xl font-black text-slate-800">৳{sales.reduce((acc, s) => acc + s.totalAmount, 0).toLocaleString()}</p>
              </div>
          </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 mb-6 border-b border-slate-200 overflow-x-auto no-scrollbar pb-1">
          <button data-testid="admin-tab-overview" onClick={() => setActiveTab('overview')} className={`pb-2.5 px-4 font-semibold text-sm transition-all whitespace-nowrap ${activeTab === 'overview' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-800'}`}>সারসংক্ষেপ / Overview</button>
          <button onClick={() => setActiveTab('requests')} className={`pb-2.5 px-4 font-semibold text-sm transition-all whitespace-nowrap ${activeTab === 'requests' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-800'}`}>Subscription Requests</button>
          <button onClick={() => setActiveTab('users')} className={`pb-2.5 px-4 font-semibold text-sm transition-all whitespace-nowrap ${activeTab === 'users' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-800'}`}>Registered Users</button>
          <button data-testid="admin-tab-branches" onClick={() => setActiveTab('branches')} className={`pb-2.5 px-4 font-semibold text-sm transition-all whitespace-nowrap ${activeTab === 'branches' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-800'}`}>শাখা / Branches</button>
          <button onClick={() => setActiveTab('sales')} className={`pb-2.5 px-4 font-semibold text-sm transition-all whitespace-nowrap ${activeTab === 'sales' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-800'}`}>Sales Analysis</button>
          <button onClick={() => setActiveTab('settings')} className={`pb-2.5 px-4 font-semibold text-sm transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === 'settings' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-800'}`}><SettingsIcon size={16} /> Pricing</button>
          <button onClick={() => setActiveTab('system')} className={`pb-2.5 px-4 font-semibold text-sm transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === 'system' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-800'}`}><Store size={16} /> Branding</button>
          <button data-testid="admin-tab-status" onClick={() => setActiveTab('status')} className={`pb-2.5 px-4 font-semibold text-sm transition-all whitespace-nowrap ${activeTab === 'status' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-800'}`}>System Status</button>
          <button onClick={() => setActiveTab('announcements')} className={`pb-2.5 px-4 font-semibold text-sm transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === 'announcements' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500 hover:text-slate-800'}`}><Megaphone size={16} /> Notices</button>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden min-h-[400px]">
          {activeTab === 'overview' && (
              <div data-testid="admin-overview" className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-6">
                      <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                          <h3 className="font-bold text-red-800">মোট বাকি / Total dues outstanding (all stores)</h3>
                          <p className="text-3xl font-black text-red-700 mt-1">৳{totalDuesOutstanding.toLocaleString()}</p>
                          <p className="text-xs text-red-500 mt-1">Sum of dueAmount over all admin-visible sales, integer paisa.</p>
                      </div>
                      <div className="border rounded-xl p-4">
                          <h3 className="font-bold text-gray-800 mb-3">সাম্প্রতিক বিক্রি / Recent sales</h3>
                          {recentSales.length === 0 && <p className="text-sm text-gray-400">No sales yet.</p>}
                          <ul className="divide-y divide-gray-100">
                              {recentSales.map((s) => (
                                  <li key={s.id} className="py-2 flex justify-between gap-3 text-sm">
                                      <span className="text-gray-700 truncate">{s.storeName || 'Unknown store'} · {new Date(s.date).toLocaleDateString()} · {s.id.slice(0, 8)}</span>
                                      <span className="font-bold shrink-0">৳{s.totalAmount.toFixed(2)}{s.dueAmount > 0 ? <span className="text-red-600"> (due ৳{s.dueAmount.toFixed(2)})</span> : ''}</span>
                                  </li>
                              ))}
                          </ul>
                      </div>
                      <div className="border rounded-xl p-4">
                          <h3 className="font-bold text-gray-800 mb-3">সাবস্ক্রিপশন শেষ হতে চলেছে / Expiring within 14 days</h3>
                          {expiringSoon.length === 0 && <p className="text-sm text-gray-400">None.</p>}
                          <ul className="divide-y divide-gray-100">
                              {expiringSoon.map((u) => (
                                  <li key={u.id} className="py-2 flex justify-between gap-3 text-sm">
                                      <span className="text-gray-700">{u.storeName} ({u.username})</span>
                                      <span className="font-bold text-amber-700 shrink-0">{u.subscriptionExpiry ? new Date(u.subscriptionExpiry).toLocaleDateString() : ''}</span>
                                  </li>
                              ))}
                          </ul>
                      </div>
                  </div>
                  <div className="space-y-6">
                      <div className="border rounded-xl p-4">
                          <h3 className="font-bold text-gray-800 mb-1">কম স্টক / Low stock — this account&apos;s own store (≤ 5)</h3>
                          <p className="text-xs text-gray-400 mb-3">Products API is own-store scoped; cross-store low stock needs a new admin endpoint and is not guessed here.</p>
                          {lowStockOwn.length === 0 && <p className="text-sm text-gray-400">No low-stock products.</p>}
                          <ul className="divide-y divide-gray-100">
                              {lowStockOwn.map((p) => (
                                  <li key={p.id} className="py-2 flex justify-between gap-3 text-sm">
                                      <span className="text-gray-700">{p.name}</span>
                                      <span className="font-bold text-red-600 shrink-0">{p.stock} {p.unit || 'pcs'}</span>
                                  </li>
                              ))}
                          </ul>
                      </div>
                      <div className="border rounded-xl p-4">
                          <h3 className="font-bold text-gray-800 mb-3">সিঙ্ক কিউ / Sync queue (this device)</h3>
                          <div className="text-sm text-gray-700 space-y-1">
                              <p>Status: {syncState.isOnline ? 'Online' : 'Offline'}{syncState.isSyncing ? ' · Syncing…' : ''}</p>
                              <p>Pending: <strong>{syncState.outboxCount}</strong> · Failed: <strong className="text-red-600">{syncState.failedCount}</strong></p>
                              {syncSummary.oldestQueuedAt && <p>Oldest queued: {new Date(syncSummary.oldestQueuedAt).toLocaleString()}</p>}
                              {syncSummary.lastError && <p className="text-red-600 break-words">Last error: {syncSummary.lastError}</p>}
                          </div>
                          <button
                              data-testid="admin-sync-retry"
                              onClick={handleRetrySync}
                              disabled={syncSummary.totalQueued === 0}
                              className="mt-3 bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-emerald-700 disabled:opacity-50"
                          >
                              Retry queued sales
                          </button>
                          {syncMsg && <p data-testid="admin-sync-msg" className="mt-2 text-sm text-gray-700">{syncMsg}</p>}
                          <p className="text-xs text-gray-400 mt-2">Failed sales are never discarded: they stay queued until a retry succeeds or the server confirms the id (SALE_ID_CONFLICT counts as synced).</p>
                      </div>
                  </div>
              </div>
          )}

          {activeTab === 'branches' && (
              <div data-testid="admin-branches" className="p-6 max-w-2xl">
                  <h3 className="font-bold text-gray-800 text-lg">শাখা ব্যবস্থাপনা / Branch management — this account&apos;s own store</h3>
                  <p className="text-sm text-gray-500 mt-1 mb-4">Branches are added and removed here with the same server guards as Profile → Branches (manage_settings). A branch holding stock, sales, dues, counters, orders or shifts is refused with the blockers named — nothing is deleted.</p>
                  {branchMsg && <p className="bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-lg px-3 py-2 text-sm mb-3">{branchMsg}</p>}
                  {branchError && <p className="bg-red-50 text-red-800 border border-red-100 rounded-lg px-3 py-2 text-sm mb-3 break-words">{branchError}</p>}
                  <form onSubmit={handleAddBranch} className="flex flex-col md:flex-row gap-2 mb-6">
                      <input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="Branch name / শাখার নাম" className="flex-1 p-2 border rounded-lg text-sm" />
                      <input value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} placeholder="Address (optional)" className="flex-1 p-2 border rounded-lg text-sm" />
                      <button type="submit" className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-emerald-700">Add branch</button>
                  </form>
                  {branches.length === 0 && <p className="text-sm text-gray-400">No branches yet.</p>}
                  <ul className="divide-y divide-gray-100">
                      {branches.map((b) => (
                          <li key={b.id} className="py-3 flex justify-between items-center gap-3">
                              <div>
                                  <div className="font-bold text-gray-800">{b.name} {b.isDefault && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full ml-1">Default</span>}</div>
                                  {b.address && <div className="text-xs text-gray-500">{b.address}</div>}
                              </div>
                              <button onClick={() => handleDeleteBranch(b.id)} className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded text-sm font-bold flex items-center gap-1">
                                  <Trash2 size={16} /> Delete
                              </button>
                          </li>
                      ))}
                  </ul>
              </div>
          )}

          {activeTab === 'requests' && (
              <div className="flex flex-col">
                  {/* Request Filter */}
                  <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row gap-4 items-center justify-between">
                      <div className="flex items-center gap-2 w-full md:w-auto">
                          <div className="relative flex-1 md:w-64">
                              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                              <input type="text" placeholder="Search ID, Name..." className="w-full pl-9 p-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                          </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
                          <select className="p-2 border rounded-lg text-sm bg-white outline-none" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
                                  <option value="all">All Status</option>
                                  <option value="pending">Pending</option>
                                  <option value="approved">Approved</option>
                                  <option value="rejected">Rejected</option>
                          </select>
                      </div>
                  </div>

                  <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse min-w-[900px]">
                          <thead className="bg-slate-50 text-slate-600 text-sm font-semibold">
                              <tr>
                                  <th className="p-4">Request / Invoice Info</th>
                                  <th className="p-4">Store Owner</th>
                                  <th className="p-4">Package</th>
                                  <th className="p-4">Payment Details</th>
                                  <th className="p-4">Status</th>
                                  <th className="p-4 text-center">Action</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {filteredRequests.map(req => (
                                  <tr key={req.id} className="hover:bg-slate-50">
                                      <td className="p-4">
                                          <div className="font-mono font-bold text-slate-700">{req.id}</div>
                                          <div className="text-xs text-slate-500 mt-1">{new Date(req.date).toLocaleDateString()}</div>
                                      </td>
                                      <td className="p-4">
                                          <div className="font-bold text-slate-800">{req.storeName}</div>
                                          <div className="text-xs text-slate-500">Owner: {req.ownerName} ({req.username})</div>
                                      </td>
                                      <td className="p-4">
                                          <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-bold uppercase whitespace-nowrap">{req.package}</span>
                                          <div className="text-xs text-slate-500 mt-1 font-bold">৳{req.amount}</div>
                                      </td>
                                      <td className="p-4 text-sm">
                                          <div><span className="text-slate-400 text-xs">Sender:</span> <span className="font-mono">{req.paymentNumber}</span></div>
                                          <div><span className="text-slate-400 text-xs">TrxID:</span> <span className="font-mono font-bold text-slate-800">{req.trxId}</span></div>
                                      </td>
                                      <td className="p-4">
                                          <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize whitespace-nowrap ${req.status === 'approved' ? 'bg-green-100 text-green-700' : req.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{req.status}</span>
                                      </td>
                                      <td className="p-4 text-center">
                                          {req.status === 'pending' && (
                                              <div className="flex justify-center gap-3">
                                                  <button type="button" onClick={(e) => handleApprove(e, req.id)} disabled={processingId === String(req.id)} className="px-3 py-1.5 bg-emerald-600 text-white rounded shadow-sm hover:bg-emerald-700 disabled:opacity-50 text-xs font-bold uppercase">Approve</button>
                                                  <button type="button" onClick={(e) => handleDeny(e, req.id)} disabled={processingId === String(req.id)} className="px-3 py-1.5 bg-red-600 text-white rounded shadow-sm hover:bg-red-700 disabled:opacity-50 text-xs font-bold uppercase">Deny</button>
                                              </div>
                                          )}
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
          )}

          {activeTab === 'users' && (
               <div className="flex flex-col">
                   {/* User Sort Toolbar */}
                   <div className="p-4 border-b bg-slate-50 flex flex-col md:flex-row items-center justify-between gap-4">
                       <div className="relative w-full md:w-72">
                           <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                           <input 
                               type="text" 
                               placeholder="Search name, phone, zila..." 
                               className="w-full pl-9 p-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white" 
                               value={userSearchQuery} 
                               onChange={(e) => setUserSearchQuery(e.target.value)} 
                           />
                       </div>
                       
                       <div className="flex items-center gap-2 self-end md:self-auto">
                           <span className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1"><ArrowUpDown size={14} /> Sort By:</span>
                           <select
                               className="p-1.5 border rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                               value={userSortBy}
                               onChange={(e) => setUserSortBy(e.target.value as any)}
                           >
                               <option value="date">Default (Newest)</option>
                               <option value="zila">Zila (District)</option>
                               <option value="upozila">Upozila</option>
                               <option value="thana">Thana</option>
                           </select>
                           <span className="text-xs font-bold text-gray-500 uppercase ml-2">Status:</span>
                           <select
                               data-testid="admin-user-status-filter"
                               className="p-1.5 border rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                               value={userStatusFilter}
                               onChange={(e) => setUserStatusFilter(e.target.value as any)}
                           >
                               <option value="all">All accounts</option>
                               <option value="active">Active (not locked)</option>
                               <option value="locked">Locked</option>
                               <option value="expired">Subscription expired</option>
                           </select>
                       </div>
                   </div>

                   <div className="overflow-x-auto">
                       <table className="w-full text-left border-collapse min-w-[800px]">
                            <thead className="bg-white text-slate-600 text-sm font-semibold border-b">
                                <tr>
                                    <th className="p-4">Store Info</th>
                                    <th className="p-4">Location</th>
                                    <th className="p-4">Category</th>
                                    <th className="p-4">Plan</th>
                                    <th className="p-4">Role / Subscription</th>
                                    <th className="p-4">Status</th>
                                    <th className="p-4 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {sortedUsers.map(u => (
                                    <tr key={u.username} className="hover:bg-slate-50 group">
                                        <td className="p-4">
                                            <div className="font-bold text-slate-800">{u.storeName}</div>
                                            <div className="text-xs text-slate-500">{u.username}</div>
                                            {u.phone && <div className="text-xs text-gray-400 mt-0.5">{u.phone}</div>}
                                        </td>
                                        <td className="p-4">
                                            {u.zila || u.upozila || u.thana ? (
                                                <div className="text-sm text-gray-700">
                                                    {u.thana && <div><span className="text-gray-400 text-xs">Thana:</span> {u.thana}</div>}
                                                    {u.upozila && <div><span className="text-gray-400 text-xs">Upz:</span> {u.upozila}</div>}
                                                    {u.zila && <div className="font-bold text-emerald-600"><span className="text-gray-400 text-xs font-normal text-black">Dist:</span> {u.zila}</div>}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400 italic">No location info</span>
                                            )}
                                        </td>
                                        <td className="p-4"><span className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs capitalize">{u.storeCategory || 'grocery'}</span></td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${u.plan === 'premium' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{u.plan.toUpperCase()}</span>
                                            <div className="text-[10px] text-gray-400 mt-1">
                                                {u.subscriptionExpiry ? new Date(u.subscriptionExpiry).toLocaleDateString() : 'N/A'}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="text-sm font-bold text-gray-700">{u.isPlatformAdmin ? 'Platform admin' : 'Store owner'}</div>
                                            <div className="text-[10px] text-gray-400 mt-0.5">
                                                Subscription: {u.subscriptionStatus || (u.subscriptionExpiry && new Date(u.subscriptionExpiry).getTime() < Date.now() ? 'expired' : 'active')}
                                            </div>
                                            <div className="text-[10px] text-gray-400">
                                                {u.isLocked ? 'Account locked — PIN reset unlocks it' : 'Account active'}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            {u.isLocked ? (
                                                <div className="flex items-center gap-1 text-red-600 font-bold text-xs bg-red-50 px-2 py-1 rounded-full w-fit">
                                                    <LockKeyhole size={14} /> LOCKED
                                                </div>
                                            ) : (
                                                <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-1 rounded-full">Active</span>
                                            )}
                                            {u.isLocked && <div className="text-[10px] text-red-400 mt-1">{u.failedLoginAttempts || 3} failed attempts</div>}
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex justify-center gap-2">
                                                <button 
                                                    onClick={() => openResetModal(u)}
                                                    className={`p-2 rounded shadow-sm transition flex items-center gap-1 text-xs font-bold ${u.isLocked ? 'bg-orange-100 text-orange-700 hover:bg-orange-200 w-24 justify-center' : 'bg-blue-50 text-blue-600 hover:bg-blue-100 w-20 justify-center'}`}
                                                    title={u.isLocked ? "Unlock Account" : "Reset PIN"}
                                                >
                                                    {u.isLocked ? <Unlock size={14} /> : <KeyRound size={14} />}
                                                    {u.isLocked ? "Unlock" : "PIN"}
                                                </button>
                                                
                                                <button 
                                                    onClick={() => handleDeleteUser(u.id)}
                                                    className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                                                    title="Delete User"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                       </table>
                   </div>
               </div>
          )}

          {activeTab === 'sales' && (
              <div className="flex flex-col">
                  {/* Analysis Filters & Summary */}
                  <div className="bg-slate-50 border-b p-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                          <div className="bg-white p-3 rounded-lg border shadow-sm">
                              <span className="text-xs text-gray-500 uppercase font-bold">Total Sales Volume</span>
                              <div className="text-xl font-bold text-emerald-700">৳{salesAnalytics.totalRevenue.toLocaleString()}</div>
                          </div>
                          <div className="bg-white p-3 rounded-lg border shadow-sm">
                              <span className="text-xs text-gray-500 uppercase font-bold">Total Profit</span>
                              <div className="text-xl font-bold text-blue-700">৳{salesAnalytics.totalProfit.toLocaleString()}</div>
                          </div>
                          <div className="bg-white p-3 rounded-lg border shadow-sm">
                              <span className="text-xs text-gray-500 uppercase font-bold">Transactions</span>
                              <div className="text-xl font-bold text-gray-700">{salesAnalytics.filteredData.length}</div>
                          </div>
                      </div>

                      <div className="flex gap-4">
                          <select 
                            className="p-2 border rounded-lg text-sm bg-white"
                            value={salesCategoryFilter}
                            onChange={(e) => setSalesCategoryFilter(e.target.value)}
                          >
                              <option value="all">All Categories</option>
                              <option value="grocery">Grocery</option>
                              <option value="medicine">Medicine</option>
                              <option value="restaurant">Restaurant</option>
                              <option value="clothing">Clothing</option>
                              <option value="electronics">Electronics</option>
                          </select>

                          <select 
                            className="p-2 border rounded-lg text-sm bg-white"
                            value={salesStoreFilter}
                            onChange={(e) => setSalesStoreFilter(e.target.value)}
                          >
                              <option value="all">All Stores</option>
                              {users.map(u => (
                                  <option key={u.id} value={u.id}>{u.storeName}</option>
                              ))}
                          </select>
                      </div>
                  </div>
                  
                  {/* Category Breakdown */}
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-gray-50 border-b">
                      {Object.entries(salesAnalytics.byCategory).map(([cat, amount]) => (
                          <div key={cat} className="bg-white p-3 rounded shadow-sm flex justify-between items-center">
                              <span className="capitalize text-sm font-medium text-gray-600">{cat}</span>
                              <span className="font-bold text-gray-800">৳{amount.toLocaleString()}</span>
                          </div>
                      ))}
                  </div>

                  {/* Detailed Table */}
                  <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse min-w-[600px]">
                          <thead className="bg-white text-slate-600 text-sm font-semibold border-b">
                                <tr>
                                    <th className="p-4">Date</th>
                                    <th className="p-4">Store Name</th>
                                    <th className="p-4">Inv ID</th>
                                    <th className="p-4 text-right">Amount</th>
                                    <th className="p-4 text-right">Profit</th>
                                </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {salesAnalytics.filteredData.slice().reverse().map(s => (
                                  <tr key={s.id} className="hover:bg-slate-50">
                                      <td className="p-4 text-sm text-slate-600">{new Date(s.date).toLocaleDateString()}</td>
                                      <td className="p-4 font-bold text-slate-800">{s.storeName || 'Unknown Store'}</td>
                                      <td className="p-4 text-xs font-mono text-slate-500">{s.id.slice(0,8)}...</td>
                                      <td className="p-4 text-right font-bold text-slate-800">৳{s.totalAmount.toFixed(2)}</td>
                                      <td className="p-4 text-right text-emerald-600">৳{s.totalProfit.toFixed(2)}</td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
          )}

          {activeTab === 'system' && (
              <div className="p-8 max-w-2xl">
                  <h2 className="text-xl font-bold mb-6 text-gray-800">Global Branding & Config</h2>
                  <form onSubmit={handleSaveSystemConfig} className="space-y-6">
                      <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                          <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                              <ImageIcon size={20} /> Global Logo
                          </h3>
                          <div className="flex items-center gap-6">
                                <div className="w-24 h-24 bg-white rounded-lg border flex items-center justify-center p-2 overflow-hidden shadow-sm">
                                    <img src={globalConfig.logo || APP_LOGO} alt="Global Logo" className="w-full h-full object-contain" />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Upload New Logo (Max 300KB)</label>
                                    <label className="flex items-center gap-2 bg-white border border-gray-300 rounded-lg px-4 py-2 cursor-pointer hover:bg-gray-50 w-fit transition">
                                        <Upload size={16} className="text-gray-500" />
                                        <span className="text-sm font-medium text-gray-700">Choose Image</span>
                                        <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                                    </label>
                                    <p className="text-xs text-gray-500 mt-2">Will replace default logo on login, sidebar, and receipts.</p>
                                </div>
                          </div>
                      </div>

                      <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                          <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                              <DollarSign size={20} /> Live Support
                          </h3>
                          <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number (with Country Code)</label>
                              <input 
                                type="text" 
                                placeholder="e.g. 8801700000000"
                                className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                                value={globalConfig.whatsappNumber || ''}
                                onChange={e => setGlobalConfig({...globalConfig, whatsappNumber: e.target.value})}
                              />
                          </div>
                      </div>

                      <div className="flex justify-end">
                          <button type="submit" className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-lg hover:bg-emerald-700 transition font-bold shadow-lg">
                              <Save size={18} /> Save Config
                          </button>
                      </div>
                  </form>
              </div>
          )}

          {activeTab === 'status' && (
              <SystemStatus />
          )}

          {activeTab === 'announcements' && (
              <div className="flex flex-col h-full">
                  <div className="p-6 border-b bg-gray-50 grid grid-cols-1 md:grid-cols-2 gap-8">
                      {/* Create Form */}
                      <div>
                          <h3 className="font-bold text-gray-800 mb-4">Create New Notice</h3>
                          <form onSubmit={handleCreateAnnouncement} className="space-y-3">
                              <input 
                                type="text" placeholder="Title / Headline" required 
                                className="w-full p-2 border rounded-lg"
                                value={newAnnouncement.title || ''}
                                onChange={e => setNewAnnouncement({...newAnnouncement, title: e.target.value})}
                              />
                              <textarea 
                                placeholder="Message content..." required
                                className="w-full p-2 border rounded-lg h-24"
                                value={newAnnouncement.message || ''}
                                onChange={e => setNewAnnouncement({...newAnnouncement, message: e.target.value})}
                              />
                              <div className="flex gap-2">
                                  <div className="flex-1">
                                      <label className="text-xs text-gray-500">Start Date</label>
                                      <input type="date" className="w-full p-2 border rounded-lg text-sm" value={newAnnouncement.startDate} onChange={e => setNewAnnouncement({...newAnnouncement, startDate: e.target.value})} />
                                  </div>
                                  <div className="flex-1">
                                      <label className="text-xs text-gray-500">End Date</label>
                                      <input type="date" className="w-full p-2 border rounded-lg text-sm" value={newAnnouncement.endDate} onChange={e => setNewAnnouncement({...newAnnouncement, endDate: e.target.value})} />
                                  </div>
                              </div>
                              <div>
                                  <label className="text-xs text-gray-500 block mb-1">Target Stores (Select Multiple or Leave Empty for All)</label>
                                  <select 
                                    multiple 
                                    className="w-full p-2 border rounded-lg text-sm h-24"
                                    onChange={(e) => {
                                        const options = Array.from(e.target.selectedOptions, (option: HTMLOptionElement) => option.value);
                                        setSelectedTargets(options);
                                    }}
                                  >
                                      {users.map(u => (
                                          <option key={u.id} value={u.id}>{u.storeName} ({u.username})</option>
                                      ))}
                                  </select>
                              </div>
                              <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-lg font-bold hover:bg-blue-700">Post Announcement</button>
                          </form>
                      </div>

                      {/* List */}
                      <div className="flex-1 overflow-y-auto max-h-[500px] space-y-3">
                          <h3 className="font-bold text-gray-800 mb-4">Active Notices</h3>
                          {announcements.length === 0 && <p className="text-gray-400 text-sm">No announcements posted.</p>}
                          {announcements.slice().reverse().map(ann => (
                              <div key={ann.id} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm relative group">
                                  <div className="flex justify-between items-start">
                                      <h4 className="font-bold text-gray-800">{ann.title}</h4>
                                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${ann.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{ann.isActive ? 'Active' : 'Inactive'}</span>
                                  </div>
                                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">{ann.message}</p>
                                  <div className="flex justify-between items-center mt-2 text-xs text-gray-400">
                                      <span>Target: {Array.isArray(ann.target) ? ann.target.length + ' stores' : 'Everyone'}</span>
                                      <span>Exp: {ann.endDate}</span>
                                  </div>
                                  <button onClick={() => deleteAnnouncement(ann.id)} className="absolute top-2 right-2 p-1.5 bg-red-100 text-red-600 rounded opacity-0 group-hover:opacity-100 transition">
                                      <Trash2 size={14} />
                                  </button>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
          )}

          {activeTab === 'settings' && (
              <div className="p-8 max-w-5xl">
                  <div className="flex justify-between items-center mb-6">
                      <h2 className="text-xl font-bold text-gray-800">System Configuration</h2>
                      <button onClick={handleSaveSettings} className="bg-emerald-600 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-700">
                          <Save size={18} /> Save Changes
                      </button>
                  </div>
                  
                  <div className="space-y-8">
                      {/* Payment Settings */}
                      <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                          <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                              <CreditCard size={20} /> Payment Numbers
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">Bkash Personal</label>
                                  <input 
                                    type="text" 
                                    className="w-full p-2 border rounded-lg outline-none"
                                    value={paymentSettings.bkash}
                                    onChange={e => setPaymentSettings({...paymentSettings, bkash: e.target.value})}
                                  />
                              </div>
                              <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">Nagad Personal</label>
                                  <input 
                                    type="text" 
                                    className="w-full p-2 border rounded-lg outline-none"
                                    value={paymentSettings.nagad}
                                    onChange={e => setPaymentSettings({...paymentSettings, nagad: e.target.value})}
                                  />
                              </div>
                          </div>
                      </div>

                      {/* Subscription Pricing Grid */}
                      <div className="bg-white p-6 rounded-xl border border-slate-200">
                          <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                              <DollarSign size={20} /> Subscription Pricing Plans (BDT)
                          </h3>
                          <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                  <thead>
                                      <tr className="bg-gray-50 text-xs uppercase text-gray-500">
                                          <th className="p-3">Store Category</th>
                                          <th className="p-3">Monthly</th>
                                          <th className="p-3">Yearly</th>
                                          <th className="p-3">2 Years</th>
                                      </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                      {(Object.keys(globalPricing) as StoreCategory[]).map(cat => (
                                          <tr key={cat}>
                                              <td className="p-3 font-bold capitalize text-gray-700">{cat}</td>
                                              <td className="p-3">
                                                  <input 
                                                    type="number"
                                                    className="w-24 p-1.5 border rounded text-sm text-right"
                                                    value={globalPricing[cat].monthly.price}
                                                    onChange={e => handlePriceChange(cat, 'monthly', 'price', e.target.value)}
                                                  />
                                              </td>
                                              <td className="p-3">
                                                  <input 
                                                    type="number"
                                                    className="w-24 p-1.5 border rounded text-sm text-right"
                                                    value={globalPricing[cat].yearly.price}
                                                    onChange={e => handlePriceChange(cat, 'yearly', 'price', e.target.value)}
                                                  />
                                              </td>
                                              <td className="p-3">
                                                  <input 
                                                    type="number"
                                                    className="w-24 p-1.5 border rounded text-sm text-right"
                                                    value={globalPricing[cat]['2yearly'].price}
                                                    onChange={e => handlePriceChange(cat, '2yearly', 'price', e.target.value)}
                                                  />
                                              </td>
                                          </tr>
                                      ))}
                                  </tbody>
                              </table>
                          </div>
                      </div>
                  </div>
              </div>
          )}
      </div>
    </div>
  );
};

export default AdminPanel;
