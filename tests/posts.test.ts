/**
 * @jest-environment node
 *
 * End-to-end integration tests for the Posts API routes.
 *
 * These tests use supertest to make real HTTP requests against the Express
 * router with the full middleware stack (JSON parsing, etc.) while mocking
 * Prisma, auth utilities, and ancillary services to isolate the posts logic.
 *
 * Posts endpoints tested:
 *   GET    /api/posts              list posts with pagination/filters
 *   GET    /api/posts/:id          get single post
 *   POST   /api/posts              create post
 *   PUT    /api/posts/:id          update post (draft/scheduled only)
 *   DELETE /api/posts/:id          delete post
 *   POST   /api/posts/:id/schedule schedule post
 *   POST   /api/posts/:id/publish  publish post
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────
// All jest.mock calls MUST be at the top level so Jest hoists them above imports.

// ── Prisma mock ──────────────────────────────────────────────────────────────
const mockPrisma = {
  post: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
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

// ── JSON Web Token mock (used by authenticate middleware) ────────────────────
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

// ── CSRF Service mock (dynamically imported in authenticate middleware) ──────
jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

// ── Trap setInterval calls (auth.ts OTP cleanup) so we can clean them up ─────
const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

// Import the router AFTER all mocks are set up
import postsRoutes from '../src/server/routes/posts';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockUserFixture = {
  id: 'user-abc-123',
  email: 'test@example.com',
  name: 'Test User',
  role: 'OWNER',
  businessId: 'biz-456',
  isActive: true,
};

const mockPostFixture = {
  id: 'post-1',
  businessId: 'biz-456',
  content: 'Test post content',
  mediaUrls: [],
  platforms: ['instagram', 'facebook'],
  scheduledAt: null,
  status: 'draft',
  link: null,
  createdBy: 'user-abc-123',
  publishedAt: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/posts', postsRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();

  // Re-apply default mock implementations
  const {
    hashPassword, comparePassword, generateToken, verifyToken,
  } = jest.requireMock('../src/server/utils/auth');
  hashPassword.mockResolvedValue('hashed_password_xyz');
  comparePassword.mockReset();
  generateToken.mockReturnValue('mock_jwt_token_abc123');
  verifyToken.mockResolvedValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  });

  // Default mock for prisma.user.findUnique (used by authenticate middleware)
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
    isActive: true,
    emailVerified: true,
  });

  const { CSRFService } =
    jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');

  // Default transaction mock
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

afterAll(() => {
  // Clear the OTP cleanup interval from auth.ts so Jest can exit cleanly
  for (const id of intervalIds) {
    clearInterval(id);
  }
  intervalIds.length = 0;
  global.setInterval = originalSetInterval;
});

// ─── TESTS ───────────────────────────────────────────────────────────────────

describe('GET /api/posts — List posts', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.post.findMany.mockResolvedValue([mockPostFixture]);
    mockPrisma.post.count.mockResolvedValue(1);
  });

  it('should list posts with pagination', async () => {
    const res = await request(app)
      .get('/api/posts')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.posts).toHaveLength(1);
    expect(res.body.data.posts[0]).toMatchObject({
      id: 'post-1',
      content: 'Test post content',
      status: 'draft',
      platforms: ['instagram', 'facebook'],
    });
    expect(res.body.data.pagination).toMatchObject({
      total: 1,
      page: 1,
      limit: 50,
    });

    expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-456' },
        skip: 0,
        take: 50,
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(mockPrisma.post.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'biz-456' } }),
    );
  });

  it('should apply status filter', async () => {
    mockPrisma.post.findMany.mockResolvedValue([]);
    mockPrisma.post.count.mockResolvedValue(0);

    await request(app)
      .get('/api/posts?status=published')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-456',
          status: 'published',
        }),
      }),
    );
  });

  it('should apply platforms filter', async () => {
    mockPrisma.post.findMany.mockResolvedValue([]);
    mockPrisma.post.count.mockResolvedValue(0);

    await request(app)
      .get('/api/posts?platforms=instagram')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-456',
          platforms: { has: 'instagram' },
        }),
      }),
    );
  });

  it('should handle pagination params', async () => {
    mockPrisma.post.findMany.mockResolvedValue([]);
    mockPrisma.post.count.mockResolvedValue(0);

    await request(app)
      .get('/api/posts?page=2&limit=10')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
      }),
    );
  });

  it('should handle empty results', async () => {
    mockPrisma.post.findMany.mockResolvedValue([]);
    mockPrisma.post.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/posts')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.posts).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/posts')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.post.findMany.mockRejectedValue(new Error('DB connection failed'));

    const res = await request(app)
      .get('/api/posts')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to fetch posts');
  });
});

describe('GET /api/posts/:id — Get single post', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should get single post', async () => {
    mockPrisma.post.findFirst.mockResolvedValue(mockPostFixture);

    const res = await request(app)
      .get('/api/posts/post-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'post-1',
      content: 'Test post content',
      status: 'draft',
    });

    expect(mockPrisma.post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'post-1', businessId: 'biz-456' },
      }),
    );
  });

  it('should return 404 for non-existent post', async () => {
    mockPrisma.post.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/posts/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Post not found');
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/posts/post-1')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.post.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/posts/post-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to fetch post');
  });
});

describe('POST /api/posts — Create post', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  const validPayload = {
    content: 'New post content',
    platforms: ['instagram', 'twitter'],
    scheduledAt: null,
  };

  it('should create post successfully', async () => {
    const createdPost = {
      ...mockPostFixture,
      id: 'post-new',
      content: 'New post content',
      platforms: ['instagram', 'twitter'],
      status: 'draft',
      createdBy: 'user-abc-123',
    };
    mockPrisma.post.create.mockResolvedValue(createdPost);

    const res = await request(app)
      .post('/api/posts')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'post-new',
      content: 'New post content',
      platforms: ['instagram', 'twitter'],
      status: 'draft',
      createdBy: 'user-abc-123',
    });

    expect(mockPrisma.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-456',
          content: 'New post content',
          mediaUrls: [],
          platforms: ['instagram', 'twitter'],
          scheduledAt: null,
          status: 'draft',
          createdBy: 'user-abc-123',
        }),
      }),
    );
  });

  it('should create post with scheduledAt and status scheduled', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const createdPost = {
      ...mockPostFixture,
      id: 'post-scheduled',
      scheduledAt: new Date(futureDate),
      status: 'scheduled',
    };
    mockPrisma.post.create.mockResolvedValue(createdPost);

    const res = await request(app)
      .post('/api/posts')
      .set('Authorization', 'Bearer valid_token')
      .send({ ...validPayload, scheduledAt: futureDate })
      .expect(201);

    expect(res.body.data.status).toBe('scheduled');
    expect(res.body.data.scheduledAt).toBeDefined();

    expect(mockPrisma.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduledAt: new Date(futureDate),
          status: 'scheduled',
        }),
      }),
    );
  });

  it('should default platforms to empty array', async () => {
    const createdPost = {
      ...mockPostFixture,
      id: 'post-new',
      platforms: [],
      status: 'draft',
    };
    mockPrisma.post.create.mockResolvedValue(createdPost);

    await request(app)
      .post('/api/posts')
      .set('Authorization', 'Bearer valid_token')
      .send({ content: 'Test content' })
      .expect(201);

    expect(mockPrisma.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          platforms: [],
        }),
      }),
    );
  });

  it('should return 400 for missing content', async () => {
    const res = await request(app)
      .post('/api/posts')
      .set('Authorization', 'Bearer valid_token')
      .send({ platforms: ['instagram'] })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('content');
    expect(mockPrisma.post.create).not.toHaveBeenCalled();
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .post('/api/posts')
      .send(validPayload)
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.post.create.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/posts')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to create post');
  });
});

describe('PUT /api/posts/:id — Update post', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.post.findFirst.mockResolvedValue(mockPostFixture);
    mockPrisma.post.update.mockResolvedValue({
      ...mockPostFixture,
      content: 'Updated content',
      link: 'https://example.com',
    });
  });

  it('should update post fields', async () => {
    const res = await request(app)
      .put('/api/posts/post-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ content: 'Updated content', link: 'https://example.com' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.content).toBe('Updated content');
    expect(res.body.data.link).toBe('https://example.com');

    expect(mockPrisma.post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'post-1', businessId: 'biz-456' },
      }),
    );
    expect(mockPrisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'post-1' },
        data: expect.objectContaining({
          content: 'Updated content',
          link: 'https://example.com',
        }),
      }),
    );
  });

  it('should return 404 for non-existent post', async () => {
    mockPrisma.post.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/posts/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .send({ content: 'Ghost' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Post not found');
    expect(mockPrisma.post.update).not.toHaveBeenCalled();
  });

  it('should return 400 when trying to edit published post', async () => {
    mockPrisma.post.findFirst.mockResolvedValue({
      ...mockPostFixture,
      status: 'published',
    });

    const res = await request(app)
      .put('/api/posts/post-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ content: 'Cannot edit published' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Cannot edit a published or failed post');
    expect(mockPrisma.post.update).not.toHaveBeenCalled();
  });

  it('should return 400 when trying to edit failed post', async () => {
    mockPrisma.post.findFirst.mockResolvedValue({
      ...mockPostFixture,
      status: 'failed',
    });

    const res = await request(app)
      .put('/api/posts/post-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ content: 'Cannot edit failed' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Cannot edit a published or failed post');
  });

  it('should allow editing draft post', async () => {
    mockPrisma.post.findFirst.mockResolvedValue({
      ...mockPostFixture,
      status: 'draft',
    });

    await request(app)
      .put('/api/posts/post-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ content: 'Can edit draft' })
      .expect(200);

    expect(mockPrisma.post.update).toHaveBeenCalled();
  });

  it('should allow editing scheduled post', async () => {
    mockPrisma.post.findFirst.mockResolvedValue({
      ...mockPostFixture,
      status: 'scheduled',
      scheduledAt: new Date(Date.now() + 86400000),
    });

    await request(app)
      .put('/api/posts/post-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ content: 'Can edit scheduled' })
      .expect(200);

    expect(mockPrisma.post.update).toHaveBeenCalled();
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .put('/api/posts/post-1')
      .send({ content: 'Test' })
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.post.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .put('/api/posts/post-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ content: 'Test' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to update post');
  });
});

describe('DELETE /api/posts/:id — Delete post', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should delete post successfully', async () => {
    mockPrisma.post.findFirst.mockResolvedValue(mockPostFixture);
    mockPrisma.post.delete.mockResolvedValue(mockPostFixture);

    const res = await request(app)
      .delete('/api/posts/post-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Post deleted');

    expect(mockPrisma.post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'post-1', businessId: 'biz-456' },
      }),
    );
    expect(mockPrisma.post.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'post-1' } }),
    );
  });

  it('should return 404 for non-existent post', async () => {
    mockPrisma.post.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/posts/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Post not found');
    expect(mockPrisma.post.delete).not.toHaveBeenCalled();
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .delete('/api/posts/post-1')
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.post.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete('/api/posts/post-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to delete post');
  });
});

describe('POST /api/posts/:id/schedule — Schedule post', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.post.findFirst.mockResolvedValue(mockPostFixture);
    mockPrisma.post.update.mockResolvedValue({
      ...mockPostFixture,
      scheduledAt: new Date(Date.now() + 86400000),
      status: 'scheduled',
    });
  });

  it('should schedule a post successfully', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    const res = await request(app)
      .post('/api/posts/post-1/schedule')
      .set('Authorization', 'Bearer valid_token')
      .send({ scheduledAt: futureDate })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('scheduled');
    expect(res.body.data.scheduledAt).toBeDefined();

    expect(mockPrisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'post-1' },
        data: expect.objectContaining({
          scheduledAt: new Date(futureDate),
          status: 'scheduled',
        }),
      }),
    );
  });

  it('should return 400 when scheduledAt is missing', async () => {
    const res = await request(app)
      .post('/api/posts/post-1/schedule')
      .set('Authorization', 'Bearer valid_token')
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('scheduledAt');
  });

  it('should return 404 for non-existent post', async () => {
    mockPrisma.post.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/posts/non-existent/schedule')
      .set('Authorization', 'Bearer valid_token')
      .send({ scheduledAt: new Date().toISOString() })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Post not found');
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .post('/api/posts/post-1/schedule')
      .send({ scheduledAt: new Date().toISOString() })
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.post.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/posts/post-1/schedule')
      .set('Authorization', 'Bearer valid_token')
      .send({ scheduledAt: new Date().toISOString() })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to schedule post');
  });
});

describe('POST /api/posts/:id/publish — Publish post', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.post.findFirst.mockResolvedValue({
      ...mockPostFixture,
      status: 'draft',
      publishedAt: null,
    });
    mockPrisma.post.update.mockResolvedValue({
      ...mockPostFixture,
      status: 'published',
      publishedAt: new Date(),
    });
  });

  it('should publish a draft post', async () => {
    const res = await request(app)
      .post('/api/posts/post-1/publish')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('published');
    expect(res.body.data.publishedAt).toBeDefined();

    expect(mockPrisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'post-1' },
        data: expect.objectContaining({
          status: 'published',
          publishedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('should publish a scheduled post', async () => {
    mockPrisma.post.findFirst.mockResolvedValue({
      ...mockPostFixture,
      status: 'scheduled',
      scheduledAt: new Date(Date.now() + 86400000),
    });

    const res = await request(app)
      .post('/api/posts/post-1/publish')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data.status).toBe('published');
    expect(mockPrisma.post.update).toHaveBeenCalled();
  });

  it('should return 404 for non-existent post', async () => {
    mockPrisma.post.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/posts/non-existent/publish')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Post not found');
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .post('/api/posts/post-1/publish')
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.post.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/posts/post-1/publish')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to publish post');
  });
});