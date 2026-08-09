// Global toast helper - dispatches custom DOM events so any code (React or not)
// can trigger visible UI toasts without needing the React context.
import apiClient from './api';

export interface ToastOptions {
  duration?: number;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

/** Dispatch a custom event that the Toast component listens for. */
function dispatchToast(message: string, type: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:toast', { detail: { message, type } }));
  }
}

// Simple toast utility — works inside and outside React component tree
export const toast = {
  success: (message: string, _options?: ToastOptions) => {
    dispatchToast(message, 'success');
  },
  error: (message: string, _options?: ToastOptions) => {
    dispatchToast(message, 'error');
  },
  warning: (message: string, _options?: ToastOptions) => {
    dispatchToast(message, 'warning');
  },
  info: (message: string, _options?: ToastOptions) => {
    dispatchToast(message, 'info');
  },
};

// Helper to show API error messages
export const showApiError = (error: any, fallback: string = 'Request failed') => {
  const message = error?.response?.data?.error || error?.message || fallback;
  toast.error(message);
};

// Helper to show success messages
export const showSuccess = (message: string) => {
  toast.success(message);
};

// Confirmation dialog
export const confirmAction = (
  message: string,
  title: string = 'Confirm Action'
): Promise<boolean> => {
  return new Promise((resolve) => {
    if (window.confirm(`${title}\n\n${message}`)) {
      resolve(true);
    } else {
      resolve(false);
    }
  });
};

// Export apiClient for use in components without importing it separately
export { apiClient };

// Helper to handle file upload
export const uploadFile = async (
  endpoint: string,
  file: File,
  additionalData?: Record<string, any>
) => {
  const formData = new FormData();
  formData.append('file', file);
  
  if (additionalData) {
    Object.entries(additionalData).forEach(([key, value]) => {
      formData.append(key, value as string);
    });
  }

  const response = await apiClient.post(endpoint, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

// Helper to download files
export const downloadFile = async (url: string, filename?: string) => {
  try {
    const response = await apiClient.get(url, {
      responseType: 'blob',
    });

    const blob = new Blob([response.data]);
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('Download failed:', error);
    throw error;
  }
};
