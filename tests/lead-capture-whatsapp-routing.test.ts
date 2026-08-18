/**
 * LeadCaptureService WhatsApp routing test
 *
 * Verifies that LeadCaptureService.captureIndiaMARTLead routes the auto-reply
 * through WhatsAppSendRouter, which (when the channel resolves to 'evolution')
 * calls EvolutionApiService.sendText — NOT the Meta (WhatsAppService) path.
 *
 * This reproduces the original defect: a mobile-connected (Evolution) business
 * previously hit WhatsAppService.sendTextMessage, which throws 'WhatsApp not
 * configured' because Meta fields are blank, silently swallowing the auto-reply.
 */

import { LeadCaptureService } from '../src/server/services/lead-capture.service';
import { EvolutionApiService } from '../src/server/services/evolution.service';

jest.mock('../src/server/db', () => ({
  prisma: {
    contact: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    business: {
      findUnique: jest.fn(),
    },
    activity: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    chatbotFlow: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('axios');
jest.mock('../src/server/utils/auth', () => ({
  encrypt: jest.fn((s: string) => `enc_${s}`),
  decrypt: jest.fn((s: string) => s.replace('enc_', '')),
}));

// Router mock: channel resolves to 'evolution', sendText delegates to the Evolution path
jest.mock('../src/server/services/whatsapp-send-router.service', () => {
  const { EvolutionApiService } = require('../src/server/services/evolution.service');
  return {
    WhatsAppSendRouter: {
      resolveChannel: jest.fn().mockResolvedValue({ channel: 'evolution' }),
      sendText: jest.fn().mockImplementation((...args: any[]) =>
        EvolutionApiService.sendText(...args)
      ),
      sendTemplate: jest.fn(),
      bulkSend: jest.fn(),
    },
  };
});

// Stub collaborators so the test stays focused on WhatsApp routing
jest.mock('../src/server/services/ai-auto-reply.service', () => ({
  handleLeadCapture: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/server/services/hot-lead-processor.service', () => ({
  HotLeadProcessor: { processNewLead: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/server/services/email.service', () => ({
  EmailService: { sendEmail: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/server/services/whatsapp-rate-limiter.service', () => ({
  WhatsAppRateLimiter: {},
}));

// Evolution service mock (real class shape, only sendText spied)
jest.mock('../src/server/services/evolution.service', () => {
  const actual = jest.requireActual('../src/server/services/evolution.service');
  return {
    ...actual,
    EvolutionApiService: {
      ...actual.EvolutionApiService,
      sendText: jest.fn().mockResolvedValue({ success: true }),
    },
  };
});

import { prisma } from '../src/server/db';

const mockedPrisma = prisma as any;
const mockedEvolution = EvolutionApiService as any;

const BUSINESS_ID = 'biz-lead-test';
const PHONE = '919999999999';

describe('LeadCaptureService -> WhatsApp routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedPrisma.contact.findUnique.mockResolvedValue(null);
    mockedPrisma.contact.findFirst.mockResolvedValue(null);
    mockedPrisma.contact.create.mockResolvedValue({ id: 'contact-1', name: 'John', phone: PHONE });
    mockedPrisma.business.findUnique.mockResolvedValue({
      name: 'Test Biz',
      autoReplyMessage: null,
      phone: '918888888888',
    });
    mockedPrisma.activity.findFirst.mockResolvedValue(null);
    mockedPrisma.activity.create.mockResolvedValue({ id: 'activity-1' });
    mockedPrisma.chatbotFlow.findMany.mockResolvedValue([]);
  });

  it('routes the IndiaMART auto-reply through EvolutionApiService when channel is evolution', async () => {
    const result = await LeadCaptureService.captureIndiaMARTLead(BUSINESS_ID, {
      name: 'John',
      phone: PHONE,
      product: 'Widgets',
    });

    expect(result.id).toBe('contact-1');
    expect(mockedEvolution.sendText).toHaveBeenCalledTimes(1);
    expect(mockedEvolution.sendText).toHaveBeenCalledWith(
      BUSINESS_ID,
      PHONE,
      expect.stringContaining('John'),
      expect.objectContaining({ messageId: 'contact-1' })
    );
  });
});
