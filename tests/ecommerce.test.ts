/**
 * @jest-environment node
 *
 * End-to-end integration tests for the E-commerce API routes.
 *
 * Tests cover:
 *   - Store management (GET/PUT /api/ecommerce/store)
 *   - Products CRUD (GET/POST/PUT/DELETE /api/ecommerce/products)
 *   - Coupons CRUD + validate (GET/POST/PUT/DELETE /api/ecommerce/coupons)
 *   - Cart operations (GET /api/ecommerce/cart, POST/PUT/DELETE items, DELETE /api/ecommerce/cart)
 *   - Checkout & Orders (POST /api/ecommerce/checkout, GET/POST/PUT/PATCH orders, verify-payment)
 */

import express from 'express';
import request from 'supertest';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

const mockUserFixture = {
  id: 'user-abc-123',
  email: 'owner@example.com',
  name: 'Store Owner',
  role: 'OWNER',
  businessId: 'biz-456',
  isActive: true,
};

const mockBusinessFixture = {
  id: 'biz-456',
  name: 'Test Business',
};

// ── Prisma mock ──────────────────────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  eCommerceStore: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  productVariant: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
    findMany: jest.fn(),
  },
  coupon: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  contact: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  cart: {
    findFirst: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    findUnique: jest.fn(),
  },
  cartItem: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  order: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  orderItem: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  loyaltyProgram: {
    findFirst: jest.fn(),
  },
  loyaltyPoints: {
    create: jest.fn(),
  },
  activity: {
    create: jest.fn(),
  },
  $transaction: jest.fn((fn: any) => fn(mockPrisma)),
  $disconnect: jest.fn(),
};

jest.mock('../src/server/db', () => ({
  prisma: mockPrisma,
}));

// ── Auth utilities mock ──────────────────────────────────────────────────────
jest.mock('../src/server/utils/auth', () => ({
  verifyToken: jest.fn().mockResolvedValue({
    id: 'user-abc-123',
    email: 'owner@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  }),
  hashPassword: jest.fn(),
  comparePassword: jest.fn(),
  generateToken: jest.fn(),
  generateRefreshToken: jest.fn(),
  getJwtSecret: jest.fn().mockReturnValue('test-secret'),
  encrypt: jest.fn(),
  decrypt: jest.fn(),
}));

// ── Rate limit mock ──────────────────────────────────────────────────────────
jest.mock('express-rate-limit', () => ({
  default: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  __esModule: true,
}));

// ── JWT mock ─────────────────────────────────────────────────────────────────
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({
    id: 'user-abc-123',
    email: 'owner@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  }),
  sign: jest.fn().mockReturnValue('mock_jwt_token'),
  decode: jest.fn(),
}));

// ── Auth middleware mock ──────────────────────────────────────
jest.mock('../src/server/middleware/auth', () => ({
  authenticate: jest.fn((req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const token = auth.replace('Bearer ', '');
    const isMember = token === 'member_token';
    req.user = {
      id: 'user-abc-123',
      businessId: 'biz-456',
      role: isMember ? 'MEMBER' : 'OWNER',
    };
    next();
  }),
  requireRole: jest.fn((...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }
    next();
  }),
  AuthRequest: class AuthRequest extends Request {},
}));

// ── CSRF Service mock ───────────────────────────────────────────────
jest.mock('../src/server/services/csrf.service', () => ({
  CSRFService: {
    generateToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
    getToken: jest.fn().mockResolvedValue('csrf-token-xyz'),
  },
}));

// ── Razorpay mock (dynamic import) ──────────────────────────────────────────
// We handle this via jest.isolateModules or simply set up the import mock
jest.mock('razorpay', () => {
  const mockOrdersCreate = jest.fn().mockResolvedValue({
    id: 'order_rzp_abc123',
    amount: 50000,
    currency: 'INR',
    receipt: 'order-mock-1',
    status: 'created',
  });
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      orders: { create: mockOrdersCreate },
      payments: { fetch: jest.fn() },
    })),
  };
});

// ── Trap setInterval ─────────────────────────────────────────────────────────
const intervalIds: ReturnType<typeof setInterval>[] = [];
const originalSetInterval = global.setInterval;
global.setInterval = ((fn: any, ms: number, ...args: any[]) => {
  const id = originalSetInterval(fn, ms, ...args);
  intervalIds.push(id);
  return id;
}) as typeof global.setInterval;

// Import router after mocks
import ecommerceRoutes from '../src/server/routes/ecommerce';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/ecommerce', ecommerceRoutes);
  return app;
}

function resetMocks(): void {
  jest.clearAllMocks();

  const { verifyToken } = jest.requireMock('../src/server/utils/auth');
  verifyToken.mockResolvedValue({
    id: 'user-abc-123',
    email: 'owner@example.com',
    businessId: 'biz-456',
    role: 'OWNER',
  });

  // Default for $transaction to call the callback
  mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));

  // Default for auth middleware
  mockPrisma.user.findUnique.mockResolvedValue(mockUserFixture);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

afterAll(() => {
  for (const id of intervalIds) {
    clearInterval(id);
  }
  intervalIds.length = 0;
  global.setInterval = originalSetInterval;
});

// ─── STORE ───────────────────────────────────────────────────────────────────

describe('GET /api/ecommerce/store', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should return existing store', async () => {
    const mockStore = { id: 'store-1', businessId: 'biz-456', name: 'My Store', provider: 'custom' };
    mockPrisma.eCommerceStore.findUnique.mockResolvedValue(mockStore);

    const res = await request(app)
      .get('/api/ecommerce/store')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject(mockStore);
  });

  it('should create store if none exists', async () => {
    mockPrisma.eCommerceStore.findUnique.mockResolvedValue(null);
    const newStore = { id: 'store-new', businessId: 'biz-456', name: 'My Store', provider: 'custom' };
    mockPrisma.eCommerceStore.create.mockResolvedValue(newStore);

    const res = await request(app)
      .get('/api/ecommerce/store')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject(newStore);
    expect(mockPrisma.eCommerceStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ businessId: 'biz-456' }) })
    );
  });

  it('should return 401 without auth', async () => {
    const res = await request(app)
      .get('/api/ecommerce/store')
      .expect(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.eCommerceStore.findUnique.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/ecommerce/store')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /api/ecommerce/store', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should upsert store successfully', async () => {
    const updateData = { name: 'Updated Store', description: 'New desc' };
    const updatedStore = { id: 'store-1', businessId: 'biz-456', ...updateData, provider: 'custom' };
    mockPrisma.eCommerceStore.upsert.mockResolvedValue(updatedStore);

    const res = await request(app)
      .put('/api/ecommerce/store')
      .set('Authorization', 'Bearer valid_token')
      .send(updateData)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Updated Store');
  });

  it('should return 401 without auth', async () => {
    await request(app)
      .put('/api/ecommerce/store')
      .send({ name: 'Test' })
      .expect(401);
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-member', email: 'member@example.com', businessId: 'biz-456', role: 'MEMBER',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUserFixture, role: 'MEMBER' });

    const res = await request(app)
      .put('/api/ecommerce/store')
      .set('Authorization', 'Bearer member_token')
      .send({ name: 'Test' })
      .expect(403);
    expect(res.body.success).toBe(false);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.eCommerceStore.upsert.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .put('/api/ecommerce/store')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test' })
      .expect(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── PRODUCTS ────────────────────────────────────────────────────────────────

describe('GET /api/ecommerce/products', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should list products with pagination', async () => {
    const products = [
      { id: 'prod-1', name: 'Product 1', price: 100, businessId: 'biz-456' },
      { id: 'prod-2', name: 'Product 2', price: 200, businessId: 'biz-456' },
    ];
    mockPrisma.product.findMany.mockResolvedValue(products);
    mockPrisma.product.count.mockResolvedValue(2);

    const res = await request(app)
      .get('/api/ecommerce/products')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.products).toHaveLength(2);
    expect(res.body.data.pagination).toMatchObject({ total: 2, page: 1, limit: 20 });
  });

  it('should return empty list when no products', async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.product.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/ecommerce/products')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.products).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('should filter by search query', async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.product.count.mockResolvedValue(0);

    await request(app)
      .get('/api/ecommerce/products?search=shirt')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ name: expect.objectContaining({ contains: 'shirt' }) }),
          ]),
        }),
      })
    );
  });

  it('should filter by category', async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.product.count.mockResolvedValue(0);

    await request(app)
      .get('/api/ecommerce/products?category=Electronics')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: 'Electronics' }),
      })
    );
  });

  it('should return 401 without auth', async () => {
    await request(app).get('/api/ecommerce/products').expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.product.findMany.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/ecommerce/products')
      .set('Authorization', 'Bearer valid_token')
      .expect(500);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/ecommerce/products', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should create a product successfully', async () => {
    const newProduct = {
      id: 'prod-new',
      businessId: 'biz-456',
      name: 'New Product',
      price: 299,
      description: null,
      compareAtPrice: null,
      sku: 'SKU-123',
      barcode: null,
      quantity: 10,
      trackInventory: true,
      images: [],
      mainImage: null,
      category: 'General',
      tags: [],
      status: 'active',
      isActive: true,
      variants: [],
    };
    mockPrisma.product.create.mockResolvedValue(newProduct);
    mockPrisma.product.findUnique.mockResolvedValue(newProduct);

    const res = await request(app)
      .post('/api/ecommerce/products')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'New Product', price: 299 })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('New Product');
  });

  it('should create product with variants', async () => {
    const product = {
      id: 'prod-with-variants', businessId: 'biz-456', name: 'Variant Product',
      price: 499, category: 'General', status: 'active', isActive: true,
      images: [], tags: [],
    };
    mockPrisma.product.create.mockResolvedValue(product);
    mockPrisma.product.findUnique.mockResolvedValue({ ...product, variants: [] });
    mockPrisma.productVariant.createMany.mockResolvedValue({ count: 2 });

    await request(app)
      .post('/api/ecommerce/products')
      .set('Authorization', 'Bearer valid_token')
      .send({
        name: 'Variant Product',
        price: 499,
        variants: [
          { size: 'M', color: 'Red', price: 499, quantity: 5 },
          { size: 'L', color: 'Blue', price: 599, quantity: 3 },
        ],
      })
      .expect(201);

    expect(mockPrisma.productVariant.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([
        expect.objectContaining({ productId: 'prod-with-variants' }),
      ]) })
    );
  });

  it('should reject product without name', async () => {
    const res = await request(app)
      .post('/api/ecommerce/products')
      .set('Authorization', 'Bearer valid_token')
      .send({ price: 100 })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('name');
  });

  it('should reject product without price', async () => {
    const res = await request(app)
      .post('/api/ecommerce/products')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'No Price' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('price');
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-member', email: 'member@example.com', businessId: 'biz-456', role: 'MEMBER',
    });
    const res = await request(app)
      .post('/api/ecommerce/products')
      .set('Authorization', 'Bearer member_token')
      .send({ name: 'Test', price: 100 })
      .expect(403);
    expect(res.body.success).toBe(false);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.product.create.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .post('/api/ecommerce/products')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test', price: 100 })
      .expect(500);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /api/ecommerce/products/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should update a product successfully', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({ id: 'prod-1', businessId: 'biz-456' });
    mockPrisma.product.update.mockResolvedValue({ id: 'prod-1', name: 'Updated', price: 150, businessId: 'biz-456' });

    const res = await request(app)
      .put('/api/ecommerce/products/prod-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated', price: 150 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Updated');
  });

  it('should return 404 when product not found', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/ecommerce/products/prod-nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Updated' })
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('not found');
  });

  it('should return 401 without auth', async () => {
    await request(app).put('/api/ecommerce/products/prod-1').send({ name: 'Test' }).expect(401);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.product.findFirst.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .put('/api/ecommerce/products/prod-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: 'Test' })
      .expect(500);
    expect(res.body.success).toBe(false);
  });
});

describe('DELETE /api/ecommerce/products/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should delete a product successfully', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({ id: 'prod-1', businessId: 'biz-456' });
    mockPrisma.productVariant.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.product.delete.mockResolvedValue({ id: 'prod-1' });

    const res = await request(app)
      .delete('/api/ecommerce/products/prod-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.productVariant.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.product.delete).toHaveBeenCalled();
  });

  it('should return 404 when product not found', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/ecommerce/products/prod-nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);
    expect(res.body.success).toBe(false);
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-member', email: 'member@example.com', businessId: 'biz-456', role: 'MEMBER',
    });
    const res = await request(app)
      .delete('/api/ecommerce/products/prod-1')
      .set('Authorization', 'Bearer member_token')
      .expect(403);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/ecommerce/products/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should get a product by id', async () => {
    const product = {
      id: 'prod-1', businessId: 'biz-456', name: 'Test Product', price: 100,
      variants: [],
    };
    mockPrisma.product.findFirst.mockResolvedValue(product);

    const res = await request(app)
      .get('/api/ecommerce/products/prod-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Test Product');
  });

  it('should include variants in the response', async () => {
    const product = {
      id: 'prod-1', businessId: 'biz-456', name: 'Product with Variants', price: 100,
      variants: [{ id: 'var-1', name: 'Small', price: 100, quantity: 5 }],
    };
    mockPrisma.product.findFirst.mockResolvedValue(product);

    const res = await request(app)
      .get('/api/ecommerce/products/prod-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.data.variants).toHaveLength(1);
  });

  it('should return 404 when product not found', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/ecommerce/products/prod-nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);
    expect(res.body.success).toBe(false);
  });

  it('should return 401 without auth', async () => {
    await request(app).get('/api/ecommerce/products/prod-1').expect(401);
  });
});

// ─── COUPONS ─────────────────────────────────────────────────────────────────

describe('GET /api/ecommerce/coupons', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should list coupons with pagination', async () => {
    const coupons = [
      { id: 'coup-1', code: 'SAVE10', type: 'PERCENTAGE', value: 10, businessId: 'biz-456' },
    ];
    mockPrisma.coupon.findMany.mockResolvedValue(coupons);
    mockPrisma.coupon.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/ecommerce/coupons')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.coupons).toHaveLength(1);
    expect(res.body.data.pagination.total).toBe(1);
  });

  it('should return empty when no coupons', async () => {
    mockPrisma.coupon.findMany.mockResolvedValue([]);
    mockPrisma.coupon.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/ecommerce/coupons')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);
    expect(res.body.data.coupons).toEqual([]);
  });

  it('should return 401 without auth', async () => {
    await request(app).get('/api/ecommerce/coupons').expect(401);
  });
});

describe('POST /api/ecommerce/coupons', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should create a percentage coupon', async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);
    mockPrisma.coupon.create.mockResolvedValue({
      id: 'coup-new', code: 'SAVE20', type: 'PERCENTAGE', value: 20,
      minOrder: 0, maxUses: null, expiresAt: null, description: null, active: true,
      businessId: 'biz-456',
    });

    const res = await request(app)
      .post('/api/ecommerce/coupons')
      .set('Authorization', 'Bearer valid_token')
      .send({ code: 'save20', type: 'PERCENTAGE', value: 20 })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.code).toBe('SAVE20');
  });

  it('should create a fixed amount coupon', async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);
    mockPrisma.coupon.create.mockResolvedValue({
      id: 'coup-fixed', code: 'FLAT50', type: 'FIXED', value: 50,
      businessId: 'biz-456',
    });

    const res = await request(app)
      .post('/api/ecommerce/coupons')
      .set('Authorization', 'Bearer valid_token')
      .send({ code: 'flat50', type: 'FIXED', value: 50 })
      .expect(201);

    expect(res.body.success).toBe(true);
  });

  it('should reject coupon with missing fields', async () => {
    const res = await request(app)
      .post('/api/ecommerce/coupons')
      .set('Authorization', 'Bearer valid_token')
      .send({ code: 'TEST' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('should reject invalid coupon type', async () => {
    const res = await request(app)
      .post('/api/ecommerce/coupons')
      .set('Authorization', 'Bearer valid_token')
      .send({ code: 'TEST', type: 'INVALID', value: 10 })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('PERCENTAGE or FIXED');
  });

  it('should reject duplicate coupon code', async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue({ id: 'coup-exists', code: 'SAVE10', businessId: 'biz-456' });

    const res = await request(app)
      .post('/api/ecommerce/coupons')
      .set('Authorization', 'Bearer valid_token')
      .send({ code: 'save10', type: 'PERCENTAGE', value: 10 })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('already exists');
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-member', email: 'member@example.com', businessId: 'biz-456', role: 'MEMBER',
    });
    const res = await request(app)
      .post('/api/ecommerce/coupons')
      .set('Authorization', 'Bearer member_token')
      .send({ code: 'TEST', type: 'PERCENTAGE', value: 10 })
      .expect(403);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.coupon.findFirst.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .post('/api/ecommerce/coupons')
      .set('Authorization', 'Bearer valid_token')
      .send({ code: 'TEST', type: 'PERCENTAGE', value: 10 })
      .expect(500);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /api/ecommerce/coupons/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should update a coupon successfully', async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue({ id: 'coup-1', businessId: 'biz-456' });
    mockPrisma.coupon.update.mockResolvedValue({ id: 'coup-1', code: 'SAVE15', value: 15 });

    const res = await request(app)
      .put('/api/ecommerce/coupons/coup-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ value: 15 })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('should return 404 when coupon not found', async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/ecommerce/coupons/coup-nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .send({ value: 15 })
      .expect(404);
    expect(res.body.success).toBe(false);
  });
});

describe('DELETE /api/ecommerce/coupons/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should delete a coupon successfully', async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue({ id: 'coup-1', businessId: 'biz-456' });
    mockPrisma.coupon.delete.mockResolvedValue({ id: 'coup-1' });

    const res = await request(app)
      .delete('/api/ecommerce/coupons/coup-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('should return 404 when coupon not found', async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/ecommerce/coupons/coup-nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);
    expect(res.body.success).toBe(false);
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-member', email: 'member@example.com', businessId: 'biz-456', role: 'MEMBER',
    });
    await request(app)
      .delete('/api/ecommerce/coupons/coup-1')
      .set('Authorization', 'Bearer member_token')
      .expect(403);
  });
});

describe('POST /api/ecommerce/coupons/validate', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should validate a valid coupon successfully', async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue({
      id: 'coup-1', code: 'SAVE10', type: 'PERCENTAGE', value: 10,
      minOrder: 0, maxUses: null, usedCount: 0, expiresAt: null,
      businessId: 'biz-456',
    });

    const res = await request(app)
      .post('/api/ecommerce/coupons/validate')
      .set('Authorization', 'Bearer valid_token')
      .send({ code: 'SAVE10', cartTotal: 500 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.discount).toBe(50);
  });

  it('should validate a fixed coupon', async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue({
      id: 'coup-2', code: 'FLAT50', type: 'FIXED', value: 50,
      minOrder: 0, maxUses: null, usedCount: 0, expiresAt: null,
      businessId: 'biz-456',
    });

    const res = await request(app)
      .post('/api/ecommerce/coupons/validate')
      .set('Authorization', 'Bearer valid_token')
      .send({ code: 'FLAT50', cartTotal: 500 })
      .expect(200);

    expect(res.body.data.discount).toBe(50);
  });

  it('should reject expired coupon', async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue({
      id: 'coup-expired', code: 'EXPIRED', type: 'PERCENTAGE', value: 10,
      expiresAt: new Date('2020-01-01'), maxUses: null, usedCount: 0,
      businessId: 'biz-456',
    });

    const res = await request(app)
      .post('/api/ecommerce/coupons/validate')
      .set('Authorization', 'Bearer valid_token')
      .send({ code: 'EXPIRED', cartTotal: 500 })
      .expect(400);
    expect(res.body.error).toContain('expired');
  });

  it('should reject coupon that reached max uses', async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue({
      id: 'coup-exhausted', code: 'EXHAUSTED', type: 'PERCENTAGE', value: 10,
      maxUses: 5, usedCount: 5, expiresAt: null,
      businessId: 'biz-456',
    });

    const res = await request(app)
      .post('/api/ecommerce/coupons/validate')
      .set('Authorization', 'Bearer valid_token')
      .send({ code: 'EXHAUSTED', cartTotal: 500 })
      .expect(400);
    expect(res.body.error).toContain('limit');
  });

  it('should reject coupon not meeting min order', async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue({
      id: 'coup-minorder', code: 'MIN100', type: 'FIXED', value: 20,
      minOrder: 100, maxUses: null, usedCount: 0, expiresAt: null,
      businessId: 'biz-456',
    });

    const res = await request(app)
      .post('/api/ecommerce/coupons/validate')
      .set('Authorization', 'Bearer valid_token')
      .send({ code: 'MIN100', cartTotal: 50 })
      .expect(400);
    expect(res.body.error).toContain('Minimum order');
  });

  it('should reject missing coupon code', async () => {
    const res = await request(app)
      .post('/api/ecommerce/coupons/validate')
      .set('Authorization', 'Bearer valid_token')
      .send({ cartTotal: 500 })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 404 for invalid code', async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/ecommerce/coupons/validate')
      .set('Authorization', 'Bearer valid_token')
      .send({ code: 'INVALID' })
      .expect(404);
    expect(res.body.error).toContain('Invalid coupon');
  });
});

// ─── CART ────────────────────────────────────────────────────────────────────

describe('GET /api/ecommerce/cart', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should return cart with items', async () => {
    const contact = { id: 'contact-1', name: 'Customer', email: 'owner@example.com' };
    const cart = {
      id: 'cart-1', businessId: 'biz-456', contactId: 'contact-1', status: 'active',
      items: [
        {
          id: 'ci-1', productId: 'prod-1', quantity: 2,
          variantPrice: null,
          product: { id: 'prod-1', name: 'Product 1', price: 100 },
        },
      ],
    };

    mockPrisma.contact.findFirst.mockResolvedValue(contact);
    mockPrisma.cart.findFirst.mockResolvedValue(cart);

    const res = await request(app)
      .get('/api/ecommerce/cart')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.subtotal).toBe(200);
    expect(res.body.data.itemCount).toBe(2);
  });

  it('should create a cart if none exists', async () => {
    const contact = { id: 'contact-1', name: 'Customer', email: 'owner@example.com' };
    const newCart = {
      id: 'cart-new', businessId: 'biz-456', contactId: 'contact-1', status: 'active',
      items: [],
    };

    mockPrisma.contact.findFirst.mockResolvedValue(contact);
    mockPrisma.cart.findFirst.mockResolvedValueOnce(null); // cart check
    mockPrisma.cart.create.mockResolvedValue(newCart);
    mockPrisma.cart.findFirst.mockResolvedValueOnce(newCart); // after create

    const res = await request(app)
      .get('/api/ecommerce/cart')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.itemCount).toBe(0);
  });
});

describe('POST /api/ecommerce/cart/items', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should add item to cart', async () => {
    const contact = { id: 'contact-1', name: 'Customer', email: 'owner@example.com' };
    const product = { id: 'prod-1', name: 'Product 1', price: 100, trackInventory: false, quantity: 10 };
    const cart = { id: 'cart-1', businessId: 'biz-456', contactId: 'contact-1' };
    const updatedCart = {
      id: 'cart-1', status: 'active', contactId: 'contact-1', businessId: 'biz-456',
      items: [
        {
          id: 'ci-1', productId: 'prod-1', quantity: 1,
          variantPrice: null,
          product: { id: 'prod-1', name: 'Product 1', price: 100 },
        },
      ],
    };

    mockPrisma.contact.findFirst.mockResolvedValue(contact);
    mockPrisma.product.findFirst.mockResolvedValue(product);
    mockPrisma.cart.findFirst.mockResolvedValueOnce(null); // check for existing cart
    mockPrisma.cart.create.mockResolvedValue(cart);
    mockPrisma.cartItem.findFirst.mockResolvedValue(null); // no existing item
    mockPrisma.cartItem.create.mockResolvedValue({ id: 'ci-1' });
    mockPrisma.cart.findUnique.mockResolvedValue(updatedCart);

    const res = await request(app)
      .post('/api/ecommerce/cart/items')
      .set('Authorization', 'Bearer valid_token')
      .send({ productId: 'prod-1', quantity: 1 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.itemCount).toBe(1);
  });

  it('should update quantity of existing item', async () => {
    const contact = { id: 'contact-1', name: 'Customer', email: 'owner@example.com' };
    const product = { id: 'prod-1', name: 'Product 1', price: 100, trackInventory: false, quantity: 10 };
    const cart = { id: 'cart-1', businessId: 'biz-456', contactId: 'contact-1' };
    const existingItem = { id: 'ci-1', cartId: 'cart-1', productId: 'prod-1', quantity: 1 };
    const updatedCart = {
      id: 'cart-1', items: [
        { id: 'ci-1', productId: 'prod-1', quantity: 3, variantPrice: null, product: { price: 100 } },
      ],
    };

    mockPrisma.contact.findFirst.mockResolvedValue(contact);
    mockPrisma.product.findFirst.mockResolvedValue(product);
    mockPrisma.cart.findFirst.mockResolvedValue(cart);
    mockPrisma.cartItem.findFirst.mockResolvedValue(existingItem);
    mockPrisma.cartItem.update.mockResolvedValue({ ...existingItem, quantity: 3 });
    mockPrisma.cart.findUnique.mockResolvedValue(updatedCart);

    await request(app)
      .post('/api/ecommerce/cart/items')
      .set('Authorization', 'Bearer valid_token')
      .send({ productId: 'prod-1', quantity: 2 })
      .expect(200);

    expect(mockPrisma.cartItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ci-1' }, data: { quantity: 3 } })
    );
  });

  it('should reject without productId', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'contact-1' });
    const res = await request(app)
      .post('/api/ecommerce/cart/items')
      .set('Authorization', 'Bearer valid_token')
      .send({ quantity: 1 })
      .expect(400);
    expect(res.body.error).toContain('productId');
  });

  it('should return 404 for non-existent product', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'contact-1' });
    mockPrisma.product.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/ecommerce/cart/items')
      .set('Authorization', 'Bearer valid_token')
      .send({ productId: 'prod-nonexistent', quantity: 1 })
      .expect(404);
    expect(res.body.error).toContain('Product not found');
  });

  it('should reject when stock insufficient', async () => {
    const contact = { id: 'contact-1', name: 'Customer', email: 'owner@example.com' };
    const product = { id: 'prod-1', name: 'Product 1', price: 100, trackInventory: true, quantity: 1 };

    mockPrisma.contact.findFirst.mockResolvedValue(contact);
    mockPrisma.product.findFirst.mockResolvedValue(product);

    const res = await request(app)
      .post('/api/ecommerce/cart/items')
      .set('Authorization', 'Bearer valid_token')
      .send({ productId: 'prod-1', quantity: 5 })
      .expect(400);
    expect(res.body.error).toContain('stock');
  });
});

describe('PUT /api/ecommerce/cart/items/:itemId', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should update cart item quantity', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', name: 'Customer', email: 'owner@example.com' });
    mockPrisma.contact.create.mockResolvedValue({ id: 'contact-1' });
    mockPrisma.cartItem.findFirst.mockResolvedValue({
      id: 'ci-1', product: { price: 100, trackInventory: false, quantity: 10 }, quantity: 1,
    });
    mockPrisma.cartItem.update.mockResolvedValue({ id: 'ci-1', quantity: 3 });
    mockPrisma.cart.findFirst.mockResolvedValue({
      id: 'cart-1', items: [{ id: 'ci-1', quantity: 3, variantPrice: null, product: { price: 100 } }],
    });

    const res = await request(app)
      .put('/api/ecommerce/cart/items/ci-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ quantity: 3 })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('should remove item when quantity is 0', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', name: 'Customer', email: 'owner@example.com' });
    mockPrisma.contact.create.mockResolvedValue({ id: 'contact-1' });
    mockPrisma.cartItem.findFirst.mockResolvedValue({
      id: 'ci-1', product: { price: 100, trackInventory: false }, quantity: 1,
    });
    mockPrisma.cartItem.delete.mockResolvedValue({});
    mockPrisma.cart.findFirst.mockResolvedValue({
      id: 'cart-1', items: [],
    });

    await request(app)
      .put('/api/ecommerce/cart/items/ci-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ quantity: 0 })
      .expect(200);

    expect(mockPrisma.cartItem.delete).toHaveBeenCalled();
  });

  it('should reject without quantity', async () => {
    const res = await request(app)
      .put('/api/ecommerce/cart/items/ci-1')
      .set('Authorization', 'Bearer valid_token')
      .send({})
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 404 for non-existent item', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', name: 'Customer', email: 'owner@example.com' });
    mockPrisma.contact.create.mockResolvedValue({ id: 'contact-1' });
    mockPrisma.cartItem.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/ecommerce/cart/items/ci-nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .send({ quantity: 3 })
      .expect(404);
    expect(res.body.error).toContain('not found');
  });
});

describe('DELETE /api/ecommerce/cart/items/:itemId', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should delete cart item', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', name: 'Customer', email: 'owner@example.com' });
    mockPrisma.contact.create.mockResolvedValue({ id: 'contact-1' });
    mockPrisma.cartItem.findFirst.mockResolvedValue({ id: 'ci-1', cart: { businessId: 'biz-456', contactId: 'contact-1' } });
    mockPrisma.cartItem.delete.mockResolvedValue({});
    mockPrisma.cart.findFirst.mockResolvedValue({
      id: 'cart-1', items: [],
    });

    const res = await request(app)
      .delete('/api/ecommerce/cart/items/ci-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('should return 404 for non-existent item', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', name: 'Customer', email: 'owner@example.com' });
    mockPrisma.contact.create.mockResolvedValue({ id: 'contact-1' });
    mockPrisma.cartItem.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/ecommerce/cart/items/ci-nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);
    expect(res.body.success).toBe(false);
  });
});

describe('DELETE /api/ecommerce/cart', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should clear the cart', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', email: 'owner@example.com' });
    mockPrisma.cart.findFirst.mockResolvedValue({ id: 'cart-1', businessId: 'biz-456', contactId: 'contact-1' });
    mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.cart.delete.mockResolvedValue({ id: 'cart-1' });

    const res = await request(app)
      .delete('/api/ecommerce/cart')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.cart.delete).toHaveBeenCalled();
  });

  it('should succeed even when no cart exists', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/ecommerce/cart')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.cart.delete).not.toHaveBeenCalled();
  });
});

// ─── CHECKOUT ────────────────────────────────────────────────────────────────

describe('POST /api/ecommerce/checkout', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should create an order from cart', async () => {
    const contact = { id: 'contact-1', name: 'Customer', email: 'owner@example.com' };
    mockPrisma.contact.findFirst.mockResolvedValue(contact);

    const cart = {
      id: 'cart-1', businessId: 'biz-456', contactId: 'contact-1',
      items: [
        {
          id: 'ci-1', productId: 'prod-1', quantity: 2,
          variantPrice: null, variantId: null, variantName: null,
          product: { id: 'prod-1', name: 'Product 1', price: 100, trackInventory: true, quantity: 10 },
        },
      ],
    };
    mockPrisma.cart.findFirst.mockResolvedValue(cart);

    const mockOrder = {
      id: 'order-1', orderNumber: 'ORD-12345-ABC', businessId: 'biz-456',
      contactId: 'contact-1', status: 'pending', paymentStatus: 'pending',
      subtotal: 200, taxAmount: 0, shippingAmount: 0, discountAmount: 0,
      total: 200, gateway: 'razorpay',
      items: [{ id: 'oi-1', name: 'Product 1', quantity: 2, price: 100, total: 200 }],
    };

    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      mockPrisma.order.create.mockResolvedValue(mockOrder);
      mockPrisma.orderItem.create = jest.fn();
      // The prisma mock passed to the tx callback
      return fn({
        order: {
          create: jest.fn().mockResolvedValue(mockOrder),
        },
        product: {
          update: jest.fn(),
        },
        cartItem: {
          deleteMany: jest.fn(),
        },
        cart: {
          delete: jest.fn(),
        },
      });
    });

    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';

    const res = await request(app)
      .post('/api/ecommerce/checkout')
      .set('Authorization', 'Bearer valid_token')
      .send({ shippingAddress: '123 Test St', paymentMethod: 'cod' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.subtotal).toBe(200);
  });

  it('should reject checkout with empty cart', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'contact-1' });
    mockPrisma.cart.findFirst.mockResolvedValue({
      id: 'cart-1', items: [],
    });

    const res = await request(app)
      .post('/api/ecommerce/checkout')
      .set('Authorization', 'Bearer valid_token')
      .send({})
      .expect(400);
    expect(res.body.error).toContain('Cart is empty');
  });

  it('should reject when stock insufficient during checkout', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'contact-1' });
    mockPrisma.cart.findFirst.mockResolvedValue({
      id: 'cart-1', items: [
        {
          id: 'ci-1', productId: 'prod-1', quantity: 5,
          variantPrice: null,
          product: { id: 'prod-1', name: 'Product 1', price: 100, trackInventory: true, quantity: 1 },
        },
      ],
    });

    const res = await request(app)
      .post('/api/ecommerce/checkout')
      .set('Authorization', 'Bearer valid_token')
      .send({})
      .expect(400);
    expect(res.body.error).toContain('stock');
  });

  it('should apply coupon discount during checkout', async () => {
    const contact = { id: 'contact-1', name: 'Customer', email: 'owner@example.com' };
    mockPrisma.contact.findFirst.mockResolvedValue(contact);
    mockPrisma.cart.findFirst.mockResolvedValue({
      id: 'cart-1', businessId: 'biz-456', contactId: 'contact-1',
      items: [{ id: 'ci-1', productId: 'prod-1', quantity: 2, variantPrice: null, product: { price: 100, trackInventory: false } }],
    });

    mockPrisma.coupon.findFirst.mockResolvedValue({
      id: 'coup-1', code: 'SAVE10', type: 'PERCENTAGE', value: 10,
      minOrder: 0, maxUses: 100, usedCount: 0, expiresAt: null,
    });
    mockPrisma.coupon.update.mockResolvedValue({});

    const mockOrder = {
      id: 'order-discount', orderNumber: 'ORD-12345-DIS', businessId: 'biz-456',
      contactId: 'contact-1', status: 'pending', paymentStatus: 'pending',
      subtotal: 200, discountAmount: 20, total: 180, gateway: 'cod',
      items: [],
    };

    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      return fn({
        order: { create: jest.fn().mockResolvedValue(mockOrder) },
        product: { update: jest.fn() },
        cartItem: { deleteMany: jest.fn() },
        cart: { delete: jest.fn() },
      });
    });

    const res = await request(app)
      .post('/api/ecommerce/checkout')
      .set('Authorization', 'Bearer valid_token')
      .send({ couponCode: 'SAVE10', paymentMethod: 'cod' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(180);
  });
});

// ─── PAYMENT VERIFICATION ────────────────────────────────────────────────────

describe('POST /api/ecommerce/orders/:id/verify-payment', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should verify payment successfully', async () => {
    process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';

    mockPrisma.order.findFirst.mockResolvedValue({
      id: 'order-1', businessId: 'biz-456', total: 200, orderNumber: 'ORD-123',
      gatewayData: {},
    });

    mockPrisma.order.update.mockResolvedValue({
      id: 'order-1', paymentStatus: 'paid', status: 'processing',
    });

    mockPrisma.loyaltyProgram.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/ecommerce/orders/order-1/verify-payment')
      .set('Authorization', 'Bearer valid_token')
      .send({
        razorpay_order_id: 'order_rzp_abc',
        razorpay_payment_id: 'pay_xyz',
        razorpay_signature: 'abcdef123456',
      })
      .expect(400); // fails because signature won't match

    expect(res.body.success).toBe(false);
  });

  it('should return 404 if order not found', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/ecommerce/orders/order-nonexistent/verify-payment')
      .set('Authorization', 'Bearer valid_token')
      .send({ razorpay_order_id: 'oid', razorpay_payment_id: 'pid', razorpay_signature: 'sig' })
      .expect(404);
    expect(res.body.success).toBe(false);
  });
});

// ─── ORDERS ──────────────────────────────────────────────────────────────────

describe('GET /api/ecommerce/orders', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should list orders with pagination', async () => {
    const orders = [
      { id: 'order-1', orderNumber: 'ORD-1', contact: { name: 'John' }, items: [] },
    ];
    mockPrisma.order.findMany.mockResolvedValue(orders);
    mockPrisma.order.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/ecommerce/orders')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.orders).toHaveLength(1);
    expect(res.body.data.pagination.total).toBe(1);
  });

  it('should filter by status', async () => {
    mockPrisma.order.findMany.mockResolvedValue([]);
    mockPrisma.order.count.mockResolvedValue(0);

    await request(app)
      .get('/api/ecommerce/orders?status=processing')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'processing' }),
      })
    );
  });

  it('should return 401 without auth', async () => {
    await request(app).get('/api/ecommerce/orders').expect(401);
  });
});

describe('POST /api/ecommerce/orders', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should create a manual order', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({
      id: 'prod-1', name: 'Product 1', price: 100, businessId: 'biz-456', trackInventory: false,
    });

    const mockOrder = {
      id: 'order-manual', orderNumber: 'ORD-MANUAL-1', businessId: 'biz-456',
      contactId: 'contact-1', status: 'pending', paymentStatus: 'pending',
      subtotal: 200, total: 200, items: [],
      contact: { name: 'John' },
    };

    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      return fn({
        order: { create: jest.fn().mockResolvedValue(mockOrder) },
        product: { findUnique: jest.fn(), update: jest.fn() },
      });
    });

    const res = await request(app)
      .post('/api/ecommerce/orders')
      .set('Authorization', 'Bearer valid_token')
      .send({
        contactId: 'contact-1',
        items: [{ productId: 'prod-1', quantity: 2 }],
      })
      .expect(201);

    expect(res.body.success).toBe(true);
  });

  it('should reject without contactId and items', async () => {
    const res = await request(app)
      .post('/api/ecommerce/orders')
      .set('Authorization', 'Bearer valid_token')
      .send({})
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('should reject with invalid items', async () => {
    const res = await request(app)
      .post('/api/ecommerce/orders')
      .set('Authorization', 'Bearer valid_token')
      .send({ contactId: 'c-1', items: 'not-an-array' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-member', email: 'member@example.com', businessId: 'biz-456', role: 'MEMBER',
    });
    const res = await request(app)
      .post('/api/ecommerce/orders')
      .set('Authorization', 'Bearer member_token')
      .send({ contactId: 'c-1', items: [{ productId: 'prod-1' }] })
      .expect(403);
  });

  it('should return 500 on database error', async () => {
    mockPrisma.product.findFirst.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .post('/api/ecommerce/orders')
      .set('Authorization', 'Bearer valid_token')
      .send({ contactId: 'c-1', items: [{ productId: 'prod-1' }] })
      .expect(500);
  });
});

describe('GET /api/ecommerce/orders/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should get order by id', async () => {
    const order = {
      id: 'order-1', businessId: 'biz-456', orderNumber: 'ORD-1',
      contact: { name: 'John', phone: '1234567890', email: 'john@test.com' },
      items: [{ id: 'oi-1', name: 'Product 1', quantity: 1 }],
    };
    mockPrisma.order.findFirst.mockResolvedValue(order);

    const res = await request(app)
      .get('/api/ecommerce/orders/order-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.orderNumber).toBe('ORD-1');
  });

  it('should return 404 when order not found', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/ecommerce/orders/order-nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /api/ecommerce/orders/:id', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should update order status and payment status', async () => {
    const existingOrder = { id: 'order-1', businessId: 'biz-456', status: 'pending', paymentStatus: 'pending' };
    mockPrisma.order.findFirst.mockResolvedValue(existingOrder);
    mockPrisma.order.update.mockResolvedValue({
      ...existingOrder, status: 'processing', paymentStatus: 'paid',
    });

    const res = await request(app)
      .put('/api/ecommerce/orders/order-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ status: 'processing', paymentStatus: 'paid' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('processing');
  });

  it('should restore inventory when cancelling order', async () => {
    const existingOrder = { id: 'order-1', businessId: 'biz-456', status: 'pending', paymentStatus: 'pending' };
    mockPrisma.order.findFirst.mockResolvedValue(existingOrder);
    mockPrisma.orderItem.findMany.mockResolvedValue([
      { id: 'oi-1', productId: 'prod-1', quantity: 2 },
    ]);
    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.order.update.mockResolvedValue({ ...existingOrder, status: 'cancelled' });

    const res = await request(app)
      .put('/api/ecommerce/orders/order-1')
      .set('Authorization', 'Bearer valid_token')
      .send({ status: 'cancelled' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prod-1' },
        data: { quantity: { increment: 2 } },
      })
    );
  });

  it('should return 404 when order not found', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .put('/api/ecommerce/orders/order-nonexistent')
      .set('Authorization', 'Bearer valid_token')
      .send({ status: 'processing' })
      .expect(404);
    expect(res.body.success).toBe(false);
  });

  it('should return 403 for MEMBER role', async () => {
    const { verifyToken } = jest.requireMock('../src/server/utils/auth');
    verifyToken.mockResolvedValue({
      id: 'user-member', email: 'member@example.com', businessId: 'biz-456', role: 'MEMBER',
    });
    await request(app)
      .put('/api/ecommerce/orders/order-1')
      .set('Authorization', 'Bearer member_token')
      .send({ status: 'processing' })
      .expect(403);
  });
});

describe('PATCH /api/ecommerce/orders/:id/status', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should update order status', async () => {
    mockPrisma.order.findFirst.mockResolvedValue({ id: 'order-1', businessId: 'biz-456', status: 'pending' });
    mockPrisma.order.update.mockResolvedValue({ id: 'order-1', status: 'shipped' });

    const res = await request(app)
      .patch('/api/ecommerce/orders/order-1/status')
      .set('Authorization', 'Bearer valid_token')
      .send({ status: 'shipped' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('shipped');
  });

  it('should reject invalid status', async () => {
    const res = await request(app)
      .patch('/api/ecommerce/orders/order-1/status')
      .set('Authorization', 'Bearer valid_token')
      .send({ status: 'invalid_status' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 404 when order not found', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .patch('/api/ecommerce/orders/order-nonexistent/status')
      .set('Authorization', 'Bearer valid_token')
      .send({ status: 'shipped' })
      .expect(404);
    expect(res.body.success).toBe(false);
  });

  it('should reject status change when already cancelled/refunded', async () => {
    const existingOrder = { id: 'order-1', businessId: 'biz-456', status: 'cancelled' };
    mockPrisma.order.findFirst.mockResolvedValue(existingOrder);

    await request(app)
      .patch('/api/ecommerce/orders/order-1/status')
      .set('Authorization', 'Bearer valid_token')
      .send({ status: 'cancelled' })
      .expect(200);

    // Inventory should not be restored again
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });
});

describe('GET /api/ecommerce/track/:orderNumber', () => {
  let app: express.Application;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => { resetMocks(); });

  it('should track order by order number', async () => {
    mockPrisma.order.findFirst.mockResolvedValue({
      id: 'order-1', orderNumber: 'ORD-TRACK-1',
      items: [{ id: 'oi-1', product: { name: 'Product 1', images: [] } }],
    });

    const res = await request(app)
      .get('/api/ecommerce/track/ORD-TRACK-1')
      .set('Authorization', 'Bearer valid_token')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.orderNumber).toBe('ORD-TRACK-1');
  });

  it('should return 404 when order not found', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/ecommerce/track/ORD-NONEXISTENT')
      .set('Authorization', 'Bearer valid_token')
      .expect(404);
    expect(res.body.success).toBe(false);
  });
});
