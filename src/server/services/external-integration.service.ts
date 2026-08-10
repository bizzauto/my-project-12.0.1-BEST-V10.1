import { PrismaClient } from '@prisma/client';
import { encryptData, decryptData } from './data-encryption.service.js';

const prisma = new PrismaClient();

export interface ExternalIntegrationConfig {
  baseUrl?: string;
  webhookSecret?: string;
  additionalFields?: Record<string, string>;
}

export interface ExternalIntegration {
  id: string;
  businessId: string;
  provider: string;
  name: string;
  config: ExternalIntegrationConfig | null;
  isActive: boolean;
  lastTestedAt: Date | null;
  lastTestStatus: 'success' | 'failed' | null;
  lastTestError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExternalIntegrationInput {
  businessId: string;
  provider: string;
  name: string;
  apiKey: string;
  config?: ExternalIntegrationConfig;
}

export interface TestIntegrationResult {
  success: boolean;
  error?: string;
  details?: any;
}

/**
 * Service for managing external business integrations
 * Encrypts API keys at rest, provides test/validation capabilities
 */
export class ExternalIntegrationService {
  /**
   * Encrypt an API key for storage
   */
  static encryptApiKey(apiKey: string): string {
    return encryptData(apiKey);
  }

  /**
   * Decrypt an API key from storage
   */
  static decryptApiKey(encryptedKey: string): string {
    return decryptData(encryptedKey);
  }

  /**
   * Create a new external integration
   */
  static async create(input: CreateExternalIntegrationInput): Promise<ExternalIntegration> {
    const encryptedApiKey = this.encryptApiKey(input.apiKey);

    const integration = await prisma.externalIntegration.create({
      data: {
        businessId: input.businessId,
        provider: input.provider,
        name: input.name,
        apiKeyEncrypted: encryptedApiKey,
        config: input.config as any,
        isActive: true,
      },
    });

    return this.sanitizeIntegration(integration);
  }

  /**
   * List all integrations for a business
   */
  static async listByBusiness(businessId: string): Promise<ExternalIntegration[]> {
    const integrations = await prisma.externalIntegration.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });

    return integrations.map(this.sanitizeIntegration);
  }

  /**
   * Get a single integration by ID (with decrypted API key for internal use)
   */
  static async getById(id: string, businessId: string, includeApiKey = false): Promise<ExternalIntegration | null> {
    const integration = await prisma.externalIntegration.findFirst({
      where: { id, businessId },
    });

    if (!integration) return null;

    const result = this.sanitizeIntegration(integration);

    if (includeApiKey) {
      (result as any).apiKey = this.decryptApiKey(integration.apiKeyEncrypted);
    }

    return result;
  }

  /**
   * Update an integration
   */
  static async update(
    id: string,
    businessId: string,
    data: Partial<Pick<CreateExternalIntegrationInput, 'name' | 'config' | 'apiKey'> & { isActive?: boolean }>
  ): Promise<ExternalIntegration | null> {
    const updateData: any = { ...data };

    if (data.apiKey) {
      updateData.apiKeyEncrypted = this.encryptApiKey(data.apiKey);
      delete updateData.apiKey;
    }

    const integration = await prisma.externalIntegration.update({
      where: { id, businessId },
      data: updateData,
    });

    return this.sanitizeIntegration(integration);
  }

  /**
   * Delete an integration
   */
  static async delete(id: string, businessId: string): Promise<boolean> {
    await prisma.externalIntegration.delete({
      where: { id, businessId },
    });
    return true;
  }

  /**
   * Test an integration by making a validation call to the provider
   */
  static async testIntegration(id: string, businessId: string): Promise<TestIntegrationResult> {
    const integration = await this.getById(id, businessId, true);

    if (!integration) {
      return { success: false, error: 'Integration not found' };
    }

    const apiKey = (integration as any).apiKey;
    if (!apiKey) {
      return { success: false, error: 'API key not available' };
    }

    let result: TestIntegrationResult;

    try {
      switch (integration.provider) {
        case 'whatsapp':
          result = await this.testWhatsApp(apiKey, integration.config);
          break;
        case 'shopify':
          result = await this.testShopify(apiKey, integration.config);
          break;
        case 'razorpay':
          result = await this.testRazorpay(apiKey, integration.config);
          break;
        case 'hubspot':
          result = await this.testHubSpot(apiKey, integration.config);
          break;
        case 'zoho':
          result = await this.testZoho(apiKey, integration.config);
          break;
        case 'custom':
          result = await this.testCustom(apiKey, integration.config);
          break;
        default:
          result = { success: false, error: `Unknown provider: ${integration.provider}` };
      }
    } catch (error: any) {
      result = { success: false, error: error.message };
    }

    // Update test status
    await prisma.externalIntegration.update({
      where: { id },
      data: {
        lastTestedAt: new Date(),
        lastTestStatus: result.success ? 'success' : 'failed',
        lastTestError: result.error || null,
      },
    });

    return result;
  }

  /**
   * Provider-specific test implementations
   */
  private static async testWhatsApp(apiKey: string, config: ExternalIntegrationConfig | null): Promise<TestIntegrationResult> {
    // WhatsApp Business API test - validate token with Meta Graph API
    const baseUrl = config?.baseUrl || 'https://graph.facebook.com/v18.0';
    const phoneNumberId = config?.additionalFields?.phoneNumberId;

    if (!phoneNumberId) {
      return { success: false, error: 'Phone Number ID required in config' };
    }

    const response = await fetch(`${baseUrl}/${phoneNumberId}?fields=id,verified_name,display_phone_number`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as any;
      return { success: false, error: error.error?.message || `HTTP ${response.status}` };
    }

    const data = (await response.json()) as any;
    return {
      success: true,
      details: {
        verifiedName: data.verified_name,
        phoneNumber: data.display_phone_number,
        phoneNumberId: data.id
      }
    };
  }

  private static async testShopify(apiKey: string, config: ExternalIntegrationConfig | null): Promise<TestIntegrationResult> {
    // Shopify Admin API test
    const shopDomain = config?.additionalFields?.shopDomain;
    const accessToken = apiKey; // In Shopify, the API key is the access token

    if (!shopDomain) {
      return { success: false, error: 'Shop domain required in config' };
    }

    const baseUrl = config?.baseUrl || `https://${shopDomain}/admin/api/2024-01`;

    const response = await fetch(`${baseUrl}/shop.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as any;
      return { success: false, error: error.errors || `HTTP ${response.status}` };
    }

    const data = (await response.json()) as any;
    return {
      success: true,
      details: {
        shopName: data.shop?.name,
        shopDomain: data.shop?.myshopify_domain,
        plan: data.shop?.plan_name
      }
    };
  }

  private static async testRazorpay(apiKey: string, config: ExternalIntegrationConfig | null): Promise<TestIntegrationResult> {
    // Razorpay API test - validate key by fetching account details
    // apiKey format: "key_id:key_secret" or just key_id if secret is in config
    const [keyId, keySecret] = apiKey.includes(':')
      ? apiKey.split(':')
      : [apiKey, config?.additionalFields?.keySecret];

    if (!keySecret) {
      return { success: false, error: 'Key secret required (format: "key_id:key_secret" or in config)' };
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const baseUrl = config?.baseUrl || 'https://api.razorpay.com/v1';

    const response = await fetch(`${baseUrl}/account`, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as any;
      return { success: false, error: error.error?.description || `HTTP ${response.status}` };
    }

    const data = (await response.json()) as any;
    return {
      success: true,
      details: {
        accountId: data.id,
        name: data.name,
        email: data.email,
        currency: data.currency
      }
    };
  }

  private static async testHubSpot(apiKey: string, config: ExternalIntegrationConfig | null): Promise<TestIntegrationResult> {
    // HubSpot API test
    const baseUrl = config?.baseUrl || 'https://api.hubapi.com';

    const response = await fetch(`${baseUrl}/oauth/v1/access-tokens/${apiKey}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as any;
      return { success: false, error: error.message || `HTTP ${response.status}` };
    }

    const data = (await response.json()) as any;
    return {
      success: true,
      details: {
        hubId: data.hub_id,
        hubDomain: data.hub_domain,
        scopes: data.scopes
      }
    };
  }

  private static async testZoho(apiKey: string, config: ExternalIntegrationConfig | null): Promise<TestIntegrationResult> {
    // Zoho API test
    const baseUrl = config?.baseUrl || 'https://www.zohoapis.com/crm/v2';

    const response = await fetch(`${baseUrl}/users?type=CurrentUser`, {
      headers: { Authorization: `Zoho-oauthtoken ${apiKey}` },
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as any;
      return { success: false, error: error.message || `HTTP ${response.status}` };
    }

    const data = (await response.json()) as any;
    return {
      success: true,
      details: {
        userName: data.users?.[0]?.full_name,
        userEmail: data.users?.[0]?.email,
        role: data.users?.[0]?.role
      }
    };
  }

  private static async testCustom(apiKey: string, config: ExternalIntegrationConfig | null): Promise<TestIntegrationResult> {
    // Generic test - just verify the key can make a request to a health endpoint
    if (!config?.baseUrl) {
      return { success: false, error: 'Base URL required for custom integrations' };
    }

    const healthEndpoint = config.additionalFields?.healthEndpoint || '/health';
    const headerName = config.additionalFields?.authHeader || 'Authorization';
    const headerValue = config.additionalFields?.authPrefix
      ? `${config.additionalFields.authPrefix} ${apiKey}`
      : apiKey;

    const response = await fetch(`${config.baseUrl}${healthEndpoint}`, {
      headers: { [headerName]: headerValue },
    });

    return {
      success: response.ok,
      error: response.ok ? undefined : `HTTP ${response.status}`,
      details: { status: response.status }
    };
  }

  /**
   * Sanitize integration for API responses (never expose encrypted key)
   */
  private static sanitizeIntegration(integration: any): ExternalIntegration {
    const { apiKeyEncrypted, ...safe } = integration;
    return {
      ...safe,
      config: integration.config as ExternalIntegrationConfig | null,
    };
  }

  /**
   * Get decrypted API key for internal service-to-service calls
   * Use sparingly - only for backend operations that need the raw key
   */
  static async getDecryptedApiKey(id: string, businessId: string): Promise<string | null> {
    const integration = await prisma.externalIntegration.findFirst({
      where: { id, businessId },
      select: { apiKeyEncrypted: true },
    });

    if (!integration) return null;
    return this.decryptApiKey(integration.apiKeyEncrypted);
  }
}

export default ExternalIntegrationService;