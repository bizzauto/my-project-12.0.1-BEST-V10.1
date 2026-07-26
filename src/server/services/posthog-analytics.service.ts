import { PostHog } from 'posthog-node';

/**
 * PostHog Analytics Service
 * Docs: https://posthog.com/docs
 * Free tier: 1 million events/month
 */

let _client: PostHog | null = null;

function getClient(): PostHog | null {
  if (_client) return _client;

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return null;

  _client = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
  });

  console.log('[PostHog] Analytics initialized');
  return _client;
}

/**
 * PostHog Analytics Service
 * Track events, identify users, and manage analytics
 */
export class PostHogAnalyticsService {
  /**
   * Check if PostHog is configured
   */
  static isConfigured(): boolean {
    return !!process.env.POSTHOG_API_KEY;
  }

  /**
   * Initialize PostHog (call at server startup)
   */
  static init(): void {
    const client = getClient();
    if (client) {
      console.log('[PostHog] Analytics service ready');
    } else {
      console.warn('[PostHog] POSTHOG_API_KEY not set — analytics disabled');
    }
  }

  /**
   * Capture an analytics event
   */
  static capture(event: {
    distinctId: string;
    event: string;
    properties?: Record<string, any>;
    group?: { type: string; key: string };
  }): void {
    try {
      const client = getClient();
      if (!client) return;

      client.capture({
        distinctId: event.distinctId,
        event: event.event,
        properties: event.properties || {},
        groups: event.group ? { [event.group.type]: event.group.key } : undefined,
      });
    } catch (error: any) {
      console.error('[PostHog] Capture failed:', error.message);
    }
  }

  /**
   * Identify a user with properties
   */
  static identify(distinctId: string, properties: Record<string, any>): void {
    try {
      const client = getClient();
      if (!client) return;

      client.identify({
        distinctId,
        properties,
      });
    } catch (error: any) {
      console.error('[PostHog] Identify failed:', error.message);
    }
  }

  /**
   * Track a business-level event (convenience method)
   */
  static trackBusinessEvent(
    businessId: string,
    event: string,
    properties?: Record<string, any>
  ): void {
    this.capture({
      distinctId: businessId,
      event,
      properties: {
        ...properties,
        source: 'server',
      },
      group: { type: 'business', key: businessId },
    });
  }

  /**
   * Flush pending events (call on shutdown)
   */
  static async flush(): Promise<void> {
    try {
      const client = getClient();
      if (!client) return;
      await client.shutdown();
      console.log('[PostHog] Events flushed');
    } catch (error: any) {
      console.error('[PostHog] Flush failed:', error.message);
    }
  }

  /**
   * Test connection by sending a test event
   */
  static testConnection(businessId: string): { success: boolean; error?: string } {
    try {
      this.capture({
        distinctId: businessId,
        event: 'integration_test',
        properties: { test: true, timestamp: new Date().toISOString() },
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

export default PostHogAnalyticsService;
