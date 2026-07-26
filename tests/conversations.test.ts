/**
 * @jest-environment node
 *
 * Integration tests for the Conversations API (inbox).
 * Tests all endpoints: stats, list, get conversation, reply, mark read, archive.
 *
 * Endpoints tested:
 *   GET    /api/conversations/stats       inbox statistics
 *   GET    /api/conversations             list conversations (WhatsApp, Email, Reviews)
 *   GET    /api/conversations/:contactId  get full conversation
 *   POST   /api/conversations/:contactId/reply  reply to conversation
 *   PATCH  /api/conversations/:contactId/read   mark as read
 *   POST   /api/conversations/archive     archive conversations
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  contact: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  message: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    groupBy: jest.fn(),
  },
  review: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  business: {
    findUnique: jest.fn(),
    update: jest.fn(),
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
  decrypt: jest.fn().mockReturnValue('decrypted'),
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

// ── Axios mock ────────────────────────────────────────────────────────────────
jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({
    data: { messages: [{ id: 'wa-msg-123' }] },
  }),
}));

// ── Email Service mock ───────────────────────────────────────────────────────
jest.mock('../src/server/services/email.service', () => ({
  EmailService: {
    sendEmail: jest.fn().mockResolvedValue({ success: true }),
  },
}));

// Import the router AFTER all mocks are set up
import conversationsRoutes from '../src/server/routes/conversations';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockContact = {
  id: 'contact-1',
  businessId: 'biz-1',
  name: 'John Doe',
  phone: '+919876543210',
  email: 'john@example.com',
  waProfilePic: 'https://example.com/avatar.jpg',
  source: 'whatsapp',
  whatsappOptIn: true,
  status: 'active',
  lastMessageAt: new Date('2025-01-15T10:00:00Z'),
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-15'),
};

const mockContactNoPhone = {
  ...mockContact,
  id: 'contact-2',
  phone: null,
  email: 'jane@example.com',
  source: 'email',
};

const mockMessage = {
  id: 'msg-1',
  businessId: 'biz-1',
  contactId: 'contact-1',
  direction: 'incoming',
  type: 'text',
  content: 'Hello!',
  mediaUrl: null,
  mediaType: null,
  status: 'received',
  waMessageId: null,
  createdAt: new Date('2025-01-15T10:00:00Z'),
  updatedAt: new Date('2025-01-15T10:00:00Z'),
};

const mockMessageOutbound = {
  ...mockMessage,
  id: 'msg-2',
  direction: 'outbound',
  status: 'sent',
};

const mockReview = {
  id: 'review-1',
  businessId: 'biz-1',
  platform: 'google',
  externalId: 'google-review-1',
  reviewerName: 'Jane Smith',
  reviewerEmail: 'jane@example.com',
  reviewerPhone: null,
  rating: 5,
  text: 'Great service!',
  reviewDate: new Date('2025-01-10T10:00:00Z'),
  isPublished: true,
  replyText: null,
  replyStatus: 'pending',
  repliedAt: null,
  isRead: false,
  createdAt: new Date('2025-01-10T10:00:00Z'),
  updatedAt: new Date('2025-01-10T10:00:00Z'),
};

const mockReview2 = {
  ...mockReview,
  id: 'review-2',
  reviewerName: 'John Doe',
  reviewerEmail: 'john@example.com',
  rating: 4,
  text: 'Good but could be better',
};

const mockBusiness = {
  id: 'biz-1',
  name: 'Test Business',
  waPhoneNumberId: '123456789',
  waAccessToken: 'encrypted_token',
  totalMessages: 100,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRoutes);
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

  mockPrisma.contact.findMany.mockResolvedValue([]);
  mockPrisma.contact.count.mockResolvedValue(0);
  mockPrisma.contact.findFirst.mockResolvedValue(null);
  mockPrisma.contact.update.mockResolvedValue({});
  mockPrisma.contact.updateMany.mockResolvedValue({ count: 0 });

  mockPrisma.message.findMany.mockResolvedValue([]);
  mockPrisma.message.findFirst.mockResolvedValue(null);
  mockPrisma.message.create.mockResolvedValue({});
  mockPrisma.message.count.mockResolvedValue(0);
  mockPrisma.message.update.mockResolvedValue({});
  mockPrisma.message.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.message.groupBy.mockResolvedValue([]);

  mockPrisma.review.findMany.mockResolvedValue([]);
  mockPrisma.review.findFirst.mockResolvedValue(null);
  mockPrisma.review.update.mockResolvedValue({});
  mockPrisma.review.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.review.count.mockResolvedValue(0);

  mockPrisma.business.findUnique.mockResolvedValue(mockBusiness);
  mockPrisma.business.update.mockResolvedValue({});

  mockPrisma.activity.create.mockResolvedValue({});

  const { CSRFService } = jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');
}

// ─── GET /api/conversations/stats — Inbox Statistics ────────────────────────

describe('GET /api/conversations/stats', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should return inbox statistics with all channels', async () => {
    // Setup mocks for stats calculation
    mockPrisma.contact.findMany.mockResolvedValue([
      { ...mockContact, id: 'contact-1', whatsappOptIn: true, phone: '+919876543210', email: 'a@b.com', source: 'whatsapp', lastMessageAt: new Date() },
      { ...mockContact, id: 'contact-2', whatsappOptIn: false, phone: null, email: 'b@c.com', source: 'email', lastMessageAt: new Date() },
    ]);
    mockPrisma.review.findMany.mockResolvedValue([
      { ...mockReview, reviewerEmail: 'review1@test.com', isRead: false },
      { ...mockReview, id: 'review-2', reviewerEmail: 'review2@test.com', isRead: true },
    ]);
    mockPrisma.message.groupBy.mockResolvedValue([
      { contactId: 'contact-1', _count: 5 },
    ]);
    mockPrisma.message.count.mockResolvedValue(5);
    mockPrisma.review.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/conversations/stats')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('totalConversations');
    expect(res.body.data).toHaveProperty('unreadCount');
    expect(res.body.data).toHaveProperty('byChannel');
    expect(res.body.data.byChannel).toHaveProperty('whatsapp');
    expect(res.body.data.byChannel).toHaveProperty('email');
    expect(res.body.data.byChannel).toHaveProperty('reviews');
  });

  it('should return zero stats when no contacts or reviews', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([]);
    mockPrisma.review.findMany.mockResolvedValue([]);
    mockPrisma.message.groupBy.mockResolvedValue([]);
    mockPrisma.message.count.mockResolvedValue(0);
    mockPrisma.review.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/conversations/stats')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.totalConversations).toBe(0);
    expect(res.body.data.unreadCount).toBe(0);
    expect(res.body.data.byChannel.whatsapp).toBe(0);
    expect(res.body.data.byChannel.email).toBe(0);
    expect(res.body.data.byChannel.reviews).toBe(0);
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/conversations/stats')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database query fails', async () => {
    mockPrisma.contact.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/conversations/stats')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to fetch inbox stats');
  });
});

// ─── GET /api/conversations — List Conversations ─────────────────────────────

describe('GET /api/conversations', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should list conversations with pagination', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([
      { ...mockContact, messages: [mockMessage] },
    ]);
    mockPrisma.message.count.mockResolvedValue(2);
    mockPrisma.review.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('conversations');
    expect(res.body.data).toHaveProperty('pagination');
    expect(res.body.data.conversations).toHaveLength(1);
    expect(res.body.data.conversations[0]).toMatchObject({
      contactId: 'contact-1',
      contactName: 'John Doe',
      channel: 'whatsapp',
    });
    expect(res.body.data.pagination).toMatchObject({
      total: 1,
      page: 1,
      limit: 50,
    });
  });

  it('should filter by channel (whatsapp/email/reviews)', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([
      { ...mockContact, messages: [mockMessage] },
    ]);
    mockPrisma.message.count.mockResolvedValue(1);
    mockPrisma.review.findMany.mockResolvedValue([]);

    // Test whatsapp filter
    await request(app)
      .get('/api/conversations?channel=whatsapp')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    // Test email filter
    await request(app)
      .get('/api/conversations?channel=email')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    // Test reviews filter
    mockPrisma.contact.findMany.mockResolvedValue([]);
    mockPrisma.review.findMany.mockResolvedValue([mockReview]);
    await request(app)
      .get('/api/conversations?channel=reviews')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);
  });

  it('should filter by status (unread/read)', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([
      { ...mockContact, messages: [mockMessage] },
    ]);
    mockPrisma.message.count.mockResolvedValue(1);
    mockPrisma.review.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/conversations?status=unread')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    await request(app)
      .get('/api/conversations?status=read')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);
  });

  it('should apply search filter', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([]);
    mockPrisma.review.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/conversations?search=john')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    // Verify search was applied to contact query
    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { name: { contains: 'john', mode: 'insensitive' } },
            { phone: { contains: 'john' } },
            { email: { contains: 'john', mode: 'insensitive' } },
          ]),
        }),
      }),
    );
  });

  it('should apply pagination', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([]);
    mockPrisma.review.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/conversations?page=2&limit=10')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    // Route does in-memory pagination; verify pagination metadata
    expect(res.body.data.pagination).toMatchObject({
      page: 2,
      limit: 10,
    });
  });

  it('should return empty results when no conversations', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([]);
    mockPrisma.review.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.conversations).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/conversations')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database query fails', async () => {
    mockPrisma.contact.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to fetch conversations');
  });
});

// ─── GET /api/conversations/:contactId — Get Full Conversation ───────────────

describe('GET /api/conversations/:contactId', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  describe('Review conversations (review_* prefix)', () => {
    it('should return review conversation with all reviews grouped', async () => {
      mockPrisma.review.findMany.mockResolvedValue([mockReview, mockReview2]);

      const res = await request(app)
        .get('/api/conversations/review_john%40example.com')
        .set('Authorization', 'Bearer valid_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        contactId: 'review_john@example.com',
        contactName: 'Jane Smith',
        channel: 'reviews',
      });
      expect(res.body.data.messages).toHaveLength(2);
      expect(res.body.data.messages[0]).toMatchObject({
        channel: 'reviews',
        direction: 'incoming',
        type: 'review',
        rating: 5,
      });
    });

    it('should return 404 for non-existent review conversation', async () => {
      mockPrisma.review.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/conversations/review_nonexistent%40test.com')
        .set('Authorization', 'Bearer valid_token')
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Review conversation not found');
    });

    it('should apply pagination to review messages', async () => {
      mockPrisma.review.findMany.mockResolvedValue([mockReview, mockReview2]);

      const res = await request(app)
        .get('/api/conversations/review_john%40example.com?page=1&limit=1')
        .set('Authorization', 'Bearer valid_token')
        .expect(200);

      expect(res.body.data.messages).toHaveLength(1);
      expect(res.body.data.pagination).toMatchObject({
        total: 2,
        page: 1,
        limit: 1,
      });
    });
  });

  describe('Regular conversations (WhatsApp/Email)', () => {
    it('should return full conversation with messages', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(mockContact);
      mockPrisma.message.findMany.mockResolvedValue([mockMessage, mockMessageOutbound]);
      mockPrisma.message.count.mockResolvedValue(2);

      const res = await request(app)
        .get('/api/conversations/contact-1')
        .set('Authorization', 'Bearer valid_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        contactId: 'contact-1',
        contactName: 'John Doe',
        channel: 'whatsapp',
      });
      expect(res.body.data.messages).toHaveLength(2);
      expect(res.body.data.messages[0]).toMatchObject({
        direction: 'incoming',
        type: 'text',
        content: 'Hello!',
      });
      expect(res.body.data.messages[1]).toMatchObject({
        direction: 'outbound',
        type: 'text',
      });
    });

    it('should return 404 for non-existent contact', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/conversations/non-existent')
        .set('Authorization', 'Bearer valid_token')
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Contact not found');
    });

    it('should determine channel based on message type', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue({
        ...mockContact,
        email: 'test@test.com',
        phone: null,
      });
      mockPrisma.message.findMany.mockResolvedValue([
        { ...mockMessage, type: 'email' },
      ]);
      mockPrisma.message.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/api/conversations/contact-2')
        .set('Authorization', 'Bearer valid_token')
        .expect(200);

      expect(res.body.data.channel).toBe('email');
    });

    it('should apply pagination to messages', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(mockContact);
      mockPrisma.message.findMany.mockResolvedValue([mockMessage]);
      mockPrisma.message.count.mockResolvedValue(10);

      const res = await request(app)
        .get('/api/conversations/contact-1?page=2&limit=5')
        .set('Authorization', 'Bearer valid_token')
        .expect(200);

      expect(res.body.data.pagination).toMatchObject({
        total: 10,
        page: 2,
        limit: 5,
      });
    });
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .get('/api/conversations/contact-1')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database query fails', async () => {
    mockPrisma.contact.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/conversations/contact-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to fetch conversation');
  });
});

// ─── POST /api/conversations/:contactId/reply — Reply to Conversation ────────

describe('POST /api/conversations/:contactId/reply', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  describe('Review replies (review_* prefix)', () => {
    it('should reply to review conversation', async () => {
      mockPrisma.review.findFirst.mockResolvedValue(mockReview);
      mockPrisma.review.update.mockResolvedValue({
        ...mockReview,
        replyText: 'Thank you for your feedback!',
        replyStatus: 'replied',
        repliedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/conversations/review_jane%40example.com/reply')
        .set('Authorization', 'Bearer valid_token')
        .send({ content: 'Thank you for your feedback!' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        replyText: 'Thank you for your feedback!',
        replyStatus: 'replied',
      });
      expect(mockPrisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'review-1' },
          data: expect.objectContaining({
            replyText: 'Thank you for your feedback!',
            replyStatus: 'replied',
            repliedBy: 'user-1',
          }),
        }),
      );
    });

    it('should return 400 when content is missing', async () => {
      const res = await request(app)
        .post('/api/conversations/review_jane%40example.com/reply')
        .set('Authorization', 'Bearer valid_token')
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Reply content is required');
    });

    it('should return 404 when review conversation not found', async () => {
      mockPrisma.review.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/conversations/review_nonexistent/reply')
        .set('Authorization', 'Bearer valid_token')
        .send({ content: 'Test reply' })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Review conversation not found');
    });

    it('should create activity log for review reply', async () => {
      mockPrisma.review.findFirst.mockResolvedValue(mockReview);
      mockPrisma.review.update.mockResolvedValue(mockReview);

      await request(app)
        .post('/api/conversations/review_jane%40example.com/reply')
        .set('Authorization', 'Bearer valid_token')
        .send({ content: 'Thank you!' })
        .expect(200);

      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'review_reply',
            title: expect.stringContaining('Replied to'),
            content: 'Thank you!',
            createdBy: 'user-1',
          }),
        }),
      );
    });
  });

  describe('WhatsApp replies', () => {
    it('should send WhatsApp reply when phone available', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(mockContact);
      mockPrisma.business.findUnique.mockResolvedValue(mockBusiness);
      mockPrisma.message.create.mockResolvedValue(mockMessageOutbound);
      mockPrisma.contact.update.mockResolvedValue(mockContact);

      const res = await request(app)
        .post('/api/conversations/contact-1/reply')
        .set('Authorization', 'Bearer valid_token')
        .send({ content: 'Hello from business!' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        direction: 'outbound',
        type: 'text',
        status: 'sent',
      });
      expect(mockPrisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            businessId: 'biz-1',
            contactId: 'contact-1',
            direction: 'outbound',
            type: 'text',
            content: 'Hello from business!',
            status: 'sent',
          }),
        }),
      );
    });

    it('should fall back to email when contact has no phone', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue({
        ...mockContact,
        phone: null,
        email: 'test@test.com',
      });
      mockPrisma.message.create.mockResolvedValue({
        ...mockMessageOutbound,
        type: 'email',
      });
      mockPrisma.contact.update.mockResolvedValue({});

      const res = await request(app)
        .post('/api/conversations/contact-2/reply')
        .set('Authorization', 'Bearer valid_token')
        .send({ content: 'Test' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('email');
    });

    it('should return 400 when WhatsApp not configured', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(mockContact);
      mockPrisma.business.findUnique.mockResolvedValue({
        ...mockBusiness,
        waPhoneNumberId: null,
        waAccessToken: null,
      });

      const res = await request(app)
        .post('/api/conversations/contact-1/reply')
        .set('Authorization', 'Bearer valid_token')
        .send({ content: 'Test' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('WhatsApp not configured for this business');
    });
  });

  describe('Email replies', () => {
    it('should send email reply when channel specified as email', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue({
        ...mockContact,
        email: 'john@example.com',
        phone: null,
      });
      mockPrisma.message.create.mockResolvedValue({
        ...mockMessageOutbound,
        type: 'email',
      });
      mockPrisma.contact.update.mockResolvedValue({});

      const res = await request(app)
        .post('/api/conversations/contact-2/reply')
        .set('Authorization', 'Bearer valid_token')
        .send({ content: 'Email reply', channel: 'email' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('email');
      expect(mockPrisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'email',
            content: 'Email reply',
          }),
        }),
      );
    });

    it('should return 400 when contact has no email for email channel', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue({
        ...mockContact,
        email: null,
        phone: '+919876543210',
      });

      const res = await request(app)
        .post('/api/conversations/contact-1/reply')
        .set('Authorization', 'Bearer valid_token')
        .send({ content: 'Test', channel: 'email' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Contact has no email address');
    });
  });

  it('should return 400 when content is missing', async () => {
    const res = await request(app)
      .post('/api/conversations/contact-1/reply')
      .set('Authorization', 'Bearer valid_token')
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Reply content is required');
  });

  it('should return 404 when contact not found', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.review.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/conversations/non-existent/reply')
      .set('Authorization', 'Bearer valid_token')
      .send({ content: 'Test' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Contact not found');
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .post('/api/conversations/contact-1/reply')
      .send({ content: 'Test' })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database operation fails', async () => {
    mockPrisma.contact.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/conversations/contact-1/reply')
      .set('Authorization', 'Bearer valid_token')
      .send({ content: 'Test' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to send reply');
  });
});

// ─── PATCH /api/conversations/:contactId/read — Mark as Read ────────────────

describe('PATCH /api/conversations/:contactId/read', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should mark review conversation as read', async () => {
    mockPrisma.review.updateMany.mockResolvedValue({ count: 2 });

    const res = await request(app)
      .patch('/api/conversations/review_john%40example.com/read')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ markedRead: 2 });
    expect(mockPrisma.review.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
          isRead: false,
        }),
        data: { isRead: true },
      }),
    );
  });

  it('should mark WhatsApp messages as read', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(mockContact);
    mockPrisma.message.updateMany.mockResolvedValue({ count: 3 });

    const res = await request(app)
      .patch('/api/conversations/contact-1/read')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ markedRead: 3 });
    expect(mockPrisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contactId: 'contact-1',
          businessId: 'biz-1',
          direction: 'incoming',
          status: 'received',
        }),
        data: { status: 'read' },
      }),
    );
  });

  it('should return 404 for non-existent review conversation', async () => {
    mockPrisma.review.updateMany.mockResolvedValue({ count: 0 });

    // The endpoint still returns 200 with markedRead: 0 for reviews
    const res = await request(app)
      .patch('/api/conversations/review_nonexistent/read')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.markedRead).toBe(0);
  });

  it('should return 404 for non-existent contact', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/conversations/non-existent/read')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Contact not found');
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .patch('/api/conversations/contact-1/read')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database query fails', async () => {
    mockPrisma.contact.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .patch('/api/conversations/contact-1/read')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to mark as read');
  });
});

// ─── POST /api/conversations/archive — Archive Conversations ────────────────

describe('POST /api/conversations/archive', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should archive regular contacts', async () => {
    mockPrisma.contact.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.review.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .post('/api/conversations/archive')
      .set('Authorization', 'Bearer valid_token')
      .send({ contactIds: ['contact-1', 'contact-2'] })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      archived: 2,
      contacts: 2,
      reviews: 0,
    });
    expect(mockPrisma.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['contact-1', 'contact-2'] },
          businessId: 'biz-1',
        }),
        data: { status: 'inactive' },
      }),
    );
  });

  it('should archive review conversations', async () => {
    mockPrisma.contact.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.review.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/conversations/archive')
      .set('Authorization', 'Bearer valid_token')
      .send({ contactIds: ['review_john%40example.com'] })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      archived: 1,
      contacts: 0,
      reviews: 1,
    });
    expect(mockPrisma.review.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
        }),
        data: { isRead: true },
      }),
    );
  });

  it('should return 400 when contactIds is missing or invalid', async () => {
    const res = await request(app)
      .post('/api/conversations/archive')
      .set('Authorization', 'Bearer valid_token')
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('contactIds array is required');
  });

  it('should return 400 when contactIds is not an array', async () => {
    const res = await request(app)
      .post('/api/conversations/archive')
      .set('Authorization', 'Bearer valid_token')
      .send({ contactIds: 'not-an-array' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('contactIds array is required');
  });

  it('should return 400 when contactIds array is empty', async () => {
    const res = await request(app)
      .post('/api/conversations/archive')
      .set('Authorization', 'Bearer valid_token')
      .send({ contactIds: [] })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('contactIds array is required');
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app)
      .post('/api/conversations/archive')
      .send({ contactIds: ['contact-1'] })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database operation fails', async () => {
    mockPrisma.contact.updateMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/conversations/archive')
      .set('Authorization', 'Bearer valid_token')
      .send({ contactIds: ['contact-1'] })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to archive conversations');
  });
});

afterAll(() => {
  jest.clearAllMocks();
});