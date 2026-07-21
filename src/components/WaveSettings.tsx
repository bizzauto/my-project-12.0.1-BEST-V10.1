import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { waveAPI } from '../lib/api';
import {
  Building2,
  Link2,
  Unlink,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  ExternalLink,
  FileText,
  DollarSign,
} from 'lucide-react';

interface WaveStatus {
  connected: boolean;
  configured: boolean;
  businessName?: string;
  waveBusinessId?: string;
  autoSync?: boolean;
  lastSyncAt?: string;
}

export default function WaveSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<WaveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadStatus();

    // Handle OAuth callback
    if (searchParams.get('connected') === 'true') {
      setStatus((prev) => prev ? { ...prev, connected: true } : prev);
      setSearchParams({});
    }
    if (searchParams.get('error')) {
      setError(searchParams.get('error') || 'Connection failed');
      setSearchParams({});
    }
  }, []);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const res = await waveAPI.getStatus();
      if (res.data?.success) {
        setStatus(res.data.data);
      }
    } catch (err: any) {
      console.error('Failed to load Wave status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      setError('');
      const res = await waveAPI.getAuthUrl();
      if (res.data?.success && res.data.data?.authUrl) {
        window.location.href = res.data.data.authUrl;
      }
    } catch (err: any) {
      setError('Failed to initiate Wave connection');
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Wave?')) return;
    try {
      await waveAPI.disconnect();
      setStatus({ connected: false, configured: true });
    } catch (err: any) {
      setError('Failed to disconnect Wave');
    }
  };

  const handleSyncAll = async () => {
    try {
      setSyncing(true);
      setSyncResult(null);
      const res = await waveAPI.syncAll();
      if (res.data?.success) {
        setSyncResult(res.data.data);
      } else {
        setError(res.data?.error || 'Sync failed');
      }
    } catch (err: any) {
      setError('Sync failed: ' + err.message);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-100 rounded-lg">
          <Building2 className="h-6 w-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Wave Accounting</h1>
          <p className="text-sm text-gray-500">Sync invoices and manage accounting with Wave (free)</p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2">
          <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Connection Status */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {status?.connected ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-gray-400" />
            )}
            <div>
              <p className="font-medium text-gray-900">
                {status?.connected ? 'Connected' : 'Not Connected'}
              </p>
              {status?.connected && status?.businessName && (
                <p className="text-sm text-gray-500">Business: {status.businessName}</p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            {status?.connected ? (
              <>
                <button
                  onClick={loadStatus}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-3 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 flex items-center gap-2"
                >
                  <Unlink className="h-4 w-4" />
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={handleConnect}
                disabled={!status?.configured}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Link2 className="h-4 w-4" />
                Connect Wave
              </button>
            )}
          </div>
        </div>

        {!status?.configured && (
          <p className="mt-3 text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
            ⚠️ Wave credentials not configured. Please set WAVE_CLIENT_ID and WAVE_CLIENT_SECRET in your environment variables.
          </p>
        )}
      </div>

      {/* Actions (only when connected) */}
      {status?.connected && (
        <>
          {/* Sync */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Invoice Sync
            </h3>

            <div className="flex items-center gap-4">
              <button
                onClick={handleSyncAll}
                disabled={syncing}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
              >
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {syncing ? 'Syncing...' : 'Sync All Unpaid Invoices'}
              </button>

              {status.lastSyncAt && (
                <p className="text-sm text-gray-500">
                  Last synced: {new Date(status.lastSyncAt).toLocaleString()}
                </p>
              )}
            </div>

            {/* Sync Result */}
            {syncResult && (
              <div className="mt-4 bg-gray-50 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-700">
                  ✅ Synced: {syncResult.synced} | ❌ Failed: {syncResult.failed} | Total: {syncResult.total}
                </p>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h3 className="font-medium text-gray-900 mb-4">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-3">
              <a
                href={`https://my.waveapps.com/`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm text-gray-700"
              >
                <ExternalLink className="h-4 w-4" />
                Open Wave Dashboard
              </a>
              <a
                href={`https://developer.waveapps.com/`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm text-gray-700"
              >
                <ExternalLink className="h-4 w-4" />
                Wave Developer Portal
              </a>
            </div>
          </div>
        </>
      )}

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 mb-2">💡 About Wave Integration</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• <strong>100% Free</strong> — Wave charges no fees for invoicing or accounting</li>
          <li>• Auto-sync your BizzAuto invoices to Wave</li>
          <li>• Track payments and reconcile accounts</li>
          <li>• Get your API credentials at <a href="https://developer.waveapps.com/" target="_blank" className="underline">developer.waveapps.com</a></li>
        </ul>
      </div>
    </div>
  );
}
