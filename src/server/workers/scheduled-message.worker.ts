import { Queue, Worker, Job } from 'bullmq';
import { prisma } from '../db.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { EvolutionApiService } from '../services/evolution.service.js';
import { WhatsAppRateLimiter } from '../services/whatsapp-rate-limiter.service.js';
import { createRedisConnection } from '../utils/redis-connection.js';

const redisConnection = createRedisConnection();

if (!redisConnection) {
  console.log('[Scheduled Message Worker] Redis not available — worker disabled');
}

// Queue for scheduled messages
export const scheduledMessageQueue = redisConnection ? new Queue('scheduled-messages', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 10000,
    },
  },
}) : null;

// Smart send: detects which WhatsApp channel is configured
async function smartSendText(businessId: string, to: string, message: string): Promise<any> {
  const evoIntegration = await prisma.integration.findFirst({
    where: { businessId, type: 'evolution_api', isActive: true },
  });
  if (evoIntegration) {
    try {
      return await EvolutionApiService.sendText(businessId, to, message);
    } catch (e) {
      console.warn('[Scheduled Worker] Evolution API failed, falling back to Meta');
    }
  }
  return await WhatsAppService.sendTextMessage(businessId, to, message);
}

// Scheduled message worker
const scheduledMessageWorker = redisConnection ? new Worker(
  'scheduled-messages',
  async (job: Job) => {
    const { messageId, businessId, phone, content, metadata } = job.data;

    console.log(`[Scheduled Worker] Processing message ${messageId} to ${phone}`);

    // Check rate limit
    const rateCheck = await WhatsAppRateLimiter.canSend(businessId, phone);
    if (!rateCheck.allowed) {
      // Re-queue with delay
      const delayMs = rateCheck.waitTimeMs || 60000;
      console.log(`[Scheduled Worker] Rate limited, re-queueing in ${delayMs}ms`);
      
      await scheduledMessageQueue?.add(
        'send-scheduled',
        {
          messageId,
          businessId,
          phone,
          content,
          metadata,
        },
        {
          delay: delayMs,
          priority: metadata?.priority === 'high' ? 1 : 0,
        }
      );
      
      return { requeued: true, delayMs };
    }

    // Send the message
    try {
      const result = await smartSendText(businessId, phone, content);
      WhatsAppRateLimiter.recordSend(businessId, phone);

      // Update message status
      await prisma.scheduledMessage.update({
        where: { id: messageId },
        data: {
          status: 'sent',
          sentAt: new Date(),
          waMessageId: result.messages?.[0]?.id,
        },
      });

      console.log(`[Scheduled Worker] Message ${messageId} sent successfully`);
      return { success: true, waMessageId: result.messages?.[0]?.id };
    } catch (error: any) {
      console.error(`[Scheduled Worker] Failed to send message ${messageId}:`, error.message);
      
      // Update message status
      await prisma.scheduledMessage.update({
        where: { id: messageId },
        data: {
          status: 'failed',
          error: error.message,
        },
      });

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // Process one message at a time to respect rate limits
  }
) : null;

// Worker event handlers
if (scheduledMessageWorker) {
  scheduledMessageWorker.on('completed', (job) => {
    console.log(`[Scheduled Worker] Job ${job.id} completed`);
  });

  scheduledMessageWorker.on('failed', (job, err) => {
    console.error(`[Scheduled Worker] Job ${job?.id} failed:`, err.message);
  });

  scheduledMessageWorker.on('error', (err) => {
    console.error('[Scheduled Worker] Worker error:', err.message);
  });
}

/**
 * Schedule a message for later sending
 */
export async function scheduleMessage(
  businessId: string,
  phone: string,
  content: string,
  options: {
    sendAt?: Date;
    priority?: 'high' | 'normal' | 'low';
    contactId?: string;
    metadata?: any;
  } = {}
): Promise<{ messageId: string; estimatedSendTime: Date }> {
  // Create message record
  const message = await prisma.scheduledMessage.create({
    data: {
      businessId,
      phone,
      content,
      contactId: options.contactId,
      scheduledAt: options.sendAt || new Date(),
      scheduledFor: options.sendAt || new Date(),
      priority: options.priority || 'normal',
      status: 'pending',
      metadata: options.metadata,
    },
  });

  // Add to queue
  const delayMs = options.sendAt 
    ? Math.max(0, options.sendAt.getTime() - Date.now())
    : 0;

  await scheduledMessageQueue?.add(
    'send-scheduled',
    {
      messageId: message.id,
      businessId,
      phone,
      content,
      metadata: options.metadata,
    },
    {
      delay: delayMs,
      priority: options.priority === 'high' ? 1 : 0,
      jobId: `scheduled:${message.id}`,
    }
  );

  return {
    messageId: message.id,
    estimatedSendTime: options.sendAt || new Date(),
  };
}

/**
 * Process pending scheduled messages (called periodically)
 */
export async function processPendingMessages(): Promise<number> {
  const pendingMessages = await prisma.scheduledMessage.findMany({
    where: {
      status: 'pending',
      scheduledFor: { lte: new Date() },
    },
    orderBy: [
      { priority: 'asc' }, // high first
      { scheduledFor: 'asc' },
    ],
    take: 50,
  });

  let processed = 0;
  for (const msg of pendingMessages) {
    try {
      await scheduleMessage(msg.businessId, msg.phone, msg.content, {
        sendAt: msg.scheduledFor || undefined,
        priority: msg.priority as any,
        contactId: msg.contactId || undefined,
        metadata: msg.metadata as any,
      });
      processed++;
    } catch (error: any) {
      console.error(`[Scheduler] Failed to queue message ${msg.id}:`, error.message);
    }
  }

  return processed;
}

// Cleanup function
export async function cleanupScheduledMessages(): Promise<number> {
  const result = await prisma.scheduledMessage.deleteMany({
    where: {
      status: { in: ['sent', 'failed'] },
      createdAt: { lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // 7 days old
    },
  });
  return result.count;
}

export { scheduledMessageWorker };
export default scheduledMessageWorker;
