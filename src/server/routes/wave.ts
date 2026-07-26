import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireBusinessOwner, AuthRequest } from '../middleware/auth.js';
import { WaveService } from '../services/wave.service.js';

const router = Router();
router.use(authenticate);

/**
 * GET /api/wave/status
 * Check if Wave is configured and get business info
 */
router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const integration = await prisma.integration.findUnique({
      where: { businessId_type: { businessId, type: 'wave' } },
    });

    if (!integration || !integration.isActive) {
      return res.json({
        success: true,
        data: { connected: false, configured: WaveService.isConfigured() },
      });
    }

    const config = integration.config as any;
    return res.json({
      success: true,
      data: {
        connected: true,
        configured: WaveService.isConfigured(),
        businessName: config.businessName || null,
        waveBusinessId: config.waveBusinessId || null,
        autoSync: config.autoSync || false,
        lastSyncAt: integration.lastSyncAt,
        createdAt: integration.createdAt,
      },
    });
  } catch (error: any) {
    console.error('[Wave] Status check failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/wave/auth-url
 * Get OAuth authorization URL for Wave
 */
router.get('/auth-url', (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const redirectUri = `${process.env.BASE_URL || 'http://localhost:3001'}/api/wave/callback`;
    const state = Buffer.from(JSON.stringify({ businessId })).toString('base64');
    const authUrl = WaveService.getAuthUrl(redirectUri, state);

    return res.json({ success: true, data: { authUrl } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/wave/callback
 * Handle OAuth callback from Wave (public — no auth middleware)
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).json({ success: false, error: 'Missing code or state' });
    }

    const { businessId } = JSON.parse(Buffer.from(state as string, 'base64').toString());
    const redirectUri = `${process.env.BASE_URL || 'http://localhost:3001'}/api/wave/callback`;

    const tokenResult = await WaveService.exchangeCodeForToken(code as string, redirectUri);
    if (!tokenResult.success || !tokenResult.data) {
      return res.status(400).json({ success: false, error: tokenResult.error });
    }

    // Test connection to get business info
    const connectionTest = await WaveService.testConnection(tokenResult.data.accessToken);
    const businessName = connectionTest.success ? connectionTest.data?.businessName : null;
    const waveBusinessId = connectionTest.success ? connectionTest.data?.businessId : null;

    // Save to Integration model
    await prisma.integration.upsert({
      where: { businessId_type: { businessId, type: 'wave' } },
      create: {
        businessId,
        type: 'wave',
        name: 'Wave Accounting',
        config: {
          accessToken: tokenResult.data.accessToken,
          refreshToken: tokenResult.data.refreshToken,
          expiresIn: tokenResult.data.expiresIn,
          businessName,
          waveBusinessId,
          autoSync: false,
        },
        isActive: true,
      },
      update: {
        config: {
          accessToken: tokenResult.data.accessToken,
          refreshToken: tokenResult.data.refreshToken,
          expiresIn: tokenResult.data.expiresIn,
          businessName,
          waveBusinessId,
          autoSync: false,
        },
        isActive: true,
        lastError: null,
      },
    });

    // Redirect to frontend settings page
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/settings/wave?connected=true`);
  } catch (error: any) {
    console.error('[Wave] Callback failed:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/settings/wave?error=${encodeURIComponent(error.message)}`);
  }
});

/**
 * POST /api/wave/disconnect
 * Disconnect Wave integration
 */
router.post('/disconnect', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    await prisma.integration.deleteMany({
      where: { businessId, type: 'wave' },
    });

    return res.json({ success: true, data: { message: 'Wave disconnected successfully' } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/wave/accounts
 * List chart of accounts from Wave
 */
router.get('/accounts', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const integration = await prisma.integration.findUnique({
      where: { businessId_type: { businessId, type: 'wave' } },
    });

    if (!integration || !integration.isActive) {
      return res.status(400).json({ success: false, error: 'Wave not connected' });
    }

    const config = integration.config as any;
    const result = await WaveService.listAccounts(config.accessToken, config.waveBusinessId);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    return res.json({ success: true, data: result.data });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/wave/sync-invoice/:invoiceId
 * Sync a CRM invoice to Wave
 */
router.post('/sync-invoice/:invoiceId', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    const { invoiceId } = req.params;

    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const integration = await prisma.integration.findUnique({
      where: { businessId_type: { businessId, type: 'wave' } },
    });

    if (!integration || !integration.isActive) {
      return res.status(400).json({ success: false, error: 'Wave not connected' });
    }

    const config = integration.config as any;

    // Get the CRM invoice
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    if (invoice.businessId !== businessId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Create customer in Wave if needed
    const customerName = 'Customer';
    const customerEmail = '';

    const customerResult = await WaveService.createCustomer(
      config.accessToken,
      config.waveBusinessId,
      {
        name: customerName,
        email: customerEmail,
      }
    );

    if (!customerResult.success) {
      return res.status(400).json({ success: false, error: `Customer creation failed: ${customerResult.error}` });
    }

    // Create invoice in Wave
    const waveLineItems = [
      {
        description: 'Invoice',
        quantity: 1,
        unitPrice: invoice.amount || 0,
      },
    ];

    const invoiceResult = await WaveService.createInvoice(
      config.accessToken,
      config.waveBusinessId,
      {
        customerId: customerResult.data.id,
        lineItems: waveLineItems,
      }
    );

    if (!invoiceResult.success) {
      return res.status(400).json({ success: false, error: `Invoice creation failed: ${invoiceResult.error}` });
    }

    // Update integration lastSyncAt
    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSyncAt: new Date() },
    });

    return res.json({
      success: true,
      data: {
        waveInvoiceId: invoiceResult.data.id,
        message: 'Invoice synced to Wave successfully',
      },
    });
  } catch (error: any) {
    console.error('[Wave] Sync invoice failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/wave/sync-all
 * Sync all unpaid CRM invoices to Wave
 */
router.post('/sync-all', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const integration = await prisma.integration.findUnique({
      where: { businessId_type: { businessId, type: 'wave' } },
    });

    if (!integration || !integration.isActive) {
      return res.status(400).json({ success: false, error: 'Wave not connected' });
    }

    // Get all unpaid invoices
    const unpaidInvoices = await prisma.invoice.findMany({
      where: { businessId, status: { not: 'paid' } },
      take: 50, // Limit to prevent timeout
    });

    const results = [];
    for (const invoice of unpaidInvoices) {
      try {
        // Reuse the sync logic
        const config = integration.config as any;

        const customerResult = await WaveService.createCustomer(
          config.accessToken,
          config.waveBusinessId,
          {
            name: 'Customer',
            email: '',
          }
        );

        if (!customerResult.success) {
          results.push({ invoiceId: invoice.id, success: false, error: customerResult.error });
          continue;
        }

        const waveLineItems = [
          {
            description: 'Invoice',
            quantity: 1,
            unitPrice: invoice.amount || 0,
          },
        ];

        const invoiceResult = await WaveService.createInvoice(
          config.accessToken,
          config.waveBusinessId,
          {
            customerId: customerResult.data.id,
            lineItems: waveLineItems,
          }
        );

        results.push({
          invoiceId: invoice.id,
          success: invoiceResult.success,
          waveInvoiceId: invoiceResult.data?.id,
          error: invoiceResult.error,
        });
      } catch (err: any) {
        results.push({ invoiceId: invoice.id, success: false, error: err.message });
      }
    }

    // Update lastSyncAt
    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastSyncAt: new Date() },
    });

    const synced = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return res.json({
      success: true,
      data: { synced, failed, total: unpaidInvoices.length, results },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/wave/last-sync
 * Get last sync info
 */
router.get('/last-sync', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const integration = await prisma.integration.findUnique({
      where: { businessId_type: { businessId, type: 'wave' } },
      select: { lastSyncAt: true, lastError: true, isActive: true },
    });

    return res.json({
      success: true,
      data: {
        lastSyncAt: integration?.lastSyncAt || null,
        lastError: integration?.lastError || null,
        isActive: integration?.isActive || false,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
