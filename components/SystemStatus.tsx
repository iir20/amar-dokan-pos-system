// Phase 2 — admin system-status view.
//
// Every number here comes from GET /api/admin/system-status, which in turn
// reads the live database ping, the disk outbox depth and the last backup
// export time — nothing is cached, estimated or invented. If the endpoint
// fails, the panel says so instead of showing stale numbers.

import React, { useEffect, useState } from 'react';
import { StorageService } from '../services/storage';

type SystemStatusData = {
  timestamp: string;
  uptimeSeconds: number;
  version: string;
  database: {
    configured: boolean;
    connected: boolean;
    pingMs: number | null;
    lastError: string | null;
    lastProbeAt: string | null;
  };
  fallbackMode: string;
  fallbackSnapshotExists: boolean;
  syncQueueDepth: number;
  lastBackupAt: string | null;
  lastBackupBy: string | null;
  errorTracking: { enabled: boolean; configured: boolean };
};

const SystemStatus: React.FC = () => {
  const [data, setData] = useState<SystemStatusData | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    StorageService.getSystemStatus()
      .then(setData)
      .catch(() => setError('Could not load system status. The server may be unreachable.'));
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  if (error) {
    return (
      <div data-testid="system-status" className="p-6">
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
        <button onClick={load} className="mt-3 px-3 py-1.5 bg-slate-800 text-white rounded-lg text-sm font-semibold">
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div data-testid="system-status" className="p-6">
        <p role="status" className="text-sm text-gray-600">
          Loading system status…
        </p>
      </div>
    );
  }

  const rows: Array<[string, string]> = [
    [
      'Database',
      data.database.connected
        ? `Connected (ping ${data.database.pingMs ?? '?'} ms)`
        : data.database.configured
          ? 'Configured but unreachable — serving from fallback'
          : 'Not configured — disk-persisted fallback',
    ],
    ['Fallback mode', data.fallbackMode],
    ['Fallback snapshot on disk', data.fallbackSnapshotExists ? 'Yes' : 'No'],
    ['Sync queue depth (server outbox)', String(data.syncQueueDepth)],
    [
      'Last backup export',
      data.lastBackupAt ? new Date(data.lastBackupAt).toLocaleString() : 'Never — no backup has been exported yet',
    ],
    [
      'Error tracking',
      data.errorTracking.enabled
        ? 'Enabled and configured'
        : data.errorTracking.configured
          ? 'DSN set but AMAR_ERROR_TRACKING_ENABLED is not true'
          : 'Not configured (see docs/monitoring.md)',
    ],
    ['Server uptime', `${Math.floor(data.uptimeSeconds / 60)} min ${Math.floor(data.uptimeSeconds % 60)} s`],
    ['Version', data.version],
  ];

  return (
    <div data-testid="system-status" className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-800">System Status</h3>
        <button onClick={load} className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-sm font-semibold">
          Refresh
        </button>
      </div>
      <dl className="divide-y divide-gray-100">
        {rows.map(([label, value]) => (
          <div key={label} className="py-2.5 flex flex-col sm:flex-row sm:justify-between gap-1">
            <dt className="text-sm text-gray-500">{label}</dt>
            <dd className="text-sm font-semibold text-gray-800 text-left sm:text-right">{value}</dd>
          </div>
        ))}
      </dl>
      {data.database.lastError && !data.database.connected && (
        <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">
          Last database error: {data.database.lastError}
        </p>
      )}
      <p className="mt-4 text-xs text-gray-400">
        As of {new Date(data.timestamp).toLocaleString()} · auto-refreshes every 30 s
      </p>
    </div>
  );
};

export default SystemStatus;
