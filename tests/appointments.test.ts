/**
 * @jest-environment node
 *
 * Integration tests for the Appointments API (CRM scheduling).
 *
 * Endpoints tested:
 *   GET    /api/appointments        — list with filtering & pagination
 *   POST   /api/appointments        — create appointment
 *   PUT    /api/appointments/:id    — update appointment
 *   DELETE /api/appointments/:id    — delete appointment
 *   PATCH  /api/appointments/:id/confirm  — confirm
 *   PATCH  /api/appointments/:id/cancel   — cancel
 *   PATCH  /api/appointments/:id/complete — complete
 *   GET    /api/appointments/services      — distinct service list
 *   GET    /api/appointments/settings      — business hours
 *   PUT    /api/appointments/settings      — update business hours
 */

import express from 'express';
import request from 'supertest';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockAppointment = {
  id: 'apt-001',
  businessId: 'biz-456',
  contactId: 'contact-789',
  createdBy: 'user-abc-123',
  title: 'Consultation with John',
  description: 'Initial consultation',
  service: 'Consultation',
  startTime: new Date('2026-07-27T10:00:00Z'),
  endTime: new Date('2026-07-27T11:00:00Z'),
  timezone: 'UTC',
  status: 'pending',
  reminderSent: false,
  reminderTime: null,
  customerNotified: false,
  location: 'Office A',
  meetingUrl: null,
  notes: null,
  internalNotes: null,
  createdAt: new Date('2026-07-26'),
  updatedAt: new Date('2026-07-26'),
  contact: {
    id: 'contact-789',
    name: 'John Doe',
    phone: '+1234567890',
    email: 'john@example.com',
  },
};

const mockBusiness = {
  id: 'biz-456',
  businessHours: { monday: { open: '09:00', close: '18:00' } },
};

// ── Prisma mock ───────────────────────────────────────────────────────────────
const mockPrisma = {
  appointment: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  contact: {
    findUnique: jest.fn(),
  },
  business: {
    findUnique: jest.fn(),
    update: jest.fn(),
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

// ── IP Blocker mock (used in authenticate middleware) ─────────────────────────
jest.mock('../src/server/middleware/ipSecurity', () => ({
  ipBlocker: {
    increment: jest.fn(),
  },
}));

// ── Trap setInterval calls ────────────────────────────────────────────────────
const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

import appointmentsRoutes from '../src/server/routes/appointments';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/appointments', appointmentsRoutes);
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

// ─── GET /api/appointments — list ─────────────────────────────────────────────

describe('GET /api/appointments', () => {
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
    const res = await request(app).get('/api/appointments').expect(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Authentication required');
  });

  it('should return empty list when no appointments exist', async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([]);
    mockPrisma.appointment.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.appointments).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('should return paginated appointments', async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([mockAppointment]);
    mockPrisma.appointment.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.appointments).toHaveLength(1);
    expect(res.body.data.appointments[0].title).toBe('Consultation with John');
    expect(res.body.data.pagination).toEqual({ total: 1, limit: 50, offset: 0 });
  });

  it('should filter by status', async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([mockAppointment]);
    mockPrisma.appointment.count.mockResolvedValue(1);

    await request(app)
      .get('/api/appointments?status=confirmed')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'confirmed' }),
      }),
    );
  });

  it('should filter by date', async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([]);
    mockPrisma.appointment.count.mockResolvedValue(0);

    await request(app)
      .get('/api/appointments?date=2026-07-27')
      .set('Authorization', 'Bearer token')
      .expect(200);

    const callArgs = mockPrisma.appointment.findMany.mock.calls[0][0];
    expect(callArgs.where.startTime).toBeDefined();
    expect(callArgs.where.startTime.gte).toBeDefined();
    expect(callArgs.where.startTime.lt).toBeDefined();
  });

  it('should apply pagination params', async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([]);
    mockPrisma.appointment.count.mockResolvedValue(0);

    await request(app)
      .get('/api/appointments?limit=10&offset=20')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 20 }),
    );
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.appointment.findMany.mockRejectedValue(new Error('DB timeout'));

    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('DB timeout');
  });

  it('should include contact info in appointments', async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([mockAppointment]);
    mockPrisma.appointment.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.data.appointments[0].contact).toMatchObject({
      id: 'contact-789',
      name: 'John Doe',
    });
  });
});

// ─── POST /api/appointments — create ──────────────────────────────────────────

describe('POST /api/appointments', () => {
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
    const res = await request(app).post('/api/appointments').send({}).expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should create an appointment successfully', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: 'contact-789',
      businessId: 'biz-456',
    });
    mockPrisma.appointment.create.mockResolvedValue(mockAppointment);

    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', 'Bearer token')
      .send({
        title: 'Consultation with John',
        startTime: '2026-07-27T10:00:00Z',
        endTime: '2026-07-27T11:00:00Z',
        contactId: 'contact-789',
        description: 'Initial consultation',
        service: 'Consultation',
        location: 'Office A',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Consultation with John');
    expect(mockPrisma.appointment.create).toHaveBeenCalledTimes(1);
  });

  it('should reject missing title', async () => {
    // Schema validation catches missing title first
    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', 'Bearer token')
      .send({ startTime: '2026-07-27T10:00:00Z', endTime: '2026-07-27T11:00:00Z', contactId: 'contact-789' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Validation failed');
  });

  it('should reject missing startTime', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', 'Bearer token')
      .send({ title: 'Test', endTime: '2026-07-27T11:00:00Z', contactId: 'contact-789' })
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  it('should reject missing endTime', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', 'Bearer token')
      .send({ title: 'Test', startTime: '2026-07-27T10:00:00Z', contactId: 'contact-789' })
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  it('should reject missing contactId', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', 'Bearer token')
      .send({ title: 'Test', startTime: '2026-07-27T10:00:00Z', endTime: '2026-07-27T11:00:00Z' })
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  it('should reject endTime before startTime', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', 'Bearer token')
      .send({
        title: 'Test',
        startTime: '2026-07-27T11:00:00Z',
        endTime: '2026-07-27T10:00:00Z',
        contactId: 'contact-789',
      })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('End time must be after start time');
  });

  it('should reject invalid contact ID', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', 'Bearer token')
      .send({
        title: 'Test',
        startTime: '2026-07-27T10:00:00Z',
        endTime: '2026-07-27T11:00:00Z',
        contactId: 'nonexistent-contact',
      })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid contact ID');
  });

  it('should reject contact belonging to different business', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: 'contact-other',
      businessId: 'biz-999',
    });

    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', 'Bearer token')
      .send({
        title: 'Test',
        startTime: '2026-07-27T10:00:00Z',
        endTime: '2026-07-27T11:00:00Z',
        contactId: 'contact-other',
      })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid contact ID');
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.contact.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', 'Bearer token')
      .send({
        title: 'Test',
        startTime: '2026-07-27T10:00:00Z',
        endTime: '2026-07-27T11:00:00Z',
        contactId: 'contact-789',
      })
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── PUT /api/appointments/:id — update ───────────────────────────────────────

describe('PUT /api/appointments/:id', () => {
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
    const res = await request(app).put('/api/appointments/apt-001').send({}).expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should update an appointment successfully', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue(mockAppointment);
    mockPrisma.appointment.update.mockResolvedValue({
      ...mockAppointment,
      title: 'Updated Title',
    });

    const res = await request(app)
      .put('/api/appointments/apt-001')
      .set('Authorization', 'Bearer token')
      .send({ title: 'Updated Title', status: 'confirmed' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Updated Title');
  });

  it('should return 404 for non-existent appointment', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/appointments/nonexistent')
      .set('Authorization', 'Bearer token')
      .send({ title: 'Updated' })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Appointment not found');
  });

  it('should return 403 when appointment belongs to different business', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue({
      ...mockAppointment,
      businessId: 'biz-other',
    });

    const res = await request(app)
      .put('/api/appointments/apt-001')
      .set('Authorization', 'Bearer token')
      .send({ title: 'Updated' })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Access denied');
  });

  it('should reject endTime before startTime on update', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue(mockAppointment);

    const res = await request(app)
      .put('/api/appointments/apt-001')
      .set('Authorization', 'Bearer token')
      .send({
        startTime: '2026-07-27T12:00:00Z',
        endTime: '2026-07-27T11:00:00Z',
      })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('End time must be after start time');
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue(mockAppointment);
    mockPrisma.appointment.update.mockRejectedValue(new Error('Update failed'));

    const res = await request(app)
      .put('/api/appointments/apt-001')
      .set('Authorization', 'Bearer token')
      .send({ title: 'Updated' })
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── DELETE /api/appointments/:id — delete ────────────────────────────────────

describe('DELETE /api/appointments/:id', () => {
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
    const res = await request(app).delete('/api/appointments/apt-001').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should delete an appointment successfully', async () => {
    mockPrisma.appointment.delete.mockResolvedValue(mockAppointment);

    const res = await request(app)
      .delete('/api/appointments/apt-001')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Appointment deleted');
    expect(mockPrisma.appointment.delete).toHaveBeenCalledWith({
      where: { id: 'apt-001', businessId: 'biz-456' },
    });
  });

  it('should return 500 when delete fails for non-existent ID', async () => {
    mockPrisma.appointment.delete.mockRejectedValue(new Error('Record not found'));

    const res = await request(app)
      .delete('/api/appointments/nonexistent')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.appointment.delete.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete('/api/appointments/apt-001')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── PATCH /api/appointments/:id/confirm — confirm ────────────────────────────

describe('PATCH /api/appointments/:id/confirm', () => {
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

  it('should confirm an appointment', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(mockAppointment);
    mockPrisma.appointment.update.mockResolvedValue({ ...mockAppointment, status: 'confirmed' });

    const res = await request(app)
      .patch('/api/appointments/apt-001/confirm')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('confirmed');
  });

  it('should return 404 when appointment not found', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/appointments/nonexistent/confirm')
      .set('Authorization', 'Bearer token')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Not found');
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.appointment.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .patch('/api/appointments/apt-001/confirm')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── PATCH /api/appointments/:id/cancel — cancel ──────────────────────────────

describe('PATCH /api/appointments/:id/cancel', () => {
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

  it('should cancel an appointment', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(mockAppointment);
    mockPrisma.appointment.update.mockResolvedValue({ ...mockAppointment, status: 'cancelled' });

    const res = await request(app)
      .patch('/api/appointments/apt-001/cancel')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('cancelled');
  });

  it('should return 404 when appointment not found', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/appointments/nonexistent/cancel')
      .set('Authorization', 'Bearer token')
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.appointment.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .patch('/api/appointments/apt-001/cancel')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── PATCH /api/appointments/:id/complete — complete ──────────────────────────

describe('PATCH /api/appointments/:id/complete', () => {
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

  it('should complete an appointment', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(mockAppointment);
    mockPrisma.appointment.update.mockResolvedValue({ ...mockAppointment, status: 'completed' });

    const res = await request(app)
      .patch('/api/appointments/apt-001/complete')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('completed');
  });

  it('should return 404 when appointment not found', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/appointments/nonexistent/complete')
      .set('Authorization', 'Bearer token')
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.appointment.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .patch('/api/appointments/apt-001/complete')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api/appointments/services — list services ───────────────────────────

describe('GET /api/appointments/services', () => {
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
    const res = await request(app).get('/api/appointments/services').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should return distinct services list', async () => {
    // The route uses Prisma's `distinct: ['service']` so the mock pre-deduplicates
    mockPrisma.appointment.findMany.mockResolvedValue([
      { service: 'Consultation' },
      { service: 'Follow-up' },
    ]);

    const res = await request(app)
      .get('/api/appointments/services')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.services).toEqual(['Consultation', 'Follow-up']);
  });

  it('should return empty array when no services exist', async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([{ service: null }]);

    const res = await request(app)
      .get('/api/appointments/services')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.services).toEqual([]);
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.appointment.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/appointments/services')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api/appointments/settings — get business hours ──────────────────────

describe('GET /api/appointments/settings', () => {
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
    const res = await request(app).get('/api/appointments/settings').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should return business hours', async () => {
    mockPrisma.business.findUnique.mockResolvedValue(mockBusiness);

    const res = await request(app)
      .get('/api/appointments/settings')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.businessHours).toEqual(mockBusiness.businessHours);
  });

  it('should return null businessHours when none set', async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ id: 'biz-456', businessHours: null });

    const res = await request(app)
      .get('/api/appointments/settings')
      .set('Authorization', 'Bearer token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.businessHours).toBeNull();
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.business.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/appointments/settings')
      .set('Authorization', 'Bearer token')
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});

// ─── PUT /api/appointments/settings — update business hours ───────────────────

describe('PUT /api/appointments/settings', () => {
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
    const res = await request(app).put('/api/appointments/settings').send({}).expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should update business hours successfully', async () => {
    const newHours = { monday: { open: '08:00', close: '17:00' } };
    mockPrisma.business.update.mockResolvedValue({ ...mockBusiness, businessHours: newHours });

    const res = await request(app)
      .put('/api/appointments/settings')
      .set('Authorization', 'Bearer token')
      .send({ businessHours: newHours })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.businessHours).toEqual(newHours);
    expect(mockPrisma.business.update).toHaveBeenCalledWith({
      where: { id: 'biz-456' },
      data: { businessHours: newHours },
    });
  });

  it('should clear businessHours when sending null', async () => {
    mockPrisma.business.update.mockResolvedValue({ id: 'biz-456', businessHours: null });

    const res = await request(app)
      .put('/api/appointments/settings')
      .set('Authorization', 'Bearer token')
      .send({ businessHours: null })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.businessHours).toBeNull();
  });

  it('should return 500 on Prisma error', async () => {
    mockPrisma.business.update.mockRejectedValue(new Error('Update failed'));

    const res = await request(app)
      .put('/api/appointments/settings')
      .set('Authorization', 'Bearer token')
      .send({ businessHours: { monday: { open: '09:00', close: '18:00' } } })
      .expect(500);

    expect(res.body.success).toBe(false);
  });
});
