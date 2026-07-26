import { useState } from 'react';
import { useToast } from '../components/Toast';
import { subscriptionsAPI } from '../lib/api';
import { Check, Loader2, CreditCard, Shield, Zap, HeadphonesIcon, Users, MessageSquare, Image, RefreshCw, Globe, Mail, Smartphone, BarChart3, Bot, ShoppingCart, Layout, Video, FileText, Wifi, Link2, Target } from 'lucide-react';
import PublicNavbar from './PublicNavbar';
import Footer from './Footer';

interface Plan {
  id: string;
  name: string;
  tagline: string;
  price: { month: number; year: number };
  features: string[];
  highlightedFeatures: string[];
  popular?: boolean;
  cta?: string;
}

interface PricingCardProps {
  plan: Plan;
  onSelect: (plan: string, period: 'month' | 'year') => void;
  loading?: boolean;
  period: 'month' | 'year';
  onPeriodChange: (p: 'month' | 'year') => void;
}

const featureIcons: Record<string, React.ReactNode> = {
  contacts: <Users size={14} />,
  messages: <MessageSquare size={14} />,
  ai: <Bot size={14} />,
  users: <Users size={14} />,
  crm: <Target size={14} />,
  analytics: <BarChart3 size={14} />,
  support: <HeadphonesIcon size={14} />,
  automation: <RefreshCw size={14} />,
  whiteLabel: <Shield size={14} />,
  api: <Wifi size={14} />,
  branding: <Image size={14} />,
  email: <Mail size={14} />,
  sms: <Smartphone size={14} />,
  social: <Globe size={14} />,
  ecommerce: <ShoppingCart size={14} />,
  pages: <Layout size={14} />,
  video: <Video size={14} />,
  docs: <FileText size={14} />,
  integrations: <Link2 size={14} />,
  multiTenant: <Users size={14} />,
};

const PricingCard: React.FC<PricingCardProps> = ({ plan, onSelect, loading, period, onPeriodChange }) => {
  const price = period === 'month' ? plan.price.month : plan.price.year;
  const yearlyMonthlyEquivalent = plan.price.year / 12;
  const savings = plan.price.month > 0
    ? Math.round((1 - yearlyMonthlyEquivalent / plan.price.month) * 100)
    : 0;

  return (
    <div
      className={`relative bg-white dark:bg-gray-800 rounded-2xl border-2 transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 flex flex-col ${
        plan.popular
          ? 'border-blue-500 shadow-xl shadow-blue-500/10 lg:scale-105 z-10'
          : plan.id === 'ENTERPRISE'
          ? 'border-purple-500/50 shadow-lg shadow-purple-500/10 hover:border-purple-500'
          : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-500/50'
      }`}
    >
      {/* Badges */}
      {plan.popular && (
        <div className="absolute -top-3 sm:-top-4 left-1/2 transform -translate-x-1/2 z-20">
          <span className="bg-gradient-to-r from-blue-600 to-purple-600 text-white text-[10px] sm:text-xs font-bold px-3 py-1 sm:px-4 sm:py-1.5 rounded-full whitespace-nowrap shadow-lg shadow-blue-500/25">
            ✨ Most Popular
          </span>
        </div>
      )}
      {plan.id === 'ENTERPRISE' && (
        <div className="absolute -top-3 sm:-top-4 left-1/2 transform -translate-x-1/2 z-20">
          <span className="bg-gradient-to-r from-purple-600 to-pink-600 text-white text-[10px] sm:text-xs font-bold px-3 py-1 sm:px-4 sm:py-1.5 rounded-full whitespace-nowrap shadow-lg shadow-purple-500/25">
            🚀 Best Value
          </span>
        </div>
      )}

      <div className="p-5 sm:p-6 flex flex-col flex-1">
        {/* Name + Tagline */}
        <div className="mb-3">
          <h3 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">{plan.name}</h3>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1 leading-tight">{plan.tagline}</p>
        </div>

        {/* Period toggle - only for non-Free */}
        {plan.id !== 'FREE' && (
          <div className="flex items-center gap-1 mb-4 p-1 bg-gray-100 dark:bg-gray-700/50 rounded-xl">
            <button
              onClick={() => onPeriodChange('month')}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                period === 'month'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => onPeriodChange('year')}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                period === 'year'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Yearly
              {period === 'year' && savings > 0 && (
                <span className="ml-1 text-[10px] text-green-500 font-bold">Save {savings}%</span>
              )}
            </button>
          </div>
        )}

        {/* Price */}
        <div className="mb-4 sm:mb-5">
          {plan.price.month === 0 ? (
            <div className="flex items-baseline gap-1">
              <span className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">Free</span>
              <span className="text-gray-500 dark:text-gray-400 text-sm">forever</span>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-1 flex-wrap">
                <span className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
                  ₹{price.toLocaleString()}
                </span>
                <span className="text-gray-500 dark:text-gray-400 text-sm sm:text-base">/{period}</span>
              </div>
              {savings > 0 && period === 'year' && (
                <p className="text-xs sm:text-sm text-green-600 dark:text-green-400 mt-1 font-medium">
                  🎉 Save {savings}% with yearly billing
                </p>
              )}
              {period === 'month' && plan.price.month > 0 && plan.price.year > 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  ₹{plan.price.year.toLocaleString()}/year (save {savings}%)
                </p>
              )}
            </>
          )}
        </div>

        {/* Highlighted Features (badge-style) */}
        {plan.highlightedFeatures.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {plan.highlightedFeatures.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/20"
              >
                {featureIcons[f] || null}
                {f === 'contacts' && 'Contacts'}
                {f === 'messages' && 'WhatsApp'}
                {f === 'ai' && 'AI Credits'}
                {f === 'users' && 'Team'}
                {f === 'crm' && 'CRM'}
                {f === 'analytics' && 'Analytics'}
                {f === 'support' && 'Support'}
                {f === 'automation' && 'Automation'}
                {f === 'whiteLabel' && 'White Label'}
                {f === 'api' && 'API Access'}
                {f === 'branding' && 'Custom Branding'}
                {f === 'email' && 'Email'}
                {f === 'sms' && 'SMS'}
                {f === 'social' && 'Social'}
                {f === 'ecommerce' && 'E-commerce'}
                {f === 'pages' && 'Pages'}
                {f === 'video' && 'Video'}
                {f === 'docs' && 'Documents'}
                {f === 'integrations' && 'Integrations'}
                {f === 'multiTenant' && 'Multi-tenant'}
              </span>
            ))}
          </div>
        )}

        {/* Features List */}
        <ul className="space-y-2.5 sm:space-y-3 mb-5 sm:mb-6 flex-1">
          {plan.features.map((feature, index) => (
            <li key={index} className="flex items-start gap-2.5 text-xs sm:text-sm">
              <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Check size={12} className="text-green-600 dark:text-green-400" />
              </div>
              <span className="text-gray-700 dark:text-gray-300 leading-relaxed">{feature}</span>
            </li>
          ))}
        </ul>

        {/* CTA Button */}
        <button
          onClick={() => onSelect(plan.id, period)}
          disabled={loading || plan.id === 'FREE'}
          className={`w-full py-3.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer mt-auto ${
            plan.popular
              ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5 active:translate-y-0'
              : plan.id === 'ENTERPRISE'
              ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700 shadow-lg shadow-purple-500/25 hover:shadow-xl'
              : plan.id === 'FREE'
              ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-default'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-600'
          } disabled:opacity-50`}
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <CreditCard size={18} />
              {plan.cta || (plan.id === 'FREE' ? 'Current Plan' : 'Get Started')}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

// Category icons for the feature grid
const categoryIcons: Record<string, React.ReactNode> = {
  'E-commerce': <ShoppingCart size={20} />,
  'Marketing': <Mail size={20} />,
  'Social Media': <Globe size={20} />,
  'Content': <Layout size={20} />,
  'Communication': <MessageSquare size={20} />,
  'Business': <Target size={20} />,
  'AI & Automation': <Bot size={20} />,
  'Voice': <HeadphonesIcon size={20} />,
  'Integrations': <Link2 size={20} />,
};

const allProductFeatures: { category: string; items: string[] }[] = [
  {
    category: 'AI & Automation',
    items: [
      'AI Content Generator (50+ templates)',
      'AI Image & Poster Generator',
      'AI Caption & Hashtag Generator',
      'AI Sales Assistant',
      'AI Smart Replies',
      'AI Review Reply Generator',
      'Visual Workflow Builder',
      'Automation Rules (Triggers & Actions)',
      'Auto-reply Chatbots',
    ],
  },
  {
    category: 'Marketing',
    items: [
      'WhatsApp Campaigns (Broadcast + Drip)',
      'Email Marketing (Brevo Integration)',
      'SMS Marketing Campaigns',
      'Drip Campaign Builder',
      'Review Request Campaigns',
      'Referral Program',
      'Coupon & Discount Engine',
      'Flash Sales & Offers',
    ],
  },
  {
    category: 'Social Media',
    items: [
      'Facebook Page Publishing',
      'Instagram Reels & Posts',
      'LinkedIn Pages',
      'Twitter/X Publishing',
      'YouTube Integration',
      'Google Business Profile Management',
      'Auto-Post Scheduling',
      'Social Media Analytics',
    ],
  },
  {
    category: 'E-commerce',
    items: [
      'Online Storefront',
      'Product Catalog (Unlimited)',
      'Order Management',
      'Abandoned Cart Recovery',
      'Wishlists',
      'Gift Cards',
      'Product Bundles',
      'Inventory Management',
    ],
  },
  {
    category: 'Communication',
    items: [
      'WhatsApp Business API',
      'Live Chat Widget',
      'Support Ticket System',
      'Client Portal',
      'Video Meetings (Jitsi)',
      'SMS Notifications',
      'Push Notifications (OneSignal)',
    ],
  },
  {
    category: 'Business',
    items: [
      'Full CRM with Pipelines',
      'Lead Scoring (AI-powered)',
      'Lead Finder (Google Maps)',
      'Appointment Booking',
      'Online Storefront',
      'Invoices & Accounting',
      'Document Generator',
      'QR Code Generator',
      'VCard Generator',
    ],
  },
  {
    category: 'Content',
    items: [
      'Blog Management',
      'Funnel Builder (Drag & Drop)',
      'Landing Pages',
      'Website Builder',
      'Poster Designer',
      'Course Builder (AI-powered)',
      'Survey Builder',
    ],
  },
  {
    category: 'Integrations',
    items: [
      'Razorpay Payments',
      'Wave Accounting',
      'PostHog Analytics',
      'Google Analytics',
      'Facebook Pixel',
      'SSO / Google & Apple Auth',
      'Webhook & API Access',
      'Zapier-like Trigger Links',
    ],
  },
  {
    category: 'Voice',
    items: [
      'AI Voice Calling (Dograh)',
      'Call Logging & Recording',
      'Wallet for Call Credits',
      'Missed Call Tracking',
      'IVR Workflows',
    ],
  },
];

interface PricingPageV2Props {
  onNavigate?: (page: string) => void;
}

export default function PricingPageV2({ onNavigate }: PricingPageV2Props) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [globalPeriod, setGlobalPeriod] = useState<'month' | 'year'>('month');
  const [showAllFeatures, setShowAllFeatures] = useState(false);

  const plans: Plan[] = [
    {
      id: 'FREE',
      name: 'Free',
      tagline: 'Perfect for trying out BizzAuto',
      price: { month: 0, year: 0 },
      highlightedFeatures: [],
      features: [
        'Up to 100 contacts',
        '100 WhatsApp messages/month',
        '10 AI credits',
        '1 Image/day',
        '1 team member',
        'Basic CRM',
        'Community support',
      ],
      cta: 'Current Plan',
    },
    {
      id: 'STARTER',
      name: 'Starter',
      tagline: 'Ideal for small businesses getting started',
      price: { month: 999, year: 9990 },
      highlightedFeatures: ['contacts', 'messages', 'ai', 'image', 'users', 'crm'],
      features: [
        'Up to 1,000 contacts',
        '5,000 WhatsApp messages/month',
        '100 AI credits',
        '3 Images/day',
        'Up to 3 team members',
        'Full CRM with Pipelines',
        'Email marketing campaigns',
        'Appointment booking',
        'Social media publishing (FB, IG)',
        'Basic analytics dashboard',
        'Email support',
      ],
    },
    {
      id: 'GROWTH',
      name: 'Growth',
      tagline: 'Best for growing teams & businesses',
      price: { month: 2499, year: 24990 },
      highlightedFeatures: ['contacts', 'messages', 'ai', 'image', 'users', 'analytics', 'automation'],
      popular: true,
      features: [
        'Up to 10,000 contacts',
        '25,000 WhatsApp messages/month',
        '500 AI credits (content & posters)',
        '10 Images/day',
        'Up to 10 team members',
        'Advanced CRM with AI lead scoring',
        'Visual automation workflows',
        'Email + SMS marketing campaigns',
        'Social media (FB, IG, LinkedIn, Twitter)',
        'Blog & funnel builder',
        'E-commerce store & orders',
        'Advanced analytics & reports',
        'Priority support',
      ],
    },
    {
      id: 'PRO',
      name: 'Pro',
      tagline: 'For established businesses at scale',
      price: { month: 4999, year: 49990 },
      highlightedFeatures: ['contacts', 'messages', 'users', 'whiteLabel', 'api', 'integrations'],
      features: [
        'Up to 50,000 contacts',
        '100,000 WhatsApp messages/month',
        '1,000 AI credits',
        '20 Images/day',
        'Unlimited team members',
        'Everything in Growth, plus:',
        'White-label (custom domain & branding)',
        'Custom integrations via API',
        'Dedicated support manager',
        'Lead finder (Google Maps)',
        'Course builder & online learning',
        'Client portal & ticket system',
        'Revenue analytics (MRR/ARR)',
      ],
    },
    {
      id: 'ENTERPRISE',
      name: 'Enterprise',
      tagline: 'Full power for large organizations',
      price: { month: 19999, year: 199990 },
      highlightedFeatures: ['contacts', 'messages', 'ai', 'integrations', 'support', 'api'],
      features: [
        'Unlimited contacts',
        'Unlimited WhatsApp messages',
        'Unlimited AI credits',
        'Unlimited Images',
        'Unlimited team members',
        'Full white-label with custom domain',
        'Dedicated infrastructure',
        'SLA guarantee (99.9% uptime)',
        'Custom feature development',
        'On-premise deployment option',
        '24/7 dedicated support',
      ],
    },
  ];

  const handleSelectPlan = async (planId: string, period: 'month' | 'year') => {
    if (planId === 'FREE') return;

    setLoading(true);

    try {
      if (!(window as any).Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Razorpay SDK'));
          document.body.appendChild(script);
        });
      }

      if (!localStorage.getItem('csrfToken')) {
        try { await subscriptionsAPI.getCurrent(); } catch {}
      }

      const response = await subscriptionsAPI.createCheckout({ plan: planId, period });
      const { orderId, amount, currency, key } = response.data.data;

      const options = {
        key,
        amount,
        currency,
        name: 'BizzAuto',
        description: `${planId} Plan - ${period === 'month' ? 'Monthly' : 'Yearly'}`,
        order_id: orderId,
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            const verifyResponse = await subscriptionsAPI.verify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              plan: planId,
              period,
            });

            if (verifyResponse.data.success) {
              toast.success('Payment successful! Subscription activated.');
              if (onNavigate) {
                setTimeout(() => onNavigate('dashboard'), 1500);
              }
            } else {
              toast.error('Payment verification failed');
            }
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Payment verification failed';
            toast.error(msg);
          }
        },
        prefill: { email: '', contact: '' },
        theme: { color: '#3B82F6' },
        modal: { ondismiss: () => toast.info('Payment cancelled') },
      };

      const razorpay = new (window as any).Razorpay(options);
      razorpay.open();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to create checkout';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <PublicNavbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-8">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 mb-3">
            Simple透明的 Pricing
          </span>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-3 sm:mb-4 px-2">
            Plans That Scale With Your Business
          </h1>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400 max-w-3xl mx-auto px-4">
            One platform — everything you need to manage contacts, send WhatsApp messages, run campaigns,
            and grow your business online. No hidden fees.
          </p>
        </div>

        {/* Global Period Toggle */}
        <div className="flex justify-center mb-8 sm:mb-10">
          <div className="inline-flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setGlobalPeriod('month')}
              className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                globalPeriod === 'month'
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Monthly Billing
            </button>
            <button
              onClick={() => setGlobalPeriod('year')}
              className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                globalPeriod === 'year'
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Yearly Billing
              <span className="ml-1.5 text-[10px] font-bold text-green-500 bg-green-100 dark:bg-green-500/10 px-1.5 py-0.5 rounded">Save ~17%</span>
            </button>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-6 gap-4 sm:gap-6">
          {plans.map((plan) => (
            <PricingCard
              key={plan.id}
              plan={plan}
              onSelect={handleSelectPlan}
              loading={loading}
              period={globalPeriod}
              onPeriodChange={setGlobalPeriod}
            />
          ))}
        </div>

        {/* Feature Comparison Section */}
        <div className="mt-16 sm:mt-24 max-w-5xl mx-auto">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-3">
              Everything You Get
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              One platform, 50+ features — all plans include core access
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {allProductFeatures.map((cat) => (
              <div
                key={cat.category}
                className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-5 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
                    {categoryIcons[cat.category] || <Zap size={20} />}
                  </div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">{cat.category}</h3>
                </div>
                <ul className="space-y-1.5">
                  {(showAllFeatures ? cat.items : cat.items.slice(0, 4)).map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400">
                      <Check size={12} className="text-green-500 mt-0.5 flex-shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                  {!showAllFeatures && cat.items.length > 4 && (
                    <li className="text-xs text-blue-500 font-medium pt-1">
                      +{cat.items.length - 4} more...
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>

          {!showAllFeatures && (
            <div className="text-center mt-6">
              <button
                onClick={() => setShowAllFeatures(true)}
                className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors cursor-pointer"
              >
                Show all features →
              </button>
            </div>
          )}
        </div>

        {/* FAQ Section */}
        <div className="mt-16 sm:mt-24 max-w-3xl mx-auto pb-12 sm:pb-16 px-2 sm:px-0">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white text-center mb-6 sm:mb-8">
            Frequently Asked Questions
          </h2>

          <div className="space-y-4 sm:space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Can I switch plans anytime?
              </h3>
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
                Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately.
                When upgrading, you pay the prorated difference. When downgrading, your new limits apply
                from the next billing cycle.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">
                What payment methods do you accept?
              </h3>
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
                We accept all major payment methods including credit/debit cards, UPI, net banking, and
                wallets via Razorpay — India's leading payment gateway.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Is there a free trial?
              </h3>
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
                All paid plans come with a 7-day free trial. No credit card required. Cancel anytime
                before the trial ends and you won't be charged.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">
                What happens when I exceed my plan limits?
              </h3>
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
                You'll receive notifications when you're approaching your limits. You can upgrade your
                plan anytime to continue using all features without interruption. We never cut off service
                without notice.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Can I use my own domain & branding?
              </h3>
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
                Yes! White-labeling with custom domain and branding is available on the Pro plan and
                above. Agencies can customize branding per client on the Agency plan.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Do you offer custom enterprise plans?
              </h3>
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
                Absolutely. The Enterprise plan can be customized to your specific needs — dedicated
                infrastructure, custom features, on-premise deployment, and volume discounts.
                <a href="#contact" className="text-blue-600 dark:text-blue-400 hover:underline ml-1">
                  Contact our sales team.
                </a>
              </p>
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="text-center pb-12 sm:pb-16">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-8 sm:p-12 max-w-4xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
              Ready to transform your business?
            </h2>
            <p className="text-blue-100 text-sm sm:text-base mb-6 max-w-xl mx-auto">
              Join thousands of businesses using BizzAuto to manage contacts, send campaigns, and grow smarter.
            </p>
            <button
              onClick={() => document.querySelector('.grid')?.scrollIntoView({ behavior: 'smooth' })}
              className="bg-white text-blue-700 font-semibold px-8 py-3.5 rounded-xl hover:bg-blue-50 transition-all shadow-lg cursor-pointer"
            >
              Compare Plans ↑
            </button>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
