import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Shield,
  Zap,
  Settings,
  TestTube2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
} from 'lucide-react';
import { integrationsAPI } from '../lib/api';
import { PageSkeleton } from './Skeleton';
import ConfirmDialog from './ConfirmDialog';
import { useToast } from './Toast';

export interface Provider {
  id: string;
  name: string;
  description: string;
  authType: string;
  configFields: ConfigField[];
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'string' | 'password' | 'url' | 'number';
  required: boolean;
  default?: string;
  description?: string;
}

export interface Integration {
  id: string;
  businessId: string;
  provider: string;
  name: string;
  config: Record<string, any> | null;
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestStatus: 'success' | 'failed' | null;
  lastTestError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestResult {
  success: boolean;
  error?: string;
  details?: Record<string, any>;
}

const IntegrationsPage: React.FC = () => {
  const { success: showSuccess, error: showError, info: showInfo } = useToast();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState<Integration | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Integration | null>(null);
  const [showKey, setShowKey] = useState<string | null>(null);

  const loadIntegrations = useCallback(async () => {
    try {
      const res = await integrationsAPI.list();
      setIntegrations(res.data?.data || []);
    } catch {
      setIntegrations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProviders = useCallback(async () => {
    try {
      const res = await integrationsAPI.getProviders();
      setProviders(res.data?.data || []);
    } catch {
      setProviders([]);
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIntegrations();
    loadProviders();
  }, [loadIntegrations, loadProviders]);

  const handleProviderSelect = (provider: Provider) => {
    setSelectedProvider(provider);
    const initialConfig: Record<string, any> = {};
    provider.configFields.forEach(field => {
      if (field.default !== undefined) {
        initialConfig[field.key] = field.default;
      }
    });
    setFormData({
      provider: provider.id,
      name: '',
      apiKey: '',
      config: initialConfig,
    });
    setShowModal(true);
  };

  const handleEdit = (integration: Integration) => {
    setEditingIntegration(integration);
    const provider = providers.find(p => p.id === integration.provider);
    if (provider) {
      setSelectedProvider(provider);
      setFormData({
        provider: integration.provider,
        name: integration.name,
        apiKey: '', // Don't pre-fill for security
        config: integration.config || {},
      });
      setShowModal(true);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingIntegration(null);
    setSelectedProvider(null);
    setFormData({});
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleConfigChange = (key: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      config: { ...prev.config, [key]: value },
    }));
  };

  const handleSubmit = async () => {
    if (!formData.name?.trim() || !formData.apiKey?.trim()) {
      showError('Name and API Key are required');
      return;
    }

    if (!selectedProvider) {
      showError('Please select a provider');
      return;
    }

    // Validate required config fields
    for (const field of selectedProvider.configFields) {
      if (field.required && !formData.config?.[field.key]?.trim()) {
        showError(`${field.label} is required`);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (editingIntegration) {
        await integrationsAPI.update(editingIntegration.id, {
          name: formData.name,
          config: formData.config,
          apiKey: formData.apiKey || undefined, // Only send if provided
        });
        showSuccess('Integration updated successfully');
      } else {
        await integrationsAPI.create({
          provider: formData.provider,
          name: formData.name,
          apiKey: formData.apiKey,
          config: formData.config,
        });
        showSuccess('Integration created successfully');
      }
      handleCloseModal();
      loadIntegrations();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to save integration');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const res = await integrationsAPI.test(id);
      const result = res.data?.data as TestResult;
      if (result.success) {
        showSuccess('Connection test successful');
        if (result.details) {
          showInfo(`Details: ${JSON.stringify(result.details)}`);
        }
      } else {
        showError(result.error || 'Connection test failed');
      }
      loadIntegrations();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Test failed');
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await integrationsAPI.delete(deleteTarget.id);
      showSuccess('Integration deleted');
      loadIntegrations();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete');
    }
    setDeleteTarget(null);
  };

  const getProviderName = (providerId: string) => {
    return providers.find(p => p.id === providerId)?.name || providerId;
  };

  const getProviderIcon = (providerId: string) => {
    const icons: Record<string, React.ReactNode> = {
      whatsapp: <Zap size={20} className="text-green-500" />,
      shopify: <Settings size={20} className="text-purple-500" />,
      razorpay: <Shield size={20} className="text-blue-500" />,
      hubspot: <ExternalLink size={20} className="text-orange-500" />,
      zoho: <TestTube2 size={20} className="text-red-500" />,
      custom: <Settings size={20} className="text-gray-500" />,
    };
    return icons[providerId] || <Settings size={20} className="text-gray-500" />;
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="p-4 sm:p-5 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3">
            <Settings className="text-blue-600" size={32} />
            External Integrations
          </h1>
          <p className="text-gray-600">
            Connect your business to external services (WhatsApp, Shopify, Razorpay, HubSpot, Zoho, Custom APIs)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadIntegrations()}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => {
              setEditingIntegration(null);
              handleProviderSelect(providers[0]); // Will be overridden by dropdown
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus size={20} /> Add Integration
          </button>
        </div>
      </div>

      {/* Providers Dropdown for Add Integration */}
      <div className="mb-6">
        <div className="relative inline-block text-left">
          <div>
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              onClick={() => {
                setEditingIntegration(null);
                setSelectedProvider(null);
                setFormData({});
                setShowModal(true);
              }}
            >
              <Plus size={20} />
              <span>Add Integration</span>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {integrations.length === 0 ? (
          <div className="text-center py-12">
            <Settings size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-lg font-medium text-gray-900">No integrations configured</p>
            <p className="text-sm text-gray-500 mt-1">Add your first external integration to connect with other services</p>
            <button
              onClick={() => {
                setEditingIntegration(null);
                setSelectedProvider(null);
                setFormData({});
                setShowModal(true);
              }}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus size={20} /> Add Integration
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 sm:px-5 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Integration</th>
                  <th className="px-4 sm:px-5 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
                  <th className="px-4 sm:px-5 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 sm:px-5 md:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Tested</th>
                  <th className="px-4 sm:px-5 md:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {integrations.map(integration => (
                  <tr key={integration.id} className="hover:bg-gray-50">
                    <td className="px-4 sm:px-5 md:px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-gray-100 rounded-lg">
                          {getProviderIcon(integration.provider)}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{integration.name}</p>
                          <p className="text-sm text-gray-500 font-mono">{integration.id.slice(0, 8)}...</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 sm:px-5 md:px-6 py-4">
                      <span className="text-sm text-gray-700">{getProviderName(integration.provider)}</span>
                    </td>
                    <td className="px-4 sm:px-5 md:px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        integration.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {integration.isActive ? 'Active' : 'Inactive'}
                      </span>
                      {integration.lastTestStatus && (
                        <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          integration.lastTestStatus === 'success'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                        {integration.lastTestStatus === 'success' ? (
                          <>✓ Verified</>
                        ) : (
                          <>✗ Failed</>
                        )}
                      </span>
                      )}
                    </td>
                    <td className="px-4 sm:px-5 md:px-6 py-4 text-sm text-gray-500">
                      {integration.lastTestedAt
                        ? new Date(integration.lastTestedAt).toLocaleDateString()
                        : 'Never tested'}
                    </td>
                    <td className="px-4 sm:px-5 md:px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleTest(integration.id)}
                          disabled={testingId === integration.id}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="Test Connection"
                        >
                          {testingId === integration.id ? (
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                          ) : (
                            <TestTube2 size={16} />
                          )}
                        </button>
                        <button
                          onClick={() => handleEdit(integration)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="Edit"
                        >
                          <Settings size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(integration)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Delete"
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
        )}
      </div>

      {/* Provider Selection Modal (for Add) */}
      {!editingIntegration && showModal && providers.length > 0 && !selectedProvider && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Select Integration Provider</h2>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {providers.map(provider => (
                <button
                  key={provider.id}
                  onClick={() => handleProviderSelect(provider)}
                  className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors flex items-start gap-3"
                >
                  <div className="p-2 bg-gray-100 rounded-lg">
                    {getProviderIcon(provider.id)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">{provider.name}</p>
                    <p className="text-sm text-gray-500 truncate">{provider.description}</p>
                  </div>
                  <ChevronDown size={18} className="text-gray-400 mt-1" />
                </button>
              ))}
            </div>
            <button
              onClick={handleCloseModal}
              className="mt-4 w-full py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Integration Form Modal */}
      {(editingIntegration || selectedProvider) && showModal && selectedProvider && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-xl sm:rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-4 sm:p-5 md:p-6 border-b border-gray-100 sticky top-0 bg-white">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">
                  {editingIntegration ? 'Edit Integration' : `Add ${selectedProvider.name}`}
                </h2>
                <button
                  onClick={handleCloseModal}
                  className="p-1 text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
              {!editingIntegration && (
                <p className="text-sm text-gray-500 mt-1">{selectedProvider.description}</p>
              )}
            </div>

            <div className="p-4 sm:p-5 md:p-6 space-y-4">
              {/* Basic Fields */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Integration Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  placeholder="e.g., Main WhatsApp Account"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API Key {editingIntegration ? '<span className="text-gray-400">(leave blank to keep current)</span>' : ''}
                </label>
                <div className="relative">
                  <input
                    type={showKey === 'apiKey' ? 'text' : 'password'}
                    value={formData.apiKey}
                    onChange={(e) => handleInputChange('apiKey', e.target.value)}
                    placeholder={editingIntegration ? 'Leave blank to keep current key' : 'Enter API key / Access token'}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-12"
                    required={!editingIntegration}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(k => k === 'apiKey' ? null : 'apiKey')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showKey === 'apiKey' ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">Your API key is encrypted at rest and never displayed again after saving.</p>
              </div>

              {/* Provider-specific Config Fields */}
              {selectedProvider.configFields.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    <Settings size={16} />
                    {selectedProvider.name} Configuration
                  </h3>
                  <div className="space-y-3">
                    {selectedProvider.configFields.map(field => (
                      <div key={field.key}>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {field.label} {field.required && <span className="text-red-500">*</span>}
                        </label>
                        {field.type === 'password' ? (
                          <div className="relative">
                            <input
                              type={showKey === field.key ? 'text' : 'password'}
                              value={formData.config?.[field.key] || ''}
                              onChange={(e) => handleConfigChange(field.key, e.target.value)}
                              placeholder={field.description}
                              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-12"
                              required={field.required}
                            />
                            <button
                              type="button"
                              onClick={() => setShowKey(k => k === field.key ? null : field.key)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                              {showKey === field.key ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                          </div>
                        ) : (
                          <input
                            type={field.type}
                            value={formData.config?.[field.key] || field.default || ''}
                            onChange={(e) => handleConfigChange(field.key, e.target.value)}
                            placeholder={field.description}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            required={field.required}
                          />
                        )}
                        {field.description && (
                          <p className="text-xs text-gray-500 mt-1">{field.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-4 border-t border-gray-100">
                <button
                  onClick={handleCloseModal}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    editingIntegration ? 'Save Changes' : 'Create Integration'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Integration"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />

      {/* Provider List Reference */}
      <div className="mt-6 bg-blue-50 rounded-lg p-4 sm:p-5 md:p-6 border border-blue-200">
        <h3 className="font-semibold text-blue-900 mb-2">Supported Providers</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {providers.map(provider => (
            <div key={provider.id} className="bg-white p-3 rounded border border-gray-100">
              <div className="flex items-center gap-2 mb-1">
                <div className="p-1 bg-gray-100 rounded">{getProviderIcon(provider.id)}</div>
                <span className="font-medium text-gray-900">{provider.name}</span>
              </div>
              <p className="text-xs text-gray-500">{provider.description}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {provider.configFields.filter(f => f.required).map(f => (
                  <span key={f.key} className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{f.label}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default IntegrationsPage;