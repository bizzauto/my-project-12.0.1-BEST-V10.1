/**
 * @jest-environment node
 *
 * Phase D.2 — Lead → Deal conversion (closes the full lead → pipeline loop).
 *
 * Exercises POST /api/leads/:id/convert on the real leads.ts router (mocked
 * Prisma + auth). The route promotes a captured lead's Contact into a Deal by
 * setting dealStage (and optionally stageId/pipelineId/value) and logs an
 * activity linking the deal to the originating Contact.
 *
 * Then asserts a Deal row linked to the Contact is created/persisted:
 *   - prisma.contact.update receives the deal fields (dealStage = the stage)
 *   - prisma.activity.create links contactId to the conversion
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

const mockPrisma = {
  contact: {
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  activity: {
    create: jest.fn(),
  },
  business: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  $disconnect: jest.fn(),
};

jest.mock('../src/server/db', () => ({
  prisma: mockPrisma,
}));

jest.mock('../src/server/utils/auth', () => ({
  verifyToken: jest.fn().mockResolvedValue({
    id: 'user-1',
    email: 'test@test.com',
    businessId: 'biz-1',
    role: 'OWNER',
  }),
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
  generateToken: jest.fn().mockReturnValue('mock_jwt_token'),
  generateRefreshToken: jest.fn().mockReturnValue('mock_refresh_token'),
  getJwtSecret: jest.fn().mockReturnValue('test-secret'),
  encrypt: jest.fn().mockReturnValue('encrypted'),
  decrypt: jest.fn().mockReturnValue('decrypted'),
}));

jest.mock('express-rate-limit', () => ({
  default: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  __esModule: true,
}));

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

jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

jest.mock('../src/server/middleware/cache', () => ({
  cacheResponse: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));

jest.mock('../src/server/services/redis-cache.service', () => ({
  cacheResponse: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  invalidateCache: jest.fn(),
  getCacheStats: jest.fn(),
}));

// leads.ts pulls in heavy services — stub them so the router loads cleanly.
jest.mock('../src/server/services/lead-capture.service', () => ({
  LeadCaptureService: {
    captureIndiaMARTLead: jest.fn(),
    captureJustDialLead: jest.fn(),
    captureFacebookLead: jest.fn(),
    captureInstagramLead: jest.fn(),
  },
}));

jest.mock('../src/server/services/whatsapp-send-router.service', () => ({
  WhatsAppSendRouter: {
    resolveChannel: jest.fn(),
    sendText: jest.fn(),
    sendTemplate: jest.fn(),
    bulkSend: jest.fn(),
  },
}));

jest.mock('../src/server/services/email.service', () => ({
  EmailService: { sendEmail: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../src/server/services/ai-auto-reply.service', () => ({
  handleLeadCapture: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/server/middleware/ipSecurity', () => ({
  ipBlocker: { increment: jest.fn() },
}));

jest.mock('axios');

// Import router AFTER all mocks are set up
import leadsRoutes from '../src/server/routes/leads';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/leads', leadsRoutes);
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
}

// ─── Lead → Deal conversion ──────────────────────────────────────────────────

describe('Phase D.2 — Lead to Deal conversion', () => {
  let app: express.Application;

  const leadContact = {
    id: 'lead-1',
    businessId: 'biz-1',
    name: 'Priya Sharma',
    phone: '+919888888888',
    email: 'priya@example.com',
    company: 'Priya Enterprises',
    dealValue: 0,
    dealStage: null,
    stage: null,
    stageId: null,
    pipelineId: null,
    source: 'indiamart',
  };

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      businessId: 'biz-1',
      role: 'OWNER',
      isActive: true,
      emailVerified: true,
    });
  });

  it('converts a captured lead into a deal linked to the same contact', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(leadContact);
    mockPrisma.contact.update.mockResolvedValue({
      ...leadContact,
      dealValue: 75000,
      dealStage: 'New Lead',
      stage: 'New Lead',
      stageId: 'stage-new',
      pipelineId: 'pipe-1',
    });
    mockPrisma.activity.create.mockResolvedValue({ id: 'act-1' });

    const res = await request(app)
      .post('/api/leads/lead-1/convert')
      .set('Authorization', 'Bearer valid_token')
      .send({ stage: 'New Lead', stageId: 'stage-new', pipelineId: 'pipe-1', value: 75000 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'lead-1',
      contactId: 'lead-1',
      dealStage: 'New Lead',
      stageId: 'stage-new',
      pipelineId: 'pipe-1',
      dealValue: 75000,
    });

    // Persistence: contact promoted to a deal with the requested stage
    expect(mockPrisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-1', businessId: 'biz-1' },
        data: expect.objectContaining({
          dealStage: 'New Lead',
          stage: 'New Lead',
          stageId: 'stage-new',
          pipelineId: 'pipe-1',
          dealValue: 75000,
        }),
      }),
    );

    // The deal is linked to the originating Contact via an activity row
    expect(mockPrisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactId: 'lead-1',
          type: 'lead_converted_to_deal',
          stageTo: 'New Lead',
        }),
      }),
    );
  });

  it('uses default stage when none provided', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(leadContact);
    mockPrisma.contact.update.mockResolvedValue({
      ...leadContact,
      dealStage: 'New Lead',
      stage: 'New Lead',
    });
    mockPrisma.activity.create.mockResolvedValue({ id: 'act-2' });

    const res = await request(app)
      .post('/api/leads/lead-1/convert')
      .set('Authorization', 'Bearer valid_token')
      .send({})
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.dealStage).toBe('New Lead');
  });

  it('returns 404 when the lead does not exist', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    await request(app)
      .post('/api/leads/missing/convert')
      .set('Authorization', 'Bearer valid_token')
      .send({ stage: 'New Lead' })
      .expect(404);
  });
});
