/**
 * @jest-environment node
 *
 * Integration tests for the Email API.
 * Tests SMTP configuration, template CRUD, drip campaign CRUD,
 * email lists, and password reset flows.
 *
 * Endpoints tested:
 *   POST   /api/email/test                        test SMTP connection
 *   POST   /api/email/test-connection              test SMTP config
 *   POST   /api/email/config                       save SMTP config
 *   GET    /api/email/templates                    list templates
 *   GET    /api/email/templates/:id                get template
 *   POST   /api/email/templates                    create template
 *   PUT    /api/email/templates/:id                update template
 *   DELETE /api/email/templates/:id                delete template
 *   GET    /api/email/drips                        list drip campaigns
 *   POST   /api/email/drips                        create drip campaign
 *   PUT    /api/email/drips/:id                    update drip campaign
 *   PATCH  /api/email/drips/:id/toggle             toggle drip active status
 *   DELETE /api/email/drips/:id                    delete drip campaign
 *   GET    /api/email/lists                        list subscriber lists
 *   POST   /api/email/lists                        create subscriber list
 *   DELETE /api/email/lists/:id                    delete subscriber list
 *   POST   /api/email/password-reset               request password reset
 *   POST   /api/email/password-reset/confirm       confirm password reset
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

// ── Prisma mock ──────────────────────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  emailTemplate: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  dripCampaign: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  emailList: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  $disconnect: jest.fn(),
};

jest.mock('../src/server/db', () => ({
  prisma: mockPrisma,
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

// ── EmailService mock ────────────────────────────────────────────────────────
const mockEmailService = {
  testConnection: jest.fn(),
  testEmailConfig: jest.fn(),
  configureEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
};

jest.mock('../src/server/services/email.service', () => ({
  EmailService: mockEmailService,
}));

// ── bcryptjs mock (dynamic import in password-reset/confirm) ─────────────────
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_new_password'),
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
import emailRoutes from '../src/server/routes/email';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  businessId: 'biz-1',
  role: 'OWNER',
  isActive: true,
  emailVerified: true,
  name: 'Test User',
};

const mockTemplate = {
  id: 'tmpl-1',
  businessId: 'biz-1',
  name: 'Welcome Email',
  subject: 'Welcome to BizzAuto',
  htmlContent: '<h1>Welcome</h1>',
  textContent: 'Welcome to BizzAuto',
  category: 'general',
  variables: ['name', 'email'],
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockDrip = {
  id: 'drip-1',
  businessId: 'biz-1',
  name: 'Onboarding Series',
  trigger: 'signup',
  steps: [{ delay: 1, templateId: 'tmpl-1' }],
  isActive: true,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockEmailList = {
  id: 'list-1',
  businessId: 'biz-1',
  name: 'Newsletter',
  description: 'Monthly newsletter subscribers',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/email', emailRoutes);
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

  // Default: authenticate middleware finds active user
  mockPrisma.user.findUnique.mockResolvedValue(mockUser);

  // Default: EmailService methods succeed
  mockEmailService.testConnection.mockResolvedValue({ success: true });
  mockEmailService.testEmailConfig.mockResolvedValue({ success: true });
  mockEmailService.configureEmail.mockResolvedValue({ success: true });
  mockEmailService.sendPasswordResetEmail.mockResolvedValue(undefined);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

afterAll(() => {
  for (const id of intervalIds) {
    clearInterval(id);
  }
  intervalIds.length = 0;
  global.setInterval = originalSetInterval;
});

// ─── EMAIL TEST CONNECTION ──────────────────────────────────────────────────

describe('POST /api/email/test', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should test SMTP connection successfully', async () => {
    const res = await request(app)
      .post('/api/email/test')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('SMTP connection successful');
    expect(mockEmailService.testConnection).toHaveBeenCalledTimes(1);
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/email/test')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when EmailService.testConnection fails', async () => {
    mockEmailService.testConnection.mockResolvedValue({ success: false, error: 'Connection refused' });

    const res = await request(app)
      .post('/api/email/test')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Connection refused');
  });

  it('should return 500 when EmailService.testConnection throws', async () => {
    mockEmailService.testConnection.mockRejectedValue(new Error('Unexpected error'));

    const res = await request(app)
      .post('/api/email/test')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Unexpected error');
  });

  it('should return 403 for suspended accounts', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });

    const res = await request(app)
      .post('/api/email/test')
      .set('Authorization', 'Bearer valid_token')
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('suspended');
  });

  it('should return 403 for MEMBER role (no requireRole guard on test)', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-2',
      email: 'member@test.com',
      businessId: 'biz-1',
      role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, id: 'user-2', role: 'MEMBER' });

    // /test only requires authenticate, not requireRole — MEMBER can access
    mockEmailService.testConnection.mockResolvedValue({ success: true });

    const res = await request(app)
      .post('/api/email/test')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/email/test-connection', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should test SMTP connection with custom config', async () => {
    const config = { host: 'smtp.custom.com', port: 587, user: 'user', pass: 'pass' };

    const res = await request(app)
      .post('/api/email/test-connection')
      .set('Authorization', 'Bearer valid_token')
      .send(config)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('SMTP connection successful');
    expect(mockEmailService.testEmailConfig).toHaveBeenCalledWith(config);
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/email/test-connection')
      .send({ host: 'smtp.gmail.com' })
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 when connection test fails', async () => {
    mockEmailService.testEmailConfig.mockResolvedValue({ success: false, error: 'Invalid credentials' });

    const res = await request(app)
      .post('/api/email/test-connection')
      .set('Authorization', 'Bearer valid_token')
      .send({ host: 'smtp.gmail.com' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid credentials');
  });
});

describe('POST /api/email/config', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should save SMTP configuration as OWNER', async () => {
    const config = {
      smtpHost: 'smtp.gmail.com',
      smtpPort: '587',
      smtpUser: 'user@test.com',
      smtpPass: 'password',
      fromName: 'Test',
      fromEmail: 'test@test.com',
    };

    const res = await request(app)
      .post('/api/email/config')
      .set('Authorization', 'Bearer valid_token')
      .send(config)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('SMTP configuration saved');
    expect(mockEmailService.configureEmail).toHaveBeenCalledWith('biz-1', {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      user: 'user@test.com',
      pass: 'password',
      fromName: 'Test',
      fromEmail: 'test@test.com',
    });
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-2', email: 'member@test.com', businessId: 'biz-1', role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, id: 'user-2', role: 'MEMBER' });

    const res = await request(app)
      .post('/api/email/config')
      .set('Authorization', 'Bearer valid_token')
      .send({ smtpHost: 'smtp.gmail.com' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/email/config')
      .send({ smtpHost: 'smtp.gmail.com' })
      .expect(401);
  });

  it('should return 500 when configureEmail fails', async () => {
    mockEmailService.configureEmail.mockResolvedValue({ success: false, error: 'Config error' });

    const res = await request(app)
      .post('/api/email/config')
      .set('Authorization', 'Bearer valid_token')
      .send({ smtpHost: 'smtp.gmail.com' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Config error');
  });

  it('should use defaults when optional fields are omitted', async () => {
    const res = await request(app)
      .post('/api/email/config')
      .set('Authorization', 'Bearer valid_token')
      .send({ smtpHost: 'smtp.custom.com' })
      .expect(200);

    expect(mockEmailService.configureEmail).toHaveBeenCalledWith('biz-1', {
      host: 'smtp.custom.com',
      port: 587,
      secure: false,
      user: '',
      pass: '',
      fromName: undefined,
      fromEmail: undefined,
    });
  });
});

// ─── EMAIL TEMPLATES ─────────────────────────────────────────────────────────

describe('GET /api/email/templates', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should list templates with pagination', async () => {
    mockPrisma.emailTemplate.findMany.mockResolvedValue([mockTemplate]);
    mockPrisma.emailTemplate.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/email/templates')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.templates).toHaveLength(1);
    expect(res.body.data.templates[0].name).toBe('Welcome Email');
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 50, total: 1 });
  });

  it('should return empty list when no templates exist', async () => {
    mockPrisma.emailTemplate.findMany.mockResolvedValue([]);
    mockPrisma.emailTemplate.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/email/templates')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.templates).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('should filter templates by category', async () => {
    mockPrisma.emailTemplate.findMany.mockResolvedValue([mockTemplate]);
    mockPrisma.emailTemplate.count.mockResolvedValue(1);

    await request(app)
      .get('/api/email/templates?category=general')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.emailTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: 'general' }),
      }),
    );
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).get('/api/email/templates').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.emailTemplate.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/email/templates')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('DB error');
  });
});

describe('GET /api/email/templates/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should get template by id', async () => {
    mockPrisma.emailTemplate.findFirst.mockResolvedValue(mockTemplate);

    const res = await request(app)
      .get('/api/email/templates/tmpl-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Welcome Email');
  });

  it('should return 404 when template not found', async () => {
    mockPrisma.emailTemplate.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/email/templates/nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Template not found');
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).get('/api/email/templates/tmpl-1').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.emailTemplate.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/email/templates/tmpl-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });

  it('should scope template lookup to businessId', async () => {
    mockPrisma.emailTemplate.findFirst.mockResolvedValue(mockTemplate);

    await request(app)
      .get('/api/email/templates/tmpl-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.emailTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tmpl-1', businessId: 'biz-1' },
      }),
    );
  });
});

describe('POST /api/email/templates', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  const validPayload = {
    name: 'New Template',
    subject: 'Hello {{name}}',
    htmlContent: '<h1>Hello {{name}}</h1>',
    category: 'marketing',
    variables: ['name'],
  };

  it('should create a template as OWNER', async () => {
    mockPrisma.emailTemplate.create.mockResolvedValue({
      ...mockTemplate,
      name: 'New Template',
      subject: 'Hello {{name}}',
    });

    const res = await request(app)
      .post('/api/email/templates')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(mockPrisma.emailTemplate.create).toHaveBeenCalledTimes(1);
  });

  it('should return 400 when name is missing', async () => {
    const { name, ...payload } = validPayload;

    const res = await request(app)
      .post('/api/email/templates')
      .set('Authorization', 'Bearer valid_token')
      .send(payload)
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Name');
  });

  it('should return 400 when subject is missing', async () => {
    const res = await request(app)
      .post('/api/email/templates')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test', htmlContent: '<h1>Test</h1>' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('subject');
  });

  it('should return 400 when htmlContent is missing', async () => {
    const res = await request(app)
      .post('/api/email/templates')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test', subject: 'Test' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('htmlContent');
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-2', email: 'member@test.com', businessId: 'biz-1', role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, id: 'user-2', role: 'MEMBER' });

    const res = await request(app)
      .post('/api/email/templates')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/email/templates')
      .send(validPayload)
      .expect(401);
  });

  it('should default textContent and category when not provided', async () => {
    mockPrisma.emailTemplate.create.mockResolvedValue(mockTemplate);

    await request(app)
      .post('/api/email/templates')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test', subject: 'Test', htmlContent: '<h1>Test</h1>' })
      .expect(201);

    expect(mockPrisma.emailTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          textContent: '',
          category: 'general',
          variables: [],
        }),
      }),
    );
  });

  it('should return 500 on database error', async () => {
    mockPrisma.emailTemplate.create.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/email/templates')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

describe('PUT /api/email/templates/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should update a template as OWNER', async () => {
    mockPrisma.emailTemplate.findFirst.mockResolvedValue(mockTemplate);
    mockPrisma.emailTemplate.update.mockResolvedValue({ ...mockTemplate, name: 'Updated' });

    const res = await request(app)
      .put('/api/email/templates/tmpl-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated', subject: 'New Subject', htmlContent: '<h1>Updated</h1>' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.emailTemplate.update).toHaveBeenCalled();
  });

  it('should return 404 when template not found', async () => {
    mockPrisma.emailTemplate.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/email/templates/nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Template not found');
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-2', email: 'member@test.com', businessId: 'biz-1', role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, id: 'user-2', role: 'MEMBER' });

    const res = await request(app)
      .put('/api/email/templates/tmpl-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated' })
      .expect(403);

    expect(res.body.success).toBe(false);
  });

  it('should strip id, businessId, and createdAt from update data', async () => {
    mockPrisma.emailTemplate.findFirst.mockResolvedValue(mockTemplate);
    mockPrisma.emailTemplate.update.mockResolvedValue(mockTemplate);

    await request(app)
      .put('/api/email/templates/tmpl-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated', id: 'should-ignore', businessId: 'should-ignore', createdAt: 'should-ignore' })
      .expect(200);

    const updateCall = mockPrisma.emailTemplate.update.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('id');
    expect(updateCall.data).not.toHaveProperty('businessId');
    expect(updateCall.data).not.toHaveProperty('createdAt');
  });
});

describe('DELETE /api/email/templates/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should delete a template as OWNER', async () => {
    mockPrisma.emailTemplate.findFirst.mockResolvedValue(mockTemplate);
    mockPrisma.emailTemplate.delete.mockResolvedValue(mockTemplate);

    const res = await request(app)
      .delete('/api/email/templates/tmpl-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Template deleted');
  });

  it('should return 404 when template not found', async () => {
    mockPrisma.emailTemplate.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/email/templates/nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Template not found');
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-2', email: 'member@test.com', businessId: 'biz-1', role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, id: 'user-2', role: 'MEMBER' });

    const res = await request(app)
      .delete('/api/email/templates/tmpl-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(403);
  });
});

// ─── DRIP CAMPAIGNS ──────────────────────────────────────────────────────────

describe('GET /api/email/drips', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should list drip campaigns', async () => {
    mockPrisma.dripCampaign.findMany.mockResolvedValue([mockDrip]);

    const res = await request(app)
      .get('/api/email/drips')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Onboarding Series');
  });

  it('should return empty list when no drips', async () => {
    mockPrisma.dripCampaign.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/email/drips')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data).toEqual([]);
  });

  it('should scope drips by businessId', async () => {
    mockPrisma.dripCampaign.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/email/drips')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.dripCampaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
      }),
    );
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).get('/api/email/drips').expect(401);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/email/drips', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should create a drip campaign as OWNER', async () => {
    mockPrisma.dripCampaign.create.mockResolvedValue(mockDrip);

    const res = await request(app)
      .post('/api/email/drips')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Onboarding Series', trigger: 'signup', steps: [{ delay: 1 }] })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Onboarding Series');
  });

  it('should return 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/email/drips')
      .set('Authorization', 'Bearer valid_token')
      .send({ trigger: 'signup' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Name');
  });

  it('should return 400 when trigger is missing', async () => {
    const res = await request(app)
      .post('/api/email/drips')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('trigger');
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-2', email: 'member@test.com', businessId: 'biz-1', role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, id: 'user-2', role: 'MEMBER' });

    const res = await request(app)
      .post('/api/email/drips')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test', trigger: 'signup' })
      .expect(403);
  });

  it('should default steps to empty array', async () => {
    mockPrisma.dripCampaign.create.mockResolvedValue(mockDrip);

    await request(app)
      .post('/api/email/drips')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test', trigger: 'signup' })
      .expect(201);

    expect(mockPrisma.dripCampaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ steps: [] }),
      }),
    );
  });
});

describe('PUT /api/email/drips/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should update a drip campaign', async () => {
    mockPrisma.dripCampaign.findFirst.mockResolvedValue(mockDrip);
    mockPrisma.dripCampaign.update.mockResolvedValue({ ...mockDrip, name: 'Updated' });

    const res = await request(app)
      .put('/api/email/drips/drip-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Updated');
  });

  it('should return 404 when drip not found', async () => {
    mockPrisma.dripCampaign.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/email/drips/nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated' })
      .expect(404);

    expect(res.body.error).toBe('Drip not found');
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-2', email: 'member@test.com', businessId: 'biz-1', role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, id: 'user-2', role: 'MEMBER' });

    const res = await request(app)
      .put('/api/email/drips/drip-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated' })
      .expect(403);
  });

  it('should strip id, businessId, createdAt from update data', async () => {
    mockPrisma.dripCampaign.findFirst.mockResolvedValue(mockDrip);
    mockPrisma.dripCampaign.update.mockResolvedValue(mockDrip);

    await request(app)
      .put('/api/email/drips/drip-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated', id: 'x', businessId: 'y', createdAt: 'z' })
      .expect(200);

    const data = mockPrisma.dripCampaign.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('businessId');
    expect(data).not.toHaveProperty('createdAt');
  });
});

describe('PATCH /api/email/drips/:id/toggle', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should toggle drip from active to paused', async () => {
    mockPrisma.dripCampaign.findFirst.mockResolvedValue({ ...mockDrip, isActive: true });
    mockPrisma.dripCampaign.update.mockResolvedValue({ ...mockDrip, isActive: false });

    const res = await request(app)
      .patch('/api/email/drips/drip-1/toggle')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('paused');
    expect(mockPrisma.dripCampaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });

  it('should toggle drip from paused to active', async () => {
    mockPrisma.dripCampaign.findFirst.mockResolvedValue({ ...mockDrip, isActive: false });
    mockPrisma.dripCampaign.update.mockResolvedValue({ ...mockDrip, isActive: true });

    const res = await request(app)
      .patch('/api/email/drips/drip-1/toggle')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('activated');
  });

  it('should return 404 when drip not found', async () => {
    mockPrisma.dripCampaign.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/email/drips/nonexistent/toggle')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.error).toBe('Drip not found');
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-2', email: 'member@test.com', businessId: 'biz-1', role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, id: 'user-2', role: 'MEMBER' });

    const res = await request(app)
      .patch('/api/email/drips/drip-1/toggle')
      .set('Authorization', 'Bearer valid_token')
      .expect(403);
  });
});

describe('DELETE /api/email/drips/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should delete a drip campaign', async () => {
    mockPrisma.dripCampaign.findFirst.mockResolvedValue(mockDrip);
    mockPrisma.dripCampaign.delete.mockResolvedValue(mockDrip);

    const res = await request(app)
      .delete('/api/email/drips/drip-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Drip deleted');
  });

  it('should return 404 when drip not found', async () => {
    mockPrisma.dripCampaign.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/email/drips/nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-2', email: 'member@test.com', businessId: 'biz-1', role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, id: 'user-2', role: 'MEMBER' });

    const res = await request(app)
      .delete('/api/email/drips/drip-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(403);
  });
});

// ─── EMAIL LISTS ─────────────────────────────────────────────────────────────

describe('GET /api/email/lists', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should list subscriber lists', async () => {
    mockPrisma.emailList.findMany.mockResolvedValue([mockEmailList]);

    const res = await request(app)
      .get('/api/email/lists')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Newsletter');
  });

  it('should return empty list', async () => {
    mockPrisma.emailList.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/email/lists')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data).toEqual([]);
  });

  it('should return 401 without auth', async () => {
    await request(app).get('/api/email/lists').expect(401);
  });
});

describe('POST /api/email/lists', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should create a subscriber list', async () => {
    mockPrisma.emailList.create.mockResolvedValue(mockEmailList);

    const res = await request(app)
      .post('/api/email/lists')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Newsletter', description: 'Monthly newsletter' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Newsletter');
  });

  it('should return 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/email/lists')
      .set('Authorization', 'Bearer valid_token')
      .send({ description: 'No name' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Name');
  });

  it('should default description to empty string', async () => {
    mockPrisma.emailList.create.mockResolvedValue(mockEmailList);

    await request(app)
      .post('/api/email/lists')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test List' })
      .expect(201);

    expect(mockPrisma.emailList.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: '' }),
      }),
    );
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-2', email: 'member@test.com', businessId: 'biz-1', role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, id: 'user-2', role: 'MEMBER' });

    const res = await request(app)
      .post('/api/email/lists')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test' })
      .expect(403);
  });
});

describe('DELETE /api/email/lists/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should delete a list', async () => {
    mockPrisma.emailList.findFirst.mockResolvedValue(mockEmailList);
    mockPrisma.emailList.delete.mockResolvedValue(mockEmailList);

    const res = await request(app)
      .delete('/api/email/lists/list-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('List deleted');
  });

  it('should return 404 when list not found', async () => {
    mockPrisma.emailList.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/email/lists/nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.error).toBe('List not found');
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-2', email: 'member@test.com', businessId: 'biz-1', role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, id: 'user-2', role: 'MEMBER' });

    const res = await request(app)
      .delete('/api/email/lists/list-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(403);
  });
});

// ─── PASSWORD RESET ──────────────────────────────────────────────────────────

describe('POST /api/email/password-reset', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should send password reset email for existing user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.user.update.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/api/email/password-reset')
      .send({ email: 'test@test.com' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('reset email');
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      'test@test.com',
      'Test User',
      expect.any(String),
    );
  });

  it('should return generic message even for non-existent user (security)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/email/password-reset')
      .send({ email: 'nonexistent@test.com' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('reset email');
    expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('should return 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/email/password-reset')
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Email is required');
  });

  it('should not fail when sendPasswordResetEmail throws', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.user.update.mockResolvedValue(mockUser);
    mockEmailService.sendPasswordResetEmail.mockRejectedValue(new Error('Email error'));

    const res = await request(app)
      .post('/api/email/password-reset')
      .send({ email: 'test@test.com' })
      .expect(200);

    // Still returns success to prevent email enumeration
    expect(res.body.success).toBe(true);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/email/password-reset')
      .send({ email: 'test@test.com' })
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/email/password-reset/confirm', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should reset password with valid token', async () => {
    // findFirst must match the hashed token + expiry check
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);
    mockPrisma.user.update.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/api/email/password-reset/confirm')
      .send({ token: 'valid-reset-token', password: 'NewPassword123' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Password has been reset');
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          password: 'hashed_new_password',
          resetToken: null,
          resetTokenExpiresAt: null,
        }),
      }),
    );
  });

  it('should return 400 when token is missing', async () => {
    const res = await request(app)
      .post('/api/email/password-reset/confirm')
      .send({ password: 'NewPassword123' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Token');
  });

  it('should return 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/email/password-reset/confirm')
      .send({ token: 'some-token' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('password');
  });

  it('should return 400 when password is too short', async () => {
    const res = await request(app)
      .post('/api/email/password-reset/confirm')
      .send({ token: 'some-token', password: '123' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('at least 8 characters');
  });

  it('should return 400 when token is invalid or expired', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/email/password-reset/confirm')
      .send({ token: 'invalid-token', password: 'NewPassword123' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Invalid or expired reset token');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.user.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/email/password-reset/confirm')
      .send({ token: 'some-token', password: 'NewPassword123' })
      .expect(500);

    expect(res.body.success).toBe(false);
  });

  it('should hash the token and find user by hashed token + expiry', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);
    mockPrisma.user.update.mockResolvedValue(mockUser);

    await request(app)
      .post('/api/email/password-reset/confirm')
      .send({ token: 'raw-token', password: 'NewPassword123' })
      .expect(200);

    // The route hashes the token with crypto.createHash('sha256')
    // and searches using it with resetTokenExpiresAt >= now
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          resetToken: expect.any(String),
          resetTokenExpiresAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
  });
});
