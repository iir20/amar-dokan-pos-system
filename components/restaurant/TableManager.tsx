
import React, { useState, useEffect } from 'react';
import { useApiData } from '../../hooks/useApiData';
import { RestaurantTable, Language, User } from '../../types';
import { Plus, Trash2, QrCode, Monitor, Copy, Check, Settings, Save, ExternalLink } from 'lucide-react';
import { TRANSLATIONS } from '../../constants';
import { StorageService } from '../../services/storage';

interface TableManagerProps {
  lang: Language;
  onSelectTableForGuest: (tableId: string) => void;
}

const TableManager: React.FC<TableManagerProps> = ({ lang, onSelectTableForGuest }) => {
  const t = TRANSLATIONS[lang];
  const { data: tablesData, refetch: refetchTables } = useApiData(() => StorageService.getTables(), []);
  const tables = tablesData || [];
  const [newTableName, setNewTableName] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  // Base URL State management
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [isEditingBaseUrl, setIsEditingBaseUrl] = useState(false);

  useEffect(() => {
      StorageService.getCurrentUser().then(setUser);

      // Initialize with current location, stripping query params
      // Check if we are in a blob/preview environment
      let current = window.location.href.split('?')[0];
      if (current.startsWith('blob:')) {
          current = 'https://your-deployed-app.com'; // Placeholder for preview environments
      }
      // Load saved preference if available (could add to DB settings later)
      const saved = localStorage.getItem('pos_guest_base_url');
      setBaseUrl(saved || current);
  }, []);

  const saveBaseUrl = () => {
      // Remove trailing slash if present
      const clean = baseUrl.replace(/\/$/, '');
      localStorage.setItem('pos_guest_base_url', clean);
      setBaseUrl(clean);
      setIsEditingBaseUrl(false);
  };

  const addTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTableName.trim() || !user) return;

    await StorageService.addTable(newTableName);
    setNewTableName('');
    refetchTables();
  };

  const deleteTable = async (id: string) => {
    if(window.confirm('Delete this table?')) {
        await StorageService.deleteTable(id);
        refetchTables();
    }
  };

  const getTableUrl = (tableId: string) => {
      // Crucial: Include storeId in URL so guest device knows which restaurant this is
      if (!user) return '#';
      return `${baseUrl}?storeId=${user.id}&tableId=${tableId}`;
  };

  const copyToClipboard = (id: string) => {
      const url = getTableUrl(id);
      navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <h2 className="text-2xl font-bold text-gray-800">{t.tables}</h2>
        
        {/* Base URL Configuration */}
        <div className="w-full md:w-auto bg-blue-50 p-2 rounded-lg border border-blue-100 flex items-center gap-2">
            {isEditingBaseUrl ? (
                <div className="flex items-center gap-2 w-full md:w-96">
                    <input 
                        type="url" 
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        className="flex-1 p-1.5 text-sm border rounded outline-none focus:border-blue-500"
                        placeholder="https://your-domain.com"
                    />
                    <button onClick={saveBaseUrl} className="bg-blue-600 text-white p-1.5 rounded hover:bg-blue-700">
                        <Save size={16} />
                    </button>
                </div>
            ) : (
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="flex items-center gap-2 text-blue-800 text-sm">
                        <Settings size={14} />
                        <span className="font-bold hidden sm:inline">Menu Link Domain:</span>
                        <span className="truncate max-w-[200px] opacity-70" title={baseUrl}>{baseUrl}</span>
                    </div>
                    <button 
                        onClick={() => setIsEditingBaseUrl(true)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-bold underline"
                    >
                        Change
                    </button>
                </div>
            )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Create Table Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit">
          <h3 className="font-bold text-lg mb-4">Add New Table</h3>
          <form onSubmit={addTable} className="flex gap-2">
            <input 
              type="text" 
              placeholder="e.g. Table 1, Patio 2"
              className="flex-1 p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
            />
            <button className="bg-emerald-600 text-white p-2 rounded-lg hover:bg-emerald-700">
              <Plus size={24} />
            </button>
          </form>
        </div>

        {/* Table List */}
        {tables.map(table => (
          <div key={table.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between group/card">
            <div className="flex justify-between items-start mb-4">
              <div>
                 <h3 className="text-xl font-bold text-gray-800">{table.name}</h3>
                 <span className="text-xs text-gray-400">ID: {table.id.slice(-4)}</span>
              </div>
              <button onClick={() => deleteTable(table.id)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover/card:opacity-100 transition-opacity">
                <Trash2 size={20} />
              </button>
            </div>
            
            <div className="flex flex-col gap-2">
               {/* QR Code URL Display */}
               <div className="bg-gray-50 p-3 rounded-lg flex items-center gap-3 border border-gray-100 relative group">
                   <QrCode size={24} className="text-emerald-600 shrink-0" />
                   <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-gray-400 uppercase font-bold">Guest Menu Link</p>
                      <div className="text-xs text-gray-600 truncate">
                          {getTableUrl(table.id)}
                      </div>
                   </div>
                   <div className="flex gap-1">
                        <button 
                            onClick={() => window.open(getTableUrl(table.id), '_blank')}
                            className="text-gray-400 hover:text-blue-600 p-1"
                            title="Open Link"
                        >
                            <ExternalLink size={16} />
                        </button>
                        <button 
                            onClick={() => copyToClipboard(table.id)}
                            className="text-gray-400 hover:text-emerald-600 p-1"
                            title="Copy URL"
                        >
                            {copiedId === table.id ? <Check size={16} className="text-emerald-600"/> : <Copy size={16} />}
                        </button>
                   </div>
               </div>
               
               <button 
                  onClick={() => onSelectTableForGuest(table.id)}
                  className="w-full mt-2 bg-emerald-50 text-emerald-700 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-emerald-100 transition"
                >
                   <Monitor size={16} /> View as Guest
               </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TableManager;
