/**
 * @jest-environment node
 *
 * End-to-end integration tests for the Workflows API.
 *
 * Workflows endpoints tested:
 *   GET  /api/workflows              — list workflows with pagination, search, filter
 *   GET  /api/workflows/:id          — get single workflow with executions
 *   POST /api/workflows              — create workflow (OWNER, ADMIN)
 *   PUT  /api/workflows/:id          — update workflow (OWNER, ADMIN)
 *   PATCH /api/workflows/:id/toggle  — toggle active state (OWNER, ADMIN)
 *   DELETE /api/workflows/:id        — delete workflow (OWNER, ADMIN)
 *   POST /api/workflows/:id/run      — execute workflow manually (OWNER, ADMIN)
 *   GET  /api/workflows/:id/runs     — get execution history
 *   GET  /api/workflows/executions/:executionId — get execution details
 *   POST /api/workflows/execute      — execute by trigger type
 */

import express from 'express';
import request from 'supertest';

const mockWorkflowFixture = {
  id: 'wf-abc-123',
  businessId: 'biz-456',
  name: 'Lead Nurture Workflow',
  description: 'Nurture new leads via WhatsApp',
  triggerType: 'lead_created',
  triggerConfig: { source: 'all' },
  nodes: [{ id: 'n1', type: 'send_message', config: { template: 'welcome' } }],
  edges: [{ id: 'e1', source: 'trigger', target: 'n1' }],
  isActive: true,
  createdBy: 'user-abc-123',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  _count: { executions: 5 },
};

const mockExecutionFixture = {
  id: 'exec-123',
  workflowId: 'wf-abc-123',
  businessId: 'biz-456',
  status: 'completed',
  triggerData: { source: 'manual', triggeredBy: 'user-abc-123' },
  startedAt: new Date('2025-01-01'),
  completedAt: new Date('2025-01-01'),
  nodeResults: [{ nodeId: 'n1', status: 'success', output: {} }],
  error: null,
};

const mockUserRecord = {
  id: 'user-abc-123',
  email: 'test@example.com',
  businessId: 'biz-456',
  role: 'OWNER',
  isActive: true,
  emailVerified: true,
};

const mockPrisma = {
  workflow: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  workflowExecution: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findUnique: jest.fn().mockResolvedValue(mockUserRecord),
  },
  $disconnect: jest.fn(),
};

jest.mock('../src/server/db', () => ({
  prisma: mockPrisma,
}));

jest.mock('../src/server/utils/auth', () => ({
  hashPassword: jest.fn().mockResolvedValue('hashed'),
  comparePassword: jest.fn().mockResolvedValue(true),
  generateToken: jest.fn().mockReturnValue('mock_jwt'),
  generateRefreshToken: jest.fn().mockReturnValue('mock_refresh'),
  verifyToken: jest.fn().mockResolvedValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  }),
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
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  }),
  sign: jest.fn().mockReturnValue('mock_jwt'),
  decode: jest.fn(),
}));

jest.mock('../src/server/middleware/validate', () => ({
  validate: (schema: any) => (req: any, res: any, next: any) => next(),
}));

jest.mock('../src/server/services/workflow-execution.service', () => ({
  executeWorkflow: jest.fn().mockResolvedValue({
    id: 'exec-new',
    workflowId: 'wf-abc-123',
    status: 'completed',
    nodeResults: [],
    startedAt: new Date(),
    completedAt: new Date(),
  }),
  triggerWorkflows: jest.fn().mockResolvedValue([]),
}));

const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

import workflowRoutes from '../src/server/routes/workflows';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/workflows', workflowRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();
  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  });
  mockPrisma.user.findUnique.mockResolvedValue(mockUserRecord);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

afterAll(() => {
  for (const id of intervalIds) clearInterval(id);
  intervalIds.length = 0;
  global.setInterval = originalSetInterval;
});

// ─── GET /api/workflows ──────────────────────────────────────────────────────

describe('GET /api/workflows', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should return paginated workflows list', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([mockWorkflowFixture]);
    mockPrisma.workflow.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/workflows')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.workflows).toHaveLength(1);
    expect(res.body.data.pagination).toMatchObject({
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    });
    expect(mockPrisma.workflow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-456' },
        skip: 0,
        take: 50,
        orderBy: { createdAt: 'desc' },
      })
    );
  });

  it('should support search query', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([mockWorkflowFixture]);
    mockPrisma.workflow.count.mockResolvedValue(1);

    await request(app)
      .get('/api/workflows?search=lead')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.workflow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { name: { contains: 'lead', mode: 'insensitive' } },
            { description: { contains: 'lead', mode: 'insensitive' } },
          ]),
        }),
      })
    );
  });

  it('should support isActive filter', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([mockWorkflowFixture]);
    mockPrisma.workflow.count.mockResolvedValue(1);

    await request(app)
      .get('/api/workflows?isActive=true')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.workflow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      })
    );
  });

  it('should support pagination parameters', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([]);
    mockPrisma.workflow.count.mockResolvedValue(0);

    await request(app)
      .get('/api/workflows?page=2&limit=10')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.workflow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    );
  });

  it('should return empty array when no workflows', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([]);
    mockPrisma.workflow.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/workflows')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data.workflows).toEqual([]);
  });

  it('should return 401 without auth', async () => {
    const res = await request(app).get('/api/workflows').expect(401);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.workflow.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/workflows')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.error).toBe('Failed to fetch workflows');
  });
});

// ─── GET /api/workflows/:id ──────────────────────────────────────────────────

describe('GET /api/workflows/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should return workflow with recent executions', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue({
      ...mockWorkflowFixture,
      executions: [mockExecutionFixture],
    });

    const res = await request(app)
      .get('/api/workflows/wf-abc-123')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'wf-abc-123',
      name: 'Lead Nurture Workflow',
      triggerType: 'lead_created',
      isActive: true,
    });
    expect(res.body.data.executions).toHaveLength(1);
  });

  it('should return 404 when workflow not found', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/workflows/nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.error).toBe('Workflow not found');
  });

  it('should return 401 without auth', async () => {
    await request(app).get('/api/workflows/wf-abc-123').expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.workflow.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/workflows/wf-abc-123')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.error).toBe('Failed to fetch workflow');
  });
});

// ─── POST /api/workflows ─────────────────────────────────────────────────────

describe('POST /api/workflows', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  const validPayload = {
    name: 'New Workflow',
    triggerType: 'lead_created',
    triggerConfig: { source: 'website' },
    nodes: [{ id: 'n1', type: 'send_message' }],
    edges: [],
    description: 'Test workflow',
  };

  it('should create a new workflow', async () => {
    mockPrisma.workflow.create.mockResolvedValue({ ...mockWorkflowFixture, id: 'wf-new', ...validPayload });

    const res = await request(app)
      .post('/api/workflows')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('New Workflow');
    expect(res.body.data.triggerType).toBe('lead_created');
    expect(res.body.data.businessId).toBe('biz-456');
    expect(res.body.data.createdBy).toBe('user-abc-123');
    expect(mockPrisma.workflow.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-456',
          name: 'New Workflow',
          triggerType: 'lead_created',
        }),
      })
    );
  });

  it('should return 400 when name is missing', async () => {
    const { name, ...payload } = validPayload;
    const res = await request(app)
      .post('/api/workflows')
      .set('Authorization', 'Bearer valid_token')
      .send(payload)
      .expect(400);

    expect(res.body.error).toBe('Name and trigger type are required');
  });

  it('should return 400 when triggerType is missing', async () => {
    const { triggerType, ...payload } = validPayload;
    const res = await request(app)
      .post('/api/workflows')
      .set('Authorization', 'Bearer valid_token')
      .send(payload)
      .expect(400);

    expect(res.body.error).toBe('Name and trigger type are required');
  });

  it('should return 400 for invalid triggerType', async () => {
    const res = await request(app)
      .post('/api/workflows')
      .set('Authorization', 'Bearer valid_token')
      .send({ ...validPayload, triggerType: 'invalid_type' })
      .expect(400);

    expect(res.body.error).toContain('Invalid trigger type');
  });

  it('should return 401 without auth', async () => {
    await request(app).post('/api/workflows').send(validPayload).expect(401);
  });

  it('should return 403 for non-OWNER/ADMIN role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValueOnce({
      id: 'user-other',
      email: 'other@example.com',
      businessId: 'biz-456',
      role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      ...mockUserRecord,
      id: 'user-other',
      role: 'MEMBER',
    });

    await request(app)
      .post('/api/workflows')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(403);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.workflow.create.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/workflows')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(500);

    expect(res.body.error).toBe('Failed to create workflow');
  });
});

// ─── PUT /api/workflows/:id ──────────────────────────────────────────────────

describe('PUT /api/workflows/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should update workflow', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(mockWorkflowFixture);
    mockPrisma.workflow.update.mockResolvedValue({
      ...mockWorkflowFixture,
      name: 'Updated Name',
      description: 'Updated description',
    });

    const res = await request(app)
      .put('/api/workflows/wf-abc-123')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated Name', description: 'Updated description' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Updated Name');
    expect(mockPrisma.workflow.update).toHaveBeenCalledWith({
      where: { id: 'wf-abc-123' },
      data: expect.objectContaining({
        name: 'Updated Name',
        description: 'Updated description',
      }),
    });
  });

  it('should validate triggerType when provided', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(mockWorkflowFixture);

    const res = await request(app)
      .put('/api/workflows/wf-abc-123')
      .set('Authorization', 'Bearer valid_token')
      .send({ triggerType: 'invalid_type' })
      .expect(400);

    expect(res.body.error).toContain('Invalid trigger type');
  });

  it('should return 404 when workflow not found', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/workflows/nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated' })
      .expect(404);

    expect(res.body.error).toBe('Workflow not found');
  });

  it('should return 401 without auth', async () => {
    await request(app).put('/api/workflows/wf-abc-123').send({ name: 'X' }).expect(401);
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValueOnce({ role: 'MEMBER', businessId: 'biz-456', id: 'u2', email: 'm@e.com' });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ ...mockUserRecord, id: 'u2', role: 'MEMBER' });
    mockPrisma.workflow.findFirst.mockResolvedValue(mockWorkflowFixture);

    await request(app)
      .put('/api/workflows/wf-abc-123')
      .set('Authorization', 'Bearer token')
      .send({ name: 'X' })
      .expect(403);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(mockWorkflowFixture);
    mockPrisma.workflow.update.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .put('/api/workflows/wf-abc-123')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated' })
      .expect(500);

    expect(res.body.error).toBe('Failed to update workflow');
  });
});

// ─── PATCH /api/workflows/:id/toggle ─────────────────────────────────────────

describe('PATCH /api/workflows/:id/toggle', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should activate an inactive workflow', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue({ ...mockWorkflowFixture, isActive: false });
    mockPrisma.workflow.update.mockResolvedValue({ ...mockWorkflowFixture, isActive: true });

    const res = await request(app)
      .patch('/api/workflows/wf-abc-123/toggle')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.isActive).toBe(true);
  });

  it('should deactivate an active workflow', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue({ ...mockWorkflowFixture, isActive: true });
    mockPrisma.workflow.update.mockResolvedValue({ ...mockWorkflowFixture, isActive: false });

    const res = await request(app)
      .patch('/api/workflows/wf-abc-123/toggle')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data.isActive).toBe(false);
  });

  it('should return 404 when not found', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(null);

    await request(app)
      .patch('/api/workflows/nonexistent/toggle')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);
  });

  it('should return 401 without auth', async () => {
    await request(app).patch('/api/workflows/wf-abc-123/toggle').expect(401);
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValueOnce({ role: 'MEMBER', businessId: 'biz-456', id: 'u2', email: 'm@e.com' });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ ...mockUserRecord, id: 'u2', role: 'MEMBER' });
    mockPrisma.workflow.findFirst.mockResolvedValue(mockWorkflowFixture);

    await request(app)
      .patch('/api/workflows/wf-abc-123/toggle')
      .set('Authorization', 'Bearer token')
      .expect(403);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(mockWorkflowFixture);
    mockPrisma.workflow.update.mockRejectedValue(new Error('DB error'));

    await request(app)
      .patch('/api/workflows/wf-abc-123/toggle')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);
  });
});

// ─── DELETE /api/workflows/:id ───────────────────────────────────────────────

describe('DELETE /api/workflows/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should delete an inactive workflow', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue({ ...mockWorkflowFixture, isActive: false });
    mockPrisma.workflow.delete.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/workflows/wf-abc-123')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Workflow deleted successfully');
  });

  it('should return 400 when trying to delete active workflow', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue({ ...mockWorkflowFixture, isActive: true });

    const res = await request(app)
      .delete('/api/workflows/wf-abc-123')
      .set('Authorization', 'Bearer valid_token')
      .expect(400);

    expect(res.body.error).toBe('Cannot delete an active workflow. Deactivate it first.');
  });

  it('should return 404 when not found', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(null);

    await request(app)
      .delete('/api/workflows/nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);
  });

  it('should return 401 without auth', async () => {
    await request(app).delete('/api/workflows/wf-abc-123').expect(401);
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValueOnce({ role: 'MEMBER', businessId: 'biz-456', id: 'u2', email: 'm@e.com' });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ ...mockUserRecord, id: 'u2', role: 'MEMBER' });
    mockPrisma.workflow.findFirst.mockResolvedValue({ ...mockWorkflowFixture, isActive: false });

    await request(app)
      .delete('/api/workflows/wf-abc-123')
      .set('Authorization', 'Bearer token')
      .expect(403);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue({ ...mockWorkflowFixture, isActive: false });
    mockPrisma.workflow.delete.mockRejectedValue(new Error('DB error'));

    await request(app)
      .delete('/api/workflows/wf-abc-123')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);
  });
});

// ─── POST /api/workflows/:id/run ─────────────────────────────────────────────

describe('POST /api/workflows/:id/run', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should execute workflow manually', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(mockWorkflowFixture);
    const { executeWorkflow } = await import('../src/server/services/workflow-execution.service');
    (executeWorkflow as jest.Mock).mockResolvedValue({
      id: 'exec-new',
      workflowId: 'wf-abc-123',
      status: 'completed',
      nodeResults: [{ nodeId: 'n1', status: 'success', output: { sent: true } }],
      startedAt: new Date(),
      completedAt: new Date(),
    });

    const res = await request(app)
      .post('/api/workflows/wf-abc-123/run')
      .set('Authorization', 'Bearer valid_token')
      .send({ triggerData: { source: 'test' } })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.execution).toBeDefined();
    expect(res.body.data.nodeResults).toBeDefined();
  });

  it('should return 500 when executeWorkflow fails', async () => {
    const { executeWorkflow } = await import('../src/server/services/workflow-execution.service');
    (executeWorkflow as jest.Mock).mockRejectedValue(new Error('Workflow not found'));

    const res = await request(app)
      .post('/api/workflows/nonexistent/run')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.error).toBe('Failed to run workflow');
  });

  it('should return 401 without auth', async () => {
    await request(app).post('/api/workflows/wf-abc-123/run').expect(401);
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValueOnce({ role: 'MEMBER', businessId: 'biz-456', id: 'u2', email: 'm@e.com' });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ ...mockUserRecord, id: 'u2', role: 'MEMBER' });
    mockPrisma.workflow.findFirst.mockResolvedValue(mockWorkflowFixture);

    await request(app)
      .post('/api/workflows/wf-abc-123/run')
      .set('Authorization', 'Bearer token')
      .expect(403);
  });

  it('should return 500 on execution error', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(mockWorkflowFixture);
    const { executeWorkflow } = await import('../src/server/services/workflow-execution.service');
    (executeWorkflow as jest.Mock).mockRejectedValue(new Error('Execution failed'));

    await request(app)
      .post('/api/workflows/wf-abc-123/run')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);
  });
});

// ─── GET /api/workflows/:id/runs ─────────────────────────────────────────────

describe('GET /api/workflows/:id/runs', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should return paginated execution history', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(mockWorkflowFixture);
    mockPrisma.workflowExecution.findMany.mockResolvedValue([mockExecutionFixture]);
    mockPrisma.workflowExecution.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/workflows/wf-abc-123/runs')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.executions).toHaveLength(1);
    expect(res.body.data.pagination).toMatchObject({
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('should support pagination', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(mockWorkflowFixture);
    mockPrisma.workflowExecution.findMany.mockResolvedValue([]);
    mockPrisma.workflowExecution.count.mockResolvedValue(0);

    await request(app)
      .get('/api/workflows/wf-abc-123/runs?page=2&limit=5')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.workflowExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 })
    );
  });

  it('should return 404 when workflow not found', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(null);

    await request(app)
      .get('/api/workflows/nonexistent/runs')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);
  });

  it('should return 401 without auth', async () => {
    await request(app).get('/api/workflows/wf-abc-123/runs').expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(mockWorkflowFixture);
    mockPrisma.workflowExecution.findMany.mockRejectedValue(new Error('DB error'));

    await request(app)
      .get('/api/workflows/wf-abc-123/runs')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);
  });
});

// ─── GET /api/workflows/executions/:executionId ──────────────────────────────

describe('GET /api/workflows/executions/:executionId', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should return execution details with workflow', async () => {
    mockPrisma.workflowExecution.findFirst.mockResolvedValue({
      ...mockExecutionFixture,
      workflow: { id: 'wf-abc-123', name: 'Test', triggerType: 'lead_created', nodes: [], edges: [] },
    });

    const res = await request(app)
      .get('/api/workflows/executions/exec-123')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'exec-123',
      workflowId: 'wf-abc-123',
      status: 'completed',
    });
    expect(res.body.data.workflow).toBeDefined();
  });

  it('should return 404 when execution not found', async () => {
    mockPrisma.workflowExecution.findFirst.mockResolvedValue(null);

    await request(app)
      .get('/api/workflows/executions/nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);
  });

  it('should return 401 without auth', async () => {
    await request(app).get('/api/workflows/executions/exec-123').expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.workflowExecution.findFirst.mockRejectedValue(new Error('DB error'));

    await request(app)
      .get('/api/workflows/executions/exec-123')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);
  });
});

// ─── POST /api/workflows/execute ─────────────────────────────────────────────

describe('POST /api/workflows/execute', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should trigger workflows by trigger type', async () => {
    const { triggerWorkflows } = await import('../src/server/services/workflow-execution.service');
    (triggerWorkflows as jest.Mock).mockResolvedValue([
      { id: 'exec-1', workflowId: 'wf-1', status: 'completed' },
      { id: 'exec-2', workflowId: 'wf-2', status: 'completed' },
    ]);

    const res = await request(app)
      .post('/api/workflows/execute')
      .set('Authorization', 'Bearer valid_token')
      .send({ businessId: 'biz-456', triggerType: 'lead_created', triggerData: { source: 'web' } })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.executionsCreated).toBe(2);
    expect(triggerWorkflows).toHaveBeenCalledWith(
      'biz-456',
      'lead_created',
      expect.objectContaining({ source: 'web' })
    );
  });

  it('should return 400 when businessId is missing', async () => {
    const res = await request(app)
      .post('/api/workflows/execute')
      .set('Authorization', 'Bearer valid_token')
      .send({ triggerType: 'lead_created' })
      .expect(400);

    expect(res.body.error).toBe('Business ID and trigger type are required');
  });

  it('should return 400 when triggerType is missing', async () => {
    const res = await request(app)
      .post('/api/workflows/execute')
      .set('Authorization', 'Bearer valid_token')
      .send({ businessId: 'biz-456' })
      .expect(400);

    expect(res.body.error).toBe('Business ID and trigger type are required');
  });

  it('should return 401 without auth', async () => {
    await request(app).post('/api/workflows/execute').send({}).expect(401);
  });

  it('should return 500 on execution error', async () => {
    const { triggerWorkflows } = await import('../src/server/services/workflow-execution.service');
    (triggerWorkflows as jest.Mock).mockRejectedValue(new Error('Trigger failed'));

    await request(app)
      .post('/api/workflows/execute')
      .set('Authorization', 'Bearer valid_token')
      .send({ businessId: 'biz-456', triggerType: 'lead_created' })
      .expect(500);
  });
});