import { useState, useEffect } from 'react';
import { brevoEmailAPI } from '../lib/api';
import {
  Mail,
  Link2,
  Unlink,
  CheckCircle,
  XCircle,
  Loader2,
  Send,
  Users,
  List,
  TestTube,
} from 'lucide-react';

interface BrevoStatus {
  configured: boolean;
  connected: boolean;
  accountInfo?: { email: string; plan: string; dailyLimit: number };
  defaultFromEmail?: string;
  lastSyncAt?: string;
}

interface BrevoList {
  id: number;
  name: string;
  totalContacts: number;
}

export default function BrevoEmailSettings() {
  const [status, setStatus] = useState<BrevoStatus | null>(null);
  const [lists, setLists] = useState<BrevoList[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Config form
  const [apiKey, setApiKey] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');

  // Test form
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);

  // Sync form
  const [syncListId, setSyncListId] = useState<number | ''>('');
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const res = await brevoEmailAPI.getStatus();
      if (res.data?.success) {
        setStatus(res.data.data);
        if (res.data.data.connected) loadLists();
      }
    } catch (err: any) {
      console.error('Failed to load Brevo status:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadLists = async () => {
    try {
      const res = await brevoEmailAPI.getLists();
      if (res.data?.success && res.data.data) {
        setLists(res.data.data);
      }
    } catch (err: any) {
      console.error('Failed to load lists:', err);
    }
  };

  const handleConnect = async () => {
    if (!apiKey.trim()) {
      setError('API key is required');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const res = await brevoEmailAPI.connect({
        apiKey: apiKey.trim(),
        defaultFromEmail: fromEmail.trim() || undefined,
        defaultFromName: fromName.trim() || undefined,
      });
      if (res.data?.success) {
        setStatus((prev) => prev ? { ...prev, connected: true } : null);
        setApiKey('');
        setFromEmail('');
        setFromName('');
        loadLists();
      } else {
        setError(res.data?.error || 'Failed to connect');
      }
    } catch (err: any) {
      setError('Failed to connect: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Brevo?')) return;
    try {
      await brevoEmailAPI.disconnect();
      setStatus((prev) => prev ? { ...prev, connected: false } : null);
      setLists([]);
    } catch (err: any) {
      setError('Failed to disconnect');
    }
  };

  const handleTest = async () => {
    if (!testEmail.trim()) {
      setError('Enter a recipient email');
      return;
    }

    try {
      setTesting(true);
      setError('');
      setSuccess('');
      const res = await brevoEmailAPI.test({ to: testEmail.trim() });
      if (res.data?.success) {
        setSuccess('Test email sent! Check your inbox.');
        setTestEmail('');
      } else {
        setError(res.data?.error || 'Failed to send test');
      }
    } catch (err: any) {
      setError('Failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    if (!syncListId) {
      setError('Select a Brevo list to sync to');
      return;
    }

    try {
      setSyncing(true);
      setError('');
      setSuccess('');
      const res = await brevoEmailAPI.syncContacts({ listId: Number(syncListId) });
      if (res.data?.success) {
        const { synced, failed, total } = res.data.data;
        setSuccess(`Synced ${synced}/${total} contacts (${failed} failed)`);
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
          <Mail className="h-6 w-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Brevo Email</h1>
          <p className="text-sm text-gray-500">Email campaigns — 300 emails/day free</p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2">
          <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {/* Connection Status */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
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
              {status?.connected && status?.accountInfo && (
                <p className="text-sm text-gray-500">
                  {status.accountInfo.email} — {status.accountInfo.plan} plan
                </p>
              )}
            </div>
          </div>

          {status?.connected && (
            <button
              onClick={handleDisconnect}
              className="px-3 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 flex items-center gap-2"
            >
              <Unlink className="h-4 w-4" />
              Disconnect
            </button>
          )}
        </div>

        {/* Config Form */}
        {!status?.connected && (
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brevo API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="xkeysib-your-brevo-api-key"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="mt-1 text-xs text-gray-500">
                Find in Brevo → Settings → API Keys
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default From Email</label>
                <input
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="noreply@yourdomain.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default From Name</label>
                <input
                  type="text"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="Your Business"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <button
              onClick={handleConnect}
              disabled={saving || !apiKey.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {saving ? 'Connecting...' : 'Connect Brevo'}
            </button>
          </div>
        )}
      </div>

      {/* Test Email (when connected) */}
      {status?.connected && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
            <TestTube className="h-4 w-4" />
            Send Test Email
          </h3>
          <div className="flex gap-3">
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="test@example.com"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleTest}
              disabled={testing || !testEmail.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send Test
            </button>
          </div>
        </div>
      )}

      {/* Contact Sync (when connected) */}
      {status?.connected && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
            <Users className="h-4 w-4" />
            Sync Contacts to Brevo
          </h3>

          {lists.length > 0 ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Brevo List</label>
                <select
                  value={syncListId}
                  onChange={(e) => setSyncListId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select a list...</option>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name} ({list.totalContacts} contacts)
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleSync}
                disabled={syncing || !syncListId}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
              >
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                {syncing ? 'Syncing...' : 'Sync BizzAuto Contacts'}
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No Brevo lists found. Create one in your Brevo dashboard first.</p>
          )}

          {status.lastSyncAt && (
            <p className="mt-3 text-xs text-gray-400">
              Last synced: {new Date(status.lastSyncAt).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 mb-2">💡 Brevo Free Tier</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• <strong>300 emails/day</strong> — unlimited contacts</li>
          <li>• Transactional + marketing emails</li>
          <li>• Contact management and lists</li>
          <li>• Get started at <a href="https://www.brevo.com/" target="_blank" className="underline">brevo.com</a></li>
        </ul>
      </div>
    </div>
  );
}
