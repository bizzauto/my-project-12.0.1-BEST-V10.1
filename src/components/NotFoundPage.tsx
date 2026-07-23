import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Home, ArrowLeft, Search, Mail } from 'lucide-react';

const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 flex items-center justify-center p-4 sm:p-6 md:p-8 relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/5 rounded-full blur-3xl" />

      <div className="text-center max-w-lg relative z-10">
        <div className="relative mb-8 animate-fade-in-up">
          <h1 className="text-[7rem] sm:text-[9rem] font-black leading-none bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 dark:from-blue-400 dark:via-purple-400 dark:to-pink-400 bg-clip-text text-transparent select-none">
            404
          </h1>
          <div className="absolute -top-1 right-2 sm:right-6 w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl flex items-center justify-center shadow-xl shadow-orange-500/25 animate-pulse">
            <AlertTriangle size={28} className="text-white" aria-hidden="true" />
          </div>
        </div>

        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-3">
          Oops! Page not found
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mb-8 text-sm sm:text-base leading-relaxed">
          The page you're looking for doesn't exist or has been moved.
          <br className="hidden sm:block" />
          Let's get you back on track.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
          <button onClick={() => navigate('/')} aria-label="Navigate to homepage"
            className="px-6 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-indigo-700 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5 transition-all active:translate-y-0">
            <Home size={18} /> Go Home
          </button>
          <button onClick={() => window.history.back()} aria-label="Go back to previous page"
            className="px-6 py-3.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center gap-2 cursor-pointer border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-md transition-all">
            <ArrowLeft size={18} /> Go Back
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:gap-4 text-center">
          {[
            { label: 'Product', path: '/features', icon: <Search size={16} /> },
            { label: 'Pricing', path: '/pricing', icon: <AlertTriangle size={16} /> },
            { label: 'Support', path: '/contact', icon: <Mail size={16} /> },
          ].map((link, i) => (
            <button key={i} onClick={() => navigate(link.path)} aria-label={`Go to ${link.label}`}
              className="p-3 sm:p-4 bg-white dark:bg-gray-800/80 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700/50 text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-200 dark:hover:border-blue-500/30 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer group">
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700/50 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/20 flex items-center justify-center transition-colors">
                  {link.icon}
                </div>
                <span className="font-medium">{link.label}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NotFoundPage;
