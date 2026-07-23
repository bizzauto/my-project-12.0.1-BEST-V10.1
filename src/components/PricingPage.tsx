import { useState } from 'react';
import { useToast } from '../components/Toast';
import { subscriptionsAPI } from '../lib/api';
import { Check, Loader2, CreditCard } from 'lucide-react';
import PublicNavbar from './PublicNavbar';
import Footer from './Footer';

interface Plan {
  id: string;
  name: string;
  price: { month: number; year: number };
  features: string[];
  popular?: boolean;
}

interface PricingCardProps {
  plan: Plan;
  onSelect: (plan: string, period: 'month' | 'year') => void;
  loading?: boolean;
}

const PricingCard: React.FC<PricingCardProps> = ({ plan, onSelect, loading }) => {
  const [period, setPeriod] = useState<'month' | 'year'>('month');

  const price = period === 'month' ? plan.price.month : plan.price.year;
  const savings = period === 'year' ? Math.round((plan.price.month * 12 - plan.price.year) / plan.price.month * 100) : 0;

  return (
    <div
      className={`relative bg-white dark:bg-gray-800 rounded-2xl border-2 transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 ${
        plan.popular
          ? 'border-blue-500 shadow-xl shadow-blue-500/10 lg:scale-105'
          : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-500/50'
      }`}
    >
      {plan.popular && (
        <div className="absolute -top-3 sm:-top-4 left-1/2 transform -translate-x-1/2">
          <span className="bg-gradient-to-r from-blue-600 to-purple-600 text-white text-[10px] sm:text-xs font-bold px-3 py-1 sm:px-4 sm:py-1.5 rounded-full whitespace-nowrap shadow-lg shadow-blue-500/25">
            ✨ Most Popular
          </span>
        </div>
      )}

      <div className="p-5 sm:p-6">
        <h3 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-2">{plan.name}</h3>

        {/* Period toggle */}
        <div className="flex items-center gap-1 mb-4 p-1 bg-gray-100 dark:bg-gray-700/50 rounded-xl">
          <button
            onClick={() => setPeriod('month')}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer ${
              period === 'month'
                ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setPeriod('year')}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer ${
              period === 'year'
                ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Yearly
          </button>
        </div>

        {/* Price */}
        <div className="mb-4 sm:mb-6">
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
              ₹{price.toLocaleString()}
            </span>
            <span className="text-gray-500 dark:text-gray-400 text-sm sm:text-base">/{period}</span>
          </div>
          {savings > 0 && (
            <p className="text-xs sm:text-sm text-green-600 dark:text-green-400 mt-1 font-medium">
              🎉 Save {savings}% with yearly billing
            </p>
          )}
        </div>

        {/* Features */}
        <ul className="space-y-2.5 sm:space-y-3 mb-5 sm:mb-6">
          {plan.features.map((feature, index) => (
            <li key={index} className="flex items-start gap-2.5 text-xs sm:text-sm">
              <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Check size={12} className="text-green-600 dark:text-green-400" />
              </div>
              <span className="text-gray-700 dark:text-gray-300">{feature}</span>
            </li>
          ))}
        </ul>

        {/* CTA Button */}
        <button
          onClick={() => onSelect(plan.id, period)}
          disabled={loading}
          className={`w-full py-3.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            plan.popular
              ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5 active:translate-y-0'
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
              Get Started
            </>
          )}
        </button>
      </div>
    </div>
  );
};

interface PricingPageProps {
  onNavigate?: (page: string) => void;
}

export default function PricingPage({ onNavigate }: PricingPageProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [plans] = useState<Plan[]>([
    {
      id: 'FREE',
      name: 'Free',
      price: { month: 0, year: 0 },
      features: [
        '100 Contacts',
        '100 WhatsApp messages/month',
        '10 AI credits',
        '1 User',
        'Basic CRM',
      ],
    },
    {
      id: 'STARTER',
      name: 'Starter',
      price: { month: 999, year: 9990 },
      features: [
        '1,000 Contacts',
        '5,000 WhatsApp messages/month',
        '100 AI credits',
        '3 Users',
        'Full CRM & Pipeline',
        'Email Support',
      ],
      popular: false,
    },
    {
      id: 'GROWTH',
      name: 'Growth',
      price: { month: 2499, year: 24990 },
      features: [
        '10,000 Contacts',
        '25,000 WhatsApp messages/month',
        '500 AI credits',
        '10 Users',
        'Advanced Analytics',
        'Priority Support',
        'Automation Workflows',
      ],
      popular: true,
    },
    {
      id: 'PRO',
      name: 'Pro',
      price: { month: 4999, year: 49990 },
      features: [
        '50,000 Contacts',
        '100,000 WhatsApp messages/month',
        '2,000 AI credits',
        '25 Users',
        'White Label',
        'Dedicated Support',
        'Custom Integrations',
        'API Access',
      ],
    },
    {
      id: 'AGENCY',
      name: 'Agency',
      price: { month: 9999, year: 99990 },
      features: [
        'Unlimited Contacts',
        'Unlimited WhatsApp messages',
        '10,000 AI credits',
        'Unlimited Users',
        'Multi-tenant Support',
        'Custom Branding',
        'Premium Support',
        'SLA Guarantee',
      ],
    },
  ]);

  const handleSelectPlan = async (planId: string, period: 'month' | 'year') => {
    if (planId === 'FREE') {
      toast.info('You are already on the Free plan');
      return;
    }

    setLoading(true);

    try {
      // Load Razorpay SDK
      if (!(window as any).Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Razorpay SDK'));
          document.body.appendChild(script);
        });
      }

      // Seed the CSRF token before the checkout POST. The backend requires an
      // X-CSRF-Token header on authenticated state-changing requests, but the
      // token is only stored after a prior authenticated response returns it.
      // A subscriber landing directly on /pricing may not have one yet, which
      // caused checkout to fail with a 403 before Razorpay ever opened.
      if (!localStorage.getItem('csrfToken')) {
        try {
          await subscriptionsAPI.getCurrent();
        } catch {
          // Non-fatal: response interceptor still captures the CSRF header if present
        }
      }

      // Create Razorpay order
      const response = await subscriptionsAPI.createCheckout({ plan: planId, period });
      const { orderId, amount, currency, key } = response.data.data;

      // Open Razorpay checkout
      const options = {
        key,
        amount,
        currency,
        name: 'BizzAuto',
        description: `${planId} Plan - ${period === 'month' ? 'Monthly' : 'Yearly'}`,
        order_id: orderId,
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            // Verify payment on backend
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
        prefill: {
          email: '',
          contact: '',
        },
        theme: {
          color: '#3B82F6',
        },
        modal: {
          ondismiss: () => {
            toast.info('Payment cancelled');
          },
        },
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
        <div className="text-center mb-10 sm:mb-16">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-3 sm:mb-4 px-2">
            Simple, Transparent Pricing
          </h1>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto px-4">
            Choose the plan that fits your business needs. All plans include a 7-day free trial.
          </p>
        </div>

        {/* Pricing Cards - 1 col on mobile, 2 on tablet, 3-5 on desktop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 sm:gap-6">
          {plans.map((plan) => (
            <PricingCard
              key={plan.id}
              plan={plan}
              onSelect={handleSelectPlan}
              loading={loading}
            />
          ))}
        </div>

        {/* FAQ Section */}
        <div className="mt-12 sm:mt-20 max-w-3xl mx-auto pb-12 sm:pb-16 px-2 sm:px-0">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white text-center mb-6 sm:mb-8">
            Frequently Asked Questions
          </h2>

          <div className="space-y-4 sm:space-y-6">
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Can I switch plans anytime?
              </h3>
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
                Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately.
              </p>
            </div>

            <div>
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">
                What payment methods do you accept?
              </h3>
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
                We accept all major payment methods including credit/debit cards, UPI, net banking, and wallets via Razorpay.
              </p>
            </div>

            <div>
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Is there a free trial?
              </h3>
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
                Yes, all paid plans come with a 7-day free trial. No credit card required.
              </p>
            </div>

            <div>
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">
                What happens when I exceed my plan limits?
              </h3>
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
                You'll be notified when you're approaching your limits. You can upgrade your plan to continue using the service without interruption.
              </p>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
