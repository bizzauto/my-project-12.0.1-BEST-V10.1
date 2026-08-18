/**
 * @jest-environment jsdom
 *
 * Tests for WhatsAppConnectModal:
 *   - on open it calls evolutionAPI.connect()
 *   - it renders an <img> with the QR src returned by connect()
 *   - when a subsequent getStatus poll returns 'connected' it calls
 *     onConnected() and shows the connected state.
 */

import React from 'react';
import { screen, waitFor, act } from '@testing-library/react';
import { render, RenderOptions } from '@testing-library/react';

// ======== Mocks ========
jest.mock('lucide-react');

// Mutable mock for the api module. The component imports `evolutionAPI`.
const mockConnect = jest.fn();
const mockGetStatus = jest.fn();
jest.mock('../src/lib/api', () => ({
  evolutionAPI: {
    connect: (...args: any[]) => mockConnect(...args),
    getStatus: (...args: any[]) => mockGetStatus(...args),
    disconnect: jest.fn(),
    deleteInstance: jest.fn(),
    sendText: jest.fn(),
    chats: jest.fn(),
    getConfig: jest.fn(),
    saveConfig: jest.fn(),
  },
}));

// ======== Imports after mocks ========
import WhatsAppConnectModal from '../src/components/WhatsAppConnectModal';

// ======== Test helpers ========
const renderModal = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, options);

const QR_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('WhatsAppConnectModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('calls connect on mount and renders QR <img> with the returned src', async () => {
    mockConnect.mockResolvedValue({
      data: { success: true, data: { qrCode: QR_DATA_URL, status: 'scanning' } },
    });
    mockGetStatus.mockResolvedValue({
      data: { success: true, data: { status: 'scanning' } },
    });

    renderModal(<WhatsAppConnectModal open onClose={jest.fn()} onConnected={jest.fn()} />);

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());

    const img = await waitFor(() =>
      screen.getByAltText('WhatsApp QR code') as HTMLImageElement
    );
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toBe(QR_DATA_URL);
  });

  it('renders raw base64 PNG QR by prefixing data:image/png;base64,', async () => {
    const raw = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    mockConnect.mockResolvedValue({
      data: { success: true, data: { qrCodeBase64: raw, status: 'scanning' } },
    });
    mockGetStatus.mockResolvedValue({
      data: { success: true, data: { status: 'scanning' } },
    });

    renderModal(<WhatsAppConnectModal open onClose={jest.fn()} onConnected={jest.fn()} />);

    const img = await waitFor(() =>
      screen.getByAltText('WhatsApp QR code') as HTMLImageElement
    );
    expect(img.getAttribute('src')).toBe('data:image/png;base64,' + raw);
  });

  it('calls onConnected and shows connected state when getStatus poll returns connected', async () => {
    mockConnect.mockResolvedValue({
      data: { success: true, data: { qrCode: QR_DATA_URL, status: 'scanning' } },
    });
    // All polls return connected immediately (shorter mock chain avoids ordering issues).
    mockGetStatus.mockResolvedValue({
      data: { success: true, data: { status: 'connected', phone: '+91 98765 43210' } },
    });

    const onConnected = jest.fn();
    renderModal(<WhatsAppConnectModal open onClose={jest.fn()} onConnected={onConnected} />);

    // Let the connect() resolve → startPolling() is called.
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());

    // Flush any pending microtasks so setInterval is registered.
    await act(async () => {
      await Promise.resolve();
    });

    // Advance the polling clock → interval fires → pollStatus resolves.
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    // Flush microtasks from the resolved getStatus promise.
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onConnected).toHaveBeenCalled();
    });

    // Connected copy appears with the phone.
    expect(screen.getByText(/Connected as/)).toBeInTheDocument();
    expect(screen.getByText(/\+91 98765 43210/)).toBeInTheDocument();
  });

  it('renders retry + config CTA when no QR is returned', async () => {
    mockConnect.mockResolvedValue({
      data: { success: true, data: { status: 'scanning' } }, // no qrCode/qrCodeBase64
    });

    renderModal(<WhatsAppConnectModal open onClose={jest.fn()} onConnected={jest.fn()} />);

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());

    expect(await screen.findByText(/Couldn't connect/)).toBeInTheDocument();
    expect(screen.getByText(/Retry/)).toBeInTheDocument();
    expect(screen.getByText(/Set instance config/)).toBeInTheDocument();
  });
});
