import { useState, useEffect } from 'react';
import { oneSignalAPI } from '../lib/api';
import {
  Bell,
  Link2,
  Unlink,
  CheckCircle,
  XCircle,
  Loader2,
  Send,
  Users,
  Layers,
} from 'lucide-react';

interface OneSignalStatus {
  configured: boolean;
  connected: boolean;
  appId?: string;
  stats?: { totalPlayers: number; subscribedPlayers: number };
  lastSyncAt?: string;
}

interface Segment {
  id: string;
  name: string;
  user_count: number;
}

export default function OneSignalSettings() {
  const [status, setStatus] = useState<OneSignalStatus | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [appId, setAppId] = useState('');
  const [restApiKey, setRestApiKey] = useState('');

  // Send form
  const [sendTitle, setSendTitle] = useState('');
  const [sendBody, setSendBody] = useState('');
  const [sendSegment, setSendSegment] = useState('Subscribed Users');

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const res = await oneSignalAPI.getStatus();
      if (res.data?.success) {
        setStatus(res.data.data);
        if (res.data.data.connected) {
          loadSegments();
        }
      }
    } catch (err: any) {
      console.error('Failed to load OneSignal status:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSegments = async () => {
    try {
      const res = await oneSignalAPI.getSegments();
      if (res.data?.success && res.data.data) {
        setSegments(res.data.data);
      }
    } catch (err: any) {
      console.error('Failed to load segments:', err);
    }
  };

  const handleConnect = async () => {
    if (!appId.trim() || !restApiKey.trim()) {
      setError('Both App ID and REST API Key are required');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const res = await oneSignalAPI.connect({ appId: appId.trim(), restApiKey: restApiKey.trim() });
      if (res.data?.success) {
        setStatus((prev) => prev ? { ...prev, connected: true } : null);
        setAppId('');
        setRestApiKey('');
        loadSegments();
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
    if (!confirm('Are you sure you want to disconnect OneSignal?')) return;
    try {
      await oneSignalAPI.disconnect();
      setStatus((prev) => prev ? { ...prev, connected: false } : null);
      setSegments([]);
    } catch (err: any) {
      setError('Failed to disconnect');
    }
  };

  const handleSend = async () => {
    if (!sendTitle.trim() || !sendBody.trim()) {
      setError('Title and body are required');
      return;
    }

    try {
      setSending(true);
      setError('');
      setSuccess('');
      const res = await oneSignalAPI.send({
        title: sendTitle,
        body: sendBody,
        segment: sendSegment,
      });
      if (res.data?.success) {
        setSuccess(`Notification sent to ${res.data.data?.recipients || 0} subscribers!`);
        setSendTitle('');
        setSendBody('');
      } else {
        setError(res.data?.error || 'Failed to send');
      }
    } catch (err: any) {
      setError('Failed to send: ' + (err.response?.data?.error || err.message));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-red-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-red-100 rounded-lg">
          <Bell className="h-6 w-6 text-red-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">OneSignal Push Notifications</h1>
          <p className="text-sm text-gray-500">Send push notifications — free tier available</p>
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
              {status?.connected && status?.stats && (
                <p className="text-sm text-gray-500">
                  <Users className="inline h-3 w-3 mr-1" />
                  {status.stats.subscribedPlayers} subscribers
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
              <label className="block text-sm font-medium text-gray-700 mb-1">App ID</label>
              <input
                type="text"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="your-onesignal-app-id"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">REST API Key</label>
              <input
                type="password"
                value={restApiKey}
                onChange={(e) => setRestApiKey(e.target.value)}
                placeholder="your-rest-api-key"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              <p className="mt-1 text-xs text-gray-500">
                Find in OneSignal → Settings → Keys &amp; IDs
              </p>
            </div>

            <button
              onClick={handleConnect}
              disabled={saving || !appId.trim() || !restApiKey.trim()}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {saving ? 'Connecting...' : 'Connect OneSignal'}
            </button>
          </div>
        )}
      </div>

      {/* Send Notification (when connected) */}
      {status?.connected && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
            <Send className="h-4 w-4" />
            Send Push Notification
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={sendTitle}
                onChange={(e) => setSendTitle(e.target.value)}
                placeholder="Notification title"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
              <textarea
                value={sendBody}
                onChange={(e) => setSendBody(e.target.value)}
                placeholder="Notification message..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Segment</label>
              <select
                value={sendSegment}
                onChange={(e) => setSendSegment(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              >
                <option value="Subscribed Users">All Subscribers</option>
                {segments.map((seg) => (
                  <option key={seg.id} value={seg.name}>
                    {seg.name} ({seg.user_count} users)
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleSend}
              disabled={sending || !sendTitle.trim() || !sendBody.trim()}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? 'Sending...' : 'Send Notification'}
            </button>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h4 className="font-medium text-red-900 mb-2">💡 OneSignal Free Tier</h4>
        <ul className="text-sm text-red-700 space-y-1">
          <li>• <strong>Unlimited</strong> push notifications</li>
          <li>• <strong>10,000</strong> web subscribers included</li>
          <li>• Targeted segments and scheduling</li>
          <li>• Get started at <a href="https://onesignal.com/" target="_blank" className="underline">onesignal.com</a></li>
        </ul>
      </div>
    </div>
  );
}
