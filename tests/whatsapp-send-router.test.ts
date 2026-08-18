/**
 * WhatsAppSendRouter Unit Tests
 *
 * Verifies channel resolution:
 *   - evolution when business has no Meta fields but an active evolution_api Integration exists
 *   - meta when business has waPhoneNumberId + waAccessToken
 *   - null when neither is configured
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
      bulkSend: jest.fn().mockResolvedValue({ queued: 1, estimatedTime: '1s' }),
    },
  };
});

import { prisma } from '../src/server/db';

const mockedPrisma = prisma as any;
const mockedEvolution = EvolutionApiService as any;

const BUSINESS_ID = 'biz-router-test';

describe('WhatsAppSendRouter.resolveChannel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns evolution when no Meta fields but an active evolution_api Integration exists', async () => {
    mockedPrisma.business.findUnique.mockResolvedValue({ waPhoneNumberId: null, waAccessToken: null });
    mockedPrisma.integration.findFirst.mockResolvedValue({ id: 'evo_1' });

    const result = await WhatsAppSendRouter.resolveChannel(BUSINESS_ID);

    expect(result.channel).toBe('evolution');
    expect(mockedPrisma.integration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: BUSINESS_ID, type: 'evolution_api', isActive: true } })
    );
  });

  it('returns meta when business has waPhoneNumberId + waAccessToken', async () => {
    mockedPrisma.business.findUnique.mockResolvedValue({ waPhoneNumberId: 'PHONE', waAccessToken: 'TOKEN' });
    // Meta takes precedence; integration lookup should not even be needed, but ensure it isn't called with evolution
    mockedPrisma.integration.findFirst.mockResolvedValue(null);

    const result = await WhatsAppSendRouter.resolveChannel(BUSINESS_ID);

    expect(result.channel).toBe('meta');
  });

  it('returns null when neither Meta nor Evolution is configured', async () => {
    mockedPrisma.business.findUnique.mockResolvedValue({ waPhoneNumberId: null, waAccessToken: null });
    mockedPrisma.integration.findFirst.mockResolvedValue(null);

    const result = await WhatsAppSendRouter.resolveChannel(BUSINESS_ID);

    expect(result.channel).toBeNull();
  });
});

describe('WhatsAppSendRouter.sendText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes to EvolutionApiService.sendText when channel is evolution', async () => {
    mockedPrisma.business.findUnique.mockResolvedValue({ waPhoneNumberId: null, waAccessToken: null });
    mockedPrisma.integration.findFirst.mockResolvedValue({ id: 'evo_1' });

    await WhatsAppSendRouter.sendText(BUSINESS_ID, '919999999999', 'Hi!');

    expect(mockedEvolution.sendText).toHaveBeenCalledWith(BUSINESS_ID, '919999999999', 'Hi!', expect.any(Object));
  });

  it('throws a clear error when neither channel is configured', async () => {
    mockedPrisma.business.findUnique.mockResolvedValue({ waPhoneNumberId: null, waAccessToken: null });
    mockedPrisma.integration.findFirst.mockResolvedValue(null);

    await expect(
      WhatsAppSendRouter.sendText(BUSINESS_ID, '919999999999', 'Hi!')
    ).rejects.toThrow('WhatsApp not configured');
  });
});
