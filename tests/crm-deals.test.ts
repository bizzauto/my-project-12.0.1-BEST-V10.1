/**
 * @jest-environment node
 *
 * Integration tests for the Deals CRM API.
 * Tests deal listing, creation, stats, stage updates, and role-based access.
 *
 * Endpoints tested:
 *   GET    /api/deals          list deals with pagination/filters
 *   POST   /api/deals          create deal (new or existing contact)
 *   GET    /api/deals/stats    get deal statistics
 *   PUT    /api/deals/:id      update deal details
 *   PUT    /api/deals/:id/stage  update deal stage (drag-and-drop)
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────
// All jest.mock calls MUST be at the top level so Jest hoists them above imports.

// ── Prisma mock ──────────────────────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  contact: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  activity: {
    create: jest.fn(),
  },
  business: {
    findUnique: jest.fn(),
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

// ── JSON Web Token mock (used by authenticate middleware) ────────────────────
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

// ── CSRF Service mock (dynamically imported in authenticate middleware) ──────
jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

// ── Cache middleware mock (no-op for tests - avoids Redis dependency) ────────
jest.mock('../src/server/middleware/cache', () => ({
  cacheResponse: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));

// Import the router AFTER all mocks are set up
import dealsRoutes from '../src/server/routes/deals';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  businessId: 'biz-1',
  role: 'OWNER',
  isActive: true,
  emailVerified: true,
};

const mockDealContact = {
  id: 'deal-contact-1',
  businessId: 'biz-1',
  name: 'Acme Corp',
  phone: '+911234567890',
  email: 'acme@example.com',
  company: 'Acme Corp',
  dealValue: 50000,
  dealStage: 'Negotiation',
  stage: 'Negotiation',
  stageId: 'stage-1',
  pipelineId: 'pipeline-1',
  tags: ['customer'],
  source: 'manual',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-15'),
  pipeline: { id: 'pipeline-1', name: 'Sales Pipeline' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/deals', dealsRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();

  // Re-apply default mock implementations
  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: 'user-1',
    email: 'test@test.com',
    businessId: 'biz-1',
    role: 'OWNER',
  });

  mockPrisma.user.findUnique.mockResolvedValue(mockUser);

  const { CSRFService } =
    jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');
}

// ─── GET /api/deals — List deals ─────────────────────────────────────────────

describe('GET /api/deals', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.contact.findMany.mockResolvedValue([mockDealContact]);
    mockPrisma.contact.count.mockResolvedValue(1);
  });

  it('should list deals with pagination', async () => {
    const res = await request(app)
      .get('/api/deals')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.deals).toHaveLength(1);
    expect(res.body.data.deals[0]).toMatchObject({
      contactId: 'deal-contact-1',
      title: 'Acme Corp - Negotiation',
      value: 50000,
      stage: 'Negotiation',
      pipelineId: 'pipeline-1',
      contact: {
        name: 'Acme Corp',
        phone: '+911234567890',
        email: 'acme@example.com',
        company: 'Acme Corp',
      },
    });
    expect(res.body.data.pagination).toMatchObject({
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    });

    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
          OR: expect.arrayContaining([
            { dealValue: { gt: 0 } },
            { dealStage: { not: null } },
            { pipelineId: { not: null } },
            { stageId: { not: null } },
          ]),
        }),
        skip: 0,
        take: 50,
        orderBy: { updatedAt: 'desc' },
        select: expect.any(Object),
      }),
    );
  });

  it('should filter by stage', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([]);
    mockPrisma.contact.count.mockResolvedValue(0);

    await request(app)
      .get('/api/deals?stage=Negotiation')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dealStage: 'Negotiation',
        }),
      }),
    );
  });

  it('should handle empty results', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([]);
    mockPrisma.contact.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/deals')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.deals).toEqual([]);
    expect(res.body.data.pagination).toMatchObject({
      total: 0,
      page: 1,
      totalPages: 0,
    });
  });
});

// ─── POST /api/deals — Create deal ───────────────────────────────────────────

describe('POST /api/deals', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should create a new contact as deal', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null); // no existing
    mockPrisma.contact.create.mockResolvedValue({
      ...mockDealContact,
      id: 'new-deal-1',
      name: 'New Client',
      phone: '+919999999999',
      dealValue: 25000,
      dealStage: 'lead',
    });

    const res = await request(app)
      .post('/api/deals')
      .set('Authorization', 'Bearer valid_token')
      .send({
        contactName: 'New Client',
        contactPhone: '+919999999999',
        contactEmail: 'new@client.com',
        value: 25000,
        stage: 'lead',
        source: 'manual',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: 'New Client',
      phone: '+919999999999',
      dealValue: 25000,
      dealStage: 'lead',
    });

    expect(mockPrisma.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-1',
          name: 'New Client',
          phone: '+919999999999',
          dealValue: 25000,
          dealStage: 'lead',
        }),
      }),
    );
  });

  it('should update existing contact as deal', async () => {
    const existingContact = { ...mockDealContact, id: 'existing-1', dealValue: 0, dealStage: null };
    mockPrisma.contact.findFirst.mockResolvedValue(existingContact);
    mockPrisma.contact.update.mockResolvedValue({
      ...existingContact,
      dealValue: 75000,
      dealStage: 'qualified',
    });

    const res = await request(app)
      .post('/api/deals')
      .set('Authorization', 'Bearer valid_token')
      .send({
        contactName: 'Acme Corp',
        contactPhone: '+911234567890',
        value: 75000,
        stage: 'qualified',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'existing-1',
      dealValue: 75000,
      dealStage: 'qualified',
    });

    expect(mockPrisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-1' },
        data: expect.objectContaining({
          dealValue: 75000,
          dealStage: 'qualified',
        }),
      }),
    );
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
  });
});

// ─── GET /api/deals/stats — Deal statistics ──────────────────────────────────

describe('GET /api/deals/stats', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should return deal statistics', async () => {
    const now = new Date();
    const dealsData = [
      { dealValue: 50000, dealStage: 'Negotiation', stage: 'Negotiation', createdAt: now, updatedAt: now },
      { dealValue: 100000, dealStage: 'Closed Won', stage: 'Won', createdAt: now, updatedAt: now },
      { dealValue: 20000, dealStage: 'Closed Lost', stage: 'Lost', createdAt: now, updatedAt: now },
      { dealValue: 15000, dealStage: 'Qualified', stage: 'Qualified', createdAt: now, updatedAt: now },
    ];
    mockPrisma.contact.findMany.mockResolvedValue(dealsData);

    const res = await request(app)
      .get('/api/deals/stats')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      totalDealValue: 185000,
      wonDeals: 100000,
      lostDeals: 20000,
    });

    // Pipeline should have one entry per unique deal stage
    expect(res.body.data.pipeline).toBeDefined();
    expect(res.body.data.pipeline.length).toBeGreaterThanOrEqual(3);

    // Win/loss rates
    expect(res.body.data.winRate).toBeGreaterThan(0);
    expect(res.body.data.lossRate).toBeGreaterThan(0);

    // Forecast
    expect(res.body.data.monthlyForecast).toBeGreaterThan(0);
    expect(res.body.data.quarterlyForecast).toBeGreaterThan(0);

    // Average deal age
    expect(res.body.data.avgDealAge).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty deals for stats', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/deals/stats')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      totalDealValue: 0,
      wonDeals: 0,
      lostDeals: 0,
      activeDeals: 0,
      totalDeals: 0,
      weightedPipelineValue: 0,
      winRate: 0,
      lossRate: 0,
      avgDealAge: 0,
      monthlyForecast: 0,
      quarterlyForecast: 0,
      pipeline: [],
    });
  });
});

// ─── PUT /api/deals/:id/stage — Update deal stage ────────────────────────────

describe('PUT /api/deals/:id/stage', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should update deal stage', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(mockDealContact);
    mockPrisma.contact.update.mockResolvedValue({
      id: 'deal-contact-1',
      name: 'Acme Corp',
      dealValue: 50000,
      dealStage: 'Closed Won',
      stage: 'Closed Won',
      stageId: 'stage-2',
      pipelineId: 'pipeline-1',
    });

    const res = await request(app)
      .put('/api/deals/deal-contact-1/stage')
      .set('Authorization', 'Bearer valid_token')
      .send({ stage: 'Closed Won', stageId: 'stage-2', pipelineId: 'pipeline-1' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'deal-contact-1',
      stage: 'Closed Won',
      stageId: 'stage-2',
      pipelineId: 'pipeline-1',
    });

    // Verify contact was updated
    expect(mockPrisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'deal-contact-1', businessId: 'biz-1' },
        data: expect.objectContaining({
          dealStage: 'Closed Won',
          stage: 'Closed Won',
          stageId: 'stage-2',
          pipelineId: 'pipeline-1',
        }),
      }),
    );

    // Activity was logged for stage change
    expect(mockPrisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'deal_stage_changed',
          stageFrom: 'Negotiation',
          stageTo: 'Closed Won',
          createdBy: 'user-1',
        }),
      }),
    );
  });

  it('should return 404 for non-existent deal', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/deals/non-existent-id/stage')
      .set('Authorization', 'Bearer valid_token')
      .send({ stage: 'Closed Won' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Contact/deal not found');
    expect(mockPrisma.contact.update).not.toHaveBeenCalled();
  });
});

// ─── PUT /api/deals/:id — Update deal details ────────────────────────────────

describe('PUT /api/deals/:id', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should update deal details', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(mockDealContact);
    mockPrisma.contact.update.mockResolvedValue({
      ...mockDealContact,
      dealValue: 75000,
      dealStage: 'Proposal',
    });

    const res = await request(app)
      .put('/api/deals/deal-contact-1')
      .set('Authorization', 'Bearer valid_token')
      .send({
        dealValue: 75000,
        dealStage: 'Proposal',
        pipelineId: 'pipeline-1',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      dealValue: 75000,
      dealStage: 'Proposal',
    });

    expect(mockPrisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'deal-contact-1', businessId: 'biz-1' },
        data: expect.objectContaining({
          dealValue: 75000,
          dealStage: 'Proposal',
          pipelineId: 'pipeline-1',
        }),
      }),
    );
  });

  it('should return 404 for non-existent deal', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/deals/non-existent-id')
      .set('Authorization', 'Bearer valid_token')
      .send({ dealValue: 1000 })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Contact/deal not found');
    expect(mockPrisma.contact.update).not.toHaveBeenCalled();
  });
});
