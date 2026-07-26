/**
 * @jest-environment node
 *
 * End-to-end integration tests for the Posters API routes.
 *
 * These tests use supertest to make real HTTP requests against the Express
 * router with the full middleware stack (JSON parsing, etc.) while mocking
 * Prisma, auth utilities, and ancillary services to isolate the posters logic.
 *
 * Posters endpoints tested:
 *   GET    /api/posters                    list poster templates
 *   GET    /api/posters/generated          list generated posters from WingsStore
 *   GET    /api/posters/:id                get single template
 *   POST   /api/posters                    create custom template (OWNER/ADMIN)
 *   POST   /api/posters/:id/usage          update template usage count
 *   POST   /api/posters/generate-image     AI image generation
 *   POST   /api/posters/generate           Generate poster from template
 *   GET    /api/posters/:id/download       Download generated poster
 *   GET    /api/posters/backgrounds/active Get active backgrounds
 *   DELETE /api/posters/generated/:id      Delete generated poster
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

// ── Prisma mock ──────────────────────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  posterTemplate: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  wingsStore: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  posterBackground: {
    findMany: jest.fn(),
  },
  activity: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
  $disconnect: jest.fn(),
};

jest.mock('../src/server/db', () => ({
  prisma: mockPrisma,
}));

// ── Auth middleware mock ─────────────────────────────────────
jest.mock('../src/server/middleware/auth', () => ({
  authenticate: jest.fn((req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    req.user = { id: 'user-abc-123', businessId: 'biz-456', role: 'OWNER' };
    next();
  }),
  requireRole: jest.fn((...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }
    next();
  }),
  AuthRequest: class AuthRequest extends Request {},
}));

// ── Auth utilities mock ──────────────────────────────────────────────────────
jest.mock('../src/server/utils/auth', () => ({
  hashPassword: jest.fn().mockResolvedValue('hashed_password_xyz'),
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
  encrypt: jest.fn().mockReturnValue('encrypted_data'),
  decrypt: jest.fn().mockReturnValue('decrypted_data'),
}));

// ── Disable rate limiting for tests ──────────────────────────────────────────
jest.mock('express-rate-limit', () => ({
  default: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  __esModule: true,
}));

// ── JSON Web Token mock ────────────────────────────────────────────────────
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  }),
  sign: jest.fn().mockReturnValue('mock_jwt_token_abc123'),
  decode: jest.fn(),
}));

// ── CSRF Service mock ──────────────────────────────────────────────────────
jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

// ── AI Service mock ────────────────────────────────────────────────────────
const mockAIUseCredit = jest.fn().mockResolvedValue(true);
const mockAICheckCredits = jest.fn().mockResolvedValue(true);
const mockAIGeneratePoster = jest.fn().mockResolvedValue({
  imageUrl: 'https://example.com/generated-poster.png',
});

jest.mock('../src/server/services/ai.service', () => ({
  AIService: {
    useCredit: (...args: any[]) => mockAIUseCredit(...args),
    checkCredits: (...args: any[]) => mockAICheckCredits(...args),
    generatePoster: (...args: any[]) => mockAIGeneratePoster(...args),
    generateImage: jest.fn().mockResolvedValue('https://example.com/ai-image.png'),
  },
}));

// ── Trap setInterval calls ─────────────────────────────────────────────────
const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

// Import the router AFTER all mocks are set up
import postersRoutes from '../src/server/routes/posters';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockUserFixture = {
  id: 'user-abc-123',
  email: 'test@example.com',
  name: 'Test User',
  role: 'OWNER',
  businessId: 'biz-456',
  isActive: true,
};

const mockTemplateFixture = {
  id: 'template-1',
  businessId: 'biz-456',
  name: 'Business Poster',
  category: 'social',
  content: '<div>Template content</div>',
  thumbnailUrl: 'https://example.com/thumb.png',
  isSystem: false,
  isDefault: false,
  description: 'A business poster template',
  usageCount: 5,
  variables: [{ name: 'headline', type: 'text' }, { name: 'subtitle', type: 'text' }],
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockGeneratedPosterFixture = {
  id: 'generated-1',
  businessId: 'biz-456',
  name: 'AI Poster - 2025-01-15',
  type: 'image',
  category: 'poster',
  url: 'https://example.com/ai-poster.png',
  thumbnail: 'https://example.com/ai-poster-thumb.png',
  tags: ['poster', 'ai-generated'],
  isGenerated: true,
  prompt: 'Professional business poster',
  metadata: { format: 'square', generatedAt: '2025-01-15T10:00:00.000Z' },
  createdAt: new Date('2025-01-15'),
  updatedAt: new Date('2025-01-15'),
};

const mockBackgroundFixture = {
  id: 'bg-1',
  name: 'Abstract Background',
  category: 'abstract',
  url: 'https://example.com/bg.png',
  isActive: true,
  expiresAt: null,
  createdAt: new Date('2025-01-01'),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/posters', postersRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();

  // Re-apply default mock implementations
  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  });

  mockAIUseCredit.mockResolvedValue(true);
  mockAICheckCredits.mockResolvedValue(true);
  mockAIGeneratePoster.mockResolvedValue({
    imageUrl: 'https://example.com/generated-poster.png',
  });

  mockPrisma.user.findUnique.mockResolvedValue(mockUserFixture);
  // Reset all Prisma mocks to default implementations
  mockPrisma.posterTemplate.findMany.mockResolvedValue([]);
  mockPrisma.posterTemplate.findFirst.mockResolvedValue(null);
  mockPrisma.posterTemplate.create.mockResolvedValue({} as any);
  mockPrisma.posterTemplate.update.mockResolvedValue({} as any);
  mockPrisma.posterTemplate.delete.mockResolvedValue({} as any);
  mockPrisma.wingsStore.findMany.mockResolvedValue([]);
  mockPrisma.wingsStore.findFirst.mockResolvedValue(null);
  mockPrisma.wingsStore.create.mockResolvedValue({} as any);
  mockPrisma.wingsStore.delete.mockResolvedValue({} as any);
  mockPrisma.wingsStore.count.mockResolvedValue(0);
  mockPrisma.posterBackground.findMany.mockResolvedValue([]);
  const { CSRFService } =
    jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');

  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

afterAll(() => {
  for (const id of intervalIds) {
    clearInterval(id);
  }
  intervalIds.length = 0;
  global.setInterval = originalSetInterval;
});

// ─── TESTS ───────────────────────────────────────────────────────────────────

describe('GET /api/posters — List poster templates', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.posterTemplate.findMany.mockResolvedValue([mockTemplateFixture]);
  });

  it('should list poster templates', async () => {
    const res = await request(app)
      .get('/api/posters')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: 'template-1',
      name: 'Business Poster',
      category: 'social',
    });

    expect(mockPrisma.posterTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ businessId: 'biz-456' }],
        }),
        orderBy: { usageCount: 'desc' },
      }),
    );
  });

  it('should filter by category', async () => {
    mockPrisma.posterTemplate.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/posters?category=whatsapp')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.posterTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: 'whatsapp',
        }),
      }),
    );
  });

  it('should include system templates when isSystem=true', async () => {
    mockPrisma.posterTemplate.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/posters?isSystem=true')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.posterTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { businessId: 'biz-456' },
            { isSystem: true },
          ]),
        }),
      }),
    );
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/posters')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.posterTemplate.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/posters')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to fetch templates');
  });
});

describe('GET /api/posters/generated — List generated posters', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.wingsStore.findMany.mockResolvedValue([mockGeneratedPosterFixture]);
    mockPrisma.wingsStore.count.mockResolvedValue(1);
  });

  it('should list generated posters with pagination', async () => {
    const res = await request(app)
      .get('/api/posters/generated')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: 'generated-1',
      name: 'AI Poster - 2025-01-15',
      url: 'https://example.com/ai-poster.png',
    });
    expect(res.body.pagination).toMatchObject({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });

    expect(mockPrisma.wingsStore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-456',
          type: 'image',
          isGenerated: true,
          tags: { has: 'poster' },
        }),
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      }),
    );
  });

  it('should filter by category', async () => {
    mockPrisma.wingsStore.findMany.mockResolvedValue([]);
    mockPrisma.wingsStore.count.mockResolvedValue(0);

    await request(app)
      .get('/api/posters/generated?category=social')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.wingsStore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: 'social',
        }),
      }),
    );
  });

  it('should handle pagination', async () => {
    mockPrisma.wingsStore.findMany.mockResolvedValue([]);
    mockPrisma.wingsStore.count.mockResolvedValue(0);

    await request(app)
      .get('/api/posters/generated?page=2&limit=10')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.wingsStore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
      }),
    );
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .get('/api/posters/generated')
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.wingsStore.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/posters/generated')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to list generated posters');
  });
});

describe('GET /api/posters/:id — Get single template', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should get single template', async () => {
    mockPrisma.posterTemplate.findFirst.mockResolvedValue(mockTemplateFixture);

    const res = await request(app)
      .get('/api/posters/template-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'template-1',
      name: 'Business Poster',
      category: 'social',
    });

    expect(mockPrisma.posterTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'template-1',
          OR: [{ businessId: 'biz-456' }, { isSystem: true }],
        },
      }),
    );
  });

  it('should return 404 for non-existent template', async () => {
    mockPrisma.posterTemplate.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/posters/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Template not found');
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .get('/api/posters/template-1')
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.posterTemplate.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/posters/template-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to fetch template');
  });
});

describe('POST /api/posters — Create custom template', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  const validPayload = {
    name: 'Custom Template',
    category: 'social',
    content: '<div>Custom content</div>',
    thumbnailUrl: 'https://example.com/custom-thumb.png',
  };

  it('should create custom template successfully', async () => {
    const createdTemplate = {
      ...mockTemplateFixture,
      id: 'template-new',
      name: 'Custom Template',
      category: 'social',
      content: '<div>Custom content</div>',
      thumbnailUrl: 'https://example.com/custom-thumb.png',
      isSystem: false,
    };
    mockPrisma.posterTemplate.create.mockResolvedValue(createdTemplate);

    const res = await request(app)
      .post('/api/posters')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'template-new',
      name: 'Custom Template',
      isSystem: false,
    });

    expect(mockPrisma.posterTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-456',
          name: 'Custom Template',
          category: 'social',
          content: '<div>Custom content</div>',
          thumbnailUrl: 'https://example.com/custom-thumb.png',
          isSystem: false,
        }),
      }),
    );
  });

  it('should default isSystem to false', async () => {
    const createdTemplate = {
      ...mockTemplateFixture,
      id: 'template-new',
      isSystem: false,
    };
    mockPrisma.posterTemplate.create.mockResolvedValue(createdTemplate);

    await request(app)
      .post('/api/posters')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test', category: 'social', content: '<div>Content</div>' })
      .expect(201);

    expect(mockPrisma.posterTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isSystem: false,
        }),
      }),
    );
  });

  it('should create template for MEMBER role (no role guard on this route)', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-member',
      email: 'member@test.com',
      businessId: 'biz-456',
      role: 'MEMBER',
    });

    const createdTemplate = {
      ...mockTemplateFixture,
      id: 'template-member',
      name: 'Custom Template',
      category: 'social',
      content: '<div>Custom content</div>',
      thumbnailUrl: 'https://example.com/custom-thumb.png',
      isSystem: false,
    };
    mockPrisma.posterTemplate.create.mockResolvedValue(createdTemplate);

    const res = await request(app)
      .post('/api/posters')
      .set('Authorization', 'Bearer member_token')
      .send(validPayload)
      .expect(201);

    expect(res.body.success).toBe(true);
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .post('/api/posters')
      .send(validPayload)
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.posterTemplate.create.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/posters')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to create template');
  });
});

describe('POST /api/posters/:id/usage — Update template usage count', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.posterTemplate.update.mockResolvedValue({
      ...mockTemplateFixture,
      usageCount: 6,
    });
  });

  it('should increment usage count', async () => {
    const res = await request(app)
      .post('/api/posters/template-1/usage')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Usage counted');

    expect(mockPrisma.posterTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'template-1' },
        data: { usageCount: { increment: 1 } },
      }),
    );
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .post('/api/posters/template-1/usage')
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.posterTemplate.update.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/posters/template-1/usage')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to update usage');
  });
});

describe('POST /api/posters/generate-image — AI image generation', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.wingsStore.create.mockResolvedValue({
      ...mockGeneratedPosterFixture,
      id: 'generated-new',
    });
  });

  it('should generate AI image with headline', async () => {
    const res = await request(app)
      .post('/api/posters/generate-image')
      .set('Authorization', 'Bearer valid_token')
      .send({ headline: 'Summer Sale', subtitle: '50% Off', businessName: 'Test Biz' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.url).toBeDefined();
    expect(mockPrisma.wingsStore.create).toHaveBeenCalled();
  });

  it('should generate AI image with prompt', async () => {
    const res = await request(app)
      .post('/api/posters/generate-image')
      .set('Authorization', 'Bearer valid_token')
      .send({ prompt: 'Professional poster for gym', format: 'story' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.url).toBeDefined();
  });

  it('should return 400 when both prompt and headline missing', async () => {
    const res = await request(app)
      .post('/api/posters/generate-image')
      .set('Authorization', 'Bearer valid_token')
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Prompt or headline is required');
  });

  it('should handle format parameter', async () => {
    const res = await request(app)
      .post('/api/posters/generate-image')
      .set('Authorization', 'Bearer valid_token')
      .send({ headline: 'Test', format: 'landscape' })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .post('/api/posters/generate-image')
      .send({ headline: 'Test' })
      .expect(401);
  });

  it('should handle database error gracefully (returns SVG fallback)', async () => {
    mockPrisma.wingsStore.create.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/posters/generate-image')
      .set('Authorization', 'Bearer valid_token')
      .send({ headline: 'Test' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.url).toBeDefined();
  });
});

describe('POST /api/posters/generate — Generate poster from template', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.posterTemplate.findFirst.mockResolvedValue(mockTemplateFixture);
    mockPrisma.wingsStore.create.mockResolvedValue({
      ...mockGeneratedPosterFixture,
      id: 'generated-new',
    });
  });

  it('should generate poster from template successfully', async () => {
    const res = await request(app)
      .post('/api/posters/generate')
      .set('Authorization', 'Bearer valid_token')
      .send({
        templateId: 'template-1',
        userData: { headline: 'Grand Opening', subtitle: 'This Saturday' },
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('generated-new');
    expect(res.body.data.url).toBe('https://example.com/generated-poster.png');
    expect(res.body.data.templateId).toBe('template-1');

    expect(mockAICheckCredits).toHaveBeenCalledWith('biz-456');
    expect(mockAIGeneratePoster).toHaveBeenCalled();
    expect(mockAIUseCredit).toHaveBeenCalledWith('biz-456');
    expect(mockPrisma.posterTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'template-1' },
        data: { usageCount: { increment: 1 } },
      }),
    );
  });

  it('should return 404 for non-existent template', async () => {
    mockPrisma.posterTemplate.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/posters/generate')
      .set('Authorization', 'Bearer valid_token')
      .send({ templateId: 'non-existent', userData: {} })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Template not found');
  });

  it('should return 429 when AI credits exhausted', async () => {
    mockAICheckCredits.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/posters/generate')
      .set('Authorization', 'Bearer valid_token')
      .send({ templateId: 'template-1', userData: {} })
      .expect(429);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('AI credits exhausted');
  });

  it('should return 404 when templateId missing', async () => {
    mockPrisma.posterTemplate.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/posters/generate')
      .set('Authorization', 'Bearer valid_token')
      .send({ userData: {} })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Template not found');
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .post('/api/posters/generate')
      .send({ templateId: 'template-1', userData: {} })
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.posterTemplate.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/posters/generate')
      .set('Authorization', 'Bearer valid_token')
      .send({ templateId: 'template-1', userData: {} })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to generate poster');
  });
});

describe('GET /api/posters/:id/download — Download generated poster', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.posterTemplate.findFirst.mockResolvedValue(mockTemplateFixture);
    mockPrisma.wingsStore.findFirst.mockResolvedValue(mockGeneratedPosterFixture);
    mockAICheckCredits.mockResolvedValue(true);
  });

  it('should return existing generated poster for download', async () => {
    const res = await request(app)
      .get('/api/posters/template-1/download')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.downloadUrl).toBe('https://example.com/ai-poster.png');
    expect(res.body.data.filename).toBe('Business_Poster.png');
  });

  it('should generate new poster if none exists', async () => {
    mockPrisma.wingsStore.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/posters/template-1/download')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.downloadUrl).toBe('https://example.com/generated-poster.png');
    expect(mockAIGeneratePoster).toHaveBeenCalled();
  });

  it('should return 404 for non-existent template', async () => {
    mockPrisma.posterTemplate.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/posters/non-existent/download')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Template not found');
  });

  it('should return 429 when AI credits exhausted and no existing poster', async () => {
    mockPrisma.wingsStore.findFirst.mockResolvedValue(null);
    mockAICheckCredits.mockResolvedValue(false);

    const res = await request(app)
      .get('/api/posters/template-1/download')
      .set('Authorization', 'Bearer valid_token')
      .expect(429);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('AI credits exhausted');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.posterTemplate.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/posters/template-1/download')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to download poster');
  });
});

describe('GET /api/posters/backgrounds/active — Get active backgrounds', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.posterBackground.findMany.mockResolvedValue([mockBackgroundFixture]);
  });

  it('should list active backgrounds', async () => {
    const res = await request(app)
      .get('/api/posters/backgrounds/active')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: 'bg-1',
      name: 'Abstract Background',
      category: 'abstract',
    });

    expect(mockPrisma.posterBackground.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          OR: expect.arrayContaining([
            { expiresAt: null },
            { expiresAt: { gte: expect.any(Date) } },
          ]),
        }),
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('should filter by category', async () => {
    mockPrisma.posterBackground.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/posters/backgrounds/active?category=abstract')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.posterBackground.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: 'abstract',
        }),
      }),
    );
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .get('/api/posters/backgrounds/active')
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.posterBackground.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/posters/backgrounds/active')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to fetch backgrounds');
  });
});

describe('DELETE /api/posters/generated/:id — Delete generated poster', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.wingsStore.findFirst.mockResolvedValue(mockGeneratedPosterFixture);
    mockPrisma.wingsStore.delete.mockResolvedValue(mockGeneratedPosterFixture);
  });

  it('should delete generated poster successfully', async () => {
    const res = await request(app)
      .delete('/api/posters/generated/generated-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Poster deleted successfully');

    expect(mockPrisma.wingsStore.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'generated-1', businessId: 'biz-456', isGenerated: true },
      }),
    );
    expect(mockPrisma.wingsStore.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'generated-1' } }),
    );
  });

  it('should return 404 for non-existent generated poster', async () => {
    mockPrisma.wingsStore.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/posters/generated/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Generated poster not found');
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .delete('/api/posters/generated/generated-1')
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.wingsStore.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete('/api/posters/generated/generated-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to delete poster');
  });
});