/**
 * @jest-environment node
 *
 * Integration tests for the Notifications API.
 * Tests notification listing, marking as read, archival, and preferences.
 *
 * Endpoints tested:
 *   GET    /api/notifications               list notifications with filters/pagination
 *   POST   /api/notifications/:id/read      mark notification as read
 *   POST   /api/notifications/read-all      mark all as read
 *   DELETE /api/notifications/:id           archive (soft delete) notification
 *   GET    /api/notifications/preferences   get notification preferences
 *   PUT    /api/notifications/preferences   update notification preferences
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

// ── Prisma mock ──────────────────────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  notification: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  notificationPreference: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
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

    const token = auth.replace('Bearer ', '');

    (async () => {
      try {
        const { verifyToken } = jest.requireMock('../src/server/utils/auth');
        const decoded = await verifyToken(token);

        const { prisma } = jest.requireMock('../src/server/db');
        const user = await prisma.user.findUnique({ where: { id: decoded.id } });

        if (!user) {
          res.status(401).json({ success: false, error: 'User not found' });
          return;
        }

        if (!user.isActive) {
          res.status(403).json({ success: false, error: 'Your account has been suspended. Contact support.' });
          return;
        }

        req.user = {
          id: user.id,
          email: user.email,
          businessId: user.businessId,
          role: user.role,
        };
        next();
      } catch {
        res.status(401).json({ success: false, error: 'Invalid token' });
      }
    })();
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

// ── Trap setInterval calls so we can clean them up ────────────────────────────
const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

// Import the router AFTER all mocks are set up
import notificationsRoutes from '../src/server/routes/notifications';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  businessId: 'biz-1',
  role: 'OWNER',
  isActive: true,
  emailVerified: true,
};

const mockNotification = {
  id: 'notif-1',
  businessId: 'biz-1',
  userId: 'user-1',
  type: 'lead_captured',
  title: 'New Lead',
  message: 'John Doe submitted a lead form',
  icon: 'lead',
  link: '/leads/lead-1',
  data: { leadId: 'lead-1' },
  isRead: false,
  isArchived: false,
  priority: 'normal',
  deliveredVia: ['in_app'],
  emailSent: false,
  pushSent: false,
  whatsappSent: false,
  createdAt: new Date('2025-01-01T10:00:00Z'),
  updatedAt: new Date('2025-01-01T10:00:00Z'),
};

const mockNotifications = [
  mockNotification,
  {
    ...mockNotification,
    id: 'notif-2',
    type: 'appointment_booked',
    title: 'New Appointment',
    message: 'Appointment booked for Jan 15',
    isRead: true,
    priority: 'high',
    createdAt: new Date('2025-01-01T09:00:00Z'),
  },
];

const defaultPreferences = {
  emailNotifications: true,
  smsNotifications: false,
  pushNotifications: true,
  whatsappNotifications: false,
  newLeadAlert: true,
  appointmentReminder: true,
  campaignUpdate: true,
  supportTicketUpdate: true,
  weeklyReport: true,
  monthlyReport: true,
  securityAlerts: true,
  marketingEmails: false,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationsRoutes);
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
  mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

afterAll(() => {
  for (const id of intervalIds) {
    clearInterval(id);
  }
  intervalIds.length = 0;
  global.setInterval = originalSetInterval;
});

// ─── TESTS: GET /api/notifications ──────────────────────────────────────────

describe('GET /api/notifications', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should list notifications with default pagination', async () => {
    mockPrisma.notification.findMany.mockResolvedValue(mockNotifications);
    mockPrisma.notification.count.mockResolvedValue(2);

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.notifications).toHaveLength(2);
    expect(res.body.data.unreadCount).toBe(2);
  });

  it('should return empty list when no notifications', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.notifications).toEqual([]);
    expect(res.body.data.unreadCount).toBe(0);
  });

  it('should filter by isRead=true', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([mockNotifications[1]]);
    mockPrisma.notification.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/notifications?isRead=true')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data.notifications).toHaveLength(1);
    expect(res.body.data.notifications[0].isRead).toBe(true);
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isRead: true }),
      }),
    );
  });

  it('should filter by isRead=false', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([mockNotifications[0]]);
    mockPrisma.notification.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/notifications?isRead=false')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data.notifications).toHaveLength(1);
    expect(res.body.data.notifications[0].isRead).toBe(false);
  });

  it('should filter by type', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([mockNotifications[0]]);
    mockPrisma.notification.count.mockResolvedValue(1);

    await request(app)
      .get('/api/notifications?type=lead_captured')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: 'lead_captured' }),
      }),
    );
  });

  it('should filter by priority', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([mockNotifications[1]]);
    mockPrisma.notification.count.mockResolvedValue(1);

    await request(app)
      .get('/api/notifications?priority=high')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ priority: 'high' }),
      }),
    );
  });

  it('should support pagination with limit and offset', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([mockNotifications[0]]);
    mockPrisma.notification.count.mockResolvedValue(2);

    await request(app)
      .get('/api/notifications?limit=1&offset=1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
        skip: 1,
      }),
    );
  });

  it('should exclude archived notifications by default', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isArchived: false }),
      }),
    );
  });

  it('should scope to businessId from authenticated user', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: 'biz-1' }),
      }),
    );
  });

  it('should order by createdAt desc', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).get('/api/notifications').expect(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 403 for suspended user', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-2', email: 'suspended@test.com', businessId: 'biz-1', role: 'OWNER',
    });
    mockPrisma.user = mockPrisma.user || { findUnique: jest.fn() };
    (mockPrisma as any).user = (mockPrisma as any).user || { findUnique: jest.fn() };
    (mockPrisma as any).user.findUnique.mockResolvedValue({ ...mockUser, id: 'user-2', isActive: false });

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer valid_token')
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('suspended');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.notification.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('DB error');
  });

  it('should count unread notifications separately', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([mockNotifications[0]]);
    mockPrisma.notification.count.mockResolvedValue(5);

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data.unreadCount).toBe(5);
    expect(mockPrisma.notification.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isRead: false, isArchived: false }),
      }),
    );
  });
});

// ─── TESTS: POST /api/notifications/:id/read ────────────────────────────────

describe('POST /api/notifications/:id/read', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should mark notification as read', async () => {
    mockPrisma.notification.findUnique.mockResolvedValue(mockNotification);
    mockPrisma.notification.update.mockResolvedValue({ ...mockNotification, isRead: true });

    const res = await request(app)
      .post('/api/notifications/notif-1/read')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.isRead).toBe(true);
    expect(mockPrisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-1' },
        data: { isRead: true },
      }),
    );
  });

  it('should return 404 when notification not found', async () => {
    mockPrisma.notification.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/notifications/nonexistent/read')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Notification not found');
  });

  it('should return 403 when notification belongs to another business', async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      ...mockNotification,
      businessId: 'other-biz',
    });

    const res = await request(app)
      .post('/api/notifications/notif-1/read')
      .set('Authorization', 'Bearer valid_token')
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Access denied');
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/notifications/notif-1/read')
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.notification.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/notifications/notif-1/read')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('DB error');
  });
});

// ─── TESTS: POST /api/notifications/read-all ────────────────────────────────

describe('POST /api/notifications/read-all', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should mark all unread notifications as read', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });

    const res = await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('All notifications marked as read');
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1', isRead: false },
        data: { isRead: true },
      }),
    );
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).post('/api/notifications/read-all').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.notification.updateMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('DB error');
  });
});

// ─── TESTS: DELETE /api/notifications/:id ───────────────────────────────────

describe('DELETE /api/notifications/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should archive (soft delete) a notification', async () => {
    mockPrisma.notification.findUnique.mockResolvedValue(mockNotification);
    mockPrisma.notification.update.mockResolvedValue({ ...mockNotification, isArchived: true });

    const res = await request(app)
      .delete('/api/notifications/notif-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.isArchived).toBe(true);
    expect(mockPrisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-1' },
        data: { isArchived: true },
      }),
    );
  });

  it('should return 404 when notification not found', async () => {
    mockPrisma.notification.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/notifications/nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Notification not found');
  });

  it('should return 403 when notification belongs to another business', async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({
      ...mockNotification,
      businessId: 'other-biz',
    });

    const res = await request(app)
      .delete('/api/notifications/notif-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Access denied');
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).delete('/api/notifications/notif-1').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.notification.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete('/api/notifications/notif-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('DB error');
  });
});

// ─── TESTS: GET /api/notifications/preferences ──────────────────────────────

describe('GET /api/notifications/preferences', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should return saved preferences when they exist', async () => {
    const savedPrefs = { ...defaultPreferences, emailNotifications: false, marketingEmails: true };
    mockPrisma.notificationPreference.findUnique.mockResolvedValue({
      userId: 'user-1',
      ...savedPrefs,
    });

    const res = await request(app)
      .get('/api/notifications/preferences')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.emailNotifications).toBe(false);
    expect(res.body.data.marketingEmails).toBe(true);
  });

  it('should return default preferences when none saved', async () => {
    mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/notifications/preferences')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(defaultPreferences);
  });

  it('should return defaults when table does not exist (catch block)', async () => {
    mockPrisma.notificationPreference.findUnique.mockRejectedValue(
      new Error('Table notification_preference does not exist'),
    );

    const res = await request(app)
      .get('/api/notifications/preferences')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(defaultPreferences);
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).get('/api/notifications/preferences').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should scope lookup to userId from auth', async () => {
    mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);

    await request(app)
      .get('/api/notifications/preferences')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.notificationPreference.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });
});

// ─── TESTS: PUT /api/notifications/preferences ──────────────────────────────

describe('PUT /api/notifications/preferences', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should upsert preferences', async () => {
    const newPrefs = { emailNotifications: false, pushNotifications: false };
    mockPrisma.notificationPreference.upsert.mockResolvedValue({
      userId: 'user-1',
      ...defaultPreferences,
      ...newPrefs,
    });

    const res = await request(app)
      .put('/api/notifications/preferences')
      .set('Authorization', 'Bearer valid_token')
      .send(newPrefs)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.emailNotifications).toBe(false);
    expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        create: expect.objectContaining({ userId: 'user-1', ...newPrefs }),
        update: newPrefs,
      }),
    );
  });

  it('should return success even when table does not exist (catch block)', async () => {
    mockPrisma.notificationPreference.upsert.mockRejectedValue(
      new Error('Table notification_preference does not exist'),
    );

    const res = await request(app)
      .put('/api/notifications/preferences')
      .set('Authorization', 'Bearer valid_token')
      .send({ emailNotifications: false })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.emailNotifications).toBe(false);
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app).put('/api/notifications/preferences').send({}).expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 200 when upsert fails (inner catch swallows error)', async () => {
    mockPrisma.notificationPreference.upsert.mockRejectedValue(new Error('Unexpected error'));

    const res = await request(app)
      .put('/api/notifications/preferences')
      .set('Authorization', 'Bearer valid_token')
      .send({ emailNotifications: false })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ emailNotifications: false });
  });
});