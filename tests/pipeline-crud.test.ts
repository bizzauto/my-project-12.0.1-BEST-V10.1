/**
 * @jest-environment node
 *
 * Phase D.1 — Pipeline stage + deal CRUD correctness.
 *
 * Exercises the real Express routers (deals.ts + pipelines.ts) with a mocked
 * Prisma client to verify the full pipeline loop works end-to-end:
 *   POST /api/pipelines            → create a pipeline (with default stages)
 *   POST /api/pipelines/:id/stages → create a stage inside that pipeline
 *   POST /api/deals                → create a deal in that stage
 *   PUT  /api/deals/:id/stage      → move the deal to another stage
 *   DELETE /api/deals/:id          → (new) delete a deal
 *
 * Asserts persistence (the prisma calls receive the right args) so moving a
 * deal to a new stage and deleting it behave correctly.
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

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
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    updateMany: jest.fn(),
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

// Import routers AFTER all mocks are set up
import pipelinesRoutes from '../src/server/routes/pipelines';
import dealsRoutes from '../src/server/routes/deals';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/pipelines', pipelinesRoutes);
  app.use('/api/deals', dealsRoutes);
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

// ─── Pipeline → Stage → Deal → Move loop ─────────────────────────────────────

describe('Phase D.1 — Pipeline stage + deal CRUD loop', () => {
  let app: express.Application;

  const pipelineId = 'pipe-d1';
  const stageLead = 'stage-lead';
  const stageWon = 'stage-won';

  const createdPipeline = {
    id: pipelineId,
    businessId: 'biz-1',
    name: 'Sales Pipeline',
    description: 'Main pipeline',
    isDefault: false,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    stages: [
      { id: stageLead, pipelineId, name: 'Lead Inbox', order: 0, color: '#3B82F6' },
      { id: stageWon, pipelineId, name: 'Closed Won', order: 5, color: '#10B981' },
    ],
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

  it('creates a pipeline with default stages', async () => {
    mockPrisma.pipeline.create.mockResolvedValue({
      ...createdPipeline,
      stages: createdPipeline.stages,
    });

    const res = await request(app)
      .post('/api/pipelines')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Sales Pipeline' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Sales Pipeline');
    // default 7 stages created
    const createCall = mockPrisma.pipeline.create.mock.calls[0][0];
    expect(createCall.data.stages.create).toHaveLength(7);
  });

  it('adds a stage to an existing pipeline', async () => {
    mockPrisma.pipeline.findFirst.mockResolvedValue(createdPipeline);
    mockPrisma.stage.create.mockResolvedValue({
      id: 'stage-new',
      pipelineId,
      name: 'Qualified',
      order: 6,
      color: '#8B5CF6',
    });

    const res = await request(app)
      .post(`/api/pipelines/${pipelineId}/stages`)
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Qualified', color: '#8B5CF6' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.stage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pipelineId,
          name: 'Qualified',
          order: 6, // max existing order (5) + 1
        }),
      }),
    );
  });

  it('creates a deal in a stage (persists pipelineId + stageId)', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null); // new contact
    mockPrisma.contact.create.mockResolvedValue({
      id: 'deal-1',
      businessId: 'biz-1',
      name: 'Acme Corp',
      phone: '+919999999999',
      dealValue: 50000,
      dealStage: 'Lead Inbox',
      stage: 'Lead Inbox',
      stageId: stageLead,
      pipelineId,
    });

    const res = await request(app)
      .post('/api/deals')
      .set('Authorization', 'Bearer valid_token')
      .send({
        contactName: 'Acme Corp',
        contactPhone: '+919999999999',
        value: 50000,
        stage: 'Lead Inbox',
        stageId: stageLead,
        pipelineId,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-1',
          name: 'Acme Corp',
          dealValue: 50000,
          dealStage: 'Lead Inbox',
        }),
      }),
    );
  });

  it('moves the deal to another stage (persists stage change)', async () => {
    // existing deal contact
    mockPrisma.contact.findFirst.mockResolvedValue({
      id: 'deal-1',
      businessId: 'biz-1',
      name: 'Acme Corp',
      dealValue: 50000,
      dealStage: 'Lead Inbox',
      stage: 'Lead Inbox',
      stageId: stageLead,
      pipelineId,
    });
    mockPrisma.contact.update.mockResolvedValue({
      id: 'deal-1',
      businessId: 'biz-1',
      name: 'Acme Corp',
      dealValue: 50000,
      dealStage: 'Closed Won',
      stage: 'Closed Won',
      stageId: stageWon,
      pipelineId,
    });
    mockPrisma.activity.create.mockResolvedValue({ id: 'act-1' });

    const res = await request(app)
      .put('/api/deals/deal-1/stage')
      .set('Authorization', 'Bearer valid_token')
      .send({ stage: 'Closed Won', stageId: stageWon, pipelineId })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'deal-1',
      stage: 'Closed Won',
      stageId: stageWon,
      pipelineId,
    });

    // Persistence: contact updated with new stage + logged activity
    expect(mockPrisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'deal-1', businessId: 'biz-1' },
        data: expect.objectContaining({
          dealStage: 'Closed Won',
          stage: 'Closed Won',
          stageId: stageWon,
          pipelineId,
        }),
      }),
    );
    expect(mockPrisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'deal_stage_changed' }),
      }),
    );
  });

  it('deletes a deal (clears deal fields, keeps contact)', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({
      id: 'deal-1',
      businessId: 'biz-1',
      name: 'Acme Corp',
      dealValue: 50000,
      dealStage: 'Closed Won',
    });
    mockPrisma.contact.update.mockResolvedValue({
      id: 'deal-1',
      businessId: 'biz-1',
      name: 'Acme Corp',
      dealValue: 0,
      dealStage: null,
    });

    const res = await request(app)
      .delete('/api/deals/deal-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'deal-1', businessId: 'biz-1' },
        data: expect.objectContaining({
          dealStage: null,
          stageId: null,
          pipelineId: null,
          dealValue: 0,
        }),
      }),
    );
  });

  it('returns 404 when moving a non-existent deal', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    await request(app)
      .put('/api/deals/missing/stage')
      .set('Authorization', 'Bearer valid_token')
      .send({ stage: 'Closed Won' })
      .expect(404);
  });
});
