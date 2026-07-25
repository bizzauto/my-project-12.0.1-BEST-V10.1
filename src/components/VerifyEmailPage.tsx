import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { CheckCircle, AlertCircle, Mail, ArrowRight, Loader2 } from 'lucide-react';

type VerificationStatus = 'loading' | 'success' | 'error' | 'resend';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { token } = useAuthStore();
  const [status, setStatus] = useState<VerificationStatus>('loading');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    const verifyToken = async () => {
      const urlToken = searchParams.get('token');

      if (urlToken) {
        // Verify email with token from URL
        try {
          const res = await fetch(`/api/auth/verify-email?token=${urlToken}`);
          const data = await res.json();

          if (data.success) {
            setStatus('success');
            setMessage('Email verified successfully! You can now access all features.');
          } else {
            setStatus('error');
            setMessage(data.error || 'Invalid or expired verification token');
          }
        } catch {
          setStatus('error');
          setMessage('Failed to verify email. Please try again.');
        }
      } else if (token) {
        // Check verification status for logged-in users
        try {
          const res = await fetch('/api/auth/verification-status', {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();

          if (data.success && data.data.verified) {
            setStatus('success');
            setMessage('Your email is already verified!');
          } else {
            setStatus('resend');
          }
        } catch {
          setStatus('resend');
        }
      } else {
        setStatus('resend');
      }
    };

    verifyToken();
  }, [searchParams, token]);

  const handleResend = async () => {
    if (!email) {
      setMessage('Please enter your email address');
      return;
    }

    try {
      const res = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (data.success) {
        setMessage('Verification email sent! Check your inbox.');
      } else {
        setMessage(data.error || 'Failed to send verification email');
      }
    } catch {
      setMessage('Failed to send verification email');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/5 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 p-6 sm:p-8 text-center">
          {/* Header */}
          <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center mx-auto mb-5 sm:mb-6 shadow-lg ${
            status === 'success'
              ? 'bg-gradient-to-br from-green-400 to-emerald-500 shadow-green-500/25'
              : status === 'error'
              ? 'bg-gradient-to-br from-red-400 to-rose-500 shadow-red-500/25'
              : 'bg-gradient-to-br from-blue-500 to-purple-600 shadow-blue-500/25'
          }`}>
            {status === 'success' ? (
              <CheckCircle size={36} className="text-white" />
            ) : status === 'error' ? (
              <AlertCircle size={36} className="text-white" />
            ) : (
              <Mail size={36} className="text-white" />
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {status === 'success'
              ? 'Email Verified!'
              : status === 'error'
              ? 'Verification Failed'
              : 'Verify Your Email'}
          </h1>

          {/* Loading State */}
          {status === 'loading' && (
            <div className="space-y-4">
              <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full mx-auto animate-spin" />
              <p className="text-gray-500 dark:text-gray-400">Verifying your email...</p>
            </div>
          )}

          {/* Success State */}
          {status === 'success' && (
            <div className="space-y-4">
              <p className="text-gray-500 dark:text-gray-400">{message}</p>
              <button
                onClick={() => navigate('/dashboard')}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-3.5 rounded-xl font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5 active:translate-y-0"
              >
                Go to Dashboard <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* Error State */}
          {status === 'error' && (
            <div className="space-y-4">
              <p className="text-red-500 dark:text-red-400 text-sm">{message}</p>
              <button
                onClick={() => navigate('/login')}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-3.5 rounded-xl font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5 active:translate-y-0"
              >
                Go to Login <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* Resend State */}
          {status === 'resend' && (
            <div className="space-y-4">
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
                {message || "Your email isn't verified yet. Enter your email to resend the verification link."}
              </p>
              <div className="relative group">
                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 dark:focus:border-blue-400 transition-all dark:bg-gray-700 dark:text-white placeholder:text-gray-400"
                />
              </div>
              <button
                onClick={handleResend}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-3.5 rounded-xl font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5 active:translate-y-0"
              >
                Send Verification Email <ArrowRight size={18} />
              </button>
              <button
                onClick={() => navigate('/login')}
                className="w-full text-gray-500 dark:text-gray-400 py-2 hover:text-gray-700 dark:hover:text-gray-300 transition-colors text-sm font-medium"
              >
                Back to Login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
