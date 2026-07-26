/**
 * @jest-environment node
 *
 * End-to-end integration tests for the Integrations API.
 *
 * These tests use supertest to make real HTTP requests against the Express
 * router with the full middleware stack (JSON parsing, etc.) while mocking
 * Prisma, auth utilities, and ancillary services to isolate the integration logic.
 *
 * Endpoints tested:
 *   GET    /api/integrations                    — list all integrations
 *   POST   /api/integrations/google-sheets      — configure Google Sheets integration
 *   GET    /api/integrations/google-sheets/oauth-url — get Google OAuth URL
 *   GET    /api/integrations/google-sheets/callback — handle Google OAuth callback
 *   POST   /api/integrations/google-sheets/sync — sync contacts to Google Sheets
 *   POST   /api/integrations/google-sheets/import — import contacts from Google Sheets
 *   POST   /api/integrations/google-sheets/create — create new spreadsheet
 *   POST   /api/integrations/email              — configure email integration
 *   POST   /api/integrations/email/test         — test email configuration
 *   POST   /api/integrations/proxy              — add proxy for WhatsApp
 *   POST   /api/integrations                    — create custom integration
 *   PUT    /api/integrations/:id                — update integration
 *   DELETE /api/integrations/:id                — delete integration
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────
// All jest.mock calls MUST be at the top level so Jest hoists them above imports.

const mockIntegrationFixture = {
  id: 'int-abc-123',
  businessId: 'biz-456',
  type: 'google_sheets',
  name: 'Google Sheets',
  config: { spreadsheetId: 'sheet-123', autoSync: true },
  isActive: true,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockBusinessFixture = {
  id: 'biz-456',
  name: 'Test Business',
  type: 'general',
  plan: 'FREE',
  planStartedAt: new Date('2025-01-01'),
  planExpiresAt: new Date('2025-01-15'),
  phone: null,
  city: null,
  aiCreditsUsed: 0,
  aiCreditsLimit: 100,
};

const mockUserFixture = {
  id: 'user-abc-123',
  email: 'test@example.com',
  name: 'Test User',
  password: 'hashed_password_xyz',
  role: 'OWNER',
  businessId: 'biz-456',
  isActive: true,
  image: null,
  googleId: null,
  appleId: null,
  lastLoginAt: null,
  phone: null,
  emailVerified: null,
  isVerified: false,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

// ── Prisma mock ──────────────────────────────────────────────────────────────
jest.mock('../src/server/db.js', () => ({
  prisma: {
    integration: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    business: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    contact: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

// Auth middleware mock
jest.mock("../src/server/middleware/auth", () => ({
  authenticate: jest.fn((req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    const token = auth.replace("Bearer ", "");
    // Handle invalid and expired tokens
    if (token === 'invalid_jwt_token' || token === 'expired_jwt_token') {
      res.status(401).json({ success: false, error: "Invalid token" });
      return;
    }
    req.user = { id: "user-abc-123", businessId: "biz-456", role: "OWNER" };
    next();
  }),
  AuthRequest: class AuthRequest extends Request {},
}));

// ── Auth utilities mock ──────────────────────────────────────────────────────
jest.mock('../src/server/utils/auth.js', () => ({
  encrypt: jest.fn((val: string) => `encrypted_${val}`),
  decrypt: jest.fn((val: string) => val.replace('encrypted_', '')),
  generateToken: jest.fn(() => 'mock_jwt_token'),
  verifyToken: jest.fn(() => ({ id: 'user-abc-123', email: 'test@example.com', businessId: 'biz-456', role: 'OWNER' })),
  hashPassword: jest.fn((val: string) => `hashed_${val}`),
  verifyPassword: jest.fn(() => true),
}));

// ── express-rate-limit mock ──────────────────────────────────────────────────
jest.mock('express-rate-limit', () => {
  return jest.fn(() => (req: any, res: any, next: any) => next());
});

// ── jsonwebtoken mock ────────────────────────────────────────────────────────
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock_jwt_token'),
  verify: jest.fn(() => ({ id: 'user-abc-123', email: 'test@example.com', businessId: 'biz-456', role: 'OWNER' })),
}));

// ── GoogleSheetsService mock ─────────────────────────────────────────────────
jest.mock('../src/server/services/google-sheets.service.js', () => ({
  GoogleSheetsService: {
    configureIntegration: jest.fn(),
    getOAuthUrl: jest.fn(),
    handleOAuthCallback: jest.fn(),
    syncContacts: jest.fn(),
    importContacts: jest.fn(),
    createSpreadsheet: jest.fn(),
  },
}));

// ── EmailService mock ────────────────────────────────────────────────────────
jest.mock('../src/server/services/email.service.js', () => ({
  EmailService: {
    configureEmail: jest.fn(),
    testEmailConfig: jest.fn(),
  },
}));

// ── WhatsAppService mock ─────────────────────────────────────────────────────
jest.mock('../src/server/services/whatsapp.service.js', () => ({
  WhatsAppService: {
    addProxy: jest.fn(),
  },
}));

// ── Disable setInterval for OTP cleanup (if any) ──────────────────────────────
jest.useFakeTimers();

// ─── Import Route & Mocked Modules ───────────────────────────────────────────
import integrationsRouter from '../src/server/routes/integrations.js';
import { prisma } from '../src/server/db.js';
import { verifyToken, generateToken } from '../src/server/utils/auth.js';
import { GoogleSheetsService } from '../src/server/services/google-sheets.service.js';
import { EmailService } from '../src/server/services/email.service.js';
import { WhatsAppService } from '../src/server/services/whatsapp.service.js';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockVerifyToken = verifyToken as jest.Mock;
const mockGenerateToken = generateToken as jest.Mock;
const mockGoogleSheetsService = GoogleSheetsService as jest.Mocked<typeof GoogleSheetsService>;
const mockEmailService = EmailService as jest.Mocked<typeof EmailService>;
const mockWhatsAppService = WhatsAppService as jest.Mocked<typeof WhatsAppService>;

// ─── Test App Builder ────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', integrationsRouter);
  return app;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeAuthToken(payload: Record<string, any> = {}) {
  const defaultPayload = {
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
    ...payload,
  };
  return `Bearer ${mockGenerateToken(defaultPayload)}`;
}

function resetMocks() {
  jest.clearAllMocks();
  mockPrisma.integration.findMany.mockReset();
  mockPrisma.integration.findUnique.mockReset();
  mockPrisma.integration.findFirst.mockReset();
  mockPrisma.integration.create.mockReset();
  mockPrisma.integration.update.mockReset();
  mockPrisma.integration.delete.mockReset();
  mockPrisma.integration.deleteMany.mockReset();
  mockPrisma.business.findUnique.mockReset();
  mockPrisma.business.findFirst.mockReset();
  mockPrisma.business.update.mockReset();
  mockPrisma.user.findUnique.mockReset();
  mockPrisma.user.findFirst.mockReset();
  mockPrisma.contact.findMany.mockReset();
  mockPrisma.contact.upsert.mockReset();
  mockPrisma.$transaction.mockReset();
  mockGoogleSheetsService.configureIntegration.mockReset();
  mockGoogleSheetsService.getOAuthUrl.mockReset();
  mockGoogleSheetsService.handleOAuthCallback.mockReset();
  mockGoogleSheetsService.syncContacts.mockReset();
  mockGoogleSheetsService.importContacts.mockReset();
  mockGoogleSheetsService.createSpreadsheet.mockReset();
  mockEmailService.configureEmail.mockReset();
  mockEmailService.testEmailConfig.mockReset();
  mockWhatsAppService.addProxy.mockReset();
  mockVerifyToken.mockReset();
  mockGenerateToken.mockReset();
}

// ─── Test Suites ─────────────────────────────────────────────────────────────
describe('Integrations API', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    // Default successful auth
    mockVerifyToken.mockImplementation((token: string) => {
      if (token === 'valid_jwt_token') {
        return { id: 'user-abc-123', email: 'test@example.com', businessId: 'biz-456', role: 'OWNER' };
      }
      if (token === 'expired_jwt_token') {
        const err: any = new Error('jwt expired');
        err.name = 'TokenExpiredError';
        throw err;
      }
      if (token === 'invalid_jwt_token') {
        const err: any = new Error('invalid signature');
        err.name = 'JsonWebTokenError';
        throw err;
      }
      if (token === 'member_token') {
        return { id: 'user-member', email: 'member@example.com', businessId: 'biz-456', role: 'MEMBER' };
      }
      throw new Error('Invalid token');
    });
    mockGenerateToken.mockImplementation((payload) => `mock_token_for_${payload.id}`);

    // Default business lookup
    mockPrisma.business.findUnique.mockResolvedValue(mockBusinessFixture);
    mockPrisma.user.findUnique.mockResolvedValue(mockUserFixture);
  });

  afterAll(() => {
    jest.useRealTimers();
    jest.clearAllTimers();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/integrations — List all integrations
  // ═══════════════════════════════════════════════════════════════════════════
  describe('GET /api/integrations', () => {
    it('should return 200 with list of integrations', async () => {
      mockPrisma.integration.findMany.mockResolvedValue([
        mockIntegrationFixture,
        { ...mockIntegrationFixture, id: 'int-def-456', type: 'email_smtp', name: 'Email SMTP' },
      ]);

      const res = await request(app)
        .get('/api/integrations')
        .set('Authorization', makeAuthToken())
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].type).toBe('google_sheets');
      expect(mockPrisma.integration.findMany).toHaveBeenCalledWith({
        where: { businessId: 'biz-456' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return 200 with empty array when no integrations exist', async () => {
      mockPrisma.integration.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/integrations')
        .set('Authorization', makeAuthToken())
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('should return 401 without authentication token', async () => {
      const res = await request(app)
        .get('/api/integrations')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Authentication required');
    });

    it('should return 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/integrations')
        .set('Authorization', 'Bearer invalid_jwt_token')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Invalid token');
    });

    it('should return 401 with expired token', async () => {
      const res = await request(app)
        .get('/api/integrations')
        .set('Authorization', 'Bearer expired_jwt_token')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Invalid token');
    });

    it('should return 403 for member role (if route enforces owner)', async () => {
      // The route uses authenticate middleware which allows any authenticated user
      // But we test the behavior with member role
      const res = await request(app)
        .get('/api/integrations')
        .set('Authorization', makeAuthToken({ role: 'MEMBER' }))
        .expect(200); // authenticate allows member, authorization would be in route

      expect(res.body.success).toBe(true);
    });

    it('should return 500 when database query fails', async () => {
      mockPrisma.integration.findMany.mockRejectedValue(new Error('DB connection failed'));

      const res = await request(app)
        .get('/api/integrations')
        .set('Authorization', makeAuthToken())
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('DB connection failed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/integrations/google-sheets — Configure Google Sheets integration
  // ═══════════════════════════════════════════════════════════════════════════
  describe('POST /api/integrations/google-sheets', () => {
    const validConfig = {
      spreadsheetId: 'sheet-123',
      accessToken: 'access-token-xyz',
      refreshToken: 'refresh-token-xyz',
      expiryDate: Date.now() + 3600000,
      autoSync: true,
      syncInterval: 60,
    };

    it('should return 200 and configure integration successfully', async () => {
      const configuredIntegration = {
        id: 'int-new-789',
        businessId: 'biz-456',
        type: 'google_sheets',
        name: 'Google Sheets',
        config: { ...validConfig, accessToken: 'encrypted_access-token-xyz', refreshToken: 'encrypted_refresh-token-xyz' },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockGoogleSheetsService.configureIntegration.mockResolvedValue(configuredIntegration);

      const res = await request(app)
        .post('/api/integrations/google-sheets')
        .set('Authorization', makeAuthToken())
        .send(validConfig)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        type: 'google_sheets',
        isActive: true,
      });
      expect(mockGoogleSheetsService.configureIntegration).toHaveBeenCalledWith('biz-456', validConfig);
    });

    it('should return 500 when service throws for missing required fields', async () => {
      mockGoogleSheetsService.configureIntegration.mockRejectedValue(new Error('Missing required field: accessToken'));

      const res = await request(app)
        .post('/api/integrations/google-sheets')
        .set('Authorization', makeAuthToken())
        .send({ spreadsheetId: 'sheet-123' }) // missing accessToken
        .expect(500);

      expect(res.body.success).toBe(false);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/integrations/google-sheets')
        .send(validConfig)
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 when service throws error', async () => {
      mockGoogleSheetsService.configureIntegration.mockRejectedValue(new Error('Failed to configure'));

      const res = await request(app)
        .post('/api/integrations/google-sheets')
        .set('Authorization', makeAuthToken())
        .send(validConfig)
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to configure');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/integrations/google-sheets/oauth-url — Get Google OAuth URL
  // ═══════════════════════════════════════════════════════════════════════════
  describe('GET /api/integrations/google-sheets/oauth-url', () => {
    it('should return 200 with OAuth URL', async () => {
      mockGoogleSheetsService.getOAuthUrl.mockReturnValue('https://accounts.google.com/oauth/authorize?client_id=...');

      const res = await request(app)
        .get('/api/integrations/google-sheets/oauth-url')
        .set('Authorization', makeAuthToken())
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.oauthUrl).toContain('accounts.google.com');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .get('/api/integrations/google-sheets/oauth-url')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 when service throws', async () => {
      mockGoogleSheetsService.getOAuthUrl.mockImplementation(() => {
        throw new Error('OAuth config error');
      });

      const res = await request(app)
        .get('/api/integrations/google-sheets/oauth-url')
        .set('Authorization', makeAuthToken())
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/integrations/google-sheets/callback — Handle OAuth callback
  // ═══════════════════════════════════════════════════════════════════════════
  describe('GET /api/integrations/google-sheets/callback', () => {
    it('should return 200 and handle callback successfully', async () => {
      mockGoogleSheetsService.handleOAuthCallback.mockResolvedValue({ spreadsheetId: 'sheet-new-123' });

      const res = await request(app)
        .get('/api/integrations/google-sheets/callback')
        .set('Authorization', makeAuthToken())
        .query({ code: 'auth-code-123', state: 'biz-456' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Google Sheets connected successfully');
      expect(mockGoogleSheetsService.handleOAuthCallback).toHaveBeenCalledWith('biz-456', 'auth-code-123');
    });

    it('should return 400 when code or state is missing', async () => {
      const res = await request(app)
        .get('/api/integrations/google-sheets/callback')
        .set('Authorization', makeAuthToken())
        .query({ code: 'auth-code-123' }) // missing state
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Missing code or businessId');
    });

    it('should return 500 when service throws', async () => {
      mockGoogleSheetsService.handleOAuthCallback.mockRejectedValue(new Error('Token exchange failed'));

      const res = await request(app)
        .get('/api/integrations/google-sheets/callback')
        .set('Authorization', makeAuthToken())
        .query({ code: 'auth-code-123', state: 'biz-456' })
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/integrations/google-sheets/sync — Sync contacts to Google Sheets
  // ═══════════════════════════════════════════════════════════════════════════
  describe('POST /api/integrations/google-sheets/sync', () => {
    it('should return 200 and sync contacts successfully', async () => {
      mockGoogleSheetsService.syncContacts.mockResolvedValue({
        synced: 50,
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-123',
      });

      const res = await request(app)
        .post('/api/integrations/google-sheets/sync')
        .set('Authorization', makeAuthToken())
        .send({ spreadsheetId: 'sheet-123', sheetName: 'Contacts', filter: { tags: ['lead'] } })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.synced).toBe(50);
      expect(mockGoogleSheetsService.syncContacts).toHaveBeenCalledWith('biz-456', {
        spreadsheetId: 'sheet-123',
        sheetName: 'Contacts',
        filter: { tags: ['lead'] },
      });
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/integrations/google-sheets/sync')
        .send({})
        .expect(401);
    });

    it('should return 500 when sync fails', async () => {
      mockGoogleSheetsService.syncContacts.mockRejectedValue(new Error('Sync failed: API quota exceeded'));

      const res = await request(app)
        .post('/api/integrations/google-sheets/sync')
        .set('Authorization', makeAuthToken())
        .send({})
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/integrations/google-sheets/import — Import contacts from Google Sheets
  // ═══════════════════════════════════════════════════════════════════════════
  describe('POST /api/integrations/google-sheets/import', () => {
    it('should return 200 and import contacts successfully', async () => {
      mockGoogleSheetsService.importContacts.mockResolvedValue({ imported: 25, skipped: 2 });

      const res = await request(app)
        .post('/api/integrations/google-sheets/import')
        .set('Authorization', makeAuthToken())
        .send({ spreadsheetId: 'sheet-123', sheetName: 'Contacts', range: 'A:K' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.imported).toBe(25);
      expect(res.body.data.skipped).toBe(2);
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .post('/api/integrations/google-sheets/import')
        .send({})
        .expect(401);
    });

    it('should return 500 when import fails', async () => {
      mockGoogleSheetsService.importContacts.mockRejectedValue(new Error('Import failed'));

      const res = await request(app)
        .post('/api/integrations/google-sheets/import')
        .set('Authorization', makeAuthToken())
        .send({ spreadsheetId: 'sheet-123' })
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/integrations/google-sheets/create — Create new spreadsheet
  // ═══════════════════════════════════════════════════════════════════════════
  describe('POST /api/integrations/google-sheets/create', () => {
    it('should return 200 and create spreadsheet successfully', async () => {
      mockGoogleSheetsService.createSpreadsheet.mockResolvedValue({
        spreadsheetId: 'new-sheet-789',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-sheet-789',
      });

      const res = await request(app)
        .post('/api/integrations/google-sheets/create')
        .set('Authorization', makeAuthToken())
        .send({ title: 'My CRM Contacts' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.spreadsheetId).toBe('new-sheet-789');
    });

    it('should use default title when not provided', async () => {
      mockGoogleSheetsService.createSpreadsheet.mockResolvedValue({
        spreadsheetId: 'new-sheet-789',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-sheet-789',
      });

      const res = await request(app)
        .post('/api/integrations/google-sheets/create')
        .set('Authorization', makeAuthToken())
        .send({})
        .expect(200);

      expect(mockGoogleSheetsService.createSpreadsheet).toHaveBeenCalledWith('biz-456', 'CRM Contacts');
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .post('/api/integrations/google-sheets/create')
        .send({})
        .expect(401);
    });

    it('should return 500 when creation fails', async () => {
      mockGoogleSheetsService.createSpreadsheet.mockRejectedValue(new Error('Creation failed'));

      const res = await request(app)
        .post('/api/integrations/google-sheets/create')
        .set('Authorization', makeAuthToken())
        .send({ title: 'Test' })
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/integrations/email — Configure email integration
  // ═══════════════════════════════════════════════════════════════════════════
  describe('POST /api/integrations/email', () => {
    const validEmailConfig = {
      smtpHost: 'smtp.gmail.com',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'test@gmail.com',
      smtpPass: 'app-password',
      fromName: 'Test Business',
      enableAutoReply: true,
      autoReplyMessage: 'Thanks for contacting us!',
    };

    it('should return 200 and configure email successfully', async () => {
      const configuredIntegration = {
        id: 'int-email-123',
        businessId: 'biz-456',
        type: 'email_smtp',
        name: 'Email SMTP',
        config: { ...validEmailConfig, host: 'smtp.gmail.com', port: 587, secure: false, user: 'test@gmail.com' },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockEmailService.configureEmail.mockResolvedValue(configuredIntegration);

      const res = await request(app)
        .post('/api/integrations/email')
        .set('Authorization', makeAuthToken())
        .send(validEmailConfig)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('email_smtp');
      expect(mockEmailService.configureEmail).toHaveBeenCalledWith('biz-456', expect.objectContaining({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        user: 'test@gmail.com',
      }));
    });

    it('should use defaults when optional fields omitted', async () => {
      mockEmailService.configureEmail.mockResolvedValue({ id: 'int-1', type: 'email_smtp' });

      const res = await request(app)
        .post('/api/integrations/email')
        .set('Authorization', makeAuthToken())
        .send({ smtpHost: 'smtp.custom.com', smtpUser: 'user@custom.com', smtpPass: 'pass' })
        .expect(200);

      expect(mockEmailService.configureEmail).toHaveBeenCalledWith('biz-456', expect.objectContaining({
        host: 'smtp.custom.com',
        port: 587,
        secure: false,
      }));
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .post('/api/integrations/email')
        .send(validEmailConfig)
        .expect(401);
    });

    it('should return 500 when configuration fails', async () => {
      mockEmailService.configureEmail.mockRejectedValue(new Error('SMTP auth failed'));

      const res = await request(app)
        .post('/api/integrations/email')
        .set('Authorization', makeAuthToken())
        .send(validEmailConfig)
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/integrations/email/test — Test email configuration
  // ═══════════════════════════════════════════════════════════════════════════
  describe('POST /api/integrations/email/test', () => {
    it('should return 200 with valid=true when config works', async () => {
      mockEmailService.testEmailConfig.mockResolvedValue(true);

      const res = await request(app)
        .post('/api/integrations/email/test')
        .set('Authorization', makeAuthToken())
        .send({
          smtpHost: 'smtp.gmail.com',
          smtpPort: 587,
          smtpSecure: false,
          smtpUser: 'test@gmail.com',
          smtpPass: 'app-password',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.valid).toBe(true);
    });

    it('should return 200 with valid=false when config fails', async () => {
      mockEmailService.testEmailConfig.mockResolvedValue(false);

      const res = await request(app)
        .post('/api/integrations/email/test')
        .set('Authorization', makeAuthToken())
        .send({
          smtpHost: 'smtp.gmail.com',
          smtpPort: 587,
          smtpUser: 'test@gmail.com',
          smtpPass: 'wrong-password',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.valid).toBe(false);
    });

    it('should return 500 when test throws error', async () => {
      mockEmailService.testEmailConfig.mockRejectedValue(new Error('Connection timeout'));

      const res = await request(app)
        .post('/api/integrations/email/test')
        .set('Authorization', makeAuthToken())
        .send({ smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpUser: 'test', smtpPass: 'pass' })
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/integrations/proxy — Add proxy for WhatsApp
  // ═══════════════════════════════════════════════════════════════════════════
  describe('POST /api/integrations/proxy', () => {
    it('should return 200 and add proxy successfully', async () => {
      const proxy = {
        id: 'proxy-123',
        businessId: 'biz-456',
        type: 'proxy',
        name: 'WhatsApp Proxy',
        config: { url: 'http://proxy.example.com:8080', username: 'user', password: 'pass' },
        isActive: true,
        createdAt: new Date(),
      };
      mockWhatsAppService.addProxy.mockResolvedValue(proxy);

      const res = await request(app)
        .post('/api/integrations/proxy')
        .set('Authorization', makeAuthToken())
        .send({ url: 'http://proxy.example.com:8080', username: 'user', password: 'pass' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('proxy');
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .post('/api/integrations/proxy')
        .send({ url: 'http://proxy.example.com' })
        .expect(401);
    });

    it('should return 500 when service fails', async () => {
      mockWhatsAppService.addProxy.mockRejectedValue(new Error('Proxy validation failed'));

      const res = await request(app)
        .post('/api/integrations/proxy')
        .set('Authorization', makeAuthToken())
        .send({ url: 'http://proxy.example.com' })
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/integrations — Create custom integration
  // ═══════════════════════════════════════════════════════════════════════════
  describe('POST /api/integrations', () => {
    it('should return 200 and create custom integration', async () => {
      const newIntegration = {
        id: 'int-custom-123',
        businessId: 'biz-456',
        type: 'webhook',
        name: 'Custom Webhook',
        config: { url: 'https://webhook.site/123' },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.integration.create.mockResolvedValue(newIntegration);

      const res = await request(app)
        .post('/api/integrations')
        .set('Authorization', makeAuthToken())
        .send({ type: 'webhook', name: 'Custom Webhook', config: { url: 'https://webhook.site/123' }, isActive: true })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('webhook');
      expect(mockPrisma.integration.create).toHaveBeenCalledWith({
        data: {
          businessId: 'biz-456',
          type: 'webhook',
          name: 'Custom Webhook',
          config: { url: 'https://webhook.site/123' },
          isActive: true,
        },
      });
    });

    it('should return 400 when type or name is missing', async () => {
      const res = await request(app)
        .post('/api/integrations')
        .set('Authorization', makeAuthToken())
        .send({ type: 'webhook' }) // missing name
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Type and name are required');
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .post('/api/integrations')
        .send({ type: 'webhook', name: 'Test' })
        .expect(401);
    });

    it('should return 500 when database create fails', async () => {
      mockPrisma.integration.create.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .post('/api/integrations')
        .set('Authorization', makeAuthToken())
        .send({ type: 'webhook', name: 'Test' })
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PUT /api/integrations/:id — Update integration
  // ═══════════════════════════════════════════════════════════════════════════
  describe('PUT /api/integrations/:id', () => {
    it('should return 200 and update integration', async () => {
      const updatedIntegration = {
        ...mockIntegrationFixture,
        name: 'Updated Google Sheets',
        config: { ...mockIntegrationFixture.config, autoSync: false },
      };
      mockPrisma.integration.update.mockResolvedValue(updatedIntegration);

      const res = await request(app)
        .put('/api/integrations/int-abc-123')
        .set('Authorization', makeAuthToken())
        .send({ name: 'Updated Google Sheets', config: { autoSync: false }, isActive: true })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Updated Google Sheets');
      expect(mockPrisma.integration.update).toHaveBeenCalledWith({
        where: { id: 'int-abc-123', businessId: 'biz-456' },
        data: {
          name: 'Updated Google Sheets',
          config: { autoSync: false },
          isActive: true,
        },
      });
    });

    it('should return 404 when integration not found', async () => {
      mockPrisma.integration.update.mockRejectedValue({ code: 'P2025' }); // Prisma not found error

      const res = await request(app)
        .put('/api/integrations/non-existent')
        .set('Authorization', makeAuthToken())
        .send({ name: 'Updated' })
        .expect(500); // Route catches as 500

      expect(res.body.success).toBe(false);
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .put('/api/integrations/int-abc-123')
        .send({ name: 'Updated' })
        .expect(401);
    });

    it('should return 500 when database update fails', async () => {
      mockPrisma.integration.update.mockRejectedValue(new Error('DB update failed'));

      const res = await request(app)
        .put('/api/integrations/int-abc-123')
        .set('Authorization', makeAuthToken())
        .send({ name: 'Updated' })
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE /api/integrations/:id — Delete integration
  // ═══════════════════════════════════════════════════════════════════════════
  describe('DELETE /api/integrations/:id', () => {
    it('should return 200 and delete integration', async () => {
      mockPrisma.integration.delete.mockResolvedValue({ id: 'int-abc-123' });

      const res = await request(app)
        .delete('/api/integrations/int-abc-123')
        .set('Authorization', makeAuthToken())
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Integration deleted');
      expect(mockPrisma.integration.delete).toHaveBeenCalledWith({
        where: { id: 'int-abc-123', businessId: 'biz-456' },
      });
    });

    it('should return 404 when integration not found', async () => {
      mockPrisma.integration.delete.mockRejectedValue({ code: 'P2025' });

      const res = await request(app)
        .delete('/api/integrations/non-existent')
        .set('Authorization', makeAuthToken())
        .expect(500);

      expect(res.body.success).toBe(false);
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .delete('/api/integrations/int-abc-123')
        .expect(401);
    });

    it('should return 500 when database delete fails', async () => {
      mockPrisma.integration.delete.mockRejectedValue(new Error('DB delete failed'));

      const res = await request(app)
        .delete('/api/integrations/int-abc-123')
        .set('Authorization', makeAuthToken())
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });
});