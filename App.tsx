import React, { useState, useEffect, Suspense } from 'react';
import { LayoutDashboard, ShoppingCart, Package, Settings, LogOut, Menu, X, Languages, ClipboardList, Wallet, UserCircle, Wifi, Crown, Shield, Utensils, ChefHat, PieChart, MessageCircle, Store } from 'lucide-react';
import { StorageService } from './services/storage';
import { Sale, Language, User, Permission } from './types';
import { TRANSLATIONS, APP_LOGO } from './constants';
import { useApiData } from './hooks/useApiData';
import InstallPrompt from './components/InstallPrompt';
import Loader from './components/Loader';
import ErrorBoundary from './components/ErrorBoundary';

// Import DailyReport Directly to prevent lazy loading issues
import DailyReport from './components/DailyReport';

// Lazy Load Other Components
const POS = React.lazy(() => import('./components/POS'));
const Dashboard = React.lazy(() => import('./components/Dashboard'));
const Invoice = React.lazy(() => import('./components/Invoice'));
const Inventory = React.lazy(() => import('./components/Inventory'));
const DueList = React.lazy(() => import('./components/DueList'));
const Auth = React.lazy(() => import('./components/Auth'));
const Expenses = React.lazy(() => import('./components/Expenses'));
const Profile = React.lazy(() => import('./components/Profile'));
const AdminPanel = React.lazy(() => import('./components/AdminPanel'));
const SubscriptionModal = React.lazy(() => import('./components/SubscriptionModal'));
const StoreOrders = React.lazy(() => import('./components/StoreOrders'));

// Restaurant Components
const TableManager = React.lazy(() => import('./components/restaurant/TableManager'));
const KitchenDisplay = React.lazy(() => import('./components/restaurant/KitchenDisplay'));
const GuestMenu = React.lazy(() => import('./components/restaurant/GuestMenu'));

// Marketplace (Customer) Components
const MarketplaceApp = React.lazy(() => import('./components/marketplace/MarketplaceApp'));

type View = 'dashboard' | 'pos' | 'inventory' | 'dueList' | 'expenses' | 'profile' | 'admin' | 'tables' | 'kitchen' | 'guest_menu' | 'reports' | 'orders';

const App = () => {
  const [booted, setBooted] = useState(false);
  const [bootstrapError, setBootstrapError] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentView, setCurrentView] = useState<View>('pos');
  const [lang, setLang] = useState<Language>('bn');
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showUpsell, setShowUpsell] = useState(false);
  const [mode, setMode] = useState<'store' | 'marketplace'>('store');

  // Guest Mode State
  const [activeGuestTableId, setActiveGuestTableId] = useState<string | null>(null);
  const [activeGuestStoreId, setActiveGuestStoreId] = useState<string | null>(null);

  // RBAC State
  const [permissions, setPermissions] = useState<Permission[] | 'all'>('all');
  const [user, setUser] = useState<User | null>(null);

  // System Config
  const { data: globalConfig } = useApiData(() => StorageService.getGlobalConfig(), []);
  const globalLogo = globalConfig?.logo || APP_LOGO;
  const whatsappNumber = globalConfig?.whatsappNumber;

  useEffect(() => {
    StorageService.bootstrap().then((res) => {
      if (res.role === 'owner' || res.role === 'staff') {
        setIsAuthenticated(true);
        setUser(res.user || null);
        if (res.role === 'staff' && res.staff) {
          setPermissions(res.staff.permissions);
        } else {
          setPermissions('all');
        }
      }
    }).catch(() => {
      setBootstrapError('Could not reach the POS server. Check your connection and try again.');
    }).finally(() => {
      setBooted(true);
    });
  }, []);

  // Handle URL Parameters for Guest Mode (QR Code Scan)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tableId = params.get('tableId');
    const storeId = params.get('storeId');

    if (tableId) {
      setActiveGuestTableId(tableId);
      if (storeId) setActiveGuestStoreId(storeId);
      setCurrentView('guest_menu');
    }
  }, []);

  const isAdmin = user?.isPlatformAdmin === true;
  const isRestaurant = user?.storeCategory === 'restaurant';

  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (isAdmin && currentView !== 'admin') {
      setCurrentView('admin');
    }
  }, [isAdmin]);

  const handleLogin = async () => {
    const loggedInUser = await StorageService.getCurrentUser();
    setBootstrapError('');
    setUser(loggedInUser);
    const staff = await StorageService.getCurrentStaff();
    if (staff) setPermissions(staff.permissions);
    if (loggedInUser?.isPlatformAdmin) {
      setCurrentView('admin');
    } else {
      setCurrentView('pos');
    }
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    await StorageService.logout();
    setIsAuthenticated(false);
    setUser(null);
    setCurrentView('pos');
  };

  const handleCheckout = (sale: Sale) => {
    setLastSale(sale);
  };

  const isGuestMode = !!activeGuestTableId;

  if (!booted) {
    return <div className="h-screen w-screen flex items-center justify-center"><Loader /></div>;
  }

  // Customer Marketplace Mode (fully separate app)
  if (mode === 'marketplace') {
    return (
      <ErrorBoundary>
        <Suspense fallback={<div className="h-screen w-screen flex items-center justify-center"><Loader /></div>}>
          <MarketplaceApp lang={lang} setLang={setLang} onExitToStoreLogin={() => setMode('store')} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (!isAuthenticated && !isGuestMode) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<div className="h-screen w-screen flex items-center justify-center"><Loader /></div>}>
          <div className="animate-fade-in w-full h-full">
            {bootstrapError && (
              <div role="alert" className="mx-auto mt-3 max-w-xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {bootstrapError}
              </div>
            )}
            <Auth onLogin={handleLogin} lang={lang} setLang={setLang} onGoToMarketplace={() => setMode('marketplace')} />
          </div>
        </Suspense>
      </ErrorBoundary>
    );
  }

  // Handle Guest View (Fullscreen)
  if (currentView === 'guest_menu' && activeGuestTableId) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader /></div>}>
          <div className="animate-fade-in h-full">
            <GuestMenu
              lang={lang}
              tableId={activeGuestTableId}
              storeId={activeGuestStoreId}
              onExit={() => {
                if (isAuthenticated) {
                  setCurrentView('tables');
                  setActiveGuestTableId(null);
                } else {
                  window.location.reload();
                }
              }}
            />
          </div>
        </Suspense>
      </ErrorBoundary>
    );
  }

  const hasPermission = (perm: Permission) => {
    if (permissions === 'all') return true;
    return permissions.includes(perm);
  };

  const NavItem = ({ view, icon: Icon, label, reqPerm }: { view: View; icon: any; label: string, reqPerm?: Permission | Permission[] }) => {
    if (reqPerm && !(Array.isArray(reqPerm) ? reqPerm.some(hasPermission) : hasPermission(reqPerm))) return null;
    return (
      <button
        onClick={() => {
          setCurrentView(view);
          setIsSidebarOpen(false);
        }}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
          currentView === view
            ? 'bg-emerald-50 text-emerald-600 font-medium scale-[1.02] shadow-sm'
            : 'text-gray-600 hover:bg-gray-50'
        }`}
      >
        <Icon size={20} />
        <span>{label}</span>
      </button>
    );
  };

  const getPageTitle = () => {
    switch (currentView) {
      case 'dashboard': return TRANSLATIONS[lang].dashboard;
      case 'pos': return TRANSLATIONS[lang].pos;
      case 'inventory': return TRANSLATIONS[lang].inventory;
      case 'dueList': return TRANSLATIONS[lang].dueList;
      case 'expenses': return TRANSLATIONS[lang].expenses;
      case 'profile': return TRANSLATIONS[lang].profile;
      case 'admin': return 'Admin Panel';
      case 'tables': return TRANSLATIONS[lang].tables;
      case 'kitchen': return TRANSLATIONS[lang].kitchen;
      case 'reports': return TRANSLATIONS[lang].dailyReport;
      case 'orders': return 'Online Orders';
      default: return 'Amar Dokan';
    }
  };

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-white font-sans text-gray-900 overflow-hidden relative">

        <InstallPrompt lang={lang} />

        {/* --- GLOBAL WHATSAPP SUPPORT CHAT --- */}
        {whatsappNumber && (
          <a
            href={`https://wa.me/${whatsappNumber}`}
            target="_blank"
            rel="noreferrer"
            className="fixed bottom-6 right-6 z-[100] bg-[#25D366] text-white p-3 rounded-full shadow-lg hover:scale-110 transition flex items-center gap-2 font-bold animate-bounce-slight"
            title="Chat with Support"
          >
            <MessageCircle size={24} fill="white" className="text-[#25D366]" />
            <span className="hidden md:inline pr-1">Support</span>
          </a>
        )}

        {showUpsell && (
          <Suspense fallback={null}>
            <SubscriptionModal
              lang={lang}
              onClose={() => setShowUpsell(false)}
              onSuccess={() => StorageService.getCurrentUser().then(setUser)}
            />
          </Suspense>
        )}

        {isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 md:hidden animate-fade-in"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        <aside className={`fixed md:relative z-40 w-64 h-full bg-white border-r transform transition-transform duration-300 ease-out flex flex-col shadow-xl md:shadow-none ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}>
          <div className="p-6 border-b flex justify-between items-center bg-gradient-to-r from-emerald-50 to-white">
            <div className="flex items-center gap-3">
              <div className="relative group">
                <img src={globalLogo} alt="Logo" className="w-10 h-10 object-contain drop-shadow-sm transition-transform group-hover:scale-110" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-emerald-700 leading-tight">Amar Dokan</h1>
                <p className="text-[10px] text-gray-500">Online POS</p>
              </div>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-gray-500">
              <X size={24} />
            </button>
          </div>

          <nav className="p-4 space-y-2 flex-1 overflow-y-auto">
            {isAdmin ? (
              <NavItem view="admin" icon={Shield} label="Admin Dashboard" />
            ) : (
              <>
                <NavItem view="dashboard" icon={LayoutDashboard} label={TRANSLATIONS[lang].dashboard} reqPerm="view_reports" />
                <NavItem view="pos" icon={ShoppingCart} label={TRANSLATIONS[lang].pos} reqPerm="process_sale" />
                <NavItem view="inventory" icon={Package} label={TRANSLATIONS[lang].inventory} reqPerm="manage_inventory" />
                <NavItem view="orders" icon={Store} label="Online Orders" reqPerm="process_sale" />
                {isRestaurant && (
                  <>
                    <NavItem view="tables" icon={Utensils} label={TRANSLATIONS[lang].tables} reqPerm="manage_settings" />
                    <NavItem view="kitchen" icon={ChefHat} label={TRANSLATIONS[lang].kitchen} reqPerm="manage_restaurant" />
                  </>
                )}
                <NavItem view="dueList" icon={ClipboardList} label={TRANSLATIONS[lang].dueList} reqPerm="view_reports" />
                <NavItem view="expenses" icon={Wallet} label={TRANSLATIONS[lang].expenses} reqPerm={['view_reports', 'manage_expenses']} />
                <NavItem view="reports" icon={PieChart} label={TRANSLATIONS[lang].dailyReport} reqPerm="view_reports" />
                <NavItem view="profile" icon={UserCircle} label={TRANSLATIONS[lang].profile} />
              </>
            )}

            {!isAdmin && user && user.plan === 'free' && (
              <button
                onClick={() => setShowUpsell(true)}
                className="w-full mt-4 bg-gradient-to-r from-amber-100 to-yellow-100 border border-amber-200 p-3 rounded-xl flex items-center gap-3 text-amber-800 hover:shadow-md transition active:scale-95"
              >
                <div className="bg-white p-1.5 rounded-full shadow-sm text-amber-500">
                  <Crown size={16} fill="currentColor" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold uppercase tracking-wide opacity-70">Upgrade</p>
                  <p className="text-sm font-bold">Get Premium</p>
                </div>
              </button>
            )}
          </nav>

          <div className="p-4 border-t bg-gray-50 space-y-4">
            <div className={`flex items-center gap-2 px-2 text-xs font-medium ${isOnline ? 'text-green-600' : 'text-orange-500'}`}>
              <Wifi size={14} />
              <span>{isOnline ? 'Online' : 'Offline'}</span>
            </div>

            <div className="flex items-center justify-between px-2">
              <button
                onClick={() => setLang(prev => prev === 'en' ? 'bn' : 'en')}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-emerald-600"
              >
                <Languages size={16} />
                <span>{lang === 'en' ? 'বাংলা' : 'English'}</span>
              </button>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 bg-red-50 text-red-600 py-2 rounded-lg hover:bg-red-100 transition text-sm font-medium"
            >
              <LogOut size={16} /> {TRANSLATIONS[lang].logout}
            </button>
          </div>
        </aside>

        <main className="flex-1 flex flex-col h-full overflow-hidden relative">
          <div className="md:hidden bg-white border-b p-4 flex justify-between items-center shadow-sm z-20">
            <button onClick={() => setIsSidebarOpen(true)}>
              <Menu size={24} className="text-gray-600" />
            </button>
            <span className="font-semibold text-gray-800">
              {getPageTitle()}
            </span>
            <div className="w-6" />
          </div>

          {!isOnline && (
            <div role="status" className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">
              You are offline. Sales, inventory, and orders need a server connection; changes are not queued for later sync.
            </div>
          )}

          <div className="flex-1 overflow-auto bg-slate-50 relative">
            <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><Loader /></div>}>
              <div key={currentView} className="h-full animate-fade-in">
                {currentView === 'pos' && hasPermission('process_sale') && <POS lang={lang} onCheckout={handleCheckout} />}
                {currentView === 'dashboard' && hasPermission('view_reports') && <Dashboard sales={[]} lang={lang} />}
                {currentView === 'inventory' && hasPermission('manage_inventory') && <Inventory lang={lang} />}
                {currentView === 'orders' && hasPermission('process_sale') && <StoreOrders lang={lang} />}
                {currentView === 'dueList' && hasPermission('view_reports') && <DueList sales={[]} lang={lang} onViewInvoice={setLastSale} />}
                {currentView === 'expenses' && (hasPermission('view_reports') || hasPermission('manage_expenses')) && <Expenses lang={lang} canManage={hasPermission('manage_expenses')} />}
                {currentView === 'profile' && <Profile lang={lang} isOwner={permissions === 'all'} />}
                {currentView === 'admin' && isAdmin && <AdminPanel />}
                {currentView === 'reports' && hasPermission('view_reports') && <DailyReport lang={lang} />}
                {currentView === 'tables' && hasPermission('manage_settings') && <TableManager lang={lang} onSelectTableForGuest={(id) => {
                  setActiveGuestTableId(id);
                  if (user) setActiveGuestStoreId(user.id);
                  setCurrentView('guest_menu');
                }} />}
                {currentView === 'kitchen' && hasPermission('manage_restaurant') && <KitchenDisplay lang={lang} />}

                {!hasPermission('process_sale') && currentView === 'pos' && <div className="p-8 text-center text-gray-500">Access Denied</div>}
              </div>
            </Suspense>
          </div>
        </main>

        {lastSale && (
          <Suspense fallback={null}>
            <Invoice
              sale={lastSale}
              lang={lang}
              onClose={() => setLastSale(null)}
            />
          </Suspense>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default App;
