/**
 * @jest-environment node
 *
 * Integration tests for the Pipelines API (CRM pipeline & stage management).
 *
 * Endpoints tested:
 *   GET    /api/pipelines          — list all pipelines with stages & aggregates
 *   POST   /api/pipelines          — create a pipeline with stages
 *   POST   /api/pipelines/:id/stages  — add a stage to a pipeline
 *   DELETE /api/pipelines/:id      — delete a pipeline (moves contacts out)
 */

import express from 'express';
import request from 'supertest';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockStage = {
  id: 'stage-1',
  pipelineId: 'pipe-001',
  name: 'Lead Inbox',
  order: 0,
  color: '#3B82F6',
};

const mockPipeline = {
  id: 'pipe-001',
  businessId: 'biz-456',
  name: 'Sales Pipeline',
  description: 'Main sales pipeline',
  isDefault: true,
  createdAt: new Date('2026-07-26'),
  updatedAt: new Date('2026-07-26'),
  stages: [
    mockStage,
    { id: 'stage-2', pipelineId: 'pipe-001', name: 'Contacted', order: 1, color: '#F59E0B' },
  ],
  _count: { contacts: 5 },
};

// ── Prisma mock ───────────────────────────────────────────────────────────────
const mockPrisma = {
  pipeline: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  stage: {
    create: jest.fn(),
  },
  contact: {
    groupBy: jest.fn(),
    updateMany: jest.fn(),
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

// ── Trap setInterval calls ────────────────────────────────────────────────────
const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

import pipelinesRoutes from '../src/server/routes/pipelines';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/pipelines', pipelinesRoutes);
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

// ─── GET /api/pipelines — list ────────────────────────────────────────────────

describe('GET /api/pipelines', () => {
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
    const res = await request(app).get('/api/pipelines').expect(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return empty list when no pipelines exist', async () => {
    mockPrisma.pipeline.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/pipelines')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.pipelines).toEqual([]);
  });

  it('should return pipelines with stages and aggregates', async () => {
    mockPrisma.pipeline.findMany.mockResolvedValue([mockPipeline]);
    mockPrisma.contact.groupBy.mockResolvedValue([
      { stageId: 'stage-1', _count: { stageId: 3 }, _sum: { dealValue: 15000 } },
      { stageId: 'stage-2', _count: { stageId: 2 }, _sum: { dealValue: 8000 } },
    ]);

    const res = await request(app)
      .get('/api/pipelines')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.pipelines).toHaveLength(1);
    expect(res.body.data.pipelines[0].name).toBe('Sales Pipeline');
    expect(res.body.data.pipelines[0].contactCount).toBe(5);
    expect(res.body.data.pipelines[0].stages).toHaveLength(2);
    expect(res.body.data.pipelines[0].stages[0].dealCount).toBe(3);
    expect(res.body.data.pipelines[0].stages[0].dealValue).toBe(15000);
  });

  it('should include stage color in response', async () => {
    mockPrisma.pipeline.findMany.mockResolvedValue([mockPipeline]);
    mockPrisma.contact.groupBy.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/pipelines')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.data.pipelines[0].stages[0].color).toBe('#3B82F6');
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.pipeline.findMany.mockRejectedValue(new Error('DB timeout'));

    const res = await request(app)
      .get('/api/pipelines')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to fetch pipelines');
  });

  it('should handle zero stage aggregates gracefully', async () => {
    mockPrisma.pipeline.findMany.mockResolvedValue([mockPipeline]);
    mockPrisma.contact.groupBy.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/pipelines')
      .set('Authorization', 'Bearer token')
      .expect(200);

    // All stages should have zero counts
    for (const stage of res.body.data.pipelines[0].stages) {
      expect(stage.dealCount).toBe(0);
      expect(stage.dealValue).toBe(0);
    }
  });
});

// ─── POST /api/pipelines — create ─────────────────────────────────────────────

describe('POST /api/pipelines', () => {
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
    const res = await request(app).post('/api/pipelines').send({ name: 'Test' }).expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should create a pipeline with default stages', async () => {
    mockPrisma.pipeline.create.mockResolvedValue({
      ...mockPipeline,
      stages: [
        { id: 'stage-new-1', pipelineId: 'pipe-002', name: 'Lead Inbox', order: 0, color: '#3B82F6' },
        { id: 'stage-new-2', pipelineId: 'pipe-002', name: 'Contacted', order: 1, color: '#F59E0B' },
        { id: 'stage-new-3', pipelineId: 'pipe-002', name: 'Qualified', order: 2, color: '#8B5CF6' },
        { id: 'stage-new-4', pipelineId: 'pipe-002', name: 'Proposal', order: 3, color: '#F97316' },
        { id: 'stage-new-5', pipelineId: 'pipe-002', name: 'Negotiation', order: 4, color: '#EC4899' },
        { id: 'stage-new-6', pipelineId: 'pipe-002', name: 'Closed Won', order: 5, color: '#10B981' },
        { id: 'stage-new-7', pipelineId: 'pipe-002', name: 'Closed Lost', order: 6, color: '#EF4444' },
      ],
    });

    const res = await request(app)
      .post('/api/pipelines')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Sales Pipeline', description: 'Main sales pipeline' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Sales Pipeline');

    // Should create default stages
    const createCall = mockPrisma.pipeline.create.mock.calls[0][0];
    expect(createCall.data.stages.create).toHaveLength(7);
  });

  it('should create a pipeline with custom stages', async () => {
    const customStages = [
      { name: 'New Lead', order: 0, color: '#FF5733' },
      { name: 'Qualified', order: 1, color: '#33FF57' },
    ];
    mockPrisma.pipeline.create.mockResolvedValue({
      ...mockPipeline,
      id: 'pipe-003',
      name: 'Custom Pipeline',
      stages: customStages.map((s, i) => ({
        id: `stage-c-${i}`,
        pipelineId: 'pipe-003',
        ...s,
      })),
    });

    const res = await request(app)
      .post('/api/pipelines')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Custom Pipeline', stages: customStages })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Custom Pipeline');
  });

  it('should reject missing pipeline name', async () => {
    const res = await request(app)
      .post('/api/pipelines')
      .set('Authorization', 'Bearer token')
      .send({ description: 'No name provided' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Pipeline name is required');
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.pipeline.create.mockRejectedValue(new Error('Create failed'));

    const res = await request(app)
      .post('/api/pipelines')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Test Pipeline' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to create pipeline');
  });
});

// ─── POST /api/pipelines/:id/stages — add stage ───────────────────────────────

describe('POST /api/pipelines/:id/stages', () => {
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
    const res = await request(app).post('/api/pipelines/pipe-001/stages').send({ name: 'New Stage' }).expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should add a stage to a pipeline successfully', async () => {
    mockPrisma.pipeline.findFirst.mockResolvedValue(mockPipeline);
    mockPrisma.stage.create.mockResolvedValue({
      id: 'stage-new',
      pipelineId: 'pipe-001',
      name: 'Follow-up',
      order: 2,
      color: '#FF0000',
    });

    const res = await request(app)
      .post('/api/pipelines/pipe-001/stages')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Follow-up', color: '#FF0000' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Follow-up');
    expect(mockPrisma.stage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pipelineId: 'pipe-001',
          name: 'Follow-up',
          order: 2, // max existing order (1) + 1
        }),
      }),
    );
  });

  it('should return 404 when pipeline not found', async () => {
    mockPrisma.pipeline.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/pipelines/nonexistent/stages')
      .set('Authorization', 'Bearer token')
      .send({ name: 'New Stage' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Pipeline not found');
  });

  it('should reject stage creation for pipeline from another business', async () => {
    mockPrisma.pipeline.findFirst.mockResolvedValue(null); // scoped to businessId

    const res = await request(app)
      .post('/api/pipelines/pipe-other/stages')
      .set('Authorization', 'Bearer token')
      .send({ name: 'New Stage' })
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.pipeline.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/pipelines/pipe-001/stages')
      .set('Authorization', 'Bearer token')
      .send({ name: 'New Stage' })
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── DELETE /api/pipelines/:id — delete ───────────────────────────────────────

describe('DELETE /api/pipelines/:id', () => {
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
    const res = await request(app).delete('/api/pipelines/pipe-001').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should delete a pipeline and move contacts out', async () => {
    mockPrisma.pipeline.findFirst.mockResolvedValue(mockPipeline);
    mockPrisma.contact.updateMany.mockResolvedValue({ count: 5 });
    mockPrisma.pipeline.delete.mockResolvedValue(mockPipeline);

    const res = await request(app)
      .delete('/api/pipelines/pipe-001')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Pipeline deleted');

    // Verify contacts were moved out
    expect(mockPrisma.contact.updateMany).toHaveBeenCalledWith({
      where: { pipelineId: 'pipe-001' },
      data: { pipelineId: null, stageId: null },
    });
    expect(mockPrisma.pipeline.delete).toHaveBeenCalledWith({ where: { id: 'pipe-001' } });
  });

  it('should return 404 when pipeline not found', async () => {
    mockPrisma.pipeline.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/pipelines/nonexistent')
      .set('Authorization', 'Bearer token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Pipeline not found');
  });

  it('should return 500 on Prisma error during delete', async () => {
    mockPrisma.pipeline.findFirst.mockResolvedValue(mockPipeline);
    mockPrisma.pipeline.delete.mockRejectedValue(new Error('Delete failed'));

    const res = await request(app)
      .delete('/api/pipelines/pipe-001')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to delete pipeline');
  });

  it('should return 500 on Prisma error during find', async () => {
    mockPrisma.pipeline.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete('/api/pipelines/pipe-001')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});
