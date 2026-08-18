/**
 * WhatsAppSendRouter Coverage Test
 *
 * Verifies that an Evolution-only business (no Meta waPhoneNumberId/waAccessToken,
 * but an active evolution_api Integration) routes user-facing sends through the
 * WhatsAppSendRouter to EvolutionApiService — exercising the real sendText path
 * used by review-requests, payment-links, leads, cart-recovery, ai-sales-agent,
 * auto-onboarding and the workers.
 */

import { WhatsAppSendRouter } from '../src/server/services/whatsapp-send-router.service';
import { EvolutionApiService } from '../src/server/services/evolution.service';

jest.mock('../src/server/db', () => ({
  prisma: {
    business: {
      findUnique: jest.fn(),
    },
    integration: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('axios');
jest.mock('../src/server/utils/auth', () => ({
  encrypt: jest.fn((s: string) => `enc_${s}`),
  decrypt: jest.fn((s: string) => s.replace('enc_', '')),
}));

// Stub the Evolution methods we assert on so sendText can route without real HTTP
jest.mock('../src/server/services/evolution.service', () => {
  const actual = jest.requireActual('../src/server/services/evolution.service');
  return {
    ...actual,
    EvolutionApiService: {
      ...actual.EvolutionApiService,
      sendText: jest.fn().mockResolvedValue({ success: true }),
      sendTemplate: jest.fn().mockResolvedValue({ success: true }),
      sendMedia: jest.fn().mockResolvedValue({ success: true }),
    },
  };
});

import { prisma } from '../src/server/db';

const mockedPrisma = prisma as any;
const mockedEvolution = EvolutionApiService as any;

const BUSINESS_ID = 'biz-evolution-only';

describe('WhatsAppSendRouter (Evolution-only business coverage)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes sendText to EvolutionApiService.sendText for an Evolution-only business', async () => {
    // Evolution-only: no Meta fields, active evolution_api integration present
    mockedPrisma.business.findUnique.mockResolvedValue({ waPhoneNumberId: null, waAccessToken: null });
    mockedPrisma.integration.findFirst.mockResolvedValue({ id: 'evo_coverage_1' });

    const result = await WhatsAppSendRouter.sendText(
      BUSINESS_ID,
      '919999999999',
      'Hello from Evolution path!',
      { messageId: 'msg_1' }
    );

    // Resolve channel looked up the integration
    expect(mockedPrisma.integration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: BUSINESS_ID, type: 'evolution_api', isActive: true } })
    );
    // The send went through Evolution, not Meta/WhatsAppService
    expect(mockedEvolution.sendText).toHaveBeenCalledTimes(1);
    expect(mockedEvolution.sendText).toHaveBeenCalledWith(
      BUSINESS_ID,
      '919999999999',
      'Hello from Evolution path!',
      expect.anything()
    );
    expect(result).toEqual({ success: true });
  });

  it('routes sendTemplate (degraded to text) and sendMedia to Evolution as well', async () => {
    mockedPrisma.business.findUnique.mockResolvedValue({ waPhoneNumberId: null, waAccessToken: null });
    mockedPrisma.integration.findFirst.mockResolvedValue({ id: 'evo_coverage_2' });

    // Meta-style templateData degrades to a text send on Evolution
    const tplResult = await WhatsAppSendRouter.sendTemplate(
      BUSINESS_ID,
      '919999999999',
      { templateName: 'hello_world', language: 'en', variables: ['Alice'] },
      { useProxy: true }
    );
    expect(mockedEvolution.sendText).toHaveBeenCalledWith(
      BUSINESS_ID,
      '919999999999',
      'hello_world',
      expect.anything()
    );

    const mediaResult = await WhatsAppSendRouter.sendMedia(
      BUSINESS_ID,
      '919999999999',
      'https://example.com/cat.png',
      'image',
      'a cat',
      { useProxy: true }
    );
    expect(mockedEvolution.sendMedia).toHaveBeenCalledWith(
      BUSINESS_ID,
      '919999999999',
      'https://example.com/cat.png',
      'image',
      'a cat',
      expect.anything()
    );

    expect(tplResult).toEqual({ success: true });
    expect(mediaResult).toEqual({ success: true });
  });
});
