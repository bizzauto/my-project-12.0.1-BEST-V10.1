/**
 * @jest-environment node
 *
 * Integration tests for the Reviews API.
 * Tests CRUD operations, statistics, sync with Google Business Profile.
 *
 * Endpoints tested:
 *   GET    /api/reviews             list reviews with pagination/filters
 *   GET    /api/reviews/stats       review statistics
 *   GET    /api/reviews/:id         get single review
 *   PUT    /api/reviews/:id/reply   update review reply
 *   POST   /api/reviews/sync        sync reviews from Google Business Profile
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  review: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  },
  business: {
    findUnique: jest.fn(),
  },
  activity: {
    create: jest.fn(),
  },
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
    req.user = { id: 'user-1', businessId: 'biz-1', role: 'OWNER' };
    next();
  }),
  AuthRequest: class AuthRequest extends Request {},
}));

// ── Auth utilities mock ──────────────────────────────────────────────────────
jest.mock('../src/server/utils/auth', () => ({
  verifyToken: jest.fn().mockResolvedValue({
    id: 'user-1',
    email: 'test@test.com',
    businessId: 'biz-1',
    role: 'OWNER',
  }),
  hashPassword: jest.fn().mockResolvedValue('hashed_password'),
  comparePassword: jest.fn(),
  generateToken: jest.fn().mockReturnValue('mock_jwt_token'),
  generateRefreshToken: jest.fn().mockReturnValue('mock_refresh_token'),
  getJwtSecret: jest.fn().mockReturnValue('test-secret'),
  encrypt: jest.fn().mockReturnValue('encrypted'),
  decrypt: jest.fn().mockReturnValue('decrypted_token'),
}));

// ── Disable rate limiting for tests ──────────────────────────────────────────
jest.mock('express-rate-limit', () => ({
  default: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  __esModule: true,
}));

// ── JSON Web Token mock ──────────────────────────────────────────────────────
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({
    id: 'user-1',
    email: 'test@test.com',
    businessId: 'biz-1',
    role: 'OWNER',
  }),
  sign: jest.fn().mockReturnValue('mock_jwt_token'),
  decode: jest.fn(),
}));

// ── CSRF Service mock ────────────────────────────────────────────────────────
jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

// ── Cache middleware mock ────────────────────────────────────────────────────
jest.mock('../src/server/middleware/cache', () => ({
  cacheResponse: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));

// ── Axios mock for Google API calls ──────────────────────────────────────────
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Import the router AFTER all mocks are set up
import reviewsRoutes from '../src/server/routes/reviews';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockReview = {
  id: 'review-1',
  businessId: 'biz-1',
  platform: 'google',
  externalId: 'google-review-1',
  reviewerName: 'John Doe',
  reviewerEmail: 'john@example.com',
  reviewerPhone: null,
  rating: 5,
  text: 'Excellent service!',
  reviewDate: new Date('2025-01-15T10:00:00Z'),
  isPublished: true,
  replyText: null,
  replyStatus: 'pending',
  repliedAt: null,
  isRead: false,
  createdAt: new Date('2025-01-15T10:00:00Z'),
  updatedAt: new Date('2025-01-15T10:00:00Z'),
};

const mockReviews = [
  mockReview,
  {
    ...mockReview,
    id: 'review-2',
    reviewerName: 'Jane Smith',
    reviewerEmail: 'jane@example.com',
    rating: 4,
    text: 'Good but could be better',
    isRead: true,
  },
  {
    ...mockReview,
    id: 'review-3',
    reviewerName: 'Bob Wilson',
    rating: 3,
    text: 'Average experience',
  },
];

const mockBusiness = {
  id: 'biz-1',
  name: 'Test Business',
  gbpAccessToken: 'encrypted_token',
  gbpAccountId: 'account-123',
  gbpLocationId: 'location-456',
};

const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  businessId: 'biz-1',
  role: 'OWNER',
  isActive: true,
  emailVerified: true,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/reviews', reviewsRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();

  // Re-apply default mock implementations
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-1', email: 'test@test.com', businessId: 'biz-1', role: 'OWNER', isActive: true, emailVerified: true,
  });
  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: 'user-1',
    email: 'test@test.com',
    businessId: 'biz-1',
    role: 'OWNER',
  });

  const { decrypt } = jest.requireMock('../src/server/utils/auth');
  decrypt.mockReturnValue('decrypted_token');

  mockPrisma.review.findMany.mockResolvedValue([]);
  mockPrisma.review.findFirst.mockResolvedValue(null);
  mockPrisma.review.findUnique.mockResolvedValue(null);
  mockPrisma.review.update.mockResolvedValue({});
  mockPrisma.review.create.mockResolvedValue({});
  mockPrisma.review.count.mockResolvedValue(0);
  mockPrisma.review.aggregate.mockResolvedValue({ _avg: { rating: 0 } });
  mockPrisma.review.groupBy.mockResolvedValue([]);

  mockPrisma.business.findUnique.mockResolvedValue(mockBusiness);

  mockPrisma.activity.create.mockResolvedValue({});

  const { CSRFService } = jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');
}

// ─── GET /api/reviews — List Reviews ────────────────────────────────────────

describe('GET /api/reviews', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should list reviews with pagination', async () => {
    mockPrisma.review.findMany.mockResolvedValue(mockReviews);
    mockPrisma.review.count.mockResolvedValue(3);

    const res = await request(app)
      .get('/api/reviews')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.reviews).toHaveLength(3);
    expect(res.body.data.reviews[0]).toMatchObject({
      id: 'review-1',
      rating: 5,
      text: 'Excellent service!',
    });
    expect(res.body.data.pagination).toMatchObject({
      total: 3,
      page: 1,
      limit: 50,
    });

    expect(mockPrisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        skip: 0,
        take: 50,
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(mockPrisma.review.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'biz-1' } }),
    );
  });

  it('should filter by status=unread', async () => {
    mockPrisma.review.findMany.mockResolvedValue([mockReviews[0], mockReviews[2]]);
    mockPrisma.review.count.mockResolvedValue(2);

    await request(app)
      .get('/api/reviews?status=unread')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
          isRead: false,
        }),
      }),
    );
  });

  it('should filter by status=read', async () => {
    mockPrisma.review.findMany.mockResolvedValue([mockReviews[1]]);
    mockPrisma.review.count.mockResolvedValue(1);

    await request(app)
      .get('/api/reviews?status=read')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
          isRead: true,
        }),
      }),
    );
  });

  it('should support pagination params', async () => {
    mockPrisma.review.findMany.mockResolvedValue([mockReviews[1]]);
    mockPrisma.review.count.mockResolvedValue(3);

    await request(app)
      .get('/api/reviews?page=2&limit=1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 1,
        take: 1,
      }),
    );
  });

  it('should return empty results when no reviews', async () => {
    mockPrisma.review.findMany.mockResolvedValue([]);
    mockPrisma.review.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/reviews')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.reviews).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/reviews')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database query fails', async () => {
    mockPrisma.review.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/reviews')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to fetch reviews');
  });
});

// ─── GET /api/reviews/stats — Review Statistics ──────────────────────────────

describe('GET /api/reviews/stats', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should return review statistics', async () => {
    mockPrisma.review.count.mockResolvedValue(3);
    mockPrisma.review.aggregate.mockResolvedValue({ _avg: { rating: 4 } });
    mockPrisma.review.groupBy.mockResolvedValue([
      { rating: 5, _count: 1 },
      { rating: 4, _count: 1 },
      { rating: 3, _count: 1 },
    ]);
    mockPrisma.review.findMany.mockResolvedValue(mockReviews.slice(0, 5));

    const res = await request(app)
      .get('/api/reviews/stats')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      totalReviews: 3,
      averageRating: 4,
      ratingDistribution: { '5': 1, '4': 1, '3': 1 },
      recentReviews: expect.any(Array),
    });
    expect(res.body.data.recentReviews).toHaveLength(3);
  });

  it('should return zero stats when no reviews', async () => {
    mockPrisma.review.count.mockResolvedValue(0);
    mockPrisma.review.aggregate.mockResolvedValue({ _avg: { rating: null } });
    mockPrisma.review.groupBy.mockResolvedValue([]);
    mockPrisma.review.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/reviews/stats')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      totalReviews: 0,
      averageRating: 0,
      ratingDistribution: {},
      recentReviews: [],
    });
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/reviews/stats')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database query fails', async () => {
    mockPrisma.review.count.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/reviews/stats')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to fetch review stats');
  });
});

// ─── GET /api/reviews/:id — Get Single Review ────────────────────────────────

describe('GET /api/reviews/:id', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should return single review', async () => {
    mockPrisma.review.findFirst.mockResolvedValue(mockReview);

    const res = await request(app)
      .get('/api/reviews/review-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'review-1',
      rating: 5,
      text: 'Excellent service!',
      reviewerName: 'John Doe',
    });

    expect(mockPrisma.review.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'review-1', businessId: 'biz-1' },
      }),
    );
  });

  it('should return 404 for non-existent review', async () => {
    mockPrisma.review.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/reviews/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Review not found');
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/reviews/review-1')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database query fails', async () => {
    mockPrisma.review.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/reviews/review-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to fetch review');
  });
});

// ─── PUT /api/reviews/:id/reply — Update Review Reply ────────────────────────

describe('PUT /api/reviews/:id/reply', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should update review reply successfully', async () => {
    mockPrisma.review.update.mockResolvedValue({
      ...mockReview,
      replyText: 'Thank you for your feedback!',
      replyStatus: 'sent',
      repliedAt: new Date(),
    });

    const res = await request(app)
      .put('/api/reviews/review-1/reply')
      .set('Authorization', 'Bearer valid_token')
      .send({ replyText: 'Thank you for your feedback!' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Reply sent');
    expect(mockPrisma.review.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'review-1' },
        data: expect.objectContaining({
          replyText: 'Thank you for your feedback!',
          replyStatus: 'sent',
          repliedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .put('/api/reviews/review-1/reply')
      .send({ replyText: 'Test' })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database update fails', async () => {
    mockPrisma.review.update.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .put('/api/reviews/review-1/reply')
      .set('Authorization', 'Bearer valid_token')
      .send({ replyText: 'Test' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to send reply');
  });
});

// ─── POST /api/reviews/sync — Sync Reviews from Google Business Profile ──────

describe('POST /api/reviews/sync', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockedAxios.get.mockReset();
  });

  it('should sync reviews from Google Business Profile', async () => {
    // Setup business with GBP credentials
    mockPrisma.business.findUnique.mockResolvedValue({
      ...mockBusiness,
      gbpAccessToken: 'encrypted_token',
      gbpAccountId: 'account-123',
      gbpLocationId: 'location-456',
    });

    // Mock axios response from Google My Business API
    mockedAxios.get.mockResolvedValue({
      data: {
        reviews: [
          {
            name: 'accounts/account-123/locations/location-456/reviews/review-1',
            reviewId: 'review-1',
            reviewer: {
              displayName: 'Google User 1',
              email: 'google1@example.com',
            },
            starRating: 'FIVE',
            comment: 'Great service!',
            createTime: '2025-01-15T10:00:00Z',
            reviewReply: {
              comment: 'Thank you!',
              updateTime: '2025-01-16T10:00:00Z',
            },
          },
          {
            name: 'accounts/account-123/locations/location-456/reviews/review-2',
            reviewId: 'review-2',
            reviewer: {
              displayName: 'Google User 2',
              email: 'google2@example.com',
            },
            starRating: 'FOUR',
            comment: 'Good experience',
            createTime: '2025-01-14T10:00:00Z',
          },
        ],
      },
    });

    // Mock findFirst for existing review check
    mockPrisma.review.findFirst.mockResolvedValue(null);
    mockPrisma.review.create.mockResolvedValue({ id: 'new-review-1' });
    mockPrisma.review.update.mockResolvedValue({ id: 'existing-review-1' });

    const res = await request(app)
      .post('/api/reviews/sync')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Synced 2 reviews');
    expect(res.body.data.synced).toBe(2);

    // Verify axios was called with correct URL and auth
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://mybusiness.googleapis.com/v4/accounts/account-123/locations/location-456/reviews',
      expect.objectContaining({
        headers: { Authorization: 'Bearer decrypted_token' },
        params: { pageSize: 100 },
      }),
    );

    // Verify reviews were created
    expect(mockPrisma.review.create).toHaveBeenCalledTimes(2);
  });

  it('should return 400 when GBP not connected', async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      ...mockBusiness,
      gbpAccessToken: null,
      gbpAccountId: null,
      gbpLocationId: null,
    });

    const res = await request(app)
      .post('/api/reviews/sync')
      .set('Authorization', 'Bearer valid_token')
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Google Business Profile not connected');
  });

  it('should update existing reviews instead of creating duplicates', async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      ...mockBusiness,
      gbpAccessToken: 'encrypted_token',
      gbpAccountId: 'account-123',
      gbpLocationId: 'location-456',
    });

    mockedAxios.get.mockResolvedValue({
      data: {
        reviews: [
          {
            name: 'accounts/account-123/locations/location-456/reviews/review-1',
            reviewId: 'review-1',
            reviewer: {
              displayName: 'Google User 1',
              email: 'google1@example.com',
            },
            starRating: 'FIVE',
            comment: 'Updated review',
            createTime: '2025-01-15T10:00:00Z',
          },
        ],
      },
    });

    // Mock existing review found
    mockPrisma.review.findFirst.mockResolvedValue({
      ...mockReview,
      id: 'existing-review-1',
      externalId: 'review-1',
    });
    mockPrisma.review.update.mockResolvedValue({ id: 'existing-review-1' });

    const res = await request(app)
      .post('/api/reviews/sync')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.synced).toBe(1);
    expect(mockPrisma.review.update).toHaveBeenCalled();
    expect(mockPrisma.review.create).not.toHaveBeenCalled();
  });

  it('should map all star ratings correctly', async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      ...mockBusiness,
      gbpAccessToken: 'encrypted_token',
      gbpAccountId: 'account-123',
      gbpLocationId: 'location-456',
    });

    mockedAxios.get.mockResolvedValue({
      data: {
        reviews: [
          { reviewId: 'r1', reviewer: { displayName: 'U1' }, starRating: 'FIVE', comment: '', createTime: '2025-01-01T00:00:00Z' },
          { reviewId: 'r2', reviewer: { displayName: 'U2' }, starRating: 'FOUR', comment: '', createTime: '2025-01-01T00:00:00Z' },
          { reviewId: 'r3', reviewer: { displayName: 'U3' }, starRating: 'THREE', comment: '', createTime: '2025-01-01T00:00:00Z' },
          { reviewId: 'r4', reviewer: { displayName: 'U4' }, starRating: 'TWO', comment: '', createTime: '2025-01-01T00:00:00Z' },
          { reviewId: 'r5', reviewer: { displayName: 'U5' }, starRating: 'ONE', comment: '', createTime: '2025-01-01T00:00:00Z' },
        ],
      },
    });

    mockPrisma.review.findFirst.mockResolvedValue(null);
    mockPrisma.review.create.mockResolvedValue({ id: 'new' });

    await request(app)
      .post('/api/reviews/sync')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    // Verify all star ratings mapped correctly
    const createCalls = mockPrisma.review.create.mock.calls;
    expect(createCalls).toHaveLength(5);
    expect(createCalls[0][0].data.rating).toBe(5);
    expect(createCalls[1][0].data.rating).toBe(4);
    expect(createCalls[2][0].data.rating).toBe(3);
    expect(createCalls[3][0].data.rating).toBe(2);
    expect(createCalls[4][0].data.rating).toBe(1);
  });

  it('should handle Google API errors gracefully', async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      ...mockBusiness,
      gbpAccessToken: 'encrypted_token',
      gbpAccountId: 'account-123',
      gbpLocationId: 'location-456',
    });

    mockedAxios.get.mockRejectedValue(new Error('Google API error'));

    const res = await request(app)
      .post('/api/reviews/sync')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to sync reviews');
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .post('/api/reviews/sync')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should handle reviews without externalId', async () => {
    mockPrisma.business.findUnique.mockResolvedValue({
      ...mockBusiness,
      gbpAccessToken: 'encrypted_token',
      gbpAccountId: 'account-123',
      gbpLocationId: 'location-456',
    });

    mockedAxios.get.mockResolvedValue({
      data: {
        reviews: [
          {
            name: 'accounts/account-123/locations/location-456/reviews/',
            reviewer: { displayName: 'No ID User' },
            starRating: 'FIVE',
            comment: 'No external ID',
            createTime: '2025-01-01T00:00:00Z',
          },
        ],
      },
    });

    mockPrisma.review.findFirst.mockResolvedValue(null);
    mockPrisma.review.create.mockResolvedValue({ id: 'new' });

    const res = await request(app)
      .post('/api/reviews/sync')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    // Should still sync (externalId will be the name from API)
  });
});

afterAll(() => {
  jest.clearAllMocks();
});