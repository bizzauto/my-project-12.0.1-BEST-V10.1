import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './lib/authStore';
import { MobileApp } from './lib/capacitor-app';
import PageSkeleton from './components/PageSkeleton';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import ThemeSelector from './components/ThemeSelector';
import NetworkStatus from './components/NetworkStatus';
import { UIModeProvider } from './contexts/UIModeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import PWAInstallBanner from './components/PWAInstallBanner';
import CookieConsentBanner from './components/CookieConsentBanner';
import { lazy, Suspense } from 'react';

let mobileInitDone = false;

// Public pages — lazy-loaded for code splitting
const LandingPage = lazy(() => import('./components/LandingPage'));
const LoginPage = lazy(() => import('./components/LoginPage'));
const RegisterPage = lazy(() => import('./components/RegisterPage'));
const PricingPage = lazy(() => import('./components/PricingPage'));
const TermsPage = lazy(() => import('./components/TermsPage'));
const PrivacyPage = lazy(() => import('./components/PrivacyPage'));
const RefundPolicyPage = lazy(() => import('./components/RefundPolicyPage'));
const AboutPage = lazy(() => import('./components/AboutPage'));
const ContactPage = lazy(() => import('./components/ContactPage'));
const FeaturesPage = lazy(() => import('./components/FeaturesPage'));
const ForgotPasswordPage = lazy(() => import('./components/ForgotPasswordPage'));
const VerifyEmailPage = lazy(() => import('./components/VerifyEmailPage'));
const AuthCallback = lazy(() => import('./components/AuthCallback'));
const NotFoundPage = lazy(() => import('./components/NotFoundPage'));

// Authenticated layout
import AuthLayout from './layouts/AuthLayout';

// Authenticated pages — lazy-loaded for code splitting
const Dashboard = lazy(() => import('./components/UnifiedDashboardPage'));
const WhatsAppModule = lazy(() => import('./components/WhatsAppModule'));
const CRMPage = lazy(() => import('./components/CRMPage'));
const LeadGenerationPage = lazy(() => import('./components/LeadGenerationPage'));
const LeadFinderPage = lazy(() => import('./components/LeadFinderPage'));
const OutreachCampaignPage = lazy(() => import('./components/OutreachCampaignPage'));
const AppointmentsPage = lazy(() => import('./components/AppointmentsPage'));
const ECommercePage = lazy(() => import('./components/ECommercePage'));
const PublicStorefront = lazy(() => import('./components/PublicStorefront'));
const CheckoutPage = lazy(() => import('./components/CheckoutPage'));
const PayPage = lazy(() => import('./components/PayPage'));
const OrderTrackingPage = lazy(() => import('./components/OrderTrackingPage'));
const StoreSharePage = lazy(() => import('./components/StoreSharePage'));
const SalesAnalyticsPage = lazy(() => import('./components/SalesAnalyticsPage'));
const CustomerAccountPage = lazy(() => import('./components/CustomerAccountPage'));
const BulkImportExport = lazy(() => import('./components/BulkImportExport'));
const ShippingSettings = lazy(() => import('./components/ShippingSettings'));
const DocumentsPage = lazy(() => import('./components/DocumentsPage'));
const SocialMediaPage = lazy(() => import('./components/SocialMediaPage'));
const GoogleBusinessPage = lazy(() => import('./components/GoogleBusinessPage'));
const AIChatbotPage = lazy(() => import('./components/AIChatbotPage'));
const VoiceCallPage = lazy(() => import('./components/VoiceCallPage'));
const DograhSettings = lazy(() => import('./components/DograhSettings'));
const CreativeGeneratorPage = lazy(() => import('./components/CreativeGeneratorPage'));
const AutomationPage = lazy(() => import('./components/AutomationPage'));
const ReportsPage = lazy(() => import('./components/ReportsPage'));
const ReviewsPage = lazy(() => import('./components/ReviewsPage'));
const BillingPage = lazy(() => import('./components/BillingPage'));
const ApiKeysPage = lazy(() => import('./components/ApiKeysPage'));
const AuditLogPage = lazy(() => import('./components/AuditLogPage'));
const TeamManagement = lazy(() => import('./components/TeamManagement'));
const UserProfile = lazy(() => import('./components/UserProfile'));
const SettingsPage = lazy(() => import('./components/SettingsPage'));
const SuperAdminDashboard = lazy(() => import('./components/SuperAdminDashboard'));
const UserManagementPage = lazy(() => import('./components/UserManagementPage'));
const OnboardingWizard = lazy(() => import('./components/OnboardingWizard'));
const ResorPayBoard = lazy(() => import('./components/ResorPayBoard'));
const AdmissionForm = lazy(() => import('./components/AdmissionForm'));
const EmailLeadImporter = lazy(() => import('./components/EmailLeadImporter'));
const EmailMarketingPage = lazy(() => import('./components/EmailMarketingPage'));
const WorkflowBuilder = lazy(() => import('./components/WorkflowBuilder'));
const FunnelBuilder = lazy(() => import('./components/FunnelBuilder'));
const FunnelEditorPage = lazy(() => import('./components/FunnelEditorPage'));
const FunnelPreviewPage = lazy(() => import('./components/FunnelPreviewPage'));
const SurveyBuilder = lazy(() => import('./components/SurveyBuilder'));
const CourseBuilder = lazy(() => import('./components/CourseBuilder'));
const TriggerLinks = lazy(() => import('./components/TriggerLinks'));
const PaymentLinks = lazy(() => import('./components/PaymentLinks'));
const ClientPortal = lazy(() => import('./components/ClientPortal'));
const ConversationsPage = lazy(() => import('./components/ConversationsPage'));
const CoursePlayer = lazy(() => import('./components/CoursePlayer'));
const CourseStore = lazy(() => import('./components/CourseStore'));
const MyLearning = lazy(() => import('./components/MyLearning'));
const CustomFieldsBuilder = lazy(() => import('./components/CustomFieldsBuilder'));
const SupportTicketsPage = lazy(() => import('./components/SupportTicketsPage'));
const ChangelogPage = lazy(() => import('./components/ChangelogPage'));
const StatusPage = lazy(() => import('./components/StatusPage'));
const NotificationPreferencesPage = lazy(() => import('./components/NotificationPreferencesPage'));
const ApiDocsPage = lazy(() => import('./components/ApiDocsPage'));
const WebhooksPage = lazy(() => import('./components/WebhooksPage'));
const ReferralsPage = lazy(() => import('./components/ReferralsPage'));
const RevenueDashboardPage = lazy(() => import('./components/RevenueDashboardPage'));
const QRCodeGeneratorPage = lazy(() => import('./components/QRCodeGeneratorPage'));
const AuditTrailExportPage = lazy(() => import('./components/AuditTrailExportPage'));
const BlogManager = lazy(() => import('./components/BlogManager'));
const ReviewRequests = lazy(() => import('./components/ReviewRequests'));
const AgencyDashboard = lazy(() => import('./components/AgencyDashboard'));
const MissedCallSettings = lazy(() => import('./components/MissedCallSettings'));
const SnapshotManager = lazy(() => import('./components/SnapshotManager'));
const SmartReplyPage = lazy(() => import('./components/SmartReplyPage'));
const AIContentSchedulerPage = lazy(() => import('./components/AIContentSchedulerPage'));
const VoiceToTextPage = lazy(() => import('./components/VoiceToTextPage'));
const CampaignROIPage = lazy(() => import('./components/CampaignROIPage'));
const CustomerJourneyPage = lazy(() => import('./components/CustomerJourneyPage'));
const BulkMessagingPage = lazy(() => import('./components/BulkMessagingPage'));
const AppointmentBookingPage = lazy(() => import('./components/AppointmentBookingPage'));
const InventoryManagementPage = lazy(() => import('./components/InventoryManagementPage'));
const SSOConfigPage = lazy(() => import('./components/SSOConfigPage'));
const CustomRolesPage = lazy(() => import('./components/CustomRolesPage'));
const SLAManagementPage = lazy(() => import('./components/SLAManagementPage'));
const DataBackupPage = lazy(() => import('./components/DataBackupPage'));
const LandingPageBuilderPage = lazy(() => import('./components/LandingPageBuilderPage'));
const ABTestingPage = lazy(() => import('./components/ABTestingPage'));
const GoogleAdsPage = lazy(() => import('./components/GoogleAdsPage'));
const FacebookLeadAdsPage = lazy(() => import('./components/FacebookLeadAdsPage'));
const AISalesAssistantPage = lazy(() => import('./components/AISalesAssistantPage'));
const OrderHistoryPage = lazy(() => import('./components/OrderHistoryPage'));
const CACopilotPage = lazy(() => import('./components/CACopilotPage'));
const GoogleReviewsQRPage = lazy(() => import('./components/GoogleReviewsQRPage'));
const VCardMakerPage = lazy(() => import('./components/VCardMakerPage'));
const WebsiteBuilderProductPage = lazy(() => import('./components/WebsiteBuilderProductPage'));
const ResellerDashboardPage = lazy(() => import('./components/ResellerDashboardPage'));
const ResellerAuthPage = lazy(() => import('./components/ResellerAuthPage'));
const WhiteLabelSettingsPage = lazy(() => import('./components/WhiteLabelSettingsPage'));
const WaveSettings = lazy(() => import('./components/WaveSettings'));
const PostHogSettings = lazy(() => import('./components/PostHogSettings'));
const OneSignalSettings = lazy(() => import('./components/OneSignalSettings'));
const BrevoEmailSettings = lazy(() => import('./components/BrevoEmailSettings'));

// Protected Route Component
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isInitialized, onboardingCompleted } = useAuthStore();
  const location = useLocation();
  const admissionCompleted = localStorage.getItem('admissionCompleted') === 'true';

  if (!isInitialized) {
    return <PageSkeleton />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Check if onboarding is required (only redirect if not already on /onboarding)
  if (!onboardingCompleted && !location.pathname.startsWith('/onboarding')) {
    return <Navigate to="/onboarding" replace />;
  }

  // Check if admission form is completed (skip for admission-related pages)
  // NOTE: Redirect to /resorpay (plan selection + payment) first, not /admission-form
  // ResorPayBoard redirects to /admission-form after successful payment
  if (!admissionCompleted && 
      !location.pathname.startsWith('/admission-form') && 
      !location.pathname.startsWith('/resorpay') &&
      !location.pathname.startsWith('/onboarding')) {
    return <Navigate to="/resorpay" replace />;
  }

  return <ErrorBoundary pageName={location.pathname}>{children}</ErrorBoundary>;
};

// Super Admin Route
const SuperAdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isInitialized, user } = useAuthStore();

  if (!isInitialized) {
    return <PageSkeleton />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'SUPER_ADMIN') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

function AppRoutes() {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    initialize();
    // Initialize mobile native features (status bar, splash screen, etc.)
    // React StrictMode can run effects twice in development, so guard it.
    if (!mobileInitDone) {
      mobileInitDone = true;
      void MobileApp.init();
    }
  }, [initialize]);

  return (
    <ToastProvider>
      <Suspense fallback={<PageSkeleton />}>
      <Routes>
      {/* Public Routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/refund" element={<RefundPolicyPage />} />
      <Route path="/about" element={<AboutPage />} />
        <Route path="/changelog" element={<ChangelogPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/api-docs" element={<ApiDocsPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/features" element={<FeaturesPage />} />

      {/* Onboarding */}
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <OnboardingWizard />
          </ProtectedRoute>
        }
      />

      {/* ResorPay Board - Plan Selection & Payment */}
      <Route
        path="/resorpay"
        element={
          <ProtectedRoute>
            <ResorPayBoard />
          </ProtectedRoute>
        }
      />

      {/* Admission Form - Post Payment */}
      <Route
        path="/admission-form"
        element={
          <ProtectedRoute>
            <AdmissionForm />
          </ProtectedRoute>
        }
      />

      {/* Super Admin */}
      <Route
        path="/admin"
        element={
          <SuperAdminRoute>
            <SuperAdminDashboard />
          </SuperAdminRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <SuperAdminRoute>
            <UserManagementPage />
          </SuperAdminRoute>
        }
      />

      {/* Authenticated Routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <Dashboard />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/whatsapp"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <WhatsAppModule />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/crm"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <CRMPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/leads"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <LeadGenerationPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/lead-finder"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <LeadFinderPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/outreach"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <OutreachCampaignPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/appointments"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <AppointmentsPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/ecommerce"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <ECommercePage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route path="/store" element={
        <ProtectedRoute>
          <AuthLayout>
            <PublicStorefront />
          </AuthLayout>
        </ProtectedRoute>
      } />
      <Route path="/store/:businessId" element={<PublicStorefront />} />
      <Route path="/pay/:shortCode" element={<PayPage />} />
      <Route path="/checkout" element={
        <ProtectedRoute>
          <AuthLayout>
            <CheckoutPage />
          </AuthLayout>
        </ProtectedRoute>
      } />
      <Route path="/order-tracking" element={
        <ProtectedRoute>
          <OrderTrackingPage />
        </ProtectedRoute>
      } />
      <Route path="/order-tracking/:orderNumber" element={
        <ProtectedRoute>
          <OrderTrackingPage />
        </ProtectedRoute>
      } />
      <Route path="/store-share" element={
        <ProtectedRoute>
          <AuthLayout>
            <StoreSharePage />
          </AuthLayout>
        </ProtectedRoute>
      } />
      <Route path="/support-tickets" element={
        <ProtectedRoute>
          <AuthLayout>
            <SupportTicketsPage />
          </AuthLayout>
        </ProtectedRoute>
      } />
      <Route path="/notification-preferences" element={
        <ProtectedRoute>
          <AuthLayout>
            <NotificationPreferencesPage />
          </AuthLayout>
        </ProtectedRoute>
      } />
      <Route path="/webhooks" element={
        <ProtectedRoute>
          <AuthLayout>
            <WebhooksPage />
          </AuthLayout>
        </ProtectedRoute>
      } />
      <Route path="/referrals" element={
        <ProtectedRoute>
          <AuthLayout>
            <ReferralsPage />
          </AuthLayout>
        </ProtectedRoute>
      } />
      <Route path="/revenue" element={
        <ProtectedRoute>
          <AuthLayout>
            <RevenueDashboardPage />
          </AuthLayout>
        </ProtectedRoute>
      } />
      <Route path="/qr-generator" element={
        <ProtectedRoute>
          <AuthLayout>
            <QRCodeGeneratorPage />
          </AuthLayout>
        </ProtectedRoute>
      } />
      <Route path="/audit-export" element={
        <ProtectedRoute>
          <AuthLayout>
            <AuditTrailExportPage />
          </AuthLayout>
        </ProtectedRoute>
      } />
      <Route path="/analytics" element={<Navigate to="/dashboard" replace />} />
      <Route path="/my-account" element={
        <ProtectedRoute>
          <AuthLayout>
            <CustomerAccountPage />
          </AuthLayout>
        </ProtectedRoute>
      } />
      <Route path="/bulk-import" element={
        <ProtectedRoute>
          <AuthLayout>
            <BulkImportExport />
          </AuthLayout>
        </ProtectedRoute>
      } />
      <Route path="/shipping-settings" element={
        <ProtectedRoute>
          <AuthLayout>
            <ShippingSettings />
          </AuthLayout>
        </ProtectedRoute>
      } />
      <Route
        path="/documents"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <DocumentsPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/social"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <SocialMediaPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/google-business"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <GoogleBusinessPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/ai-chatbot"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <AIChatbotPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/voice-call"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <VoiceCallPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/creative"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <CreativeGeneratorPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/automation"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <AutomationPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route path="/reports" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="/import-leads"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <EmailLeadImporter />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reviews"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <ReviewsPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />

      {/* Email Marketing */}
      <Route
        path="/email-marketing"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <EmailMarketingPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />

      {/* Automation & AI */}
      <Route
        path="/workflows"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <WorkflowBuilder />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/trigger-links"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <TriggerLinks />
            </AuthLayout>
          </ProtectedRoute>
        }
      />

      {/* Marketing */}
      <Route
        path="/surveys"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <SurveyBuilder />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/blog"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <BlogManager />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/review-requests"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <ReviewRequests />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/payment-links"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <PaymentLinks />
            </AuthLayout>
          </ProtectedRoute>
        }
      />

      {/* Courses */}
      <Route
        path="/courses"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <CourseBuilder />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/course-store"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <CourseStore />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-learning"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <MyLearning />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/course-player/:courseId"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <CoursePlayer />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/funnels"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <FunnelBuilder />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/funnels/:id"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <FunnelEditorPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/funnels/:id/preview"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <FunnelPreviewPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/conversations"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <ConversationsPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />

      {/* Settings */}
      <Route
        path="/custom-fields"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <CustomFieldsBuilder />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/client-portal"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <ClientPortal />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/agency"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <AgencyDashboard />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/missed-call-settings"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <MissedCallSettings />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/dograh-settings"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <DograhSettings />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/snapshots"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <SnapshotManager />
            </AuthLayout>
          </ProtectedRoute>
        }
      />

      {/* Settings & Profile */}
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <UserProfile />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <SettingsPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/billing"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <BillingPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/team"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <TeamManagement />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/api-keys"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <ApiKeysPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/audit-log"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <AuditLogPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />

      {/* New SaaS Features */}
      <Route path="/smart-reply" element={<ProtectedRoute><AuthLayout><SmartReplyPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/content-scheduler" element={<ProtectedRoute><AuthLayout><AIContentSchedulerPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/voice-to-text" element={<ProtectedRoute><AuthLayout><VoiceToTextPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/campaign-roi" element={<ProtectedRoute><AuthLayout><CampaignROIPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/customer-journey" element={<ProtectedRoute><AuthLayout><CustomerJourneyPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/bulk-messaging" element={<ProtectedRoute><AuthLayout><BulkMessagingPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/appointment-booking" element={<ProtectedRoute><AuthLayout><AppointmentBookingPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/inventory" element={<ProtectedRoute><AuthLayout><InventoryManagementPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/sso-config" element={<ProtectedRoute><AuthLayout><SSOConfigPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/custom-roles" element={<ProtectedRoute><AuthLayout><CustomRolesPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/sla-management" element={<ProtectedRoute><AuthLayout><SLAManagementPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/data-backup" element={<ProtectedRoute><AuthLayout><DataBackupPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/landing-page-builder" element={<ProtectedRoute><AuthLayout><LandingPageBuilderPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/ab-testing" element={<ProtectedRoute><AuthLayout><ABTestingPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/google-ads" element={<ProtectedRoute><AuthLayout><GoogleAdsPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/facebook-leads" element={<ProtectedRoute><AuthLayout><FacebookLeadAdsPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/ai-sales-assistant" element={<ProtectedRoute><AuthLayout><AISalesAssistantPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/order-history" element={<ProtectedRoute><AuthLayout><OrderHistoryPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/ca-copilot" element={<ProtectedRoute><AuthLayout><CACopilotPage /></AuthLayout></ProtectedRoute>} />

      {/* Product Features */}
      <Route path="/google-reviews-qr" element={<ProtectedRoute><AuthLayout><GoogleReviewsQRPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/vcard-maker" element={<ProtectedRoute><AuthLayout><VCardMakerPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/website-builder-product" element={<ProtectedRoute><AuthLayout><WebsiteBuilderProductPage /></AuthLayout></ProtectedRoute>} />

      {/* White-Label Settings */}
      <Route
        path="/settings/white-label"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <WhiteLabelSettingsPage />
            </AuthLayout>
          </ProtectedRoute>
        }
      />

      {/* Wave Accounting Settings */}
      <Route
        path="/settings/wave"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <WaveSettings />
            </AuthLayout>
          </ProtectedRoute>
        }
      />

      {/* PostHog Analytics Settings */}
      <Route
        path="/settings/posthog"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <PostHogSettings />
            </AuthLayout>
          </ProtectedRoute>
        }
      />

      {/* OneSignal Push Notifications Settings */}
      <Route
        path="/settings/onesignal"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <OneSignalSettings />
            </AuthLayout>
          </ProtectedRoute>
        }
      />

      {/* Brevo Email Settings */}
      <Route
        path="/settings/brevo-email"
        element={
          <ProtectedRoute>
            <AuthLayout>
              <BrevoEmailSettings />
            </AuthLayout>
          </ProtectedRoute>
        }
      />

      {/* Reseller Hub */}
      <Route path="/reseller-hub" element={<ProtectedRoute><AuthLayout><ResellerDashboardPage /></AuthLayout></ProtectedRoute>} />
      <Route path="/reseller-login" element={<ResellerAuthPage />} />
      <Route path="/reseller-register" element={<ResellerAuthPage />} />

      {/* Redirects */}
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
      </Suspense>
    <NetworkStatus />
    <ThemeSelector />
    <PWAInstallBanner />
    <CookieConsentBanner />
    </ToastProvider>
  );
}

export { ProtectedRoute, SuperAdminRoute };

export default function AppWrapper() {
  return (
      <ErrorBoundary>
        <LanguageProvider>
          <UIModeProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </UIModeProvider>
        </LanguageProvider>
      </ErrorBoundary>
  );
}
