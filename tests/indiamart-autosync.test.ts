/**
 * @jest-environment node
 *
 * Tests for the IndiaMART automatic IMAP autosync poller.
 *
 * Covers:
 *   - indiamartAutosyncTick() loads active indiamart_email integrations
 *   - only integrations with config.autoSync === true are processed
 *   - per-business throttle (config.syncInterval) is respected
 *   - one business's failure does not prevent the others from running
 *   - IndiaMARTEmailService.processIndiaMARTEmails is invoked with { since }
 */

// ─── Prisma mock ─────────────────────────────────────────────────────────────
const mockFindMany = jest.fn();
const mockUpdate = jest.fn().mockResolvedValue({});

jest.mock('../src/server/db', () => ({
  prisma: {
    integration: {
      findMany: (...args: any[]) => mockFindMany(...args),
      update: (...args: any[]) => mockUpdate(...args),
    },
  },
}));

// ─── IndiaMARTEmailService mock ───────────────────────────────────────────────
const mockProcessIndiaMARTEmails = jest.fn().mockResolvedValue({
  processed: 1,
  newLeads: 1,
  skipped: 0,
  errors: [],
  leads: [],
});

jest.mock('../src/server/services/indiamart-email.service', () => ({
  IndiaMARTEmailService: {
    processIndiaMARTEmails: (...args: any[]) => mockProcessIndiaMARTEmails(...args),
  },
}));

// ─── decrypt mock (no-op so config.password stays readable) ──────────────────
jest.mock('../src/server/utils/auth', () => ({
  decrypt: (v: string) => v ?? '',
  encrypt: (v: string) => v ?? '',
}));

import { indiamartAutosyncTick, getIndiaMARTAutosyncState } from '../src/server/services/indiamart-sync.service';

function makeIntegration(overrides: any = {}) {
  return {
    id: 'int-1',
    businessId: 'biz-1',
    type: 'indiamart_email',
    isActive: true,
    config: { imapHost: 'imap.example.com', imapPort: 993, email: 'leads@example.com', password: 'secret', useSSL: true, autoSync: true, syncInterval: 60 },
    ...overrides,
  };
}

let lastSince: Date | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdate.mockResolvedValue({});
  mockProcessIndiaMARTEmails.mockResolvedValue({ processed: 1, newLeads: 1, skipped: 0, errors: [], leads: [] });
  // reset per-business throttle state for deterministic tests
  getIndiaMARTAutosyncState().lastRunByBusiness.clear();
  mockProcessIndiaMARTEmails.mockImplementation(async (_biz: string, _cfg: any, opts: any) => {
    lastSince = opts?.since;
    return { processed: 1, newLeads: 1, skipped: 0, errors: [], leads: [] };
  });
});

describe('indiamartAutosyncTick — integration selection', () => {
  it('calls processIndiaMARTEmails for an active indiamart_email integration with autoSync=true', async () => {
    mockFindMany.mockResolvedValue([makeIntegration()]);

    const result = await indiamartAutosyncTick();

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockProcessIndiaMARTEmails).toHaveBeenCalledTimes(1);
    expect(mockProcessIndiaMARTEmails).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ imapHost: 'imap.example.com', email: 'leads@example.com' }),
      expect.objectContaining({ since: expect.any(Date) }),
    );
    expect(result.processed).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('skips integrations with autoSync disabled', async () => {
    mockFindMany.mockResolvedValue([makeIntegration({ config: { ...makeIntegration().config, autoSync: false } })]);

    const result = await indiamartAutosyncTick();

    expect(mockProcessIndiaMARTEmails).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });

  it('skips non-indiamart_email integrations (defensive: db returns only matching type)', async () => {
    mockFindMany.mockResolvedValue([
      makeIntegration({ type: 'google_sheets' }),
      makeIntegration(),
    ]);

    const result = await indiamartAutosyncTick();

    // Only the indiamart_email one should be processed
    expect(mockProcessIndiaMARTEmails).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(1);
  });

  it('passes a `since` window of ~last 24h', async () => {
    mockFindMany.mockResolvedValue([makeIntegration()]);

    await indiamartAutosyncTick();

    expect(lastSince).toBeInstanceOf(Date);
    const diffMs = Date.now() - lastSince!.getTime();
    // within 5 minutes of 24h
    expect(diffMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThan(25 * 60 * 60 * 1000);
  });
});

describe('indiamartAutosyncTick — per-business throttle', () => {
  it('respects config.syncInterval: does not re-run within the interval', async () => {
    mockFindMany.mockResolvedValue([makeIntegration({ config: { ...makeIntegration().config, syncInterval: 60 } })]);

    await indiamartAutosyncTick();
    expect(mockProcessIndiaMARTEmails).toHaveBeenCalledTimes(1);

    // Immediately run again — should be throttled (syncInterval 60 min)
    await indiamartAutosyncTick();
    expect(mockProcessIndiaMARTEmails).toHaveBeenCalledTimes(1);
  });

  it('re-runs once the syncInterval has elapsed', async () => {
    mockFindMany.mockResolvedValue([makeIntegration({ config: { ...makeIntegration().config, syncInterval: 1 } })]);

    await indiamartAutosyncTick();
    expect(mockProcessIndiaMARTEmails).toHaveBeenCalledTimes(1);

    // advance throttle timestamp into the past so the interval elapsed
    getIndiaMARTAutosyncState().lastRunByBusiness.set('biz-1', Date.now() - 2 * 60 * 1000);

    await indiamartAutosyncTick();
    expect(mockProcessIndiaMARTEmails).toHaveBeenCalledTimes(2);
  });
});

describe('indiamartAutosyncTick — failure isolation', () => {
  it('one failing business does not stop the others and is recorded as an error', async () => {
    mockFindMany.mockResolvedValue([
      makeIntegration({ id: 'int-ok', businessId: 'biz-ok' }),
      makeIntegration({ id: 'int-fail', businessId: 'biz-fail' }),
    ]);

    mockProcessIndiaMARTEmails
      .mockImplementationOnce(async () => ({ processed: 1, newLeads: 1, skipped: 0, errors: [], leads: [] }))
      .mockImplementationOnce(async () => { throw new Error('IMAP auth failed'); });

    const result = await indiamartAutosyncTick();

    // both attempted; the failure is captured, not thrown
    expect(mockProcessIndiaMARTEmails).toHaveBeenCalledTimes(2);
    expect(result.processed).toBe(1);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain('biz-fail');
  });
});
