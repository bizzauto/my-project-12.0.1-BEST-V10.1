/**
 * @jest-environment node
 *
 * Integration tests for the Settings API (white-label, theme, appointments).
 * Tests CRUD operations for white-label settings, theme preferences,
 * and appointment management with role-based access control.
 *
 * Endpoints tested:
 *   GET    /api/settings              get white-label settings
 *   PUT    /api/settings              update white-label settings (OWNER/ADMIN)
 *   GET    /api/settings/theme        get theme preferences
 *   PUT    /api/settings/theme        update theme preferences
 *   GET    /api/settings/appointments      list appointments
 *   POST   /api/settings/appointments      create appointment (OWNER/ADMIN)
 *   PUT    /api/settings/appointments/:id  update appointment (OWNER/ADMIN)
 *   DELETE /api/settings/appointments/:id  delete appointment (OWNER/ADMIN)
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

// ── Prisma mock ──────────────────────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  whiteLabel: {
    findUnique: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
  },
  themePreference: {
    findUnique: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
  },
  appointment: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
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

// ── JSON Web Token mock ──────────────────────────────────────────────────────
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

// ── CSRF Service mock ────────────────────────────────────────────────────────
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

// Import router AFTER all mocks
import settingsRoutes from '../src/server/routes/settings';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  businessId: 'biz-1',
  role: 'OWNER',
  isActive: true,
  emailVerified: true,
};

const mockWhiteLabel = {
  id: 'wl-1',
  businessId: 'biz-1',
  brandName: 'My Brand',
  logoUrl: 'https://example.com/logo.png',
  faviconUrl: 'https://example.com/favicon.ico',
  primaryColor: '#3B82F6',
  customCss: null,
  customDomain: null,
  isActive: true,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockThemePreference = {
  id: 'theme-1',
  userId: 'user-1',
  theme: 'light',
  sidebarCollapsed: false,
  accentColor: '#3B82F6',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockAppointment = {
  id: 'appt-1',
  businessId: 'biz-1',
  createdBy: 'user-1',
  title: 'Client Meeting',
  description: 'Discuss project requirements',
  service: 'Consultation',
  startTime: new Date('2025-06-15T10:00:00Z'),
  endTime: new Date('2025-06-15T11:00:00Z'),
  contactId: 'contact-1',
  location: 'Office',
  isOnline: true,
  meetingLink: 'https://meet.example.com/abc',
  meetingUrl: null,
  status: 'scheduled',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  contact: { id: 'contact-1', name: 'John Doe', phone: '+1234567890', email: 'john@test.com' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRoutes);
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

  mockPrisma.user.findUnique.mockResolvedValue(mockUser);

  const { CSRFService } = jest.requireMock('../src/server/services/csrf.service');
  CSRFService.generateToken.mockResolvedValue('csrf-token-xyz');
  CSRFService.getToken.mockResolvedValue('csrf-token-xyz');
}

function setUserRole(role: string): void {
  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: 'user-1',
    email: `${role.toLowerCase()}@test.com`,
    businessId: 'biz-1',
    role,
  });
  mockPrisma.user.findUnique.mockResolvedValue({
    ...mockUser,
    role,
  });
}

// ─── GET /api/settings — White-label settings ────────────────────────────────

describe('GET /api/settings', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should return existing white-label settings', async () => {
    mockPrisma.whiteLabel.findUnique.mockResolvedValue(mockWhiteLabel);

    const res = await request(app)
      .get('/api/settings')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      brandName: 'My Brand',
      primaryColor: '#3B82F6',
      isActive: true,
    });
  });

  it('should create default white-label settings if none exist', async () => {
    mockPrisma.whiteLabel.findUnique.mockResolvedValue(null);
    mockPrisma.whiteLabel.create.mockResolvedValue({
      ...mockWhiteLabel,
      brandName: null,
      logoUrl: null,
    });

    const res = await request(app)
      .get('/api/settings')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(mockPrisma.whiteLabel.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { businessId: 'biz-1' } }),
    );
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .get('/api/settings')
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return 500 on database error', async () => {
    mockPrisma.whiteLabel.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/settings')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('DB error');
  });
});

// ─── PUT /api/settings — Update white-label ──────────────────────────────────

describe('PUT /api/settings', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.whiteLabel.upsert.mockResolvedValue(mockWhiteLabel);
  });

  it('should update white-label settings', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', 'Bearer valid_token')
      .send({
        brandName: 'Updated Brand',
        logoUrl: 'https://example.com/new-logo.png',
        primaryColor: '#FF0000',
        isActive: true,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      brandName: 'My Brand',
    });

    expect(mockPrisma.whiteLabel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        update: expect.objectContaining({
          brandName: 'Updated Brand',
          logoUrl: 'https://example.com/new-logo.png',
          primaryColor: '#FF0000',
          isActive: true,
        }),
        create: expect.objectContaining({
          businessId: 'biz-1',
          brandName: 'Updated Brand',
          logoUrl: 'https://example.com/new-logo.png',
          primaryColor: '#FF0000',
          isActive: true,
        }),
      }),
    );
  });

  it('should return 403 for MEMBER role', async () => {
    setUserRole('MEMBER');

    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', 'Bearer member_token')
      .send({ brandName: 'Hacked Brand' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
    expect(mockPrisma.whiteLabel.upsert).not.toHaveBeenCalled();
  });

  it('should return 500 on upsert failure', async () => {
    mockPrisma.whiteLabel.upsert.mockRejectedValue(new Error('Upsert failed'));

    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', 'Bearer valid_token')
      .send({ brandName: 'Brand' })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Upsert failed');
  });
});

// ─── GET /api/settings/theme — Theme preferences ─────────────────────────────

describe('GET /api/settings/theme', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  it('should return existing theme preferences', async () => {
    mockPrisma.themePreference.findUnique.mockResolvedValue(mockThemePreference);

    const res = await request(app)
      .get('/api/settings/theme')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      theme: 'light',
      sidebarCollapsed: false,
      accentColor: '#3B82F6',
    });
  });

  it('should create default theme preferences if none exist', async () => {
    mockPrisma.themePreference.findUnique.mockResolvedValue(null);
    mockPrisma.themePreference.create.mockResolvedValue({
      id: 'theme-new',
      userId: 'user-1',
      theme: 'light',
      sidebarCollapsed: false,
      accentColor: '#3B82F6',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .get('/api/settings/theme')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.themePreference.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: 'user-1' } }),
    );
  });

  it('should return 500 on error', async () => {
    mockPrisma.themePreference.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/settings/theme')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── PUT /api/settings/theme — Update theme preferences ──────────────────────

describe('PUT /api/settings/theme', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.themePreference.upsert.mockResolvedValue(mockThemePreference);
  });

  it('should update theme preferences', async () => {
    const res = await request(app)
      .put('/api/settings/theme')
      .set('Authorization', 'Bearer valid_token')
      .send({ theme: 'dark', sidebarCollapsed: true, accentColor: '#000000' })
      .expect(200);

    expect(res.body.success).toBe(true);

    expect(mockPrisma.themePreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        update: expect.objectContaining({
          theme: 'dark',
          sidebarCollapsed: true,
          accentColor: '#000000',
        }),
        create: expect.objectContaining({
          userId: 'user-1',
          theme: 'dark',
          sidebarCollapsed: true,
          accentColor: '#000000',
        }),
      }),
    );
  });

  it('should allow MEMBER role (theme is user-scoped)', async () => {
    setUserRole('MEMBER');
    mockPrisma.themePreference.upsert.mockResolvedValue({
      ...mockThemePreference,
      theme: 'dark',
    });

    const res = await request(app)
      .put('/api/settings/theme')
      .set('Authorization', 'Bearer valid_token')
      .send({ theme: 'dark' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.themePreference.upsert).toHaveBeenCalled();
  });

  it('should return 500 on error', async () => {
    mockPrisma.themePreference.upsert.mockRejectedValue(new Error('Upsert failed'));

    const res = await request(app)
      .put('/api/settings/theme')
      .set('Authorization', 'Bearer valid_token')
      .send({ theme: 'dark' })
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api/settings/appointments — List appointments ──────────────────────

describe('GET /api/settings/appointments', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.appointment.findMany.mockResolvedValue([mockAppointment]);
  });

  it('should list appointments with default params', async () => {
    const res = await request(app)
      .get('/api/settings/appointments')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      title: 'Client Meeting',
      status: 'scheduled',
    });
    expect(res.body.data[0].contact).toMatchObject({
      name: 'John Doe',
    });

    expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1' },
        include: { contact: { select: { id: true, name: true, phone: true, email: true } } },
        orderBy: { startTime: 'asc' },
      }),
    );
  });

  it('should filter by status', async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/settings/appointments?status=completed')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
          status: 'completed',
        }),
      }),
    );
  });

  it('should filter by date range', async () => {
    await request(app)
      .get('/api/settings/appointments?startDate=2025-06-01&endDate=2025-06-30')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
          startTime: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      }),
    );
  });

  it('should handle empty appointments', async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/settings/appointments')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data).toEqual([]);
  });

  it('should return 500 on error', async () => {
    mockPrisma.appointment.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/settings/appointments')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── POST /api/settings/appointments — Create appointment ────────────────────

describe('POST /api/settings/appointments', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.appointment.create.mockResolvedValue({
      ...mockAppointment,
      contact: { id: 'contact-1', name: 'John Doe', phone: '+1234567890', email: 'john@test.com' },
    });
  });

  it('should create an appointment', async () => {
    const payload = {
      title: 'New Meeting',
      description: 'Discuss proposal',
      service: 'Consultation',
      startTime: '2025-07-01T14:00:00Z',
      endTime: '2025-07-01T15:00:00Z',
      contactId: 'contact-1',
      location: 'Virtual',
      isOnline: true,
      meetingLink: 'https://meet.example.com/xyz',
      status: 'scheduled',
    };

    const res = await request(app)
      .post('/api/settings/appointments')
      .set('Authorization', 'Bearer valid_token')
      .send(payload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      title: 'Client Meeting',
    });

    expect(mockPrisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-1',
          createdBy: 'user-1',
          title: 'New Meeting',
          service: 'Consultation',
          isOnline: true,
        }),
      }),
    );
  });

  it('should return 403 for MEMBER role', async () => {
    setUserRole('MEMBER');

    const res = await request(app)
      .post('/api/settings/appointments')
      .set('Authorization', 'Bearer member_token')
      .send({ title: 'Test', startTime: '2025-07-01T14:00:00Z', endTime: '2025-07-01T15:00:00Z' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
    expect(mockPrisma.appointment.create).not.toHaveBeenCalled();
  });

  it('should allow ADMIN to create appointment', async () => {
    setUserRole('ADMIN');
    mockPrisma.appointment.create.mockResolvedValue(mockAppointment);

    const res = await request(app)
      .post('/api/settings/appointments')
      .set('Authorization', 'Bearer admin_token')
      .send({ title: 'Admin Meeting', startTime: '2025-07-01T14:00:00Z', endTime: '2025-07-01T15:00:00Z' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.appointment.create).toHaveBeenCalled();
  });

  it('should return 500 on error', async () => {
    mockPrisma.appointment.create.mockRejectedValue(new Error('Creation failed'));

    const res = await request(app)
      .post('/api/settings/appointments')
      .set('Authorization', 'Bearer valid_token')
      .send({ title: 'Test', startTime: '2025-07-01T14:00:00Z', endTime: '2025-07-01T15:00:00Z' })
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── PUT /api/settings/appointments/:id — Update appointment ─────────────────

describe('PUT /api/settings/appointments/:id', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.appointment.findFirst.mockResolvedValue(mockAppointment);
    mockPrisma.appointment.update.mockResolvedValue({
      ...mockAppointment,
      title: 'Updated Meeting',
      status: 'completed',
    });
  });

  it('should update an appointment', async () => {
    const res = await request(app)
      .put('/api/settings/appointments/appt-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ title: 'Updated Meeting', status: 'completed' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      title: 'Updated Meeting',
    });

    // Verify the appointment belongs to the business
    expect(mockPrisma.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-1', businessId: 'biz-1' },
      }),
    );

    expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-1' },
        data: expect.objectContaining({ title: 'Updated Meeting', status: 'completed' }),
      }),
    );
  });

  it('should return 404 when appointment not found', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/settings/appointments/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .send({ title: 'Ghost' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Not found');
    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });

  it('should return 403 for MEMBER role', async () => {
    setUserRole('MEMBER');

    const res = await request(app)
      .put('/api/settings/appointments/appt-1')
      .set('Authorization', 'Bearer member_token')
      .send({ title: 'Hacked' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });

  it('should return 500 on error', async () => {
    mockPrisma.appointment.update.mockRejectedValue(new Error('Update failed'));

    const res = await request(app)
      .put('/api/settings/appointments/appt-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ title: 'Updated' })
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── DELETE /api/settings/appointments/:id — Delete appointment ──────────────

describe('DELETE /api/settings/appointments/:id', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
    mockPrisma.appointment.delete.mockResolvedValue(mockAppointment);
  });

  it('should delete an appointment', async () => {
    const res = await request(app)
      .delete('/api/settings/appointments/appt-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Deleted');

    expect(mockPrisma.appointment.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-1', businessId: 'biz-1' },
      }),
    );
  });

  it('should return 403 for MEMBER role', async () => {
    setUserRole('MEMBER');

    const res = await request(app)
      .delete('/api/settings/appointments/appt-1')
      .set('Authorization', 'Bearer member_token')
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Insufficient permissions');
    expect(mockPrisma.appointment.delete).not.toHaveBeenCalled();
  });

  it('should return 500 when delete fails (not found becomes 500 due to Prisma)', async () => {
    mockPrisma.appointment.delete.mockRejectedValue(new Error('Record not found'));

    const res = await request(app)
      .delete('/api/settings/appointments/non-existent')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.appointment.delete.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete('/api/settings/appointments/appt-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});
