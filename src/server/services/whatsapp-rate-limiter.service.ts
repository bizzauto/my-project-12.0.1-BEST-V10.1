import { prisma } from '../db.js';

/**
 * WhatsApp Rate Limiter Service
 * Enforces 3 messages per minute per unique phone number
 * Prevents account ban and respects WhatsApp limits
 */
export class WhatsAppRateLimiter {
  // In-memory rate limit tracker (Redis-backed in production)
  private static rateLimitMap = new Map<string, number[]>();
  
  // Config
  private static readonly MAX_MESSAGES_PER_MINUTE = 3;
  private static readonly WINDOW_MS = 60 * 1000; // 1 minute
  private static readonly COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown after limit hit

  /**
   * Check if message can be sent to this phone number
   */
  static async canSend(businessId: string, phone: string): Promise<{
    allowed: boolean;
    waitTimeMs?: number;
    messagesInWindow: number;
    reason?: string;
  }> {
    const cleanPhone = this.cleanPhone(phone);
    const key = `${businessId}:${cleanPhone}`;
    const now = Date.now();

    // Get message timestamps for this phone in last minute
    const timestamps = this.rateLimitMap.get(key) || [];
    const recentTimestamps = timestamps.filter(t => now - t < this.WINDOW_MS);
    
    // Update the map
    this.rateLimitMap.set(key, recentTimestamps);

    // Check daily limit from database
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const todayMessages = await prisma.message.count({
      where: {
        businessId,
        to: cleanPhone,
        direction: 'outbound',
        createdAt: { gte: todayStart },
      },
    });

    // Check per-minute limit
    if (recentTimestamps.length >= this.MAX_MESSAGES_PER_MINUTE) {
      const oldestInWindow = Math.min(...recentTimestamps);
      const waitTimeMs = this.WINDOW_MS - (now - oldestInWindow);
      
      return {
        allowed: false,
        waitTimeMs,
        messagesInWindow: recentTimestamps.length,
        reason: `Rate limit: ${recentTimestamps.length}/${this.MAX_MESSAGES_PER_MINUTE} messages in last minute`,
      };
    }

    // Check if phone is in cooldown (was rate-limited recently)
    const lastBlockedKey = `blocked:${key}`;
    const lastBlocked = this.rateLimitMap.get(lastBlockedKey)?.[0];
    if (lastBlocked && now - lastBlocked < this.COOLDOWN_MS) {
      const waitTimeMs = this.COOLDOWN_MS - (now - lastBlocked);
      return {
        allowed: false,
        waitTimeMs,
        messagesInWindow: recentTimestamps.length,
        reason: `Cooldown: Phone was rate-limited ${Math.round((now - lastBlocked) / 1000)}s ago`,
      };
    }

    return {
      allowed: true,
      messagesInWindow: recentTimestamps.length,
    };
  }

  /**
   * Record that a message was sent
   */
  static recordSend(businessId: string, phone: string): void {
    const cleanPhone = this.cleanPhone(phone);
    const key = `${businessId}:${cleanPhone}`;
    const now = Date.now();

    const timestamps = this.rateLimitMap.get(key) || [];
    timestamps.push(now);
    
    // Keep only last minute
    const recentTimestamps = timestamps.filter(t => now - t < this.WINDOW_MS);
    this.rateLimitMap.set(key, recentTimestamps);
  }

  /**
   * Mark phone as rate-limited (enters cooldown)
   */
  static markRateLimited(businessId: string, phone: string): void {
    const cleanPhone = this.cleanPhone(phone);
    const key = `blocked:${businessId}:${cleanPhone}`;
    this.rateLimitMap.set(key, [Date.now()]);
  }

  /**
   * Queue message for delayed sending (respects rate limits)
   */
  static async queueMessage(
    businessId: string,
    phone: string,
    message: string,
    options: {
      priority?: 'high' | 'normal' | 'low';
      sendAt?: Date;
      metadata?: any;
    } = {}
  ): Promise<{
    queued: boolean;
    estimatedSendTime: Date;
    position?: number;
  }> {
    const cleanPhone = this.cleanPhone(phone);
    const canSendResult = await this.canSend(businessId, cleanPhone);

    // If can send immediately and no scheduled time
    if (canSendResult.allowed && !options.sendAt) {
      return {
        queued: false,
        estimatedSendTime: new Date(),
      };
    }

    // Calculate optimal send time
    let estimatedSendTime = options.sendAt || new Date();
    
    if (!canSendResult.allowed && canSendResult.waitTimeMs) {
      const waitSendTime = new Date(Date.now() + canSendResult.waitTimeMs);
      if (waitSendTime > estimatedSendTime) {
        estimatedSendTime = waitSendTime;
      }
    }

    // Store in database for retry
    await prisma.scheduledMessage.create({
      data: {
        businessId,
        phone: cleanPhone,
        message,
        scheduledFor: estimatedSendTime,
        priority: options.priority || 'normal',
        status: 'pending',
        metadata: options.metadata,
      },
    });

    return {
      queued: true,
      estimatedSendTime,
    };
  }

  /**
   * Get rate limit status for a phone number
   */
  static getStatus(businessId: string, phone: string): {
    messagesInWindow: number;
    maxMessages: number;
    resetInMs: number;
    isCooldown: boolean;
  } {
    const cleanPhone = this.cleanPhone(phone);
    const key = `${businessId}:${cleanPhone}`;
    const now = Date.now();

    const timestamps = this.rateLimitMap.get(key) || [];
    const recentTimestamps = timestamps.filter(t => now - t < this.WINDOW_MS);
    
    const oldestInWindow = recentTimestamps.length > 0 ? Math.min(...recentTimestamps) : now;
    const resetInMs = recentTimestamps.length > 0 
      ? Math.max(0, this.WINDOW_MS - (now - oldestInWindow))
      : 0;

    const blockedKey = `blocked:${key}`;
    const lastBlocked = this.rateLimitMap.get(blockedKey)?.[0];
    const isCooldown = lastBlocked ? (now - lastBlocked < this.COOLDOWN_MS) : false;

    return {
      messagesInWindow: recentTimestamps.length,
      maxMessages: this.MAX_MESSAGES_PER_MINUTE,
      resetInMs,
      isCooldown,
    };
  }

  /**
   * Clean phone number to consistent format
   */
  private static cleanPhone(phone: string): string {
    // Remove all non-digits
    let cleaned = phone.replace(/\D/g, '');
    
    // Remove leading zeros
    cleaned = cleaned.replace(/^0+/, '');
    
    // Remove country code if present (91 for India)
    if (cleaned.length === 12 && cleaned.startsWith('91')) {
      cleaned = cleaned.substring(2);
    }
    
    return cleaned;
  }

  /**
   * Cleanup old entries (call periodically)
   */
  static cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.rateLimitMap.entries()) {
      const recentTimestamps = timestamps.filter(t => now - t < this.WINDOW_MS);
      if (recentTimestamps.length === 0) {
        this.rateLimitMap.delete(key);
      } else {
        this.rateLimitMap.set(key, recentTimestamps);
      }
    }
  }
}

// Cleanup every 5 minutes
setInterval(() => WhatsAppRateLimiter.cleanup(), 5 * 60 * 1000);

export default WhatsAppRateLimiter;
