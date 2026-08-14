/**
 * Shared outbound proxy agent for server-to-external HTTPS calls.
 *
 * WHY THIS EXISTS
 * ---------------
 * Axios does NOT automatically honour `HTTPS_PROXY` / `HTTP_PROXY` environment
 * variables the way Node's native `fetch`/undici does. If the deployment runs
 * behind an egress proxy (common in sandboxed/Coolify/Docker networks where the
 * container has no direct internet), axios calls fail with a Node undici
 * `AggregateError` ("All connection attempts failed") — a raw connection-level
 * failure — while `fetch`-based calls (which read the proxy env) keep working.
 *
 * The WhatsApp service already wires a per-business proxy agent; the Google
 * Business Profile token exchange and API calls went through plain axios and
 * were hitting exactly that `AggregateError`. This helper makes every external
 * GBP call use the same egress path as the rest of the app.
 *
 * It is a no-op when no proxy env var is present, so it is safe everywhere.
 */
let cachedAgent: unknown = null;
let resolved = false;

export async function getHttpsProxyAgent(): Promise<unknown | undefined> {
  if (resolved) return cachedAgent;
  resolved = true;

  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;

  if (!proxyUrl) return undefined;

  try {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    cachedAgent = new HttpsProxyAgent(proxyUrl);
    // Redact credentials in the log so secrets never leak to stdout.
    const redacted = proxyUrl.replace(/\/\/[^@]*@/, '//***@');
    console.log('[HTTP] Outbound proxy agent enabled for external calls:', redacted);
    return cachedAgent;
  } catch (err) {
    console.error('[HTTP] Failed to initialise proxy agent:', (err as Error)?.message);
    return undefined;
  }
}
