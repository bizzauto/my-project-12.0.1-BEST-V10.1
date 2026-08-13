import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret, JWT_OPTIONS } from '../utils/jwtConfig.js';

const speedTracker: Record<string, { count: number; windowStart: number }> = {};

/**
 * Decode SUPER_ADMIN role from the Bearer token WITHOUT a DB lookup.
 *
 * Used by global limiters that run BEFORE `authenticate` (so req.user is not
 * populated yet). Synchronous + token-only so it stays cheap on every request.
 * A malformed/missing token simply returns false → caller applies the limit.
 */
function isSuperAdminFromToken(req: Request): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  try {
    const decoded = jwt.verify(header.slice(7), getJwtSecret(), {
      algorithms: ['HS256'],
      audience: JWT_OPTIONS.audience,
      issuer: JWT_OPTIONS.issuer,
    }) as any;
    return decoded?.role === 'SUPER_ADMIN';
  } catch {
    return false;
  }
}

/**
 * Global Rate Limiter - Prevents brute force & DDoS
 * 100 requests per 15 minutes per IP
 */
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, error: 'Too many requests. Please try again in 15 minutes.', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

/**
 * Auth Rate Limiter - Stricter for login/register
 * 10 attempts per 15 minutes per IP
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, error: 'Too many auth attempts. Please try again in 15 minutes.', code: 'AUTH_RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  skipSuccessfulRequests: true,
  skip: (req) => req.method === 'GET' || req.method === 'OPTIONS',
});

/**
 * Login Specific Rate Limiter - Very strict
 * 5 failed attempts per 30 minutes
 */
export const loginRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many failed login attempts. Account locked for 30 minutes.', code: 'LOGIN_LOCKED' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

/**
 * API Rate Limiter - For public APIs
 * 30 requests per minute per IP
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many API requests. Please slow down.', code: 'API_RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

/**
 * File Upload Rate Limiter
 * 10 uploads per hour
 */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Upload limit reached. Please try again later.', code: 'UPLOAD_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  skip: (req) => isSuperAdminFromToken(req),
});

/**
 * Speed Limiter - Prevents aggressive scraping/crawling
 * Adds 100-300ms delay for requests exceeding 1 req/sec sustained
 */
export const speedLimiter = (req: Request, res: Response, next: NextFunction) => {
  // Superadmin bypass — never throttle the platform owner, regardless of IP.
  if (isSuperAdminFromToken(req)) return next();

  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const windowMs = 1000; // 1 second window

  if (!speedTracker[ip]) {
    speedTracker[ip] = { count: 0, windowStart: now };
  }

  const tracker = speedTracker[ip];
  if (now - tracker.windowStart > windowMs) {
    tracker.count = 0;
    tracker.windowStart = now;
  }

  tracker.count++;

  if (tracker.count > 1) {
    const delay = Math.min((tracker.count - 1) * 100, 300);
    setTimeout(next, delay);
  } else {
    next();
  }
};

/**
 * Webhook Rate Limiter - For external webhooks
 */
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, error: 'Webhook rate limit exceeded.', code: 'WEBHOOK_RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => req.body?.webhookSecret || 'unknown',
});

/**
 * Password Reset Rate Limiter
 */
export const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { success: false, error: 'Password reset limit reached. Try again in an hour.', code: 'PASSWORD_RESET_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

/**
 * OTP Rate Limiter
 */
export const otpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'OTP request limit reached. Try again in 10 minutes.', code: 'OTP_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

/**
 * AI API Rate Limiter - For expensive AI calls
 */
export const aiApiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, error: 'AI request limit reached. Please wait.', code: 'AI_RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  skip: (req) => isSuperAdminFromToken(req),
});

/**
 * Create dynamic rate limiter
 */
export const createDynamicRateLimiter = (max: number, windowMs: number) => {
  return rateLimit({
    windowMs,
    max,
    message: { success: false, error: 'Too many requests. Try again later.', code: 'DYNAMIC_RATE_LIMIT' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
  });
};