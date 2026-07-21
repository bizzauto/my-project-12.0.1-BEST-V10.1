import { useState, useEffect } from 'react';
import { posthogAnalyticsAPI } from '../lib/api';
import {
  BarChart3,
  Link2,
  Unlink,
  CheckCircle,
  XCircle,
  Loader2,
  ExternalLink,
  Send,
} from 'lucide-react';

interface PostHogStatus {
  configured: boolean;
  connected: boolean;
  host: string;
  dashboardUrl?: string;
  lastSyncAt?: string;
}

export default function PostHogSettings() {
  const [status, setStatus] = useState<PostHogStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState('');

  // Form state
  const [apiKey, setApiKey] = useState('');
  const [host, setHost] = useState('https://us.i.posthog.com');

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const res = await posthogAnalyticsAPI.getStatus();
      if (res.data?.success) {
        setStatus(res.data.data);
      }
    } catch (err: any) {
      console.error('Failed to load PostHog status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setError('API key is required');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const res = await posthogAnalyticsAPI.configure({ apiKey: apiKey.trim(), host });
      if (res.data?.success) {
        setStatus((prev) => prev ? { ...prev, connected: true } : null);
        setApiKey('');
      } else {
        setError(res.data?.error || 'Failed to save');
      }
    } catch (err: any) {
      setError('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect PostHog?')) return;
    try {
      await posthogAnalyticsAPI.disconnect();
      setStatus((prev) => prev ? { ...prev, connected: false } : null);
    } catch (err: any) {
      setError('Failed to disconnect');
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      const res = await posthogAnalyticsAPI.test();
      if (res.data?.success) {
        setTestResult({ success: true, message: 'Test event sent! Check your PostHog dashboard.' });
      } else {
        setTestResult({ success: false, message: res.data?.error || 'Test failed' });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: 'Test failed: ' + err.message });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-purple-100 rounded-lg">
          <BarChart3 className="h-6 w-6 text-purple-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PostHog Analytics</h1>
          <p className="text-sm text-gray-500">Product analytics — 1M events/month free</p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2">
          <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Test Result */}
      {testResult && (
        <div className={`border rounded-lg p-4 flex items-center gap-2 ${
          testResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          {testResult.success ? (
            <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
          )}
          <p className={`text-sm ${testResult.success ? 'text-green-700' : 'text-red-700'}`}>
            {testResult.message}
          </p>
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
              {status?.connected && (
                <p className="text-sm text-gray-500">Analytics active</p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            {status?.connected ? (
              <>
                <button
                  onClick={handleTest}
                  disabled={testing}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                >
                  {testing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Test Event
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-3 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 flex items-center gap-2"
                >
                  <Unlink className="h-4 w-4" />
                  Disconnect
                </button>
              </>
            ) : null}
          </div>
        </div>

        {/* Config Form (when not connected) */}
        {!status?.connected && (
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                PostHog Project API Key
              </label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="phc_your-project-api-key"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <p className="mt-1 text-xs text-gray-500">
                Find this in PostHog → Settings → Project API Key
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                PostHog Host
              </label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="https://us.i.posthog.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <p className="mt-1 text-xs text-gray-500">
                Use US cloud (default) or EU cloud (https://eu.i.posthog.com)
              </p>
            </div>

            <button
              onClick={handleSave}
              disabled={saving || !apiKey.trim()}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              {saving ? 'Saving...' : 'Connect PostHog'}
            </button>
          </div>
        )}
      </div>

      {/* Quick Links (when connected) */}
      {status?.connected && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="font-medium text-gray-900 mb-4">Dashboard Links</h3>
          <div className="grid grid-cols-2 gap-3">
            <a
              href={`${status.host}/project/events`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm text-gray-700"
            >
              <ExternalLink className="h-4 w-4" />
              Events
            </a>
            <a
              href={`${status.host}/project/insights`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm text-gray-700"
            >
              <ExternalLink className="h-4 w-4" />
              Insights
            </a>
            <a
              href={`${status.host}/project/recordings`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm text-gray-700"
            >
              <ExternalLink className="h-4 w-4" />
              Session Replay
            </a>
            <a
              href={`${status.host}/project/apps`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm text-gray-700"
            >
              <ExternalLink className="h-4 w-4" />
              Settings
            </a>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <h4 className="font-medium text-purple-900 mb-2">💡 What PostHog Tracks</h4>
        <ul className="text-sm text-purple-700 space-y-1">
          <li>• <strong>Page views</strong> — which pages users visit</li>
          <li>• <strong>Feature usage</strong> — which features are used most</li>
          <li>• <strong>AI generations</strong> — content creation events</li>
          <li>• <strong>Payments</strong> — subscription and invoice events</li>
          <li>• <strong>1M events/month free</strong> — no credit card required</li>
        </ul>
      </div>
    </div>
  );
}
