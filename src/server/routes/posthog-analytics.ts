import { Router, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { PostHogAnalyticsService } from '../services/posthog-analytics.service.js';

const router = Router();
router.use(authenticate);

/**
 * GET /api/analytics/posthog/status
 * Check PostHog configuration status
 */
router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const integration = await prisma.integration.findUnique({
      where: { businessId_type: { businessId, type: 'posthog' } },
    });

    return res.json({
      success: true,
      data: {
        configured: PostHogAnalyticsService.isConfigured(),
        connected: integration?.isActive || false,
        host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
        dashboardUrl: integration?.isActive
          ? `${process.env.POSTHOG_HOST || 'https://us.i.posthog.com'}/project/apps`
          : null,
        lastSyncAt: integration?.lastSyncAt || null,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/analytics/posthog/config
 * Save PostHog API key and host configuration
 */
router.post('/config', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { apiKey, host } = req.body;

    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'API key is required' });
    }

    // Save to Integration model
    await prisma.integration.upsert({
      where: { businessId_type: { businessId, type: 'posthog' } },
      create: {
        businessId,
        type: 'posthog',
        name: 'PostHog Analytics',
        config: {
          apiKey,
          host: host || 'https://us.i.posthog.com',
          captureBackend: true,
        },
        isActive: true,
      },
      update: {
        config: {
          apiKey,
          host: host || 'https://us.i.posthog.com',
          captureBackend: true,
        },
        isActive: true,
        lastError: null,
      },
    });

    return res.json({
      success: true,
      data: { message: 'PostHog configured successfully' },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/analytics/posthog/test
 * Send a test event to verify connectivity
 */
router.post('/test', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const result = PostHogAnalyticsService.testConnection(businessId);

    return res.json({
      success: result.success,
      data: result.success ? { message: 'Test event sent successfully' } : undefined,
      error: result.error,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/analytics/posthog/disconnect
 * Remove PostHog integration
 */
router.post('/disconnect', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    await prisma.integration.deleteMany({
      where: { businessId, type: 'posthog' },
    });

    return res.json({
      success: true,
      data: { message: 'PostHog disconnected successfully' },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/analytics/posthog/dashboard-url
 * Get the PostHog dashboard URL for easy access
 */
router.get('/dashboard-url', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const integration = await prisma.integration.findUnique({
      where: { businessId_type: { businessId, type: 'posthog' } },
    });

    if (!integration) {
      return res.status(404).json({ success: false, error: 'PostHog not configured' });
    }

    const config = integration.config as any;
    const host = config.host || process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

    return res.json({
      success: true,
      data: {
        dashboardUrl: `${host}/project/apps`,
        eventsUrl: `${host}/project/events`,
        insightsUrl: `${host}/project/insights`,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
