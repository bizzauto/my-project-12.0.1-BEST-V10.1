import axios from 'axios';

/**
 * OneSignal Push Notification Service
 * Docs: https://onesignal.com/docs
 * Free tier: Unlimited push notifications, 10K web subscribers
 */

const ONESIGNAL_API_URL = 'https://onesignal.com/api/v1';

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
  console.warn('[OneSignal] ONESIGNAL_APP_ID and/or ONESIGNAL_REST_API_KEY not set. Push notifications will be unavailable.');
}

/**
 * OneSignal Push Notification Service
 * Send push notifications, manage players, and create campaigns
 */
export class OneSignalService {
  /**
   * Check if OneSignal is configured
   */
  static isConfigured(): boolean {
    return !!(ONESIGNAL_APP_ID && ONESIGNAL_REST_API_KEY);
  }

  /**
   * Get common headers for OneSignal API
   */
  private static getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Basic ${ONESIGNAL_REST_API_KEY}`,
    };
  }

  /**
   * Send a push notification
   */
  static async sendNotification(data: {
    title: string;
    body: string;
    url?: string;
    segment?: string;
    includePlayerIds?: string[];
    imageUrl?: string;
    buttons?: Array<{ id: string; text: string; url?: string }>;
  }): Promise<{
    success: boolean;
    id?: string;
    recipients?: number;
    error?: string;
  }> {
    try {
      const payload: any = {
        app_id: ONESIGNAL_APP_ID,
        contents: { en: data.body },
        headings: { en: data.title },
      };

      if (data.url) payload.url = data.url;
      if (data.imageUrl) payload.big_picture = data.imageUrl;
      if (data.buttons) {
        payload.buttons = data.buttons.map((b) => ({
          id: b.id,
          text: b.text,
          ...(b.url ? { url: b.url } : {}),
        }));
      }

      // Targeting
      if (data.includePlayerIds && data.includePlayerIds.length > 0) {
        payload.include_player_ids = data.includePlayerIds;
      } else if (data.segment) {
        payload.included_segments = [data.segment];
      } else {
        payload.included_segments = ['Subscribed Users'];
      }

      const response = await axios.post(`${ONESIGNAL_API_URL}/notifications`, payload, {
        headers: this.getHeaders(),
        timeout: 30000,
      });

      return {
        success: true,
        id: response.data.id,
        recipients: response.data.recipients,
      };
    } catch (error: any) {
      console.error('[OneSignal] Send notification failed:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errors?.[0] || error.message,
      };
    }
  }

  /**
   * Send bulk notifications to a segment
   */
  static async sendBulkNotifications(data: {
    title: string;
    body: string;
    segment: string;
    url?: string;
  }): Promise<{
    success: boolean;
    id?: string;
    recipients?: number;
    error?: string;
  }> {
    return this.sendNotification({
      title: data.title,
      body: data.body,
      segment: data.segment,
      url: data.url,
    });
  }

  /**
   * Get all available segments
   */
  static async listSegments(): Promise<{
    success: boolean;
    data?: Array<{ id: string; name: string; user_count: number }>;
    error?: string;
  }> {
    try {
      const response = await axios.get(`${ONESIGNAL_API_URL}/apps/${ONESIGNAL_APP_ID}/segments`, {
        headers: this.getHeaders(),
        timeout: 15000,
      });

      return {
        success: true,
        data: response.data.segments?.map((s: any) => ({
          id: s.id,
          name: s.name,
          user_count: s.user_count || 0,
        })) || [],
      };
    } catch (error: any) {
      console.error('[OneSignal] List segments failed:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get player/subscriber count
   */
  static async getStats(): Promise<{
    success: boolean;
    data?: { totalPlayers: number; subscribedPlayers: number };
    error?: string;
  }> {
    try {
      const response = await axios.get(`${ONESIGNAL_API_URL}/players?app_id=${ONESIGNAL_APP_ID}&limit=1`, {
        headers: this.getHeaders(),
        timeout: 15000,
      });

      return {
        success: true,
        data: {
          totalPlayers: response.data.total || 0,
          subscribedPlayers: response.data.total || 0,
        },
      };
    } catch (error: any) {
      console.error('[OneSignal] Get stats failed:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get app info
   */
  static async getAppInfo(): Promise<{
    success: boolean;
    data?: { name: string; id: string; gcmKey?: string; safariKey?: string };
    error?: string;
  }> {
    try {
      const response = await axios.get(`${ONESIGNAL_API_URL}/apps/${ONESIGNAL_APP_ID}`, {
        headers: this.getHeaders(),
        timeout: 15000,
      });

      const app = response.data;
      return {
        success: true,
        data: {
          name: app.name,
          id: app.id,
          gcmKey: app.gcm_key,
          safariKey: app.safari_web_cert_key,
        },
      };
    } catch (error: any) {
      console.error('[OneSignal] Get app info failed:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test connection by fetching app info
   */
  static async testConnection(): Promise<{
    success: boolean;
    data?: { appName: string; appId: string };
    error?: string;
  }> {
    try {
      const result = await this.getAppInfo();
      if (!result.success || !result.data) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        data: {
          appName: result.data.name,
          appId: result.data.id,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

export default OneSignalService;
