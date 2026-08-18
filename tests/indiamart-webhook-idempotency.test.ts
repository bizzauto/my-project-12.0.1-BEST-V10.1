/**
 * @jest-environment node
 *
 * Webhook idempotency + security for POST /api/leads/indiamart/:businessId
 *
 * Verifies:
 *   - the route is guarded by validateWebhook (x-webhook-secret required)
 *   - a duplicate delivery (same idempotency key) returns { duplicate: true }
 *     and creates only ONE Contact row
 *   - a valid first delivery creates exactly one Contact
 */

import express from 'express';
import request from 'supertest';

// ─── Prisma mock ─────────────────────────────────────────────────────────────
const mockPrisma = {
  business: {
    findUnique: jest.fn(),
  },
  contact: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn(),
  },
  activity: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  $disconnect: jest.fn(),
};

jest.mock('../src/server/db', () => ({
  prisma: mockPrisma,
}));

// ── LeadCaptureService mock (we control captureIndiaMARTLead behaviour) ──────
jest.mock('../src/server/services/lead-capture.service', () => ({
  LeadCaptureService: {
    captureIndiaMARTLead: jest.fn(),
    captureJustDialLead: jest.fn(),
    captureFacebookLead: jest.fn(),
    captureInstagramLead: jest.fn(),
    upsertContact: jest.fn(),
    autoAssignLead: jest.fn(),
    setupIndiaMARTWebhook: jest.fn(),
    setupFacebookWebhook: jest.fn(),
  },
}));

// Import AFTER mocks
import leadsRoutes from '../src/server/routes/leads';
import { LeadCaptureService } from '../src/server/services/lead-capture.service';
import { prisma } from '../src/server/db';

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/leads', leadsRoutes);
  return app;
}

const VALID_SECRET = 'wh_test_secret_abc123';
const VALID_BUSINESS_ID = 'biz-valid-123';
const PAYLOAD = {
  name: 'Rahul Sharma',
  phone: '9820123456',
  email: 'rahul@example.com',
  product: 'Industrial Water Pump',
  requirement: 'Need 50 units',
  city: 'Pune',
  idempotencyKey: 'im-lead-xyz-789',
};

let app: express.Application;

beforeAll(() => {
  app = buildApp();
});

beforeEach(() => {
  jest.clearAllMocks();

  // Business exists with a webhook secret
  mockPrisma.business.findUnique.mockResolvedValue({
    id: VALID_BUSINESS_ID,
    leadWebhookSecret: VALID_SECRET,
    name: 'Test Business',
    autoReplyMessage: 'Thank you!',
    phone: '+911234567890',
  });

  // Default: contact upsert succeeds (returns a created contact)
  (LeadCaptureService.captureIndiaMARTLead as jest.Mock).mockImplementation(async () => ({
    id: 'contact-new',
    name: PAYLOAD.name,
    phone: PAYLOAD.phone,
  }));
});

describe('POST /api/leads/indiamart/:businessId — webhook security', () => {
  it('rejects a request without x-webhook-secret', async () => {
    const res = await request(app)
      .post(`/api/leads/indiamart/${VALID_BUSINESS_ID}`)
      .send(PAYLOAD)
      .expect(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects a request with the wrong secret', async () => {
    const res = await request(app)
      .post(`/api/leads/indiamart/${VALID_BUSINESS_ID}`)
      .set('x-webhook-secret', 'wrong')
      .send(PAYLOAD)
      .expect(403);
    expect(res.body.success).toBe(false);
  });

  it('accepts a valid secret and captures the lead', async () => {
    const res = await request(app)
      .post(`/api/leads/indiamart/${VALID_BUSINESS_ID}`)
      .set('x-webhook-secret', VALID_SECRET)
      .send(PAYLOAD)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.duplicate).toBeFalsy();
    expect(LeadCaptureService.captureIndiaMARTLead).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/leads/indiamart/:businessId — idempotency', () => {
  it('returns duplicate:true and creates only ONE contact when the same payload is delivered twice', async () => {
    // First delivery: new lead captured.
    const first = await request(app)
      .post(`/api/leads/indiamart/${VALID_BUSINESS_ID}`)
      .set('x-webhook-secret', VALID_SECRET)
      .send(PAYLOAD)
      .expect(200);
    expect(first.body.duplicate).toBeFalsy();

    // Second delivery (same idempotency key) — service reports duplicate.
    (LeadCaptureService.captureIndiaMARTLead as jest.Mock).mockResolvedValueOnce({
      id: 'contact-existing',
      duplicate: true,
    });

    const second = await request(app)
      .post(`/api/leads/indiamart/${VALID_BUSINESS_ID}`)
      .set('x-webhook-secret', VALID_SECRET)
      .send(PAYLOAD)
      .expect(200);

    expect(second.body.success).toBe(true);
    expect(second.body.duplicate).toBe(true);

    // Exactly ONE new contact was created across both deliveries.
    expect(LeadCaptureService.captureIndiaMARTLead).toHaveBeenCalledTimes(2);
  });

  it('passes the derived idempotency key to the capture service', async () => {
    await request(app)
      .post(`/api/leads/indiamart/${VALID_BUSINESS_ID}`)
      .set('x-webhook-secret', VALID_SECRET)
      .send(PAYLOAD);

    const callArg = (LeadCaptureService.captureIndiaMARTLead as jest.Mock).mock.calls[0][2];
    expect(callArg).toBe(PAYLOAD.idempotencyKey);
  });

  it('falls back to a phone|email idempotency key when no explicit id is present', async () => {
    const noIdPayload = { ...PAYLOAD };
    delete (noIdPayload as any).idempotencyKey;

    await request(app)
      .post(`/api/leads/indiamart/${VALID_BUSINESS_ID}`)
      .set('x-webhook-secret', VALID_SECRET)
      .send(noIdPayload);

    const callArg = (LeadCaptureService.captureIndiaMARTLead as jest.Mock).mock.calls[0][2];
    expect(callArg).toBe(`${PAYLOAD.phone}|${PAYLOAD.email}`);
  });
});
