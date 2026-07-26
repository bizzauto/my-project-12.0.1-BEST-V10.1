/**
 * @jest-environment node
 *
 * End-to-end integration tests for the Blog API routes.
 *
 * These tests use supertest to make real HTTP requests against the Express
 * router with the full middleware stack (JSON parsing, etc.) while mocking
 * Prisma, auth utilities, and ancillary services to isolate the blog logic.
 *
 * Blog endpoints tested:
 *   GET    /api/blog/posts              list blog posts with pagination/filters
 *   GET    /api/blog/posts/:id          get single blog post
 *   POST   /api/blog/posts              create blog post (OWNER/ADMIN only)
 *   PUT    /api/blog/posts/:id          update blog post (OWNER/ADMIN only)
 *   DELETE /api/blog/posts/:id          delete blog post (OWNER/ADMIN only)
 *   PATCH  /api/blog/posts/:id/publish  toggle publish status (OWNER/ADMIN only)
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────
// All jest.mock calls MUST be at the top level so Jest hoists them above imports.

// ── Prisma mock ──────────────────────────────────────────────────────────────
const mockPrisma = {
  blogPost: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  blogComment: {
    deleteMany: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
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

// ── Trap setInterval calls (any module) so we can clean them up ─────────────
const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

// Import the router AFTER all mocks are set up
import blogRoutes from '../src/server/routes/blog';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockUserFixture = {
  id: 'user-abc-123',
  email: 'test@example.com',
  name: 'Test User',
  role: 'OWNER',
  businessId: 'biz-456',
  isActive: true,
};

const mockBlogPostFixture = {
  id: 'blog-1',
  businessId: 'biz-456',
  title: 'Test Blog Post',
  slug: 'test-blog-post',
  content: 'Test content for the blog post',
  excerpt: 'Test excerpt',
  featuredImage: null,
  status: 'published',
  publishedAt: new Date('2025-01-01'),
  authorId: 'user-abc-123',
  seoTitle: null,
  seoDescription: null,
  tags: ['test', 'blog'],
  category: 'General',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  author: {
    id: 'user-abc-123',
    name: 'Test User',
    email: 'test@example.com',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/blog', blogRoutes);
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

  const { CSRFService } =
    jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');

  // Default auth mock
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-abc-123', email: 'test@example.com', businessId: 'biz-456', role: 'OWNER', isActive: true, emailVerified: true,
  });
  // Default transaction mock
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));

  mockPrisma.blogPost.findFirst.mockResolvedValue(mockBlogPostFixture);
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

describe('GET /api/blog/posts — List blog posts', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.blogPost.findMany.mockResolvedValue([mockBlogPostFixture]);
    mockPrisma.blogPost.count.mockResolvedValue(1);
  });

  it('should list blog posts with pagination', async () => {
    const res = await request(app)
      .get('/api/blog/posts')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.posts).toHaveLength(1);
    expect(res.body.data.posts[0]).toMatchObject({
      id: 'blog-1',
      title: 'Test Blog Post',
      slug: 'test-blog-post',
      status: 'published',
    });
    expect(res.body.data.pagination).toMatchObject({
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    expect(mockPrisma.blogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-456' },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: expect.objectContaining({
          category: expect.objectContaining({
            select: expect.objectContaining({
              id: true,
              name: true,
              slug: true,
            }),
          }),
        }),
      }),
    );
    expect(mockPrisma.blogPost.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'biz-456' } }),
    );
  });

  it('should apply status filter', async () => {
    mockPrisma.blogPost.findMany.mockResolvedValue([]);
    mockPrisma.blogPost.count.mockResolvedValue(0);

    await request(app)
      .get('/api/blog/posts?status=draft')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.blogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-456',
          status: 'draft',
        }),
      }),
    );
  });

  it('should apply category filter', async () => {
    mockPrisma.blogPost.findMany.mockResolvedValue([]);
    mockPrisma.blogPost.count.mockResolvedValue(0);

    await request(app)
      .get('/api/blog/posts?categoryId=cat-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.blogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-456',
          categoryId: 'cat-1',
        }),
      }),
    );
  });

  it('should apply search filter', async () => {
    mockPrisma.blogPost.findMany.mockResolvedValue([]);
    mockPrisma.blogPost.count.mockResolvedValue(0);

    await request(app)
      .get('/api/blog/posts?search=test')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.blogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-456',
          OR: expect.arrayContaining([
            expect.objectContaining({ title: expect.objectContaining({ contains: 'test', mode: 'insensitive' }) }),
            expect.objectContaining({ excerpt: expect.objectContaining({ contains: 'test', mode: 'insensitive' }) }),
          ]),
        }),
      }),
    );
  });

  it('should handle empty results', async () => {
    mockPrisma.blogPost.findMany.mockResolvedValue([]);
    mockPrisma.blogPost.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/blog/posts')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.posts).toEqual([]);
    expect(res.body.data.pagination).toMatchObject({
      total: 0,
      page: 1,
      totalPages: 0,
    });
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/blog/posts')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.blogPost.findMany.mockRejectedValue(new Error('DB connection failed'));

    const res = await request(app)
      .get('/api/blog/posts')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to fetch posts');
  });
});

describe('GET /api/blog/posts/:id — Get single blog post', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should get single blog post with category and comments', async () => {
    mockPrisma.blogPost.findFirst.mockResolvedValue({
      ...mockBlogPostFixture,
      category: { id: 'cat-1', name: 'General', slug: 'general' },
      comments: [],
    });

    const res = await request(app)
      .get('/api/blog/posts/blog-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'blog-1',
      title: 'Test Blog Post',
      slug: 'test-blog-post',
      content: 'Test content for the blog post',
      status: 'published',
    });

    expect(mockPrisma.blogPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'blog-1', businessId: 'biz-456' },
        include: expect.objectContaining({
          category: true,
          comments: expect.objectContaining({
            orderBy: { createdAt: 'desc' },
            take: 50,
          }),
        }),
      }),
    );
  });

  it('should return 404 for non-existent blog post', async () => {
    mockPrisma.blogPost.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/blog/posts/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Post not found');
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/blog/posts/blog-1')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.blogPost.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/blog/posts/blog-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to fetch post');
  });
});

describe('POST /api/blog/posts — Create blog post', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  const validPayload = {
    title: 'New Blog Post',
    content: 'Content for the new blog post',
    excerpt: 'Short excerpt',
    status: 'draft',
    tags: ['tech', 'ai'],
    seoTitle: 'SEO Title',
    seoDescription: 'SEO Description',
  };

  it('should create blog post successfully', async () => {
    const createdPost = {
      ...mockBlogPostFixture,
      id: 'blog-new',
      title: 'New Blog Post',
      slug: 'new-blog-post',
      content: 'Content for the new blog post',
      excerpt: 'Short excerpt',
      status: 'draft',
      tags: ['tech', 'ai'],
      seoTitle: 'SEO Title',
      seoDescription: 'SEO Description',
      authorId: 'user-abc-123',
    };
    mockPrisma.blogPost.findFirst.mockResolvedValue(null); // No slug conflict
    mockPrisma.blogPost.create.mockResolvedValue(createdPost);

    const res = await request(app)
      .post('/api/blog/posts')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'blog-new',
      title: 'New Blog Post',
      slug: 'new-blog-post',
      status: 'draft',
      authorId: 'user-abc-123',
    });

    expect(mockPrisma.blogPost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-456',
          title: 'New Blog Post',
          content: 'Content for the new blog post',
          excerpt: 'Short excerpt',
          status: 'draft',
          tags: ['tech', 'ai'],
          seoTitle: 'SEO Title',
          seoDescription: 'SEO Description',
          slug: expect.any(String),
        }),
      }),
    );
  });

  it('should generate slug from title when not provided', async () => {
    const createdPost = {
      ...mockBlogPostFixture,
      id: 'blog-new',
      title: 'Another Blog Post',
      slug: 'another-blog-post',
      status: 'draft',
    };
    mockPrisma.blogPost.findFirst.mockResolvedValue(null);
    mockPrisma.blogPost.create.mockResolvedValue(createdPost);

    const payload = { ...validPayload, title: 'Another Blog Post' };

    const res = await request(app)
      .post('/api/blog/posts')
      .set('Authorization', 'Bearer valid_token')
      .send(payload)
      .expect(201);

    expect(res.body.data.slug).toBe('another-blog-post');
    expect(mockPrisma.blogPost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'another-blog-post',
        }),
      }),
    );
  });

  it('should handle slug conflict by appending timestamp', async () => {
    mockPrisma.blogPost.findFirst
      .mockResolvedValueOnce(mockBlogPostFixture); // First call - conflict
    mockPrisma.blogPost.create.mockResolvedValue({
      ...mockBlogPostFixture,
      id: 'blog-new',
      slug: 'test-blog-post-1234567890',
    });

    await request(app)
      .post('/api/blog/posts')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(201);

    // findFirst is called once for slug conflict check; it appends timestamp and creates without a second check
    expect(mockPrisma.blogPost.findFirst).toHaveBeenCalledTimes(1);
  });

  it('should return 400 for missing required title', async () => {
    const res = await request(app)
      .post('/api/blog/posts')
      .set('Authorization', 'Bearer valid_token')
      .send({ content: 'Content only' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Title');
  });

  it('should return 403 for MEMBER role (requireRole check)', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-member',
      email: 'member@test.com',
      businessId: 'biz-456',
      role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      ...mockUserFixture,
      id: 'user-member',
      email: 'member@test.com',
      role: 'MEMBER',
    });

    const res = await request(app)
      .post('/api/blog/posts')
      .set('Authorization', 'Bearer member_token')
      .send(validPayload)
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
    expect(mockPrisma.blogPost.create).not.toHaveBeenCalled();
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .post('/api/blog/posts')
      .send(validPayload)
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.blogPost.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/blog/posts')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to create post');
  });
});

describe('PUT /api/blog/posts/:id — Update blog post', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.blogPost.update.mockResolvedValue({
      ...mockBlogPostFixture,
      title: 'Updated Title',
    });
  });

  it('should update blog post fields', async () => {
    const res = await request(app)
      .put('/api/blog/posts/blog-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ title: 'Updated Title', content: 'Updated content' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Updated Title');

    expect(mockPrisma.blogPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'blog-1', businessId: 'biz-456' },
      }),
    );
    expect(mockPrisma.blogPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'blog-1' },
        data: expect.objectContaining({
          title: 'Updated Title',
          content: 'Updated content',
        }),
      }),
    );
  });

  it('should return 404 for non-existent blog post', async () => {
    mockPrisma.blogPost.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/blog/posts/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .send({ title: 'Ghost' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Post not found');
    expect(mockPrisma.blogPost.update).not.toHaveBeenCalled();
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-member',
      email: 'member@test.com',
      businessId: 'biz-456',
      role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      ...mockUserFixture,
      id: 'user-member',
      email: 'member@test.com',
      role: 'MEMBER',
    });

    const res = await request(app)
      .put('/api/blog/posts/blog-1')
      .set('Authorization', 'Bearer member_token')
      .send({ title: 'Updated' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .put('/api/blog/posts/blog-1')
      .send({ title: 'Test' })
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.blogPost.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .put('/api/blog/posts/blog-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ title: 'Test' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to update post');
  });
});

describe('DELETE /api/blog/posts/:id — Delete blog post', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should delete blog post successfully', async () => {
    mockPrisma.blogPost.findFirst.mockResolvedValue(mockBlogPostFixture);
    mockPrisma.blogPost.delete.mockResolvedValue(mockBlogPostFixture);

    const res = await request(app)
      .delete('/api/blog/posts/blog-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Post deleted');

    expect(mockPrisma.blogPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'blog-1', businessId: 'biz-456' },
      }),
    );
    expect(mockPrisma.blogPost.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'blog-1' } }),
    );
  });

  it('should return 404 for non-existent blog post', async () => {
    mockPrisma.blogPost.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/blog/posts/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Post not found');
    expect(mockPrisma.blogPost.delete).not.toHaveBeenCalled();
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-member',
      email: 'member@test.com',
      businessId: 'biz-456',
      role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      ...mockUserFixture,
      id: 'user-member',
      email: 'member@test.com',
      role: 'MEMBER',
    });

    const res = await request(app)
      .delete('/api/blog/posts/blog-1')
      .set('Authorization', 'Bearer member_token')
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .delete('/api/blog/posts/blog-1')
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.blogPost.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete('/api/blog/posts/blog-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to delete post');
  });
});

describe('PATCH /api/blog/posts/:id/publish — Toggle publish status', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.blogPost.findFirst.mockResolvedValue({
      ...mockBlogPostFixture,
      status: 'draft',
      publishedAt: null,
    });
    mockPrisma.blogPost.update.mockResolvedValue({
      ...mockBlogPostFixture,
      status: 'published',
      publishedAt: new Date(),
    });
  });

  it('should publish a draft blog post', async () => {
    const res = await request(app)
      .patch('/api/blog/posts/blog-1/publish')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('published');
    expect(res.body.data.publishedAt).toBeDefined();

    expect(mockPrisma.blogPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'blog-1' },
        data: expect.objectContaining({
          status: 'published',
          publishedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('should unpublish a published blog post', async () => {
    mockPrisma.blogPost.findFirst.mockResolvedValue({
      ...mockBlogPostFixture,
      status: 'published',
      publishedAt: new Date('2025-01-01'),
    });
    mockPrisma.blogPost.update.mockResolvedValue({
      ...mockBlogPostFixture,
      status: 'draft',
      publishedAt: new Date('2025-01-01'),
    });

    const res = await request(app)
      .patch('/api/blog/posts/blog-1/publish')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('draft');
  });

  it('should return 404 for non-existent blog post', async () => {
    mockPrisma.blogPost.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/blog/posts/non-existent/publish')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Post not found');
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-member',
      email: 'member@test.com',
      businessId: 'biz-456',
      role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      ...mockUserFixture,
      id: 'user-member',
      email: 'member@test.com',
      role: 'MEMBER',
    });

    const res = await request(app)
      .patch('/api/blog/posts/blog-1/publish')
      .set('Authorization', 'Bearer member_token')
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
  });

  it('should return 401 without authentication token', async () => {
    await request(app)
      .patch('/api/blog/posts/blog-1/publish')
      .expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.blogPost.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .patch('/api/blog/posts/blog-1/publish')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Failed to toggle publish status');
  });
});
