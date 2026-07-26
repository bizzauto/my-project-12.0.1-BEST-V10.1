/**
 * @jest-environment node
 *
 * Integration tests for the Brevo Email API.
 * Tests Brevo integration status, connection, email sending, lists, contacts sync, and test emails.
 *
 * Endpoints tested:
 *   GET    /api/email/brevo/status          get Brevo configuration status
 *   POST   /api/email/brevo/connect         connect/save Brevo credentials
 *   POST   /api/email/brevo/disconnect      disconnect Brevo
 *   POST   /api/email/brevo/send            send transactional email
 *   GET    /api/email/brevo/lists           list Brevo contact lists
 *   POST   /api/email/brevo/lists           create Brevo contact list
 *   POST   /api/email/brevo/contacts/sync   sync contacts to Brevo list
 *   POST   /api/email/brevo/test            send test email
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

// ── Prisma mock ──────────────────────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  integration: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  contact: {
    findMany: jest.fn(),
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
    // Use verifyToken mock so tests can override user by changing verifyToken
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken().then((decoded: any) => {
      req.user = { id: decoded.id, businessId: decoded.businessId, role: decoded.role };
      next();
    }).catch(() => {
      res.status(401).json({ success: false, error: 'Authentication required' });
    });
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

// ── JSON Web Token mock ─────────────────────────────────────────────────────
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

// ── CSRF Service mock ───────────────────────────────────────────────────────
jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

// ── Cache middleware mock ─────────────────────────────────────────────────────
jest.mock('../src/server/middleware/cache', () => ({
  cacheResponse: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));

// ── BrevoEmailService mock ───────────────────────────────────────────────────
const mockBrevoEmailService = {
  isConfigured: jest.fn(),
  getAccountInfo: jest.fn(),
  testConnection: jest.fn(),
  sendTransactionalEmail: jest.fn(),
  listLists: jest.fn(),
  createList: jest.fn(),
  createContact: jest.fn(),
};

jest.mock('../src/server/services/brevo-email.service', () => ({
  BrevoEmailService: mockBrevoEmailService,
}));

// ── Trap setInterval calls so we can clean them up ────────────────────────────
const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

// Import the router AFTER all mocks are set up
import brevoEmailRoutes from '../src/server/routes/brevo-email';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  businessId: 'biz-1',
  role: 'OWNER',
  isActive: true,
  emailVerified: true,
};

const mockIntegration = {
  id: 'integration-1',
  businessId: 'biz-1',
  type: 'brevo_email',
  name: 'Brevo Email',
  config: {
    apiKey: 'xkeysib-testkey',
    defaultFromEmail: 'noreply@bizzauto.com',
    defaultFromName: 'BizzAuto',
  },
  isActive: true,
  lastSyncAt: new Date('2025-01-01'),
  lastError: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockContacts = [
  { email: 'contact1@test.com', name: 'Contact One', phone: '+1234567890' },
  { email: 'contact2@test.com', name: 'Contact Two', phone: null },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/email/brevo', brevoEmailRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();

  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: 'user-1',
    email: 'test@test.com',
    businessId: 'biz-1',
    role: 'OWNER',
  });

  const { CSRFService } = jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');

  // Default: user is active and authenticated
  mockPrisma.user.findUnique.mockResolvedValue(mockUser);
  // The brevo-email routes use router.use(authenticate) which populates req.user
  mockPrisma.integration.findUnique.mockResolvedValue(null);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

afterAll(() => {
  for (const id of intervalIds) {
    clearInterval(id);
  }
  intervalIds.length = 0;
  global.setInterval = originalSetInterval;
});

// ─── TESTS: GET /api/email/brevo/status ─────────────────────────────────────

describe('GET /api/email/brevo/status', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should return status when Brevo is connected', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockBrevoEmailService.isConfigured.mockReturnValue(true);
    mockBrevoEmailService.getAccountInfo.mockResolvedValue({
      success: true,
      data: { email: 'test@brevo.com', plan: 'Starter' },
    });

    const res = await request(app)
      .get('/api/email/brevo/status')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.configured).toBe(true);
    expect(res.body.data.connected).toBe(true);
    expect(res.body.data.accountInfo).toEqual({ email: 'test@brevo.com', plan: 'Starter' });
    expect(res.body.data.defaultFromEmail).toBe('noreply@bizzauto.com');
    expect(res.body.data.lastSyncAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('should return status when Brevo is not connected', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(null);
    mockBrevoEmailService.isConfigured.mockReturnValue(false);

    const res = await request(app)
      .get('/api/email/brevo/status')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.configured).toBe(false);
    expect(res.body.data.connected).toBe(false);
    expect(res.body.data.accountInfo).toBeNull();
    expect(res.body.data.defaultFromEmail).toBeNull();
    expect(res.body.data.lastSyncAt).toBeNull();
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).get('/api/email/brevo/status').expect(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 401 when businessId is missing from token', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({ id: 'user-1', email: 'test@test.com', role: 'OWNER' });

    const res = await request(app)
      .get('/api/email/brevo/status')
      .set('Authorization', 'Bearer valid_token')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.integration.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/email/brevo/status')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('DB error');
  });

  it('should handle Brevo API error gracefully', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockBrevoEmailService.isConfigured.mockReturnValue(true);
    mockBrevoEmailService.getAccountInfo.mockResolvedValue({
      success: false,
      error: 'Invalid API key',
    });

    const res = await request(app)
      .get('/api/email/brevo/status')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data.accountInfo).toBeNull();
  });
});

// ─── TESTS: POST /api/email/brevo/connect ────────────────────────────────────

describe('POST /api/email/brevo/connect', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  const validConnectPayload = {
    apiKey: 'xkeysib-newkey',
    defaultFromEmail: 'noreply@test.com',
    defaultFromName: 'Test App',
  };

  it('should connect Brevo successfully', async () => {
    mockBrevoEmailService.testConnection.mockResolvedValue({
      success: true,
      data: { email: 'test@brevo.com', plan: 'Starter' },
    });
    mockPrisma.integration.upsert.mockResolvedValue({
      ...mockIntegration,
      config: { apiKey: 'xkeysib-newkey', defaultFromEmail: 'noreply@test.com', defaultFromName: 'Test App' },
    });

    const res = await request(app)
      .post('/api/email/brevo/connect')
      .set('Authorization', 'Bearer valid_token')
      .send(validConnectPayload)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toBe('Brevo connected successfully');
    expect(res.body.data.email).toBe('test@brevo.com');
    expect(res.body.data.plan).toBe('Starter');
    expect(mockPrisma.integration.upsert).toHaveBeenCalledTimes(1);
  });

  it('should return 400 when apiKey is missing', async () => {
    const res = await request(app)
      .post('/api/email/brevo/connect')
      .set('Authorization', 'Bearer valid_token')
      .send({ defaultFromEmail: 'test@test.com' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('API key is required');
  });

  it('should return 400 when connection test fails', async () => {
    mockBrevoEmailService.testConnection.mockResolvedValue({
      success: false,
      error: 'Invalid API key',
    });

    const res = await request(app)
      .post('/api/email/brevo/connect')
      .set('Authorization', 'Bearer valid_token')
      .send(validConnectPayload)
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Connection test failed: Invalid API key');
    expect(mockPrisma.integration.upsert).not.toHaveBeenCalled();
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/email/brevo/connect')
      .send(validConnectPayload)
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('should return 401 when businessId missing from token', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({ id: 'user-1', email: 'test@test.com', role: 'OWNER' });

    const res = await request(app)
      .post('/api/email/brevo/connect')
      .set('Authorization', 'Bearer valid_token')
      .send(validConnectPayload)
      .expect(401);
  });

  it('should use test result email/name as defaults when not provided', async () => {
    mockBrevoEmailService.testConnection.mockResolvedValue({
      success: true,
      data: { email: 'test@brevo.com', plan: 'Starter' },
    });
    mockPrisma.integration.upsert.mockResolvedValue(mockIntegration);

    await request(app)
      .post('/api/email/brevo/connect')
      .set('Authorization', 'Bearer valid_token')
      .send({ apiKey: 'xkeysib-newkey' })
      .expect(200);

    expect(mockPrisma.integration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          config: expect.objectContaining({
            defaultFromEmail: 'test@brevo.com',
            defaultFromName: 'BizzAuto',
          }),
        }),
      }),
    );
  });

  it('should return 500 on database error', async () => {
    mockBrevoEmailService.testConnection.mockResolvedValue({
      success: true,
      data: { email: 'test@brevo.com' },
    });
    mockPrisma.integration.upsert.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/email/brevo/connect')
      .set('Authorization', 'Bearer valid_token')
      .send(validConnectPayload)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('DB error');
  });
});

// ─── TESTS: POST /api/email/brevo/disconnect ────────────────────────────────

describe('POST /api/email/brevo/disconnect', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should disconnect Brevo successfully', async () => {
    mockPrisma.integration.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/email/brevo/disconnect')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toBe('Brevo disconnected successfully');
    expect(mockPrisma.integration.deleteMany).toHaveBeenCalledWith({
      where: { businessId: 'biz-1', type: 'brevo_email' },
    });
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).post('/api/email/brevo/disconnect').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.integration.deleteMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/email/brevo/disconnect')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('DB error');
  });
});

// ─── TESTS: POST /api/email/brevo/send ──────────────────────────────────────

describe('POST /api/email/brevo/send', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  const validSendPayload = {
    to: 'recipient@test.com',
    subject: 'Test Subject',
    htmlContent: '<h1>Test</h1>',
  };

  it('should send transactional email', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockBrevoEmailService.sendTransactionalEmail.mockResolvedValue({
      success: true,
      messageId: 'msg-123',
    });

    const res = await request(app)
      .post('/api/email/brevo/send')
      .set('Authorization', 'Bearer valid_token')
      .send(validSendPayload)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.messageId).toBe('msg-123');
    expect(res.body.data.message).toBe('Email sent successfully');
    expect(mockBrevoEmailService.sendTransactionalEmail).toHaveBeenCalledWith({
      to: 'recipient@test.com',
      subject: 'Test Subject',
      htmlContent: '<h1>Test</h1>',
      fromEmail: 'noreply@bizzauto.com',
      fromName: 'BizzAuto',
    });
  });

  it('should return 400 when to is missing', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

    const res = await request(app)
      .post('/api/email/brevo/send')
      .set('Authorization', 'Bearer valid_token')
      .send({ subject: 'Test', htmlContent: '<h1>Test</h1>' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('To, subject, and content are required');
  });

  it('should return 400 when subject is missing', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

    const res = await request(app)
      .post('/api/email/brevo/send')
      .set('Authorization', 'Bearer valid_token')
      .send({ to: 'test@test.com', htmlContent: '<h1>Test</h1>' })
      .expect(400);

    expect(res.body.error).toBe('To, subject, and content are required');
  });

  it('should return 400 when htmlContent is missing', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

    const res = await request(app)
      .post('/api/email/brevo/send')
      .set('Authorization', 'Bearer valid_token')
      .send({ to: 'test@test.com', subject: 'Test' })
      .expect(400);

    expect(res.body.error).toBe('To, subject, and content are required');
  });

  it('should return 400 when Brevo not connected', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/email/brevo/send')
      .set('Authorization', 'Bearer valid_token')
      .send(validSendPayload)
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Brevo not connected');
  });

  it('should return 400 when Brevo is not active', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue({ ...mockIntegration, isActive: false });

    const res = await request(app)
      .post('/api/email/brevo/send')
      .set('Authorization', 'Bearer valid_token')
      .send(validSendPayload)
      .expect(400);

    expect(res.body.error).toBe('Brevo not connected');
  });

  it('should return 400 when Brevo send fails', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockBrevoEmailService.sendTransactionalEmail.mockResolvedValue({
      success: false,
      error: 'Invalid recipient',
    });

    const res = await request(app)
      .post('/api/email/brevo/send')
      .set('Authorization', 'Bearer valid_token')
      .send(validSendPayload)
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid recipient');
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).post('/api/email/brevo/send').send(validSendPayload).expect(401);
  });

  it('should return 500 on unexpected error', async () => {
    mockPrisma.integration.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/email/brevo/send')
      .set('Authorization', 'Bearer valid_token')
      .send(validSendPayload)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('DB error');
  });
});

// ─── TESTS: GET /api/email/brevo/lists ──────────────────────────────────────

describe('GET /api/email/brevo/lists', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should list Brevo contact lists', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockBrevoEmailService.listLists.mockResolvedValue({
      success: true,
      data: [{ id: 1, name: 'List 1' }, { id: 2, name: 'List 2' }],
    });

    const res = await request(app)
      .get('/api/email/brevo/lists')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].name).toBe('List 1');
  });

  it('should return 400 when Brevo not connected', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/email/brevo/lists')
      .set('Authorization', 'Bearer valid_token')
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Brevo not connected');
  });

  it('should return error when listLists fails', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockBrevoEmailService.listLists.mockResolvedValue({
      success: false,
      error: 'API error',
    });

    const res = await request(app)
      .get('/api/email/brevo/lists')
      .set('Authorization', 'Bearer valid_token')
      .expect(200); // Route returns 200 with error in body

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('API error');
  });

  it('should return 401 without auth token', async () => {
    await request(app).get('/api/email/brevo/lists').expect(401);
  });
});

// ─── TESTS: POST /api/email/brevo/lists ─────────────────────────────────────

describe('POST /api/email/brevo/lists', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should create a new contact list', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockBrevoEmailService.createList.mockResolvedValue({
      success: true,
      id: 'list-123',
    });

    const res = await request(app)
      .post('/api/email/brevo/lists')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'New List' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('list-123');
    expect(mockBrevoEmailService.createList).toHaveBeenCalledWith('New List');
  });

  it('should return 400 when name is missing', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

    const res = await request(app)
      .post('/api/email/brevo/lists')
      .set('Authorization', 'Bearer valid_token')
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('List name is required');
  });

  it('should return 400 when Brevo not connected', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/email/brevo/lists')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test' })
      .expect(400);

    expect(res.body.error).toBe('Brevo not connected');
  });

  it('should return error when createList fails', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockBrevoEmailService.createList.mockResolvedValue({
      success: false,
      error: 'List already exists',
    });

    const res = await request(app)
      .post('/api/email/brevo/lists')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Existing List' })
      .expect(200);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('List already exists');
  });
});

// ─── TESTS: POST /api/email/brevo/contacts/sync ─────────────────────────────

describe('POST /api/email/brevo/contacts/sync', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should sync contacts to Brevo list', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockPrisma.contact.findMany.mockResolvedValue(mockContacts);
    mockBrevoEmailService.createContact
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });
    mockPrisma.integration.update.mockResolvedValue(mockIntegration);

    const res = await request(app)
      .post('/api/email/brevo/contacts/sync')
      .set('Authorization', 'Bearer valid_token')
      .send({ listId: 'list-123', limit: 100 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.synced).toBe(2);
    expect(res.body.data.failed).toBe(0);
    expect(res.body.data.total).toBe(2);
    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1', email: { not: null } },
        take: 100,
      }),
    );
    expect(mockPrisma.integration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'integration-1' },
        data: { lastSyncAt: expect.any(Date) },
      }),
    );
  });

  it('should return 400 when listId is missing', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

    const res = await request(app)
      .post('/api/email/brevo/contacts/sync')
      .set('Authorization', 'Bearer valid_token')
      .send({ limit: 100 })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('List ID is required');
  });

  it('should return 400 when Brevo not connected', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/email/brevo/contacts/sync')
      .set('Authorization', 'Bearer valid_token')
      .send({ listId: 'list-123' })
      .expect(400);

    expect(res.body.error).toBe('Brevo not connected');
  });

  it('should handle sync failures for individual contacts', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockPrisma.contact.findMany.mockResolvedValue(mockContacts);
    mockBrevoEmailService.createContact
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'Invalid email' });
    mockPrisma.integration.update.mockResolvedValue(mockIntegration);

    const res = await request(app)
      .post('/api/email/brevo/contacts/sync')
      .set('Authorization', 'Bearer valid_token')
      .send({ listId: 'list-123' })
      .expect(200);

    expect(res.body.data.synced).toBe(1);
    expect(res.body.data.failed).toBe(1);
  });

  it('should skip contacts without email', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockPrisma.contact.findMany.mockResolvedValue([
      { email: null, name: 'No Email', phone: '123' },
      { email: 'valid@test.com', name: 'Valid', phone: null },
    ]);
    mockBrevoEmailService.createContact.mockResolvedValue({ success: true });
    mockPrisma.integration.update.mockResolvedValue(mockIntegration);

    const res = await request(app)
      .post('/api/email/brevo/contacts/sync')
      .set('Authorization', 'Bearer valid_token')
      .send({ listId: 'list-123' })
      .expect(200);

    expect(res.body.data.total).toBe(2);
    expect(res.body.data.synced).toBe(1);
    expect(mockBrevoEmailService.createContact).toHaveBeenCalledTimes(1);
  });

  it('should restore original BREVO_API_KEY after sync', async () => {
    const originalKey = process.env.BREVO_API_KEY;
    process.env.BREVO_API_KEY = 'original-key';

    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockPrisma.contact.findMany.mockResolvedValue([mockContacts[0]]);
    mockBrevoEmailService.createContact.mockResolvedValue({ success: true });
    mockPrisma.integration.update.mockResolvedValue(mockIntegration);

    await request(app)
      .post('/api/email/brevo/contacts/sync')
      .set('Authorization', 'Bearer valid_token')
      .send({ listId: 'list-123' })
      .expect(200);

    // Original key should be restored
    expect(process.env.BREVO_API_KEY).toBe('original-key');

    if (originalKey) process.env.BREVO_API_KEY = originalKey;
    else delete process.env.BREVO_API_KEY;
  });
});

// ─── TESTS: POST /api/email/brevo/test ──────────────────────────────────────

describe('POST /api/email/brevo/test', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should send test email', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockBrevoEmailService.sendTransactionalEmail.mockResolvedValue({
      success: true,
      messageId: 'test-msg-123',
    });

    const res = await request(app)
      .post('/api/email/brevo/test')
      .set('Authorization', 'Bearer valid_token')
      .send({ to: 'test@test.com' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toBe('Test email sent successfully');
    expect(mockBrevoEmailService.sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'test@test.com',
        subject: 'BizzAuto — Test Email',
        fromEmail: 'noreply@bizzauto.com',
        fromName: 'BizzAuto',
      }),
    );
  });

  it('should return 400 when to is missing', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);

    const res = await request(app)
      .post('/api/email/brevo/test')
      .set('Authorization', 'Bearer valid_token')
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Recipient email is required');
  });

  it('should return 400 when Brevo not connected', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/email/brevo/test')
      .set('Authorization', 'Bearer valid_token')
      .send({ to: 'test@test.com' })
      .expect(400);

    expect(res.body.error).toBe('Brevo not connected');
  });

  it('should return 400 when test email send fails', async () => {
    mockPrisma.integration.findUnique.mockResolvedValue(mockIntegration);
    mockBrevoEmailService.sendTransactionalEmail.mockResolvedValue({
      success: false,
      error: 'Send failed',
    });

    const res = await request(app)
      .post('/api/email/brevo/test')
      .set('Authorization', 'Bearer valid_token')
      .send({ to: 'test@test.com' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Send failed');
  });

  it('should return 401 without auth token', async () => {
    await request(app).post('/api/email/brevo/test').send({ to: 'test@test.com' }).expect(401);
  });
});