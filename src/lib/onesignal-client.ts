/**
 * OneSignal Client-Side Integration
 * Loads OneSignal Web SDK and manages push subscription
 */

let initialized = false;

/**
 * Initialize OneSignal on the client side
 * Call this once at app startup
 */
export async function initOneSignal(): Promise<void> {
  if (initialized || typeof window === 'undefined') return;

  const appId = import.meta.env.VITE_ONESIGNAL_APP_ID;
  if (!appId) {
    console.warn('[OneSignal] VITE_ONESIGNAL_APP_ID not set — push notifications disabled');
    return;
  }

  try {
    // @ts-ignore — OneSignal is loaded via CDN script
    if (typeof window.OneSignal !== 'undefined') {
      // @ts-ignore
      await window.OneSignal.init({
        appId,
        notifyButton: { enable: false },
        allowLocalhostAsSecureOrigin: window.location.hostname === 'localhost',
      });

      initialized = true;
      console.log('[OneSignal] Client initialized');
    } else {
      console.warn('[OneSignal] SDK not loaded — check if script tag is present');
    }
  } catch (error: any) {
    console.error('[OneSignal] Init failed:', error.message);
  }
}

/**
 * Request push notification permission
 */
export async function requestPushPermission(): Promise<boolean> {
  if (!initialized || typeof window === 'undefined') return false;

  try {
    // @ts-ignore
    const granted = await window.OneSignal?.Slidedown?.push();
    return !!granted;
  } catch (error: any) {
    console.error('[OneSignal] Permission request failed:', error.message);
    return false;
  }
}

/**
 * Get the current push subscription status
 */
export async function getSubscriptionStatus(): Promise<{ subscribed: boolean; userId?: string }> {
  if (!initialized || typeof window === 'undefined') {
    return { subscribed: false };
  }

  try {
    // @ts-ignore
    const isPushEnabled = await window.OneSignal?.isPushNotificationsEnabled();
    // @ts-ignore
    const userId = await window.OneSignal?.getUserId();

    return {
      subscribed: isPushEnabled,
      userId: userId || undefined,
    };
  } catch (error: any) {
    return { subscribed: false };
  }
}
