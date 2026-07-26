import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ArrowRight, Shield, Zap, AlertCircle, TrendingUp, Users, MessageSquare, BarChart3, CheckCircle, Star, Brain, ShoppingCart, Phone, Sparkles, Wand2, Bot, Megaphone, FileText } from 'lucide-react';
import { useAuthStore } from '../lib/authStore';
import { useTranslation } from 'react-i18next';
import GoogleLoginButton from './GoogleLoginButton';
import AppleLogin from './AppleLogin';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(email, password);
      const role = useAuthStore.getState().user?.role;
      navigate(role === 'SUPER_ADMIN' ? '/admin' : '/dashboard');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-blue-600 via-purple-600 to-indigo-700 items-center justify-center p-8 xl:p-12 relative overflow-hidden">
        {/* Animated background blobs */}
        <div className="absolute top-10 left-10 w-72 h-72 bg-blue-400/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/3 w-64 h-64 bg-pink-400/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />

        <div className="relative z-10 max-w-lg w-full">
          <div className="mb-8">
            <img src="/logo.svg" alt="BizzAuto Ai Logo" className="h-28 w-auto" />
            <p className="text-blue-100 text-sm mt-2">Trusted by 200+ businesses</p>
          </div>

          <h2 className="text-3xl xl:text-4xl font-bold text-white mb-3">
            {t('login.heroTitle', 'Automate Your Business Growth')}
          </h2>
          <p className="text-base xl:text-lg text-blue-100 mb-8">
            Join 200+ businesses already growing with WhatsApp & AI automation.
          </p>

          {/* Growth Visualization Card */}
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-5 xl:p-6 border border-white/20 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-emerald-400/30 rounded-lg flex items-center justify-center">
                  <TrendingUp size={16} className="text-emerald-200" />
                </div>
                <span className="text-white font-semibold text-sm">Business Growth</span>
              </div>
              <div className="flex items-center gap-1 bg-emerald-400/20 text-emerald-100 px-2 py-1 rounded-md text-xs font-medium">
                <TrendingUp size={12} />
                +247%
              </div>
            </div>

            {/* Animated Bar Chart showing growth */}
            <div className="flex items-end justify-between gap-1.5 h-28 mb-4">
              {[35, 50, 42, 65, 55, 78, 68, 88, 75, 95].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 bg-gradient-to-t from-emerald-400/60 to-emerald-200 rounded-t-sm transition-all duration-1000"
                  style={{
                    height: `${h}%`,
                    animation: `growBar 1s ease-out ${i * 0.1}s both`,
                  }}
                />
              ))}
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 pt-3 border-t border-white/10">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-emerald-200 mb-0.5">
                  <Users size={12} />
                </div>
                <p className="text-white font-bold text-base sm:text-lg">2.4K</p>
                <p className="text-blue-200 text-[10px] sm:text-xs">Leads</p>
              </div>
              <div className="text-center border-x border-white/10">
                <div className="flex items-center justify-center gap-1 text-emerald-200 mb-0.5">
                  <MessageSquare size={12} />
                </div>
                <p className="text-white font-bold text-base sm:text-lg">18K</p>
                <p className="text-blue-200 text-[10px] sm:text-xs">Messages</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-emerald-200 mb-0.5">
                  <BarChart3 size={12} />
                </div>
                <p className="text-white font-bold text-base sm:text-lg">₹4.2L</p>
                <p className="text-blue-200 text-[10px] sm:text-xs">Revenue</p>
              </div>
            </div>
          </div>

          {/* Trust badges */}
          <div className="mt-6 flex flex-wrap items-center gap-3 sm:gap-4 text-white/80">
            <div className="flex items-center gap-1.5">
              <CheckCircle size={14} className="text-emerald-300" />
              <span className="text-xs sm:text-sm">7-day free trial</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Shield size={14} className="text-emerald-300" />
              <span className="text-xs sm:text-sm">SSL Secured</span>
            </div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <Star key={i} size={12} className="fill-yellow-300 text-yellow-300" />
              ))}
              <span className="text-xs sm:text-sm ml-1">4.9/5</span>
            </div>
          </div>

          {/* Features Showcase */}
          <div className="mt-7">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={14} className="text-amber-300" />
              <p className="text-white/90 text-xs sm:text-sm font-semibold uppercase tracking-wider">Everything you need to grow</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
              {/* WhatsApp AI */}
              <div className="group flex items-center gap-2.5 p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl border border-white/10 hover:border-white/30 transition-all cursor-pointer">
                <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-green-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-500/30 group-hover:scale-110 transition-transform">
                  <Bot size={16} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs sm:text-sm font-semibold leading-tight">WhatsApp AI</p>
                  <p className="text-blue-200 text-[10px] sm:text-xs leading-tight">Smart messaging</p>
                </div>
              </div>
              {/* AI Lead Scoring */}
              <div className="group flex items-center gap-2.5 p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl border border-white/10 hover:border-white/30 transition-all cursor-pointer">
                <div className="w-8 h-8 bg-gradient-to-br from-violet-400 to-fuchsia-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/30 group-hover:scale-110 transition-transform">
                  <Brain size={16} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs sm:text-sm font-semibold leading-tight">AI Lead Scoring</p>
                  <p className="text-blue-200 text-[10px] sm:text-xs leading-tight">Predictive CRM</p>
                </div>
              </div>
              {/* E-commerce */}
              <div className="group flex items-center gap-2.5 p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl border border-white/10 hover:border-white/30 transition-all cursor-pointer">
                <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-pink-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-orange-500/30 group-hover:scale-110 transition-transform">
                  <ShoppingCart size={16} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs sm:text-sm font-semibold leading-tight">E-Commerce</p>
                  <p className="text-blue-200 text-[10px] sm:text-xs leading-tight">Online store</p>
                </div>
              </div>
              {/* AI Automation */}
              <div className="group flex items-center gap-2.5 p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl border border-white/10 hover:border-white/30 transition-all cursor-pointer">
                <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-orange-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-amber-500/30 group-hover:scale-110 transition-transform">
                  <Wand2 size={16} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs sm:text-sm font-semibold leading-tight">AI Automation</p>
                  <p className="text-blue-200 text-[10px] sm:text-xs leading-tight">Workflows that run</p>
                </div>
              </div>
              {/* Voice AI */}
              <div className="group flex items-center gap-2.5 p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl border border-white/10 hover:border-white/30 transition-all cursor-pointer">
                <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-cyan-500/30 group-hover:scale-110 transition-transform">
                  <Phone size={16} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs sm:text-sm font-semibold leading-tight">Voice AI Calls</p>
                  <p className="text-blue-200 text-[10px] sm:text-xs leading-tight">24/7 calling agent</p>
                </div>
              </div>
              {/* Social Media */}
              <div className="group flex items-center gap-2.5 p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl border border-white/10 hover:border-white/30 transition-all cursor-pointer">
                <div className="w-8 h-8 bg-gradient-to-br from-pink-400 to-rose-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-pink-500/30 group-hover:scale-110 transition-transform">
                  <Megaphone size={16} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs sm:text-sm font-semibold leading-tight">Social Media</p>
                  <p className="text-blue-200 text-[10px] sm:text-xs leading-tight">Auto-posting</p>
                </div>
              </div>
              {/* Analytics */}
              <div className="group flex items-center gap-2.5 p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl border border-white/10 hover:border-white/30 transition-all cursor-pointer">
                <div className="w-8 h-8 bg-gradient-to-br from-indigo-400 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/30 group-hover:scale-110 transition-transform">
                  <BarChart3 size={16} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs sm:text-sm font-semibold leading-tight">Smart Analytics</p>
                  <p className="text-blue-200 text-[10px] sm:text-xs leading-tight">Real-time insights</p>
                </div>
              </div>
              {/* Course Builder */}
              <div className="group flex items-center gap-2.5 p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl border border-white/10 hover:border-white/30 transition-all cursor-pointer">
                <div className="w-8 h-8 bg-gradient-to-br from-teal-400 to-emerald-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-teal-500/30 group-hover:scale-110 transition-transform">
                  <FileText size={16} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs sm:text-sm font-semibold leading-tight">Courses & Funnels</p>
                  <p className="text-blue-200 text-[10px] sm:text-xs leading-tight">Sell digital products</p>
                </div>
              </div>
            </div>

            {/* Quick stats row */}
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="bg-white/5 backdrop-blur-sm rounded-lg p-2 border border-white/5">
                <p className="text-emerald-300 text-base sm:text-lg font-bold">25+</p>
                <p className="text-blue-200 text-[10px]">AI Tools</p>
              </div>
              <div className="bg-white/5 backdrop-blur-sm rounded-lg p-2 border border-white/5">
                <p className="text-amber-300 text-base sm:text-lg font-bold">10K+</p>
                <p className="text-blue-200 text-[10px]">Businesses</p>
              </div>
              <div className="bg-white/5 backdrop-blur-sm rounded-lg p-2 border border-white/5">
                <p className="text-pink-300 text-base sm:text-lg font-bold">99.9%</p>
                <p className="text-blue-200 text-[10px]">Uptime</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12 bg-gray-50 dark:bg-gray-900">
        <div className="w-full max-w-md">
          <>
              <div className="mb-6 sm:mb-8 text-center sm:text-left">
                <div className="flex items-center gap-2 justify-center sm:justify-start mb-3 lg:hidden">
                  <Zap className="w-6 h-6 text-blue-600" />
                  <span className="text-xl font-bold text-blue-600">BizzAuto</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-blue-600">
                  {t('login.title', 'BizzAuto Solutions')}
                </h1>
                <p className="text-sm sm:text-base text-gray-500 mt-1">
                  {t('login.subtitle', 'Platform Automation')}
                </p>
              </div>
              <form onSubmit={handleLogin} className="space-y-4 sm:space-y-5 ai-stagger">
                <div className="relative group">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3.5 text-base border border-gray-300 dark:border-gray-600 rounded-xl dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 dark:focus:border-blue-400 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-500"
                    placeholder={t('login.emailPlaceholder', 'Email Address')}
                    required
                  />
                </div>
                <div className="relative group">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-12 py-3.5 text-base border border-gray-300 dark:border-gray-600 rounded-xl dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 dark:focus:border-blue-400 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-500"
                    placeholder={t('login.passwordPlaceholder', 'Password')}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                {/* Forgot Password Link */}
                <div className="flex justify-end">
                  <Link
                    to="/forgot-password"
                    className="text-xs sm:text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
                  >
                    {t('login.forgotPassword', 'Forgot password?')}
                  </Link>
                </div>

                {error && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg flex items-center gap-2">
                    <AlertCircle size={18} />
                    <span className="text-sm">{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 text-base shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                >
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      {t('login.signIn', 'Sign In')} <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </form>

              {/* Divider */}
              <div className="relative my-5 sm:my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300 dark:border-gray-600" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-gray-50 dark:bg-gray-900 px-2 text-gray-500 dark:text-gray-400">
                    {t('login.orContinueWith', 'or continue with')}
                  </span>
                </div>
              </div>

              {/* Social Sign-In Buttons */}
              <div className="flex flex-col items-center gap-3">
                <GoogleLoginButton
                  text="signin_with"
                  label="Sign in with Google"
                  onError={(msg) => setError(msg)}
                />
                <AppleLogin
                  onError={(err) => setError(err)}
                />
              </div>

              <div className="mt-6 sm:mt-8 text-center">
                <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
                  Don't have an account?{' '}
                  <Link to="/register" className="text-blue-600 hover:text-blue-700 font-medium">
                    Sign up
                  </Link>
                </p>
              </div>

              <div className="mt-6 sm:mt-8 pt-6 sm:pt-8 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 text-center">
                  Trusted by 200+ businesses across India
                </p>
              </div>
            </>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
