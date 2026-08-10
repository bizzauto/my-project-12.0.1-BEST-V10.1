import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
// Button, Alert, strong — using local UI primitives instead of @radix-ui/react-dialog
import { CheckCircle, AlertCircle, Loader2, FileSpreadsheet, ExternalLink } from 'lucide-react';

interface GoogleSheetsOneClickProps {
  businessId: string;
  onSuccess?: (data: { spreadsheetId: string; spreadsheetUrl: string }) => void;
  onError?: (error: string) => void;
  className?: string;
}

/**
 * One-Click Google Sheets Integration
 * Opens OAuth in a popup, handles callback automatically,
 * creates spreadsheet if needed, and returns result to parent.
 */
export const GoogleSheetsOneClick: React.FC<GoogleSheetsOneClickProps> = ({
  businessId,
  onSuccess,
  onError,
  className = '',
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const messageListenerRef = useRef<((event: MessageEvent) => void) | null>(null);

  // Cleanup popup listener on unmount
  useEffect(() => {
    return () => {
      if (messageListenerRef.current) {
        window.removeEventListener('message', messageListenerRef.current);
      }
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }
    };
  }, []);

  const handleClick = useCallback(async () => {
    setStatus('loading');
    setMessage(t('integrations.googleSheets.connecting'));

    try {
      // Step 1: Get OAuth URL
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/api/integrations/google-sheets/oauth-url?popup=true`, {
        headers: { 'Content-Type': 'application/json' },
        // Note: In real app, you'd need auth token - adjust based on your auth setup
        credentials: 'include',
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to get OAuth URL');
      }

      const { oauthUrl } = await response.json();

      // Step 2: Open popup
      const popupWidth = 500;
      const popupHeight = 600;
      const left = window.screenX + (window.outerWidth - popupWidth) / 2;
      const top = window.screenY + (window.outerHeight - popupHeight) / 2;

      popupRef.current = window.open(
        oauthUrl,
        'googleSheetsOAuth',
        `width=${popupWidth},height=${popupHeight},left=${left},top=${top},scrollbars=yes,resizable=yes`
      );

      if (!popupRef.current) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }

      // Step 3: Listen for completion message from popup
      return new Promise<void>((resolve, reject) => {
        const handleMessage = (event: MessageEvent) => {
          // Security: verify origin
          if (event.origin !== window.location.origin) return;

          if (event.data.type === 'GOOGLE_SHEETS_OAUTH_RESULT') {
            window.removeEventListener('message', handleMessage);
            messageListenerRef.current = null;

            if (event.data.success) {
              setStatus('success');
              setMessage(t('integrations.googleSheets.connected'));
              setSpreadsheetUrl(event.data.spreadsheetUrl);
              onSuccess?.({
                spreadsheetId: event.data.spreadsheetId,
                spreadsheetUrl: event.data.spreadsheetUrl,
              });
              resolve();
            } else {
              setStatus('error');
              setMessage(event.data.error || t('integrations.googleSheets.error'));
              onError?.(event.data.error || 'OAuth failed');
              reject(new Error(event.data.error || 'OAuth failed'));
            }
          }
        };

        messageListenerRef.current = handleMessage;
        window.addEventListener('message', handleMessage);

        // Timeout fallback (5 minutes)
        setTimeout(() => {
          if (messageListenerRef.current) {
            window.removeEventListener('message', messageListenerRef.current);
            messageListenerRef.current = null;
            if (popupRef.current && !popupRef.current.closed) {
              popupRef.current.close();
            }
            setStatus('error');
            setMessage(t('integrations.googleSheets.timeout'));
            reject(new Error('OAuth timeout'));
          }
        }, 5 * 60 * 1000);
      });
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message || t('integrations.googleSheets.error'));
      onError?.(err.message);
    }
  }, [businessId, onSuccess, onError, t]);

  return (
    <div className={className}>
      <button
        onClick={handleClick}
        disabled={status === 'loading'}
        className="w-full gap-2 justify-center inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {status === 'loading' && <Loader2 className="h-4 w-4 animate-spin" />}
        {status !== 'loading' && <FileSpreadsheet className="h-4 w-4" />}
        <span>
          {status === 'loading'
            ? t('integrations.googleSheets.connecting')
            : status === 'success'
            ? t('integrations.googleSheets.connected')
            : t('integrations.googleSheets.connect')}
        </span>
      </button>

      {status === 'success' && (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2 text-green-800 mb-2">
            <CheckCircle className="h-5 w-5" />
            <strong>{t('integrations.googleSheets.successTitle')}</strong>
          </div>
          <p className="text-sm text-green-700 mb-3">
            {t('integrations.googleSheets.successDesc')}
          </p>
          {spreadsheetUrl && (
            <a
              href={spreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-green-700 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('integrations.googleSheets.openSheet')}
            </a>
          )}
        </div>
      )}

      {status === 'error' && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="h-4 w-4" />
          <strong>{t('integrations.googleSheets.errorTitle')}</strong>
          <p className="text-sm">{message}</p>
        </div>
      )}
    </div>
  );
};

export default GoogleSheetsOneClick;