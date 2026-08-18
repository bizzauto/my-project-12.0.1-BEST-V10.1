import { prisma } from '../db.js';

/**
 * IndiaMART automatic IMAP autosync poller.
 *
 * Pulls IndiaMART enquiry emails into the CRM without manual intervention:
 *   - one global ticker every 5 minutes (startIndiaMARTAutosync)
 *   - per-business throttling keyed by businessId (config.syncInterval minutes)
 *   - per-business isolation so a single failure never kills the rest of the loop
 *
 * Kept in its own module (only the prisma client as a static import) so it can
 * be unit-tested without dragging in the BullMQ / worker graph.
 */

const INDIA_MART_AUTOSYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const INDIA_MART_SYNC_LOOKBACK_MS = 24 * 60 * 60 * 1000; // last 24h

// Per-business throttle: businessId -> last completed run timestamp (ms)
const lastRunByBusiness = new Map<string, number>();

/** Exported so tests can drive a single tick / inspect throttle state. */
export function getIndiaMARTAutosyncState(): { lastRunByBusiness: Map<string, number> } {
  return { lastRunByBusiness };
}

/**
 * Run the IndiaMART autosync for one business.
 * Decrypts the stored IMAP config and delegates to IndiaMARTEmailService.
 * Throws are caught by the caller's per-business guard.
 */
async function runIndiaMARTSyncForBusiness(businessId: string, config: any): Promise<void> {
  const { IndiaMARTEmailService } = await import('./indiamart-email.service.js');
  const { decrypt } = await import('../utils/auth.js');

  const emailConfig = {
    imapHost: config.imapHost,
    imapPort: Number(config.imapPort) || 993,
    email: config.email,
    password: decrypt(config.password || ''),
    useSSL: config.useSSL !== false,
  };

  if (!emailConfig.imapHost || !emailConfig.email || !emailConfig.password) {
    throw new Error('IndiaMART IMAP config incomplete (missing host, email, or password)');
  }

  const since = new Date(Date.now() - INDIA_MART_SYNC_LOOKBACK_MS);
  await IndiaMARTEmailService.processIndiaMARTEmails(businessId, emailConfig, { since });
}

/**
 * One autosync tick: fetch all active indiamart_email integrations with
 * autoSync enabled and run them, throttled per business and isolated so a
 * single failure never kills the rest of the loop.
 */
export async function indiamartAutosyncTick(): Promise<{ processed: number; errors: string[] }> {
  const result = { processed: 0, errors: [] as string[] };

  let integrations: any[] = [];
  try {
    integrations = await prisma.integration.findMany({
      where: {
        type: 'indiamart_email',
        isActive: true,
        // config is JSON; autoSync lives inside it. Filter defensively in JS
        // because not all DB engines index JSON fields the same way.
      },
    });
  } catch (err: any) {
    console.error('[IndiaMART Autosync] Failed to load integrations:', err?.message || err);
    result.errors.push(`integration-load: ${err?.message || err}`);
    return result;
  }

  const now = Date.now();

  for (const integration of integrations) {
    const businessId = integration.businessId;
    const config = (integration.config as any) || {};

    // Only run integrations explicitly opted into auto-sync.
    if (!config.autoSync) {
      continue;
    }

    // Per-business throttle: respect config.syncInterval (minutes, default 60).
    const syncIntervalMs = Math.max(1, Number(config.syncInterval) || 60) * 60 * 1000;
    const lastRun = lastRunByBusiness.get(businessId) || 0;
    if (now - lastRun < syncIntervalMs) {
      continue; // throttled — skip until the interval elapses
    }

    try {
      await runIndiaMARTSyncForBusiness(businessId, config);
      lastRunByBusiness.set(businessId, now);
      result.processed++;
      // Best-effort bookkeeping so ops can see last sync time.
      try {
        await prisma.integration.update({
          where: { id: integration.id },
          data: { lastSyncAt: new Date(now) },
        });
      } catch { /* non-fatal */ }
    } catch (err: any) {
      const msg = `[IndiaMART Autosync] Business ${businessId} sync failed: ${err?.message || err}`;
      console.error(msg);
      result.errors.push(msg);
      try {
        await prisma.integration.update({
          where: { id: integration.id },
          data: { lastError: err?.message || String(err) },
        });
      } catch { /* non-fatal */ }
    }
  }

  return result;
}

let indiamartAutosyncTimer: ReturnType<typeof setInterval> | null = null;

/** Start the global IndiaMART autosync poller (5-minute interval). */
export function startIndiaMARTAutosync(): void {
  if (indiamartAutosyncTimer) return; // idempotent — never double-register
  console.log(`[IndiaMART Autosync] Starting poller (every ${INDIA_MART_AUTOSYNC_INTERVAL_MS / 60000} min)`);
  indiamartAutosyncTimer = setInterval(() => {
    indiamartAutosyncTick()
      .then((r) => {
        if (r.processed > 0 || r.errors.length > 0) {
          console.log(`[IndiaMART Autosync] tick complete — processed: ${r.processed}, errors: ${r.errors.length}`);
        }
      })
      .catch((err) => {
        console.error('[IndiaMART Autosync] tick crashed (should not happen):', err);
      });
  }, INDIA_MART_AUTOSYNC_INTERVAL_MS);
  // Do not keep the event loop alive solely for this timer.
  if (typeof indiamartAutosyncTimer.unref === 'function') {
    (indiamartAutosyncTimer as any).unref();
  }
}
