/**
 * @jest-environment node
 *
 * End-to-end integration tests for the Chatbot API.
 *
 * These tests use supertest to make real HTTP requests against the Express
 * router with the full middleware stack while mocking Prisma, auth utilities,
 * and ancillary services to isolate the chatbot logic.
 *
 * Chatbot endpoints tested:
 *   GET  /api/chatbot              — list all chatbot flows
 *   POST /api/chatbot              — create a new chatbot flow
 *   PUT  /api/chatbot/:id          — update a chatbot flow
 *   POST /api/chatbot/:id/toggle   — toggle flow active state
 *   POST /api/chatbot/:id/activate — activate a flow
 *   POST /api/chatbot/:id/deactivate — deactivate a flow
 *   POST /api/chatbot/:id/test     — test a chatbot flow
 *   DELETE /api/chatbot/:id        — delete a chatbot flow
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

const mockFlowFixture = {
  id: 'flow-abc-123',
  businessId: 'biz-456',
  name: 'Welcome Flow',
  trigger: 'keyword',
  keywords: ['hello', 'hi'],
  response: 'Welcome to our business!',
  aiEnabled: false,
  isActive: true,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockPrisma = {
  chatbotFlow: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $disconnect: jest.fn(),
};

jest.mock('../src/server/db', () => ({
  prisma: mockPrisma,
}));

jest.mock('../src/server/utils/auth', () => ({
  hashPassword: jest.fn().mockResolvedValue('hashed_password'),
  comparePassword: jest.fn().mockResolvedValue(true),
  generateToken: jest.fn().mockReturnValue('mock_jwt_token'),
  generateRefreshToken: jest.fn().mockReturnValue('mock_refresh_token'),
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
  sign: jest.fn().mockReturnValue('mock_jwt_token'),
  decode: jest.fn(),
}));

const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

import chatbotRoutes from '../src/server/routes/chatbot';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/chatbot', chatbotRoutes);
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
  // Mock prisma.user.findUnique for the authenticate middleware
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user-abc-123',
    email: 'test@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
    isActive: true,
    emailVerified: new Date(),
  });
  // Mock prisma.user.update for CSRF token generation
  mockPrisma.user.update.mockResolvedValue({});
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

afterAll(() => {
  for (const id of intervalIds) {
    clearInterval(id);
  }
  intervalIds.length = 0;
  global.setInterval = originalSetInterval;
});

// ─── GET /api/chatbot ────────────────────────────────────────────────────────

describe('GET /api/chatbot', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should return list of chatbot flows for authenticated user', async () => {
    mockPrisma.chatbotFlow.findMany.mockResolvedValue([mockFlowFixture]);

    const res = await request(app)
      .get('/api/chatbot')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: 'flow-abc-123',
      name: 'Welcome Flow',
      trigger: 'keyword',
      keywords: ['hello', 'hi'],
      isActive: true,
    });
    expect(mockPrisma.chatbotFlow.findMany).toHaveBeenCalledWith({
      where: { businessId: 'biz-456' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('should return empty array when no flows exist', async () => {
    mockPrisma.chatbotFlow.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/chatbot')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('should return 401 without authentication token', async () => {
    const res = await request(app).get('/api/chatbot').expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database query fails', async () => {
    mockPrisma.chatbotFlow.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/chatbot')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to fetch flows');
  });
});

// ─── POST /api/chatbot ───────────────────────────────────────────────────────

describe('POST /api/chatbot', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  const validPayload = {
    name: 'New Flow',
    trigger: 'keyword',
    keywords: ['hello'],
    response: 'Hi there!',
    aiEnabled: false,
  };

  it('should create a new chatbot flow', async () => {
    mockPrisma.chatbotFlow.create.mockResolvedValue({
      ...mockFlowFixture,
      id: 'flow-new-123',
      name: 'New Flow',
      keywords: ['hello'],
      response: 'Hi there!',
      aiEnabled: false,
    });

    const res = await request(app)
      .post('/api/chatbot')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'flow-new-123',
      name: 'New Flow',
      trigger: 'keyword',
      keywords: ['hello'],
      response: 'Hi there!',
      aiEnabled: false,
      isActive: true,
    });
    expect(mockPrisma.chatbotFlow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-456',
        name: 'New Flow',
        trigger: 'keyword',
        keywords: ['hello'],
        response: 'Hi there!',
        aiEnabled: false,
      }),
    });
  });

  it('should default trigger to "keyword" when not provided', async () => {
    mockPrisma.chatbotFlow.create.mockResolvedValue({
      ...mockFlowFixture,
      id: 'flow-new-123',
      name: 'Default Trigger Flow',
      trigger: 'keyword',
    });

    const payload = { ...validPayload };
    delete (payload as any).trigger;

    await request(app)
      .post('/api/chatbot')
      .set('Authorization', 'Bearer valid_token')
      .send(payload)
      .expect(201);

    expect(mockPrisma.chatbotFlow.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trigger: 'keyword',
        }),
      }),
    );
  });

  it('should default keywords to empty array when not provided', async () => {
    mockPrisma.chatbotFlow.create.mockResolvedValue({
      ...mockFlowFixture,
      id: 'flow-new-123',
      keywords: [],
    });

    const payload = { ...validPayload };
    delete (payload as any).keywords;

    await request(app)
      .post('/api/chatbot')
      .set('Authorization', 'Bearer valid_token')
      .send(payload)
      .expect(201);

    expect(mockPrisma.chatbotFlow.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          keywords: [],
        }),
      }),
    );
  });

  it('should create flow even when name is missing (no server-side validation)', async () => {
    const payload = { ...validPayload };
    delete (payload as any).name;

    mockPrisma.chatbotFlow.create.mockResolvedValue({
      ...mockFlowFixture,
      id: 'flow-no-name',
      name: undefined,
    });

    const res = await request(app)
      .post('/api/chatbot')
      .set('Authorization', 'Bearer valid_token')
      .send(payload)
      .expect(201);

    expect(res.body.success).toBe(true);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/chatbot')
      .send(validPayload)
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database create fails', async () => {
    mockPrisma.chatbotFlow.create.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/chatbot')
      .set('Authorization', 'Bearer valid_token')
      .send(validPayload)
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to create flow');
  });
});

// ─── PUT /api/chatbot/:id ────────────────────────────────────────────────────

describe('PUT /api/chatbot/:id', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should update an existing chatbot flow', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(mockFlowFixture);
    mockPrisma.chatbotFlow.update.mockResolvedValue({
      ...mockFlowFixture,
      name: 'Updated Flow',
      keywords: ['hi', 'hello', 'hey'],
    });

    const res = await request(app)
      .put('/api/chatbot/flow-abc-123')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated Flow', keywords: ['hi', 'hello', 'hey'] })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: 'Updated Flow',
      keywords: ['hi', 'hello', 'hey'],
    });
    expect(mockPrisma.chatbotFlow.findFirst).toHaveBeenCalledWith({
      where: { id: 'flow-abc-123', businessId: 'biz-456' },
    });
    expect(mockPrisma.chatbotFlow.update).toHaveBeenCalledWith({
      where: { id: 'flow-abc-123' },
      data: expect.objectContaining({
        name: 'Updated Flow',
        keywords: ['hi', 'hello', 'hey'],
      }),
    });
  });

  it('should return 404 when flow not found', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/chatbot/nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Flow not found');
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .put('/api/chatbot/flow-abc-123')
      .send({ name: 'Updated' })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database update fails', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(mockFlowFixture);
    mockPrisma.chatbotFlow.update.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .put('/api/chatbot/flow-abc-123')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to update flow');
  });

  it('should allow partial updates (only name)', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(mockFlowFixture);
    mockPrisma.chatbotFlow.update.mockResolvedValue({
      ...mockFlowFixture,
      name: 'Just Name Updated',
    });

    await request(app)
      .put('/api/chatbot/flow-abc-123')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Just Name Updated' })
      .expect(200);

    expect(mockPrisma.chatbotFlow.update).toHaveBeenCalledWith({
      where: { id: 'flow-abc-123' },
      data: expect.objectContaining({
        name: 'Just Name Updated',
      }),
    });
  });
});

// ─── POST /api/chatbot/:id/toggle ────────────────────────────────────────────

describe('POST /api/chatbot/:id/toggle', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should toggle flow from active to inactive', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue({ ...mockFlowFixture, isActive: true });
    mockPrisma.chatbotFlow.update.mockResolvedValue({ ...mockFlowFixture, isActive: false });

    const res = await request(app)
      .post('/api/chatbot/flow-abc-123/toggle')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.isActive).toBe(false);
  });

  it('should toggle flow from inactive to active', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue({ ...mockFlowFixture, isActive: false });
    mockPrisma.chatbotFlow.update.mockResolvedValue({ ...mockFlowFixture, isActive: true });

    const res = await request(app)
      .post('/api/chatbot/flow-abc-123/toggle')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.isActive).toBe(true);
  });

  it('should return 404 when flow not found', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/chatbot/nonexistent/toggle')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Flow not found');
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/chatbot/flow-abc-123/toggle')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 when database update fails', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(mockFlowFixture);
    mockPrisma.chatbotFlow.update.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/chatbot/flow-abc-123/toggle')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to toggle flow');
  });
});

// ─── POST /api/chatbot/:id/activate ──────────────────────────────────────────

describe('POST /api/chatbot/:id/activate', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should activate a flow', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(mockFlowFixture);
    mockPrisma.chatbotFlow.update.mockResolvedValue({ ...mockFlowFixture, isActive: true });

    const res = await request(app)
      .post('/api/chatbot/flow-abc-123/activate')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.isActive).toBe(true);
    expect(mockPrisma.chatbotFlow.update).toHaveBeenCalledWith({
      where: { id: 'flow-abc-123' },
      data: { isActive: true },
    });
  });

  it('should return 404 when flow not found', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/chatbot/nonexistent/activate')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Flow not found');
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/chatbot/flow-abc-123/activate')
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 when database update fails', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(mockFlowFixture);
    mockPrisma.chatbotFlow.update.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/chatbot/flow-abc-123/activate')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to activate flow');
  });
});

// ─── POST /api/chatbot/:id/deactivate ────────────────────────────────────────

describe('POST /api/chatbot/:id/deactivate', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should deactivate a flow', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(mockFlowFixture);
    mockPrisma.chatbotFlow.update.mockResolvedValue({ ...mockFlowFixture, isActive: false });

    const res = await request(app)
      .post('/api/chatbot/flow-abc-123/deactivate')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.isActive).toBe(false);
    expect(mockPrisma.chatbotFlow.update).toHaveBeenCalledWith({
      where: { id: 'flow-abc-123' },
      data: { isActive: false },
    });
  });

  it('should return 404 when flow not found', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/chatbot/nonexistent/deactivate')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Flow not found');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(mockFlowFixture);
    mockPrisma.chatbotFlow.update.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/chatbot/flow-abc-123/deactivate')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to deactivate flow');
  });
});

// ─── POST /api/chatbot/:id/test ──────────────────────────────────────────────

describe('POST /api/chatbot/:id/test', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should test a flow and return mock response', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(mockFlowFixture);

    const res = await request(app)
      .post('/api/chatbot/flow-abc-123/test')
      .set('Authorization', 'Bearer valid_token')
      .send({ message: 'Hello' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      response: expect.stringContaining('Test response for flow'),
      flowId: 'flow-abc-123',
    });
    expect(res.body.data.response).toContain('Welcome Flow');
  });

  it('should return 404 when flow not found', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/chatbot/nonexistent/test')
      .set('Authorization', 'Bearer valid_token')
      .send({ message: 'Hello' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Flow not found');
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/chatbot/flow-abc-123/test')
      .send({ message: 'Hello' })
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.chatbotFlow.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/chatbot/flow-abc-123/test')
      .set('Authorization', 'Bearer valid_token')
      .send({ message: 'Hello' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to test flow');
  });
});

// ─── DELETE /api/chatbot/:id ─────────────────────────────────────────────────

describe('DELETE /api/chatbot/:id', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should delete a chatbot flow', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(mockFlowFixture);
    mockPrisma.chatbotFlow.delete.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/chatbot/flow-abc-123')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Flow deleted');
    expect(mockPrisma.chatbotFlow.delete).toHaveBeenCalledWith({
      where: { id: 'flow-abc-123' },
    });
  });

  it('should return 404 when flow not found', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/chatbot/nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Flow not found');
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .delete('/api/chatbot/flow-abc-123')
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.chatbotFlow.findFirst.mockResolvedValue(mockFlowFixture);
    mockPrisma.chatbotFlow.delete.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete('/api/chatbot/flow-abc-123')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Failed to delete flow');
  });
});