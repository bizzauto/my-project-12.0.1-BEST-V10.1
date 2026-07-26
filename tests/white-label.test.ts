/**
 * @jest-environment node
 *
 * End-to-end integration tests for the White Label API.
 *
 * These tests use supertest to make real HTTP requests against the Express
 * router with the full middleware stack while mocking Prisma, bcrypt, jwt,
 * and ancillary services.
 *
 * White Label endpoints tested:
 *   POST /api/wl/auth/login        — Reseller login
 *   POST /api/wl/auth/register     — Reseller registration
 *   GET  /api/wl/auth/me           — Get authenticated reseller profile
 *   GET  /api/wl/clients           — List clients
 *   POST /api/wl/clients           — Create client
 *   DELETE /api/wl/clients/:id     — Delete client
 *   PATCH /api/wl/clients/:id/status — Update client status
 *   GET  /api/wl/clients/stats     — Client statistics
 *   GET  /api/wl/branding          — Get branding config
 *   PUT  /api/wl/branding          — Update branding config
 *   GET  /api/wl/products          — Get available products (public)
 */

import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// ─── Mock Dependencies ────────────────────────────────────────────────────────────

// ── Prisma mock ──────────────────────────────────────────────────────────────────
const mockPrisma = {
  wlReseller: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  wlClient: {
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

// ── bcrypt mock ───────────────────────────────────────────────────────────────────
jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

// ── jsonwebtoken mock (for wlAuth middleware) ────────────────────────────────────
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  sign: jest.fn(),
  decode: jest.fn(),
}));

// ── Disable rate limiting ────────────────────────────────────────────────────────
jest.mock('express-rate-limit', () => ({
  default: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  __esModule: true,
}));

// Set env before importing so the module evaluates with white-label ENABLED
process.env.RESELLER_JWT_SECRET = 'test-reseller-jwt-secret-32-chars-long';

// Import router AFTER all mocks
import whiteLabelRoutes from '../src/server/routes/white-label';

// ─── Fixtures ──────────────────────────────────────────────────────────────────────

const mockReseller = {
  id: 'reseller-1',
  name: 'Test Reseller',
  email: 'reseller@test.com',
  password: 'hashed_password',
  company: "Test Reseller's Company",
  phone: '+1234567890',
  plan: 'STARTER',
  domain: 'testreseller.resellerpro.com',
  primaryColor: '#6366f1',
  logo: null,
  favicon: null,
  customCss: null,
  revenue: 999,
  isActive: true,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
};

const mockClients = [
  {
    id: 'client-1',
    resellerId: 'reseller-1',
    name: 'Client One',
    email: 'client1@test.com',
    phone: '+1111111111',
    product: 'google-reviews',
    plan: 'STARTER',
    status: 'active',
    createdAt: new Date('2025-01-15'),
  },
  {
    id: 'client-2',
    resellerId: 'reseller-1',
    name: 'Client Two',
    email: 'client2@test.com',
    phone: '+2222222222',
    product: 'digital-vcard',
    plan: 'PRO',
    status: 'pending',
    createdAt: new Date('2025-01-20'),
  },
];

const mockJwtSecret = 'test-reseller-jwt-secret-32-chars-long';

// ─── Helpers ───────────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/wl', whiteLabelRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();

  // Default: white-label enabled
  process.env.RESELLER_JWT_SECRET = mockJwtSecret;

  // Mock bcrypt
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_new_password');

  // Mock jwt
  (jwt.verify as jest.Mock).mockReturnValue({ resellerId: 'reseller-1' });
  (jwt.sign as jest.Mock).mockReturnValue('mock_wl_jwt_token');
}

function setWhiteLabelDisabled(): void {
  delete process.env.RESELLER_JWT_SECRET;
  // Re-require the module to pick up the new env
  jest.resetModules();
}

function setUnauthenticated(): void {
  (jwt.verify as jest.Mock).mockImplementation(() => {
    const err: any = new Error('Invalid token');
    err.name = 'JsonWebTokenError';
    throw err;
  });
}

function setInvalidToken(): void {
  (jwt.verify as jest.Mock).mockImplementation(() => {
    const err: any = new Error('jwt expired');
    err.name = 'TokenExpiredError';
    throw err;
  });
}

// ─── Cleanup ───────────────────────────────────────────────────────────────────────

afterAll(() => {
  delete process.env.RESELLER_JWT_SECRET;
});

// ─── Tests ──────────────────────────────────────────────────────────────────────────

describe('White Label API', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  // ==================== AUTH: POST /auth/login ====================
  describe('POST /api/wl/auth/login', () => {
    it('should login successfully with valid credentials (200)', async () => {
      mockPrisma.wlReseller.findFirst.mockResolvedValue(mockReseller);
      mockPrisma.wlClient.findMany.mockResolvedValue(mockClients);

      const res = await request(app)
        .post('/api/wl/auth/login')
        .send({ email: 'reseller@test.com', password: 'correct_password' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('token', 'mock_wl_jwt_token');
      expect(res.body.data.reseller).toMatchObject({
        id: 'reseller-1',
        email: 'reseller@test.com',
        company: "Test Reseller's Company",
        clients: 2,
        activeClients: 1,
        revenue: '₹999',
      });
      expect(res.body.data.clients).toHaveLength(2);
      expect(bcrypt.compare).toHaveBeenCalledWith('correct_password', 'hashed_password');
    });

    it('should reject login with missing email (400)', async () => {
      const res = await request(app)
        .post('/api/wl/auth/login')
        .send({ password: 'password' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Email and password required');
    });

    it('should reject login with missing password (400)', async () => {
      const res = await request(app)
        .post('/api/wl/auth/login')
        .send({ email: 'reseller@test.com' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Email and password required');
    });

    it('should reject login with non-existent reseller (401)', async () => {
      mockPrisma.wlReseller.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/wl/auth/login')
        .send({ email: 'nonexistent@test.com', password: 'password' })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('should reject login with incorrect password (401)', async () => {
      mockPrisma.wlReseller.findFirst.mockResolvedValue(mockReseller);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const res = await request(app)
        .post('/api/wl/auth/login')
        .send({ email: 'reseller@test.com', password: 'wrong_password' })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('should reject login for deactivated account (403)', async () => {
      mockPrisma.wlReseller.findFirst.mockResolvedValue({ ...mockReseller, isActive: false });

      const res = await request(app)
        .post('/api/wl/auth/login')
        .send({ email: 'reseller@test.com', password: 'correct_password' })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Account is deactivated');
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wlReseller.findFirst.mockRejectedValue(new Error('DB connection failed'));

      const res = await request(app)
        .post('/api/wl/auth/login')
        .send({ email: 'reseller@test.com', password: 'password' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Login failed');
    });

    it('should return 503 when white-label module is disabled', async () => {
      setWhiteLabelDisabled();
      // Re-import to get the module with disabled state
      const { default: disabledRoutes } = await import('../src/server/routes/white-label');
      const disabledApp = express();
      disabledApp.use(express.json());
      disabledApp.use('/api/wl', disabledRoutes);

      const res = await request(disabledApp)
        .post('/api/wl/auth/login')
        .send({ email: 'reseller@test.com', password: 'password' })
        .expect(503);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('White-label module not configured');
    });
  });

  // ==================== AUTH: POST /auth/register ====================
  describe('POST /api/wl/auth/register', () => {
    it('should register new reseller successfully (201)', async () => {
      const newReseller = { ...mockReseller, id: 'reseller-new', email: 'new@test.com', name: 'New Reseller', company: 'New Company' };
      mockPrisma.wlReseller.findFirst.mockResolvedValue(null);
      mockPrisma.wlReseller.create.mockResolvedValue(newReseller);

      const res = await request(app)
        .post('/api/wl/auth/register')
        .send({
          name: 'New Reseller',
          email: 'new@test.com',
          phone: '+1999999999',
          company: 'New Company',
          password: 'SecurePass123',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.reseller).toMatchObject({
        id: 'reseller-new',
        email: 'new@test.com',
        name: 'New Reseller',
        company: 'New Company',
        plan: 'STARTER',
      });
      expect(res.body.data.reseller).not.toHaveProperty('password');
      expect(bcrypt.hash).toHaveBeenCalledWith('SecurePass123', 10);
    });

    it('should reject registration with missing required fields (400)', async () => {
      const res = await request(app)
        .post('/api/wl/auth/register')
        .send({ name: 'No Email', password: 'password' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Name, email and password required');
    });

    it('should reject registration with invalid email format (400)', async () => {
      const res = await request(app)
        .post('/api/wl/auth/register')
        .send({ name: 'Test', email: 'invalid-email', password: 'password123' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Invalid email format');
    });

    it('should reject registration with duplicate email (409)', async () => {
      mockPrisma.wlReseller.findFirst.mockResolvedValue(mockReseller);

      const res = await request(app)
        .post('/api/wl/auth/register')
        .send({ name: 'Duplicate', email: 'reseller@test.com', password: 'password123' })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Email already registered');
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wlReseller.findFirst.mockResolvedValue(null);
      mockPrisma.wlReseller.create.mockRejectedValue(new Error('Create failed'));

      const res = await request(app)
        .post('/api/wl/auth/register')
        .send({ name: 'Test', email: 'new@test.com', password: 'password123' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Registration failed');
    });

    it('should return 503 when white-label module is disabled', async () => {
      setWhiteLabelDisabled();
      const { default: disabledRoutes } = await import('../src/server/routes/white-label');
      const disabledApp = express();
      disabledApp.use(express.json());
      disabledApp.use('/api/wl', disabledRoutes);

      const res = await request(disabledApp)
        .post('/api/wl/auth/register')
        .send({ name: 'Test', email: 'new@test.com', password: 'password123' })
        .expect(503);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('White-label module not configured');
    });
  });

  // ==================== AUTH: GET /auth/me ====================
  describe('GET /api/wl/auth/me', () => {
    it('should return authenticated reseller profile (200)', async () => {
      mockPrisma.wlReseller.findUnique.mockResolvedValue(mockReseller);
      mockPrisma.wlClient.findMany.mockResolvedValue(mockClients);

      const res = await request(app)
        .get('/api/wl/auth/me')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.reseller).toMatchObject({
        id: 'reseller-1',
        email: 'reseller@test.com',
        clients: 2,
        activeClients: 1,
        revenue: '₹999',
      });
      expect(res.body.data.reseller).not.toHaveProperty('password');
    });

    it('should return 404 when reseller not found', async () => {
      mockPrisma.wlReseller.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/wl/auth/me')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Reseller not found');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/wl/auth/me')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should return 401 with invalid token', async () => {
      setInvalidToken();

      const res = await request(app)
        .get('/api/wl/auth/me')
        .set('Authorization', 'Bearer expired_token')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Invalid token');
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wlReseller.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/wl/auth/me')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to fetch profile');
    });

    it('should return 503 when white-label module is disabled', async () => {
      setWhiteLabelDisabled();
      const { default: disabledRoutes } = await import('../src/server/routes/white-label');
      const disabledApp = express();
      disabledApp.use(express.json());
      disabledApp.use('/api/wl', disabledRoutes);

      const res = await request(disabledApp)
        .get('/api/wl/auth/me')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(503);

      expect(res.body.success).toBe(false);
    });
  });

  // ==================== CLIENTS: GET /clients ====================
  describe('GET /api/wl/clients', () => {
    it('should return list of clients (200)', async () => {
      mockPrisma.wlClient.findMany.mockResolvedValue(mockClients);

      const res = await request(app)
        .get('/api/wl/clients')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.clients).toHaveLength(2);
      expect(res.body.data.clients[0]).toMatchObject({
        id: 'client-1',
        name: 'Client One',
        email: 'client1@test.com',
        status: 'active',
      });
      // Check date formatting
      expect(res.body.data.clients[0].createdAt).toBe('2025-01-15');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/wl/clients')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wlClient.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/wl/clients')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to fetch clients');
    });
  });

  // ==================== CLIENTS: POST /clients ====================
  describe('POST /api/wl/clients', () => {
    it('should create client successfully (201)', async () => {
      const newClient = {
        id: 'client-3',
        resellerId: 'reseller-1',
        name: 'New Client',
        email: 'newclient@test.com',
        phone: '+3333333333',
        product: 'google-reviews',
        plan: 'STARTER',
        status: 'pending',
        createdAt: new Date('2025-02-01'),
      };
      mockPrisma.wlClient.create.mockResolvedValue(newClient);
      mockPrisma.wlReseller.update.mockResolvedValue({ ...mockReseller, revenue: 1998 });

      const res = await request(app)
        .post('/api/wl/clients')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ name: 'New Client', email: 'newclient@test.com', phone: '+3333333333', product: 'google-reviews', plan: 'STARTER' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.client).toMatchObject({
        id: 'client-3',
        name: 'New Client',
        email: 'newclient@test.com',
        status: 'pending',
      });
      expect(res.body.data.client.createdAt).toBe('2025-02-01');
      // Verify revenue was incremented
      expect(mockPrisma.wlReseller.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'reseller-1' },
          data: { revenue: { increment: 999 } },
        })
      );
    });

    it('should reject creation with missing name (400)', async () => {
      const res = await request(app)
        .post('/api/wl/clients')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ email: 'test@test.com' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Name and email required');
    });

    it('should reject creation with missing email (400)', async () => {
      const res = await request(app)
        .post('/api/wl/clients')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ name: 'Test Client' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Name and email required');
    });

    it('should default product to google-reviews and plan to STARTER', async () => {
      const newClient = { ...mockClients[0], id: 'client-3', product: 'google-reviews', plan: 'STARTER' };
      mockPrisma.wlClient.create.mockResolvedValue(newClient);
      mockPrisma.wlReseller.update.mockResolvedValue(mockReseller);

      await request(app)
        .post('/api/wl/clients')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ name: 'Minimal Client', email: 'minimal@test.com' })
        .expect(201);

      expect(mockPrisma.wlClient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            product: 'google-reviews',
            plan: 'STARTER',
            status: 'pending',
          }),
        })
      );
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .post('/api/wl/clients')
        .send({ name: 'Test', email: 'test@test.com' })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wlClient.create.mockRejectedValue(new Error('Create failed'));

      const res = await request(app)
        .post('/api/wl/clients')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ name: 'Test', email: 'test@test.com' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to create client');
    });
  });

  // ==================== CLIENTS: DELETE /clients/:id ====================
  describe('DELETE /api/wl/clients/:id', () => {
    it('should delete client successfully (200)', async () => {
      const clientToDelete = mockClients[0];
      mockPrisma.wlClient.findFirst.mockResolvedValue(clientToDelete);
      mockPrisma.wlClient.delete.mockResolvedValue(clientToDelete);
      mockPrisma.wlReseller.update.mockResolvedValue({ ...mockReseller, revenue: 0 });

      const res = await request(app)
        .delete('/api/wl/clients/client-1')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Client removed');
      // Verify revenue was decremented
      expect(mockPrisma.wlReseller.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'reseller-1' },
          data: { revenue: { decrement: 999 } },
        })
      );
    });

    it('should return 404 when client not found', async () => {
      mockPrisma.wlClient.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/wl/clients/nonexistent')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Client not found');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .delete('/api/wl/clients/client-1')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wlClient.findFirst.mockResolvedValue(mockClients[0]);
      mockPrisma.wlClient.delete.mockRejectedValue(new Error('Delete failed'));

      const res = await request(app)
        .delete('/api/wl/clients/client-1')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to delete client');
    });
  });

  // ==================== CLIENTS: PATCH /clients/:id/status ====================
  describe('PATCH /api/wl/clients/:id/status', () => {
    it('should update client status to active (200)', async () => {
      const updatedClient = { ...mockClients[0], status: 'active' };
      mockPrisma.wlClient.findFirst.mockResolvedValue(mockClients[0]);
      mockPrisma.wlClient.update.mockResolvedValue(updatedClient);

      const res = await request(app)
        .patch('/api/wl/clients/client-1/status')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ status: 'active' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.client.status).toBe('active');
    });

    it('should update client status to pending (200)', async () => {
      const updatedClient = { ...mockClients[0], status: 'pending' };
      mockPrisma.wlClient.findFirst.mockResolvedValue(mockClients[0]);
      mockPrisma.wlClient.update.mockResolvedValue(updatedClient);

      const res = await request(app)
        .patch('/api/wl/clients/client-1/status')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ status: 'pending' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.client.status).toBe('pending');
    });

    it('should update client status to suspended (200)', async () => {
      const updatedClient = { ...mockClients[0], status: 'suspended' };
      mockPrisma.wlClient.findFirst.mockResolvedValue(mockClients[0]);
      mockPrisma.wlClient.update.mockResolvedValue(updatedClient);

      const res = await request(app)
        .patch('/api/wl/clients/client-1/status')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ status: 'suspended' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.client.status).toBe('suspended');
    });

    it('should reject invalid status (400)', async () => {
      const res = await request(app)
        .patch('/api/wl/clients/client-1/status')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ status: 'invalid' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Invalid status');
    });

    it('should return 404 when client not found', async () => {
      mockPrisma.wlClient.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .patch('/api/wl/clients/nonexistent/status')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ status: 'active' })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Client not found');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .patch('/api/wl/clients/client-1/status')
        .send({ status: 'active' })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wlClient.findFirst.mockResolvedValue(mockClients[0]);
      mockPrisma.wlClient.update.mockRejectedValue(new Error('Update failed'));

      const res = await request(app)
        .patch('/api/wl/clients/client-1/status')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ status: 'active' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to update status');
    });
  });

  // ==================== CLIENTS: GET /clients/stats ====================
  describe('GET /api/wl/clients/stats', () => {
    it('should return client statistics (200)', async () => {
      mockPrisma.wlClient.findMany.mockResolvedValue(mockClients);

      const res = await request(app)
        .get('/api/wl/clients/stats')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        total: 2,
        active: 1,
        pending: 1,
        suspended: 0,
      });
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/wl/clients/stats')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wlClient.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/wl/clients/stats')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to fetch stats');
    });
  });

  // ==================== BRANDING: GET /branding ====================
  describe('GET /api/wl/branding', () => {
    it('should return branding configuration (200)', async () => {
      mockPrisma.wlReseller.findUnique.mockResolvedValue(mockReseller);

      const res = await request(app)
        .get('/api/wl/branding')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        company: "Test Reseller's Company",
        domain: 'testreseller.resellerpro.com',
        logo: null,
        primaryColor: '#6366f1',
      });
    });

    it('should return 404 when reseller not found', async () => {
      mockPrisma.wlReseller.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/wl/branding')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Reseller not found');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .get('/api/wl/branding')
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wlReseller.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/api/wl/branding')
        .set('Authorization', 'Bearer valid_wl_token')
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to fetch branding');
    });
  });

  // ==================== BRANDING: PUT /branding ====================
  describe('PUT /api/wl/branding', () => {
    it('should update branding successfully (200)', async () => {
      const updatedReseller = {
        ...mockReseller,
        company: 'Updated Company',
        domain: 'updated.resellerpro.com',
        logo: 'https://example.com/logo.png',
        primaryColor: '#ff0000',
      };
      mockPrisma.wlReseller.findUnique.mockResolvedValue(mockReseller);
      mockPrisma.wlReseller.update.mockResolvedValue(updatedReseller);

      const res = await request(app)
        .put('/api/wl/branding')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({
          company: 'Updated Company',
          domain: 'updated.resellerpro.com',
          logo: 'https://example.com/logo.png',
          primaryColor: '#ff0000',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        company: 'Updated Company',
        domain: 'updated.resellerpro.com',
        logo: 'https://example.com/logo.png',
        primaryColor: '#ff0000',
      });
    });

    it('should update only provided fields', async () => {
      const updatedReseller = { ...mockReseller, company: 'Partial Update' };
      mockPrisma.wlReseller.findUnique.mockResolvedValue(mockReseller);
      mockPrisma.wlReseller.update.mockResolvedValue(updatedReseller);

      const res = await request(app)
        .put('/api/wl/branding')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ company: 'Partial Update' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.company).toBe('Partial Update');
      expect(mockPrisma.wlReseller.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ company: 'Partial Update' }),
        })
      );
    });

    it('should return 404 when reseller not found', async () => {
      mockPrisma.wlReseller.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/wl/branding')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ company: 'Test' })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Reseller not found');
    });

    it('should return 401 without authentication', async () => {
      setUnauthenticated();

      const res = await request(app)
        .put('/api/wl/branding')
        .send({ company: 'Test' })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wlReseller.findUnique.mockResolvedValue(mockReseller);
      mockPrisma.wlReseller.update.mockRejectedValue(new Error('Update failed'));

      const res = await request(app)
        .put('/api/wl/branding')
        .set('Authorization', 'Bearer valid_wl_token')
        .send({ company: 'Test' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to update branding');
    });
  });

  // ==================== PRODUCTS: GET /products ====================
  describe('GET /api/wl/products', () => {
    it('should return available products (200)', async () => {
      const res = await request(app)
        .get('/api/wl/products')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.products).toHaveLength(3);
      expect(res.body.data.products[0]).toMatchObject({
        id: 'google-reviews',
        name: 'AI Google Reviews QR',
        price: '₹499/mo',
      });
      expect(res.body.data.products[1]).toMatchObject({
        id: 'digital-vcard',
        name: 'Digital V-Card Maker',
        price: '₹399/mo',
      });
      expect(res.body.data.products[2]).toMatchObject({
        id: 'website-builder',
        name: 'Single Page Website Builder',
        price: '₹599/mo',
      });
    });

    it('should return 503 when white-label module is disabled', async () => {
      setWhiteLabelDisabled();
      const { default: disabledRoutes } = await import('../src/server/routes/white-label');
      const disabledApp = express();
      disabledApp.use(express.json());
      disabledApp.use('/api/wl', disabledRoutes);

      const res = await request(disabledApp)
        .get('/api/wl/products')
        .expect(503);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('White-label module not configured');
    });
  });
});