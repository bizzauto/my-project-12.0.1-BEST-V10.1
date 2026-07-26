/**
 * @jest-environment node
 *
 * Integration tests for the Campaigns API (marketing outreach campaigns).
 *
 * Endpoints tested:
 *   GET    /api/campaigns                — list with filtering & pagination
 *   GET    /api/campaigns/:id            — get single campaign with messages
 *   POST   /api/campaigns                — create campaign (OWNER/ADMIN)
 *   PUT    /api/campaigns/:id            — update draft/scheduled campaign (OWNER/ADMIN)
 *   DELETE /api/campaigns/:id            — delete non-active campaign (OWNER/ADMIN)
 *   POST   /api/campaigns/:id/start      — start/activate campaign (OWNER/ADMIN)
 *   POST   /api/campaigns/:id/pause      — pause campaign (OWNER/ADMIN)
 *   POST   /api/campaigns/:id/send       — send draft campaign (OWNER/ADMIN)
 *   POST   /api/campaigns/:id/schedule   — schedule campaign (OWNER/ADMIN)
 *   GET    /api/campaigns/:id/stats      — campaign statistics
 */

import express from 'express';
import request from 'supertest';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockCampaign = {
  id: 'camp-001',
  businessId: 'biz-456',
  name: 'Summer Promotion',
  type: 'whatsapp_broadcast',
  status: 'draft',
  templateName: 'promo_template',
  templateVars: { discount: '20%' },
  targetTags: ['customer', 'loyalty'],
  targetFilters: {},
  targetContacts: 0,
  targetCount: 50,
  content: { message: 'Check out our summer deals!', buttons: [], media: {} },
  dripSteps: null,
  scheduledAt: null,
  startedAt: null,
  completedAt: null,
  createdBy: 'user-abc-123',
  createdAt: new Date('2026-07-26'),
  updatedAt: new Date('2026-07-26'),
  _count: { messages: 0 },
};

const mockActiveCampaign = {
  ...mockCampaign,
  id: 'camp-active',
  status: 'active',
  startedAt: new Date('2026-07-26T12:00:00Z'),
  targetContacts: 100,
  _count: { messages: 25 },
};

// ── Prisma mock ───────────────────────────────────────────────────────────────
const mockPrisma = {
  campaign: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  message: {
    count: jest.fn(),
    create: jest.fn(),
  },
  contact: {
    findMany: jest.fn(),
  },
  dripQueue: {
    create: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  $disconnect: jest.fn(),
};

jest.mock('../src/server/db', () => ({
  prisma: mockPrisma,
}));

// ── Auth utilities mock ───────────────────────────────────────────────────────
jest.mock('../src/server/utils/auth', () => ({
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
  generateToken: jest.fn(),
  generateRefreshToken: jest.fn(),
  verifyToken: jest.fn().mockReturnValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  }),
  getJwtSecret: jest.fn().mockReturnValue('test-secret'),
  encrypt: jest.fn().mockReturnValue('encrypted_data'),
  decrypt: jest.fn().mockReturnValue('decrypted_data'),
}));

// ── Rate limiting mock ────────────────────────────────────────────────────────
jest.mock('express-rate-limit', () => ({
  default: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  __esModule: true,
}));

// ── JWT mock ──────────────────────────────────────────────────────────────────
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  }),
  sign: jest.fn().mockReturnValue('mock_jwt_token'),
  decode: jest.fn(),
}));

// ── CSRF service mock ─────────────────────────────────────────────────────────
jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

// ── IP Blocker mock ───────────────────────────────────────────────────────────
jest.mock('../src/server/middleware/ipSecurity', () => ({
  ipBlocker: {
    increment: jest.fn(),
  },
}));

// ── Cache middleware mock ─────────────────────────────────────────────────────
jest.mock('../src/server/services/redis-cache.service', () => ({
  cacheResponse: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  invalidateCache: jest.fn(),
  getCacheStats: jest.fn(),
}));

// ── Outreach worker mock (BullMQ queue) ───────────────────────────────────────
export const mockOutreachQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-001' }),
  close: jest.fn(),
};

jest.mock('../src/server/workers/outreach.worker', () => ({
  outreachQueue: mockOutreachQueue,
  followUpQueue: null,
}));

// ── Trap setInterval calls ────────────────────────────────────────────────────
const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

import campaignsRoutes from '../src/server/routes/campaigns';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/campaigns', campaignsRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();

  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockReturnValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  });

  const { CSRFService } = jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterAll(() => {
  for (const id of intervalIds) {
    clearInterval(id);
  }
  intervalIds.length = 0;
  global.setInterval = originalSetInterval;
});

// ─── GET /api/campaigns — list ────────────────────────────────────────────────

describe('GET /api/campaigns', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'OWNER',
      isActive: true,
      emailVerified: new Date(),
    });
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/campaigns').expect(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return empty list when no campaigns exist', async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([]);
    mockPrisma.campaign.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.campaigns).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
    expect(res.body.data.pagination.totalPages).toBe(0);
  });

  it('should return paginated campaigns with message counts', async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([mockCampaign]);
    mockPrisma.campaign.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.campaigns).toHaveLength(1);
    expect(res.body.data.campaigns[0].name).toBe('Summer Promotion');
    expect(res.body.data.pagination).toEqual({
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    });
  });

  it('should filter by status', async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([mockActiveCampaign]);
    mockPrisma.campaign.count.mockResolvedValue(1);

    await request(app)
      .get('/api/campaigns?status=active')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(mockPrisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'active' }),
      }),
    );
  });

  it('should filter by type', async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([]);
    mockPrisma.campaign.count.mockResolvedValue(0);

    await request(app)
      .get('/api/campaigns?type=email')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(mockPrisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: 'email' }),
      }),
    );
  });

  it('should apply pagination params correctly', async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([]);
    mockPrisma.campaign.count.mockResolvedValue(0);

    await request(app)
      .get('/api/campaigns?page=2&limit=10')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(mockPrisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.campaign.findMany.mockRejectedValue(new Error('DB timeout'));

    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to fetch campaigns');
  });
});

// ─── GET /api/campaigns/:id — single ──────────────────────────────────────────

describe('GET /api/campaigns/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'OWNER',
      isActive: true,
      emailVerified: new Date(),
    });
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/campaigns/camp-001').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should return a campaign by ID with messages', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue({
      ...mockCampaign,
      messages: [
        { id: 'msg-001', content: 'Hello', createdAt: new Date(), status: 'sent' },
      ],
    });

    const res = await request(app)
      .get('/api/campaigns/camp-001')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Summer Promotion');
    expect(res.body.data.messages).toHaveLength(1);
  });

  it('should return 404 for non-existent campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/campaigns/nonexistent')
      .set('Authorization', 'Bearer token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Campaign not found');
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.campaign.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/campaigns/camp-001')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── POST /api/campaigns — create (OWNER/ADMIN) ───────────────────────────────

describe('POST /api/campaigns', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'OWNER',
      isActive: true,
      emailVerified: new Date(),
    });
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).post('/api/campaigns').send({ name: 'Test', type: 'whatsapp_broadcast' }).expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should create a campaign as OWNER', async () => {
    mockPrisma.campaign.create.mockResolvedValue(mockCampaign);

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer token')
      .send({
        name: 'Summer Promotion',
        type: 'whatsapp_broadcast',
        templateName: 'promo_template',
        targetTags: ['customer', 'loyalty'],
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Summer Promotion');
    expect(mockPrisma.campaign.create).toHaveBeenCalledTimes(1);
  });

  it('should reject creation with MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockReturnValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'MEMBER',
      isActive: true,
      emailVerified: new Date(),
    });

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Test', type: 'whatsapp_broadcast' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
  });

  it('should allow ADMIN role to create campaigns', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockReturnValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'ADMIN',
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'ADMIN',
      isActive: true,
      emailVerified: new Date(),
    });
    mockPrisma.campaign.create.mockResolvedValue(mockCampaign);

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Test', type: 'whatsapp_broadcast' })
      .expect(201);

    expect(res.body.success).toBe(true);
  });

  it('should reject validation when name is missing', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer token')
      .send({ type: 'whatsapp_broadcast' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Validation failed');
  });

  it('should reject validation when type is missing', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Test' })
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  it('should set status to scheduled when scheduledAt provided', async () => {
    mockPrisma.campaign.create.mockResolvedValue({
      ...mockCampaign,
      status: 'scheduled',
      scheduledAt: new Date('2026-08-01T10:00:00Z'),
    });

    await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer token')
      .send({
        name: 'Scheduled Campaign',
        type: 'email',
        scheduledAt: '2026-08-01T10:00:00Z',
      })
      .expect(201);

    const createCall = mockPrisma.campaign.create.mock.calls[0][0];
    expect(createCall.data.status).toBe('scheduled');
  });

  it('should reject invalid campaign type', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Test', type: 'invalid_type' })
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.campaign.create.mockRejectedValue(new Error('Create failed'));

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Test', type: 'whatsapp_broadcast' })
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── PUT /api/campaigns/:id — update (OWNER/ADMIN) ────────────────────────────

describe('PUT /api/campaigns/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'OWNER',
      isActive: true,
      emailVerified: new Date(),
    });
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).put('/api/campaigns/camp-001').send({}).expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should update a draft campaign successfully', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockCampaign);
    mockPrisma.campaign.update.mockResolvedValue({
      ...mockCampaign,
      name: 'Updated Campaign Name',
    });

    const res = await request(app)
      .put('/api/campaigns/camp-001')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Updated Campaign Name' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Updated Campaign Name');
  });

  it('should update a scheduled campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue({
      ...mockCampaign,
      status: 'scheduled',
      scheduledAt: new Date('2026-08-01T10:00:00Z'),
    });
    mockPrisma.campaign.update.mockResolvedValue({
      ...mockCampaign,
      status: 'scheduled',
      name: 'Updated',
    });

    const res = await request(app)
      .put('/api/campaigns/camp-001')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Updated' })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('should reject updating an active campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockActiveCampaign);

    const res = await request(app)
      .put('/api/campaigns/camp-active')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Updated' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Cannot update active or completed campaigns');
  });

  it('should reject updating a completed campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue({
      ...mockCampaign,
      status: 'completed',
    });

    const res = await request(app)
      .put('/api/campaigns/camp-001')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Updated' })
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  it('should return 404 when campaign not found', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/campaigns/nonexistent')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Updated' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Campaign not found');
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockCampaign);
    mockPrisma.campaign.update.mockRejectedValue(new Error('Update failed'));

    const res = await request(app)
      .put('/api/campaigns/camp-001')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Updated' })
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── DELETE /api/campaigns/:id — delete (OWNER/ADMIN) ─────────────────────────

describe('DELETE /api/campaigns/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'OWNER',
      isActive: true,
      emailVerified: new Date(),
    });
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).delete('/api/campaigns/camp-001').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should delete a draft campaign successfully', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockCampaign);
    mockPrisma.campaign.delete.mockResolvedValue(mockCampaign);

    const res = await request(app)
      .delete('/api/campaigns/camp-001')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Campaign deleted successfully');
  });

  it('should reject deleting an active campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockActiveCampaign);

    const res = await request(app)
      .delete('/api/campaigns/camp-active')
      .set('Authorization', 'Bearer token')
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Cannot delete active campaigns');
  });

  it('should return 404 when campaign not found', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/campaigns/nonexistent')
      .set('Authorization', 'Bearer token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Campaign not found');
  });

  it('should reject deletion with MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockReturnValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'MEMBER',
      isActive: true,
      emailVerified: new Date(),
    });

    const res = await request(app)
      .delete('/api/campaigns/camp-001')
      .set('Authorization', 'Bearer token')
      .expect(403);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockCampaign);
    mockPrisma.campaign.delete.mockRejectedValue(new Error('Delete failed'));

    const res = await request(app)
      .delete('/api/campaigns/camp-001')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── POST /api/campaigns/:id/start — start campaign (OWNER/ADMIN) ─────────────

describe('POST /api/campaigns/:id/start', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'OWNER',
      isActive: true,
      emailVerified: new Date(),
    });
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).post('/api/campaigns/camp-001/start').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should start a draft campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockCampaign);
    mockPrisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.contact.findMany.mockResolvedValue([
      { id: 'contact-1' },
      { id: 'contact-2' },
    ]);
    mockPrisma.message.create.mockResolvedValue({ id: 'msg-001' });
    mockPrisma.campaign.update.mockResolvedValue({ ...mockCampaign, targetContacts: 2 });

    const res = await request(app)
      .post('/api/campaigns/camp-001/start')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('2 contacts');
  });

  it('should return 404 when campaign not found', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/campaigns/nonexistent/start')
      .set('Authorization', 'Bearer token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Campaign not found');
  });

  it('should reject starting an already active campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockActiveCampaign);
    mockPrisma.campaign.updateMany.mockResolvedValue({ count: 0 }); // status !== 'draft'

    const res = await request(app)
      .post('/api/campaigns/camp-active/start')
      .set('Authorization', 'Bearer token')
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Campaign already started or not found');
  });

  it('should handle drip campaigns by creating dripQueue entries', async () => {
    const dripCampaign = {
      ...mockCampaign,
      type: 'drip',
      dripSteps: JSON.stringify([
        { delay_hours: 0, message: 'Step 1' },
        { delay_hours: 24, message: 'Step 2' },
      ]),
    };
    mockPrisma.campaign.findFirst.mockResolvedValue(dripCampaign);
    mockPrisma.campaign.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.contact.findMany.mockResolvedValue([{ id: 'contact-1' }]);
    mockPrisma.campaign.update.mockResolvedValue({ ...dripCampaign, targetContacts: 1 });

    const res = await request(app)
      .post('/api/campaigns/camp-001/start')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('should require OWNER/ADMIN role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockReturnValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'MEMBER',
      isActive: true,
      emailVerified: new Date(),
    });

    const res = await request(app)
      .post('/api/campaigns/camp-001/start')
      .set('Authorization', 'Bearer token')
      .expect(403);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.campaign.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/campaigns/camp-001/start')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── POST /api/campaigns/:id/pause — pause (OWNER/ADMIN) ──────────────────────

describe('POST /api/campaigns/:id/pause', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'OWNER',
      isActive: true,
      emailVerified: new Date(),
    });
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).post('/api/campaigns/camp-001/pause').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should pause an active campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockActiveCampaign);
    mockPrisma.campaign.update.mockResolvedValue({ ...mockActiveCampaign, status: 'paused' });

    const res = await request(app)
      .post('/api/campaigns/camp-active/pause')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Campaign paused successfully');
  });

  it('should return 404 when campaign not found', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/campaigns/nonexistent/pause')
      .set('Authorization', 'Bearer token')
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockActiveCampaign);
    mockPrisma.campaign.update.mockRejectedValue(new Error('Update failed'));

    const res = await request(app)
      .post('/api/campaigns/camp-active/pause')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── POST /api/campaigns/:id/send — send (OWNER/ADMIN) ────────────────────────

describe('POST /api/campaigns/:id/send', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'OWNER',
      isActive: true,
      emailVerified: new Date(),
    });
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).post('/api/campaigns/camp-001/send').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should send a draft campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockCampaign);
    mockPrisma.contact.findMany.mockResolvedValue([
      { id: 'contact-1', phone: '+111' },
      { id: 'contact-2', phone: '+222' },
    ]);
    mockPrisma.message.create.mockResolvedValue({ id: 'msg-001' });
    mockPrisma.campaign.update.mockResolvedValue({ ...mockCampaign, status: 'active', targetContacts: 2 });

    const res = await request(app)
      .post('/api/campaigns/camp-001/send')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('2 contacts');
    expect(mockOutreachQueue.add).toHaveBeenCalled();
  });

  it('should reject sending a non-draft campaign', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockActiveCampaign);

    const res = await request(app)
      .post('/api/campaigns/camp-active/send')
      .set('Authorization', 'Bearer token')
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Can only send draft campaigns');
  });

  it('should return 404 when campaign not found', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/campaigns/nonexistent/send')
      .set('Authorization', 'Bearer token')
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockCampaign);
    mockPrisma.contact.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/campaigns/camp-001/send')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── POST /api/campaigns/:id/schedule — schedule (OWNER/ADMIN) ────────────────

describe('POST /api/campaigns/:id/schedule', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'OWNER',
      isActive: true,
      emailVerified: new Date(),
    });
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).post('/api/campaigns/camp-001/schedule').send({ scheduledAt: '2026-08-01T10:00:00Z' }).expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should schedule a campaign successfully', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString(); // tomorrow
    mockPrisma.campaign.findFirst.mockResolvedValue(mockCampaign);
    mockPrisma.campaign.update.mockResolvedValue({
      ...mockCampaign,
      status: 'scheduled',
      scheduledAt: new Date(futureDate),
    });

    const res = await request(app)
      .post('/api/campaigns/camp-001/schedule')
      .set('Authorization', 'Bearer token')
      .send({ scheduledAt: futureDate })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Campaign scheduled successfully');
  });

  it('should reject missing scheduledAt', async () => {
    const res = await request(app)
      .post('/api/campaigns/camp-001/schedule')
      .set('Authorization', 'Bearer token')
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  it('should reject past scheduled time', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockCampaign);

    const res = await request(app)
      .post('/api/campaigns/camp-001/schedule')
      .set('Authorization', 'Bearer token')
      .send({ scheduledAt: '2020-01-01T00:00:00Z' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Scheduled time must be in the future');
  });

  it('should return 404 when campaign not found', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/campaigns/nonexistent/schedule')
      .set('Authorization', 'Bearer token')
      .send({ scheduledAt: new Date(Date.now() + 86400000).toISOString() })
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockCampaign);
    mockPrisma.campaign.update.mockRejectedValue(new Error('Update failed'));

    const res = await request(app)
      .post('/api/campaigns/camp-001/schedule')
      .set('Authorization', 'Bearer token')
      .send({ scheduledAt: new Date(Date.now() + 86400000).toISOString() })
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api/campaigns/:id/stats — campaign stats ────────────────────────────

describe('GET /api/campaigns/:id/stats', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => {
    resetMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-abc-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      role: 'OWNER',
      isActive: true,
      emailVerified: new Date(),
    });
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/campaigns/camp-001/stats').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should return campaign statistics', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(mockActiveCampaign);
    mockPrisma.message.count
      .mockResolvedValueOnce(80)  // sent
      .mockResolvedValueOnce(60)  // delivered
      .mockResolvedValueOnce(30)  // read
      .mockResolvedValueOnce(15); // replied

    const res = await request(app)
      .get('/api/campaigns/camp-active/stats')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.sent).toBe(80);
    expect(res.body.data.delivered).toBe(60);
    expect(res.body.data.read).toBe(30);
    expect(res.body.data.replied).toBe(15);
    expect(res.body.data.totalRecipients).toBe(100);
    expect(res.body.data.deliveryRate).toBe(60);
    expect(res.body.data.readRate).toBe(50);
    expect(res.body.data.replyRate).toBe(50);
  });

  it('should return 0 rates when no recipients', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue({
      ...mockCampaign,
      targetContacts: 0,
      targetCount: 0,
    });
    mockPrisma.message.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const res = await request(app)
      .get('/api/campaigns/camp-001/stats')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.deliveryRate).toBe(0);
    expect(res.body.data.readRate).toBe(0);
    expect(res.body.data.replyRate).toBe(0);
  });

  it('should return 404 when campaign not found', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/campaigns/nonexistent/stats')
      .set('Authorization', 'Bearer token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Campaign not found');
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.campaign.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/campaigns/camp-001/stats')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});
