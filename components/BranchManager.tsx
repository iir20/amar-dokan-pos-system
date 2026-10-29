// Wave 2 (Item 2) — branch add/remove UI for the profile area.
//
// Branches are listed from GET /api/branches, added via POST /api/branches
// and removed via DELETE /api/branches/:id. Deleting is guarded on the
// server: a branch that still holds stock, sales, dues, counters,
// purchase orders or shifts is REFUSED (409 BRANCH_NOT_EMPTY) with a
// message naming every blocker, and nothing is deleted. This panel
// shows that message verbatim — it never silently orphans records,
// and there is no transfer flow yet, so the owner must clear or move
// the blocking records first.
import React, { useState, useEffect } from 'react';
import { Language, Branch } from '../types';
import { TRANSLATIONS } from '../constants';
import { StorageService } from '../services/storage';
import { Store, Plus, Trash2, AlertCircle } from 'lucide-react';

interface BranchManagerProps {
  lang: Language;
}

const BranchManager: React.FC<BranchManagerProps> = ({ lang }) => {
  const t = TRANSLATIONS[lang];
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchBranches = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      setBranches(await StorageService.getBranches());
    } catch (e: any) {
      setLoadError(e?.message || t.branchLoadFailed);
      setBranches([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setMessage('');
    if (!name.trim()) return;
    try {
      await StorageService.createBranch({ name: name.trim(), address: address.trim() || undefined });
      setName('');
      setAddress('');
      setMessage(t.branchCreated);
      await fetchBranches();
    } catch (err: any) {
      setFormError(err?.message || t.branchLoadFailed);
    }
  };

  const handleDelete = async (branch: Branch) => {
    if (!window.confirm(t.branchDeleteConfirm)) return;
    setDeleteError('');
    setMessage('');
    setDeletingId(branch.id);
    try {
      await StorageService.deleteBranch(branch.id);
      setMessage(t.branchDeleted);
      await fetchBranches();
    } catch (err: any) {
      // 409 BRANCH_NOT_EMPTY: the server message names every blocker
      // (stock, sales, dues, counters, purchase orders, shifts).
      const detail = err?.message || t.branchDeleteFailed;
      setDeleteError(err?.status === 409 ? `${t.branchDeleteBlocked} ${detail}` : detail);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div data-testid="branch-manager" className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-4">
        <Store size={20} className="text-emerald-600" />
        {t.branchTitle}
      </h3>

      {isLoading ? (
        <p className="text-sm text-gray-400">Loading branches...</p>
      ) : loadError ? (
        <p role="alert" className="text-sm text-red-700 flex items-center gap-1">
          <AlertCircle size={16} /> {loadError}
        </p>
      ) : branches.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">{t.branchEmpty}</p>
      ) : (
        <div className="space-y-3 mb-4">
          {branches.map((branch) => (
            <div
              key={branch.id}
              data-testid={`branch-row-${branch.id}`}
              className="flex justify-between items-center p-3 border rounded-lg hover:bg-gray-50"
            >
              <div>
                <p className="font-bold text-gray-800 text-sm">
                  {branch.name}{' '}
                  {branch.isDefault && (
                    <span className="text-[11px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold ml-1">
                      {t.branchDefault}
                    </span>
                  )}
                </p>
                {branch.address && <p className="text-xs text-gray-500">{branch.address}</p>}
              </div>
              <button
                data-testid={`branch-delete-${branch.id}`}
                disabled={deletingId === branch.id}
                onClick={() => void handleDelete(branch)}
                aria-label={`${t.branchDelete} ${branch.name}`}
                className="text-gray-400 hover:text-red-500 p-2 disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {deleteError && (
        <p role="alert" data-testid="branch-delete-error" className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm font-medium mb-4">
          {deleteError}
        </p>
      )}
      {message && (
        <p data-testid="branch-message" className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg text-sm font-medium mb-4">
          {message}
        </p>
      )}

      <form onSubmit={handleAdd} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            data-testid="branch-name-input"
            type="text"
            required
            maxLength={200}
            placeholder={t.branchName}
            className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            data-testid="branch-address-input"
            type="text"
            maxLength={500}
            placeholder={t.branchAddress}
            className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        {formError && (
          <p role="alert" className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm font-medium">
            {formError}
          </p>
        )}
        <button
          data-testid="branch-add-button"
          type="submit"
          className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-3 py-2 rounded-lg font-bold hover:bg-emerald-100"
        >
          <Plus size={14} /> {t.branchAdd}
        </button>
      </form>
    </div>
  );
};

export default BranchManager;
