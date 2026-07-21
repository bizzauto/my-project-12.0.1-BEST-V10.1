import { Router, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireBusinessOwner, AuthRequest } from '../middleware/auth.js';
import { OneSignalService } from '../services/onesignal.service.js';

const router = Router();
router.use(authenticate);

/**
 * GET /api/push/onesignal/status
 * Check OneSignal configuration and stats
 */
router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const integration = await prisma.integration.findUnique({
      where: { businessId_type: { businessId, type: 'onesignal' } },
    });

    const connected = integration?.isActive || false;
    let stats = null;

    if (connected) {
      const statsResult = await OneSignalService.getStats();
      if (statsResult.success) {
        stats = statsResult.data;
      }
    }

    return res.json({
      success: true,
      data: {
        configured: OneSignalService.isConfigured(),
        connected,
        appId: integration ? (integration.config as any)?.appId : null,
        stats,
        lastSyncAt: integration?.lastSyncAt || null,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/push/onesignal/connect
 * Save OneSignal credentials
 */
router.post('/connect', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { appId, restApiKey } = req.body;

    if (!appId || !restApiKey) {
      return res.status(400).json({ success: false, error: 'App ID and REST API Key are required' });
    }

    // Test connection with provided credentials
    // Temporarily set env vars for the test
    const originalAppId = process.env.ONESIGNAL_APP_ID;
    const originalApiKey = process.env.ONESIGNAL_REST_API_KEY;

    process.env.ONESIGNAL_APP_ID = appId;
    process.env.ONESIGNAL_REST_API_KEY = restApiKey;

    const testResult = await OneSignalService.testConnection();

    // Restore original values
    if (originalAppId) process.env.ONESIGNAL_APP_ID = originalAppId;
    else delete process.env.ONESIGNAL_APP_ID;
    if (originalApiKey) process.env.ONESIGNAL_REST_API_KEY = originalApiKey;
    else delete process.env.ONESIGNAL_REST_API_KEY;

    if (!testResult.success) {
      return res.status(400).json({ success: false, error: `Connection test failed: ${testResult.error}` });
    }

    // Save to Integration model
    await prisma.integration.upsert({
      where: { businessId_type: { businessId, type: 'onesignal' } },
      create: {
        businessId,
        type: 'onesignal',
        name: 'OneSignal Push Notifications',
        config: {
          appId,
          restApiKey,
          appName: testResult.data?.appName,
        },
        isActive: true,
      },
      update: {
        config: {
          appId,
          restApiKey,
          appName: testResult.data?.appName,
        },
        isActive: true,
        lastError: null,
      },
    });

    return res.json({
      success: true,
      data: {
        message: 'OneSignal connected successfully',
        appName: testResult.data?.appName,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/push/onesignal/disconnect
 * Remove OneSignal integration
 */
router.post('/disconnect', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    await prisma.integration.deleteMany({
      where: { businessId, type: 'onesignal' },
    });

    return res.json({
      success: true,
      data: { message: 'OneSignal disconnected successfully' },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/push/onesignal/send
 * Send a push notification
 */
router.post('/send', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const integration = await prisma.integration.findUnique({
      where: { businessId_type: { businessId, type: 'onesignal' } },
    });

    if (!integration || !integration.isActive) {
      return res.status(400).json({ success: false, error: 'OneSignal not connected' });
    }

    const { title, body, url, segment } = req.body;

    if (!title || !body) {
      return res.status(400).json({ success: false, error: 'Title and body are required' });
    }

    // Temporarily set credentials
    const config = integration.config as any;
    const originalAppId = process.env.ONESIGNAL_APP_ID;
    const originalApiKey = process.env.ONESIGNAL_REST_API_KEY;

    process.env.ONESIGNAL_APP_ID = config.appId;
    process.env.ONESIGNAL_REST_API_KEY = config.restApiKey;

    const result = await OneSignalService.sendNotification({ title, body, url, segment });

    // Restore
    if (originalAppId) process.env.ONESIGNAL_APP_ID = originalAppId;
    else delete process.env.ONESIGNAL_APP_ID;
    if (originalApiKey) process.env.ONESIGNAL_REST_API_KEY = originalApiKey;
    else delete process.env.ONESIGNAL_REST_API_KEY;

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      data: {
        id: result.id,
        recipients: result.recipients,
        message: 'Notification sent successfully',
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/push/onesignal/segments
 * List available segments
 */
router.get('/segments', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const integration = await prisma.integration.findUnique({
      where: { businessId_type: { businessId, type: 'onesignal' } },
    });

    if (!integration || !integration.isActive) {
      return res.status(400).json({ success: false, error: 'OneSignal not connected' });
    }

    const config = integration.config as any;
    const originalAppId = process.env.ONESIGNAL_APP_ID;
    const originalApiKey = process.env.ONESIGNAL_REST_API_KEY;

    process.env.ONESIGNAL_APP_ID = config.appId;
    process.env.ONESIGNAL_REST_API_KEY = config.restApiKey;

    const result = await OneSignalService.listSegments();

    if (originalAppId) process.env.ONESIGNAL_APP_ID = originalAppId;
    else delete process.env.ONESIGNAL_APP_ID;
    if (originalApiKey) process.env.ONESIGNAL_REST_API_KEY = originalApiKey;
    else delete process.env.ONESIGNAL_REST_API_KEY;

    return res.json({
      success: result.success,
      data: result.data,
      error: result.error,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
