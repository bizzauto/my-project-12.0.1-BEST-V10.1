import posthog from 'posthog-js';

let initialized = false;

/**
 * Initialize PostHog on the client side
 * Call this once at app startup
 */
export function initPostHog(): void {
  if (initialized || typeof window === 'undefined') return;

  const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
  if (!apiKey) {
    console.warn('[PostHog] VITE_POSTHOG_API_KEY not set — client analytics disabled');
    return;
  }

  posthog.init(apiKey, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    persistence: 'localStorage',
  });

  initialized = true;
  console.log('[PostHog] Client analytics initialized');
}

/**
 * Get the PostHog instance (for manual tracking)
 */
export function getPostHog() {
  return posthog;
}

/**
 * Track a custom event on the client
 */
export function trackEvent(event: string, properties?: Record<string, any>): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

/**
 * Identify the current user
 */
export function identifyUser(distinctId: string, properties?: Record<string, any>): void {
  if (!initialized) return;
  posthog.identify(distinctId, properties);
}

/**
 * Reset user identity (on logout)
 */
export function resetUser(): void {
  if (!initialized) return;
  posthog.reset();
}
