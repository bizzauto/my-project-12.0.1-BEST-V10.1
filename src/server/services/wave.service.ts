import axios from 'axios';

/**
 * Wave Accounting API Service
 * Docs: https://developer.waveapps.com/
 * Auth: OAuth 2.0
 * Base URL: https://api.waveapps.com/api/v1/
 */

const WAVE_BASE_URL = 'https://api.waveapps.com/api/v1';

// OAuth credentials (from Wave developer app)
const WAVE_CLIENT_ID = process.env.WAVE_CLIENT_ID;
const WAVE_CLIENT_SECRET = process.env.WAVE_CLIENT_SECRET;

if (!WAVE_CLIENT_ID || !WAVE_CLIENT_SECRET) {
  console.warn('[Wave] WAVE_CLIENT_ID and/or WAVE_CLIENT_SECRET not set. Wave integration will be unavailable.');
}

/**
 * Wave Accounting Service
 * Handles invoicing, customers, accounts, and payments via Wave API
 */
export class WaveService {
  /**
   * Check if Wave is properly configured
   */
  static isConfigured(): boolean {
    return !!(WAVE_CLIENT_ID && WAVE_CLIENT_SECRET);
  }

  /**
   * Get OAuth authorization URL for user to authorize
   */
  static getAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: WAVE_CLIENT_ID || '',
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });
    return `https://api.waveapps.com/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  static async exchangeCodeForToken(code: string, redirectUri: string): Promise<{
    success: boolean;
    data?: { accessToken: string; refreshToken: string; expiresIn: number };
    error?: string;
  }> {
    try {
      const response = await axios.post('https://api.waveapps.com/oauth2/token', {
        client_id: WAVE_CLIENT_ID,
        client_secret: WAVE_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });

      const { access_token, refresh_token, expires_in } = response.data;
      return {
        success: true,
        data: {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresIn: expires_in,
        },
      };
    } catch (error: any) {
      console.error('[Wave] Token exchange failed:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.error_description || error.message };
    }
  }

  /**
   * Refresh an expired access token
   */
  static async refreshToken(refreshToken: string): Promise<{
    success: boolean;
    data?: { accessToken: string; refreshToken: string; expiresIn: number };
    error?: string;
  }> {
    try {
      const response = await axios.post('https://api.waveapps.com/oauth2/token', {
        client_id: WAVE_CLIENT_ID,
        client_secret: WAVE_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });

      const { access_token, refresh_token, expires_in } = response.data;
      return {
        success: true,
        data: {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresIn: expires_in,
        },
      };
    } catch (error: any) {
      console.error('[Wave] Token refresh failed:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.error_description || error.message };
    }
  }

  /**
   * Make authenticated API request to Wave
   */
  private static async apiRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    accessToken: string,
    data?: any
  ): Promise<any> {
    const response = await axios({
      method,
      url: `${WAVE_BASE_URL}${endpoint}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data,
      timeout: 30000,
    });
    return response.data;
  }

  /**
   * Get list of businesses for the authenticated user
   */
  static async listBusinesses(accessToken: string): Promise<{
    success: boolean;
    data?: any[];
    error?: string;
  }> {
    try {
      const result = await this.apiRequest('GET', '/businesses/', accessToken);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Wave] List businesses failed:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get chart of accounts for a business
   */
  static async listAccounts(accessToken: string, businessId: string): Promise<{
    success: boolean;
    data?: any[];
    error?: string;
  }> {
    try {
      const result = await this.apiRequest('GET', `/businesses/${businessId}/accounts/`, accessToken);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Wave] List accounts failed:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create a customer in Wave
   */
  static async createCustomer(
    accessToken: string,
    businessId: string,
    data: {
      name: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      province?: string;
      postalCode?: string;
      country?: string;
    }
  ): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      const result = await this.apiRequest('POST', `/businesses/${businessId}/customers/`, accessToken, {
        name: data.name,
        email: data.email || '',
        phone: data.phone || '',
        address: data.address || '',
        city: data.city || '',
        province: data.province || '',
        postal_code: data.postalCode || '',
        country: data.country || '',
      });
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Wave] Create customer failed:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create an invoice in Wave
   */
  static async createInvoice(
    accessToken: string,
    businessId: string,
    data: {
      customerId: string;
      lineItems: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        accountId?: string;
      }>;
      dueDate?: string;
      memo?: string;
      currency?: string;
    }
  ): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      // Get the income account ID if not provided
      let incomeAccountId = data.lineItems[0]?.accountId;
      if (!incomeAccountId) {
        const accounts = await this.listAccounts(accessToken, businessId);
        if (accounts.success && accounts.data) {
          const incomeAccount = accounts.data.find((a: any) => a.account_type === 'Income');
          incomeAccountId = incomeAccount?.id;
        }
      }

      const lineItems = data.lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice.toString(),
        account_id: incomeAccountId || '',
      }));

      const invoiceData: any = {
        customer_id: data.customerId,
        currency: data.currency || 'INR',
        line_items: lineItems,
      };

      if (data.dueDate) invoiceData.due_date = data.dueDate;
      if (data.memo) invoiceData.memo = data.memo;

      const result = await this.apiRequest('POST', `/businesses/${businessId}/invoices/`, accessToken, invoiceData);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Wave] Create invoice failed:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Record a payment against an invoice
   */
  static async recordPayment(
    accessToken: string,
    businessId: string,
    data: {
      invoiceId: string;
      amount: number;
      date?: string;
      accountId?: string;
    }
  ): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      // Get the bank/cash account for payment
      let paymentAccountId = data.accountId;
      if (!paymentAccountId) {
        const accounts = await this.listAccounts(accessToken, businessId);
        if (accounts.success && accounts.data) {
          const bankAccount = accounts.data.find((a: any) =>
            a.account_type === 'Bank' || a.account_type === 'Cash'
          );
          paymentAccountId = bankAccount?.id;
        }
      }

      const paymentData: any = {
        invoice_id: data.invoiceId,
        amount: data.amount.toString(),
        account_id: paymentAccountId || '',
      };

      if (data.date) paymentData.date = data.date;

      const result = await this.apiRequest('POST', `/businesses/${businessId}/payments/`, accessToken, paymentData);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Wave] Record payment failed:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * List all invoices for a business
   */
  static async listInvoices(
    accessToken: string,
    businessId: string,
    params?: { page?: number; pageSize?: number; status?: string }
  ): Promise<{
    success: boolean;
    data?: any[];
    error?: string;
  }> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.pageSize) queryParams.append('page_size', params.pageSize.toString());
      if (params?.status) queryParams.append('status', params.status);

      const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
      const result = await this.apiRequest('GET', `/businesses/${businessId}/invoices/${query}`, accessToken);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Wave] List invoices failed:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get a specific invoice by ID
   */
  static async getInvoice(
    accessToken: string,
    businessId: string,
    invoiceId: string
  ): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      const result = await this.apiRequest('GET', `/businesses/${businessId}/invoices/${invoiceId}/`, accessToken);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Wave] Get invoice failed:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * List customers for a business
   */
  static async listCustomers(
    accessToken: string,
    businessId: string,
    params?: { page?: number; pageSize?: number }
  ): Promise<{
    success: boolean;
    data?: any[];
    error?: string;
  }> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.pageSize) queryParams.append('page_size', params.pageSize.toString());

      const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
      const result = await this.apiRequest('GET', `/businesses/${businessId}/customers/${query}`, accessToken);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Wave] List customers failed:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test the connection by fetching businesses
   */
  static async testConnection(accessToken: string): Promise<{
    success: boolean;
    data?: { businessName: string; businessId: string };
    error?: string;
  }> {
    try {
      const businesses = await this.listBusinesses(accessToken);
      if (!businesses.success || !businesses.data || businesses.data.length === 0) {
        return { success: false, error: 'No businesses found for this Wave account' };
      }

      const business = businesses.data[0];
      return {
        success: true,
        data: {
          businessName: business.name,
          businessId: business.id,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

export default WaveService;
