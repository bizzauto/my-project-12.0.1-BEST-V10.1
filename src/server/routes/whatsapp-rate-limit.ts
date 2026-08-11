import { Router } from 'express';
import { prisma } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { WhatsAppRateLimiter } from '../services/whatsapp-rate-limiter.service.js';
import { scheduleMessage, processPendingMessages, cleanupScheduledMessages } from '../workers/scheduled-message.worker.js';

const router = Router();

/**
 * GET /api/whatsapp/rate-limit/:phone
 * Check rate limit status for a phone number
 */
router.get('/rate-limit/:phone', authenticate, async (req: any, res: any) => {
  try {
    const { phone } = req.params;
    const businessId = req.user.businessId;

    const status = WhatsAppRateLimiter.getStatus(businessId, phone);
    
    res.json({
      success: true,
      data: {
        phone,
        ...status,
        canSendNow: status.messagesInWindow < status.maxMessages && !status.isCooldown,
      },
    });
  } catch (error: any) {
    console.error('Rate limit check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check rate limit',
      details: error.message,
    });
  }
});

/**
 * POST /api/whatsapp/schedule-message
 * Schedule a message for later sending
 */
router.post('/schedule-message', authenticate, async (req: any, res: any) => {
  try {
    const { phone, message, sendAt, priority, contactId, metadata } = req.body;
    const businessId = req.user.businessId;

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: 'Phone and message are required',
      });
    }

    const result = await scheduleMessage(businessId, phone, message, {
      sendAt: sendAt ? new Date(sendAt) : undefined,
      priority: priority || 'normal',
      contactId,
      metadata,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Schedule message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to schedule message',
      details: error.message,
    });
  }
});

/**
 * POST /api/whatsapp/process-pending
 * Manually trigger processing of pending scheduled messages
 */
router.post('/process-pending', authenticate, async (req: any, res: any) => {
  try {
    const processed = await processPendingMessages();
    
    res.json({
      success: true,
      data: {
        processed,
        message: `Processed ${processed} pending messages`,
      },
    });
  } catch (error: any) {
    console.error('Process pending error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process pending messages',
      details: error.message,
    });
  }
});

/**
 * DELETE /api/whatsapp/cleanup-old
 * Cleanup old scheduled messages (sent/failed > 7 days)
 */
router.delete('/cleanup-old', authenticate, async (req: any, res: any) => {
  try {
    const deleted = await cleanupScheduledMessages();
    
    res.json({
      success: true,
      data: {
        deleted,
        message: `Cleaned up ${deleted} old messages`,
      },
    });
  } catch (error: any) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup old messages',
      details: error.message,
    });
  }
});

/**
 * GET /api/whatsapp/scheduled-stats
 * Get stats about scheduled messages
 */
router.get('/scheduled-stats', authenticate, async (req: any, res: any) => {
  try {
    const businessId = req.user.businessId;

    const [pending, sent, failed] = await Promise.all([
      prisma.scheduledMessage.count({
        where: { businessId, status: 'pending' },
      }),
      prisma.scheduledMessage.count({
        where: { businessId, status: 'sent' },
      }),
      prisma.scheduledMessage.count({
        where: { businessId, status: 'failed' },
      }),
    ]);

    const recentScheduled = await prisma.scheduledMessage.findMany({
      where: { businessId, status: 'pending' },
      orderBy: { scheduledFor: 'asc' },
      take: 10,
      select: {
        id: true,
        phone: true,
        content: true,
        scheduledFor: true,
        priority: true,
        status: true,
      },
    });

    res.json({
      success: true,
      data: {
        stats: { pending, sent, failed },
        upcoming: recentScheduled,
      },
    });
  } catch (error: any) {
    console.error('Scheduled stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get scheduled stats',
      details: error.message,
    });
  }
});

export default router;
