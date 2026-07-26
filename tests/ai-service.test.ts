/**
 * @jest-environment node
 *
 * AI Service Route Tests
 *
 * Tests all AI route endpoints via supertest with mocked dependencies.
 * The ai.ts route uses callAIProvider() (same-file function) which calls axios.post.
 * We mock axios so the AI provider calls return controlled responses.
 * The AIService.useCredit mock returns true by default; set to false to test exhaustion.
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies (hoisted by Jest) ─────────────────────────────────────

// Mock prisma
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  contact: { findMany: jest.fn() },
  lead: { findMany: jest.fn() },
  appointment: { findMany: jest.fn() },
  auditLog: { findUnique: jest.fn() },
  business: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock('../src/server/db', () => ({ prisma: mockPrisma }));

// Mock axios — needed by callAIProvider() in the route
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock AIService
const mockUseCredit = jest.fn().mockResolvedValue(true);
jest.mock('../src/server/services/ai.service', () => ({
  AIService: {
    useCredit: (...args: any[]) => mockUseCredit(...args),
  },
}));

// ── Auth utilities mock (needed by authenticate middleware) ─────────────────
jest.mock('../src/server/utils/auth', () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
  generateToken: jest.fn().mockReturnValue('mock_jwt_token_abc123'),
  generateRefreshToken: jest.fn().mockReturnValue('mock_refresh_token'),
  verifyToken: jest.fn().mockResolvedValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  }),
  getJwtSecret: jest.fn().mockReturnValue('test-secret'),
  encrypt: jest.fn().mockReturnValue('enc'),
  decrypt: jest.fn().mockReturnValue('dec'),
  verifyRefreshToken: jest.fn(),
}));

// ── CSRF Service mock ──────────────────────────────────────────────────────
jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

// ── JSON Web Token mock ────────────────────────────────────────────────────
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-abc-123' }),
  sign: jest.fn().mockReturnValue('mock_jwt_token_abc123'),
  decode: jest.fn(),
}));

// Set env vars so the AI provider check passes
process.env.OPENROUTER_API_KEY = 'sk-test-openrouter-key';
process.env.GROK_API_KEY = 'sk-test-grok-key';

// Import router after mocks
import aiRoutes from '../src/server/routes/ai';

// ─── Trap setInterval from any module ──────────────────────────────────────
const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AI_RESPONSE_TEXT = 'This is the AI generated response text for testing purposes.';

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();

  // Default: authentication succeeds
  const utils = jest.requireMock('../src/server/utils/auth');
  utils.verifyToken.mockResolvedValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  });

  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
    isActive: true,
    emailVerified: new Date(),
  });

  // Default: credit check passes
  mockUseCredit.mockResolvedValue(true);

  // Default: axios.post returns a valid AI response (OpenRouter format)
  mockedAxios.post.mockResolvedValue({
    data: {
      choices: [{ message: { content: AI_RESPONSE_TEXT } }],
    },
  });
}

afterAll(() => {
  for (const id of intervalIds) {
    clearInterval(id);
  }
  intervalIds.length = 0;
  global.setInterval = originalSetInterval;
});

// ─── TESTS ───────────────────────────────────────────────────────────────────

describe('POST /api/ai/generate', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should generate AI content successfully', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .set('Authorization', 'Bearer valid_token')
      .send({ type: 'simple', prompt: 'Write a marketing tagline for a gym' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.text).toBe(AI_RESPONSE_TEXT);
    expect(res.body.data.model).toBeDefined();
    expect(res.body.data.tokensUsed).toBeGreaterThan(0);
    expect(res.body.data.creditsDeducted).toBeGreaterThan(0);

    // Verify credit was consumed
    expect(mockUseCredit).toHaveBeenCalledWith('biz-456', expect.any(Number));
  });

  it('should reject empty prompt', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .set('Authorization', 'Bearer valid_token')
      .send({ type: 'simple', prompt: '' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Prompt is required');
  });

  it('should reject long prompt (>10000 characters)', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .set('Authorization', 'Bearer valid_token')
      .send({ type: 'simple', prompt: 'x'.repeat(10001) })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('too long');
  });

  it('should handle credit exhaustion (return 429)', async () => {
    mockUseCredit.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/ai/generate')
      .set('Authorization', 'Bearer valid_token')
      .send({ type: 'simple', prompt: 'Write a tagline' })
      .expect(429);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('credits');
  });
});

describe('POST /api/ai/caption', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should generate a caption successfully', async () => {
    const res = await request(app)
      .post('/api/ai/caption')
      .set('Authorization', 'Bearer valid_token')
      .send({ topic: 'Summer Sale', businessType: 'retail', platform: 'instagram' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.caption).toBe(AI_RESPONSE_TEXT);
    expect(mockUseCredit).toHaveBeenCalledWith('biz-456');
  });
});

describe('POST /api/ai/hashtags', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should generate hashtags successfully', async () => {
    const res = await request(app)
      .post('/api/ai/hashtags')
      .set('Authorization', 'Bearer valid_token')
      .send({ topic: 'fitness', platform: 'instagram' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.hashtags).toBe(AI_RESPONSE_TEXT);
    expect(mockUseCredit).toHaveBeenCalledWith('biz-456');
  });
});

describe('POST /api/ai/review-reply', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should generate a review reply successfully', async () => {
    const res = await request(app)
      .post('/api/ai/review-reply')
      .set('Authorization', 'Bearer valid_token')
      .send({
        reviewText: 'Great service!',
        rating: 5,
        businessType: 'restaurant',
        businessName: 'Tasty Bites',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.reply).toBe(AI_RESPONSE_TEXT);
    expect(mockUseCredit).toHaveBeenCalledWith('biz-456');
  });
});
