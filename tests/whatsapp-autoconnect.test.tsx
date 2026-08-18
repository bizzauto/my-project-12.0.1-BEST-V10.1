/**
 * @jest-environment jsdom
 *
 * Tests for ModernWhatsApp mobile auto-connect wiring (Phase C.3):
 *   - getStatus returning 'connected' → no modal, shows live "Connected" status.
 *   - getStatus returning 'disconnected' WITH a prior Evolution integration
 *     (persisted evo_ever_connected flag) → auto-invokes evolutionAPI.connect()
 *     to re-pair and opens the QR modal.
 */

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { render, RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

// ======== Mocks ========
jest.mock('lucide-react');
jest.mock('qrcode.react');
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));

// Mutable mock for the api module. Use a Proxy so every export
// (authAPI, whatsappAPI, evolutionAPI, …) resolves; we override the
// two evolutionAPI methods we need to assert on.
const mockGetStatus = jest.fn();
const mockConnect = jest.fn();
jest.mock('../src/lib/api', () => {
  const base: Record<string, any> = {
    whatsappAPI: new Proxy({}, { get: () => jest.fn() }),
    authAPI: new Proxy({}, { get: () => jest.fn() }),
    evolutionAPI: {
      getStatus: (...args: any[]) => mockGetStatus(...args),
      connect: (...args: any[]) => mockConnect(...args),
      disconnect: jest.fn(),
      deleteInstance: jest.fn(),
      sendText: jest.fn(),
      chats: jest.fn(),
      getConfig: jest.fn(),
      saveConfig: jest.fn(),
    },
  };
  return new Proxy(base, { get: (_t, prop: string) => (prop in base ? base[prop] : jest.fn()) });
});

// ======== Imports after mocks ========
import ModernWhatsApp from '../src/components/ModernWhatsApp';

const renderWithProviders = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: ({ children }: { children: React.ReactNode }) => <BrowserRouter>{children}</BrowserRouter>, ...options });

describe('ModernWhatsApp - mobile auto-connect (Phase C.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows live connected status when getStatus returns connected (no modal, no auto-connect)', async () => {
    mockGetStatus.mockResolvedValue({
      data: {
        success: true,
        data: { status: 'connected', phone: '+91 98765 43210', profileName: 'BizzAuto' },
      },
    });
    mockConnect.mockResolvedValue({ data: { success: true, data: {} } });

    renderWithProviders(<ModernWhatsApp />);

    // Live "Connected" chip appears in the header with the phone.
    await waitFor(() => {
      expect(screen.getByText(/Connected/)).toBeInTheDocument();
    });
    expect(screen.getByText(/\+91 98765 43210/)).toBeInTheDocument();

    // connect() must NOT be auto-invoked for an already-connected account.
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('auto-invokes connect when disconnected but a prior Evolution integration exists', async () => {
    // Simulate a prior integration persisted across app launches.
    mockGetStatus.mockResolvedValue({
      data: { success: true, data: { status: 'disconnected' } },
    });
    mockConnect.mockResolvedValue({
      data: { success: true, data: { qrCode: 'data:image/png;base64,abc', status: 'scanning' } },
    });

    renderWithProviders(<ModernWhatsApp everConnected />);

    // Because everConnected is true, the QR modal auto-opens and calls connect().
    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalled();
    });
  });

  it('shows "Connect WhatsApp" button when disconnected with no prior integration (no auto-connect)', async () => {
    mockGetStatus.mockResolvedValue({
      data: { success: true, data: { status: 'disconnected' } },
    });
    mockConnect.mockResolvedValue({
      data: { success: true, data: { qrCode: 'data:image/png;base64,abc', status: 'scanning' } },
    });

    renderWithProviders(<ModernWhatsApp />);

    // First-time business: show the manual connect button, do NOT auto-connect.
    await waitFor(() => {
      expect(screen.getByText(/Connect WhatsApp/)).toBeInTheDocument();
    });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('shows "Checking WhatsApp…" while status is loading', async () => {
    mockGetStatus.mockImplementation(
      () => new Promise(() => {}) // never resolves → stays loading
    );

    renderWithProviders(<ModernWhatsApp />);

    await waitFor(() => {
      expect(screen.getByText(/Checking WhatsApp/)).toBeInTheDocument();
    });
  });
});
