/**
 * Error sanitization utility for production-safe error responses.
 * Prevents leaking internal details (database errors, file paths, stack traces) to clients.
 */

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Sanitize an error for client-facing responses.
 * In production, returns only a generic message.
 * In development, returns the original error message for debugging.
 */
export function sanitizeError(error: unknown, fallback: string = 'Internal server error'): string {
  if (!isProduction) {
    // Dev mode: return original error for debugging
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return fallback;
  }

  // Production: never leak internal details
  return fallback;
}

/**
 * Send a sanitized error response.
 * Use this in catch blocks instead of returning error.message directly.
 */
export function sendError(res: any, statusCode: number, message: string, error?: unknown): void {
  res.status(statusCode).json({
    success: false,
    error: message,
    // Only include details in non-production
    ...(isProduction ? {} : { details: error instanceof Error ? error.message : String(error) }),
  });
}
