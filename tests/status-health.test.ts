/**
 * Status / Health route test (Phase E.5)
 * Verifies GET /api/status/health returns the 4-boolean connectivity summary.
 */

import request from 'supertest';
import express from 'express';

// Mock prisma so DB check passes/fails deterministically
jest.mock('../src/server/db', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

// Mock the WhatsApp router so resolveChannel is deterministic
jest.mock('../src/server/services/whatsapp-send-router.service', () => ({
  WhatsAppSendRouter: {
    resolveChannel: jest.fn().mockResolvedValue({ channel: 'evolution' }),
  },
}));

import { prisma } from '../src/server/db';
import statusHealthRoutes from '../src/server/routes/status-health';

const app = express();
app.use(express.json());
// Fake auth: attach a businessId
app.use((req: any, _res, next) => {
  req.user = { businessId: 'biz-health-test' };
  next();
});
app.use('/api/status', statusHealthRoutes);

describe('GET /api/status/health', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the 4 health booleans (whatsapp, n8n, ai, db)', async () => {
    // DB check passes
    (prisma as any).$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    // No N8N_URL / AI keys -> n8n false, ai false
    delete process.env.N8N_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AI_PROVIDER_URL;
    delete process.env.NVIDIA_NIM_API_KEY;

    const res = await request(app).get('/api/status/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(typeof d.whatsapp).toBe('boolean');
    expect(typeof d.n8n).toBe('boolean');
    expect(typeof d.ai).toBe('boolean');
    expect(typeof d.db).toBe('boolean');
    // DB mock returned a row -> db true
    expect(d.db).toBe(true);
    // No AI key configured -> ai false
    expect(d.ai).toBe(false);
    // resolveChannel mocked to 'evolution' -> whatsapp true
    expect(d.whatsapp).toBe(true);
  });
});
