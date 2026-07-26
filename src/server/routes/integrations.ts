import { Router } from 'express';
import { authenticate, requireRole, type AuthRequest } from '../middleware/auth.js';
import { ExternalIntegrationService } from '../services/external-integration.service.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route GET /api/integrations
 * @desc List all external integrations for the business
 * @access Private (OWNER, ADMIN, MEMBER)
 */
router.get('/', async (req: AuthRequest, res) => {
  try {
    const businessId = req.user.businessId;
    if (!businessId) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const integrations = await ExternalIntegrationService.listByBusiness(businessId);
    res.json({ success: true, data: integrations });
  } catch (error: any) {
    console.error('List integrations error:', error);
    res.status(500).json({ success: false, error: 'Failed to list integrations' });
  }
});

/**
 * @route POST /api/integrations
 * @desc Create a new external integration
 * @access Private (OWNER, ADMIN)
 */
router.post('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  try {
    const businessId = req.user.businessId;
    if (!businessId) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { provider, name, apiKey, config } = req.body;

    // Validate required fields
    if (!provider || !name || !apiKey) {
      return res.status(400).json({
        success: false,
        error: 'Provider, name, and API key are required'
      });
    }

    // Validate provider
    const validProviders = ['whatsapp', 'shopify', 'razorpay', 'hubspot', 'zoho', 'custom'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        success: false,
        error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`
      });
    }

    const integration = await ExternalIntegrationService.create({
      businessId,
      provider,
      name,
      apiKey,
      config,
    });

    res.status(201).json({ success: true, data: integration });
  } catch (error: any) {
    console.error('Create integration error:', error);
    res.status(500).json({ success: false, error: 'Failed to create integration' });
  }
});

/**
 * @route GET /api/integrations/:id
 * @desc Get a single integration (without API key)
 * @access Private (OWNER, ADMIN, MEMBER)
 */
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const businessId = req.user.businessId;
    if (!businessId) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const integration = await ExternalIntegrationService.getById(req.params.id, businessId);

    if (!integration) {
      return res.status(404).json({ success: false, error: 'Integration not found' });
    }

    res.json({ success: true, data: integration });
  } catch (error: any) {
    console.error('Get integration error:', error);
    res.status(500).json({ success: false, error: 'Failed to get integration' });
  }
});

/**
 * @route PUT /api/integrations/:id
 * @desc Update an integration
 * @access Private (OWNER, ADMIN)
 */
router.put('/:id', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  try {
    const businessId = req.user.businessId;
    if (!businessId) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { name, config, apiKey, isActive } = req.body;

    const integration = await ExternalIntegrationService.update(
      req.params.id,
      businessId,
      { name, config, apiKey, isActive }
    );

    if (!integration) {
      return res.status(404).json({ success: false, error: 'Integration not found' });
    }

    res.json({ success: true, data: integration });
  } catch (error: any) {
    console.error('Update integration error:', error);
    res.status(500).json({ success: false, error: 'Failed to update integration' });
  }
});

/**
 * @route DELETE /api/integrations/:id
 * @desc Delete an integration
 * @access Private (OWNER, ADMIN)
 */
router.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  try {
    const businessId = req.user.businessId;
    if (!businessId) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    await ExternalIntegrationService.delete(req.params.id, businessId);
    res.json({ success: true, message: 'Integration deleted successfully' });
  } catch (error: any) {
    console.error('Delete integration error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete integration' });
  }
});

/**
 * @route POST /api/integrations/:id/test
 * @desc Test an integration connection
 * @access Private (OWNER, ADMIN)
 */
router.post('/:id/test', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  try {
    const businessId = req.user.businessId;
    if (!businessId) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const result = await ExternalIntegrationService.testIntegration(req.params.id, businessId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Test integration error:', error);
    res.status(500).json({ success: false, error: 'Failed to test integration' });
  }
});

/**
 * @route GET /api/integrations/providers/list
 * @desc Get list of supported providers with their config schema
 * @access Private
 */
router.get('/providers/list', (req: AuthRequest, res) => {
  const providers = [
    {
      id: 'whatsapp',
      name: 'WhatsApp Business API',
      description: 'Send WhatsApp messages, templates, and manage conversations',
      authType: 'bearer',
      configFields: [
        { key: 'phoneNumberId', label: 'Phone Number ID', type: 'string', required: true, description: 'WhatsApp Business Phone Number ID from Meta' },
        { key: 'businessAccountId', label: 'Business Account ID', type: 'string', required: false, description: 'Meta Business Account ID' },
        { key: 'webhookSecret', label: 'Webhook Verify Token', type: 'string', required: false, description: 'For receiving webhooks' },
      ],
    },
    {
      id: 'shopify',
      name: 'Shopify',
      description: 'Manage products, orders, customers in Shopify store',
      authType: 'header',
      configFields: [
        { key: 'shopDomain', label: 'Shop Domain', type: 'string', required: true, description: 'Your shop myshopify.com domain' },
      ],
    },
    {
      id: 'razorpay',
      name: 'Razorpay',
      description: 'Accept payments, manage subscriptions, payouts',
      authType: 'basic',
      configFields: [
        { key: 'keySecret', label: 'Key Secret', type: 'password', required: true, description: 'Razorpay Key Secret (or include in API key as key_id:key_secret)' },
        { key: 'webhookSecret', label: 'Webhook Secret', type: 'password', required: false, description: 'For verifying payment webhooks' },
      ],
    },
    {
      id: 'hubspot',
      name: 'HubSpot CRM',
      description: 'Sync contacts, deals, companies with HubSpot',
      authType: 'bearer',
      configFields: [
        { key: 'webhookSecret', label: 'Webhook Secret', type: 'password', required: false, description: 'For verifying HubSpot webhooks' },
      ],
    },
    {
      id: 'zoho',
      name: 'Zoho CRM',
      description: 'Manage leads, contacts, deals in Zoho CRM',
      authType: 'custom',
      configFields: [
        { key: 'organizationId', label: 'Organization ID', type: 'string', required: false, description: 'Zoho Organization ID' },
      ],
    },
    {
      id: 'custom',
      name: 'Custom REST API',
      description: 'Connect to any REST API with Bearer/Basic/Custom auth',
      authType: 'custom',
      configFields: [
        { key: 'baseUrl', label: 'Base URL', type: 'url', required: true, description: 'API base URL (e.g., https://api.example.com/v1)' },
        { key: 'authHeader', label: 'Auth Header Name', type: 'string', required: false, default: 'Authorization', description: 'Header name for authentication' },
        { key: 'authPrefix', label: 'Auth Prefix', type: 'string', required: false, default: 'Bearer', description: 'Prefix for auth value (Bearer, Basic, Token, etc.)' },
        { key: 'healthEndpoint', label: 'Health Check Endpoint', type: 'string', required: false, default: '/health', description: 'Endpoint to test connectivity' },
      ],
    },
  ];

  res.json({ success: true, data: providers });
});

export default router;