/**
 * Enhanced Google Business Profile API Client v2
 * 
 * Uses @openpromo/google-business-profile - Type-safe TypeScript SDK
 * Provides better type safety, performance, and modern API surface
 * 
 * Features:
 * - Type-safe SDK with full TypeScript support
 * - Accounts, Locations, Reviews, Local Posts, Performance metrics
 * - Built-in retry logic and error handling
 * - OAuth2 token management
 * - AI-powered review reply generation (inspired by reviewbud)
 */
import { GoogleBusinessProfile, createGoogleBusinessProfileOAuth } from '@openpromo/google-business-profile';
import { getHttpsProxyAgent } from './httpProxyAgent.js';
import axios, { AxiosError } from 'axios';

// OpenAI for AI-generated review replies
import OpenAI from 'openai';

// Types matching the SDK
interface BusinessAccount {
  name: string;
  accountName?: string;
  type?: string;
  role?: string;
  verificationState?: string;
  vettedState?: string;
  accountNumber?: string;
  permissionLevel?: string;
}

interface BusinessLocation {
  name: string;
  title?: string;
  storeCode?: string;
  languageCode?: string;
  websiteUri?: string;
  phoneNumbers?: {
    primaryPhone?: string;
    additionalPhones?: string[];
  };
  storefrontAddress?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  categories?: Record<string, unknown>;
  regularHours?: Record<string, unknown>;
}

interface Review {
  name: string;
  reviewId: string;
  reviewer: {
    displayName: string;
    isAnonymous: boolean;
  };
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
  comment: string;
  createTime: string;
  updateTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
}

interface ListReviewsResponse {
  reviews?: Review[];
  averageRating: number;
  totalReviewCount: number;
  nextPageToken?: string;
}

interface ReviewReplyResponse {
  comment: string;
  updateTime: string;
}

// HTTP statuses worth retrying
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 600;
const MAX_BACKOFF_MS = 12_000;
const RATE_LIMIT_FLOOR_MS = 3_000;

export class GBPQuotaError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'GBPQuotaError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(headerValue: string | undefined): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(headerValue);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

interface CallArgs {
  url: string;
  accessToken: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  label: string;
  maxRetries?: number;
}

/**
 * Single resilient call with exponential backoff
 */
async function resilientCall({ url, accessToken, method = 'GET', body, label, maxRetries = MAX_RETRIES }: CallArgs) {
  let lastErr: AxiosError | null = null;
  const httpsAgent = await getHttpsProxyAgent();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await axios({
        url,
        method,
        data: body,
        family: 4,
        ...(httpsAgent ? { httpsAgent } : {}),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      });
    } catch (err) {
      const axiosErr = err as AxiosError;
      lastErr = axiosErr;
      const status = axiosErr.response?.status;

      if (!status || !RETRYABLE_STATUS.has(status)) break;
      if (attempt === maxRetries) break;

      const retryAfter = parseRetryAfter(axiosErr.response?.headers['retry-after'] as string | undefined);
      const computed = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
      const floor = status === 429 ? RATE_LIMIT_FLOOR_MS : 0;
      const base = retryAfter ?? Math.max(computed, floor);
      const backoff = Math.round(base * (1 + Math.random() * 0.25));

      console.warn(
        `[GBP API v2] ${label} call 429/5xx (attempt ${attempt + 1}/${maxRetries + 1}, status ${status}) — backing off ${backoff}ms`
      );
      await sleep(backoff);
    }
  }

  const status = lastErr?.response?.status ?? 0;
  const data: unknown = lastErr?.response?.data;
  const body2 = (data as { error?: { message?: string; status?: string } } | undefined)?.error;
  const googleMsg = body2?.message ?? lastErr?.message ?? 'Unknown Google API error';

  console.error(`[GBP API v2] ${label} call FAILED after retries:`, { status, googleMsg });

  if (status === 429) {
    throw new GBPQuotaError(
      'Google Business Profile API rate limit reached. This usually means the OAuth app is still in TEST mode or Cloud Billing is not enabled on the project. ' +
        'Enable Cloud Billing, publish/verify the OAuth consent screen, and retry after a short wait.',
      status
    );
  }
  throw new GBPQuotaError(googleMsg, status);
}

/**
 * AI Review Reply Generator (inspired by reviewbud)
 * Generates human-like review replies using OpenAI
 */
class AIReviewReplyGenerator {
  private client: OpenAI | null = null;
  private enabled: boolean = false;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
      this.enabled = true;
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  async generateReply(
    review: Review,
    businessName: string,
    options: {
      tone?: 'professional' | 'friendly' | 'empathetic' | 'concise';
      maxLength?: number;
      includeName?: boolean;
    } = {}
  ): Promise<{ reply: string; generationMethod: string }> {
    if (!this.isEnabled()) {
      return this.generateFallbackReply(review, businessName, options);
    }

    const { tone = 'empathetic', maxLength = 300, includeName = true } = options;

    const starMap: Record<string, number> = {
      ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
    };
    const rating = starMap[review.starRating] || 0;
    const reviewerName = review.reviewer?.displayName || 'Customer';

    const toneGuidance: Record<string, string> = {
      professional: 'polite, business-like, and solution-oriented',
      friendly: 'warm, conversational, and appreciative',
      empathetic: 'understanding, caring, and focused on making it right',
      concise: 'brief, direct, and to the point',
    };

    const ratingGuidance: Record<number, string> = {
      5: 'thank them enthusiastically and highlight what they loved',
      4: 'thank them warmly and reinforce the positive experience',
      3: 'acknowledge their feedback, thank them, and show commitment to improve',
      2: 'apologize sincerely, acknowledge the issue, and offer to make it right',
      1: 'apologize deeply, take full responsibility, and provide a clear path to resolution',
    };

    try {
      const prompt = `You are the owner of "${businessName}" responding to a Google review.

Review Details:
- Rating: ${rating}/5 stars
- Reviewer: ${reviewerName}${review.reviewer?.isAnonymous ? ' (anonymous)' : ''}
- Comment: "${review.comment || '(no text provided)'}"
- Date: ${new Date(review.createTime).toLocaleDateString()}

Guidelines:
- Tone: ${toneGuidance[tone]}
- ${ratingGuidance[rating]}
- ${includeName ? `Address them by name (${reviewerName})` : 'Do not use their name'}
- Maximum ${maxLength} characters
- Write as a real business owner would - natural, not robotic
- NO corporate speak, NO "we appreciate your feedback", NO "we take all feedback seriously"
- Be specific to their comment when possible
- Sign with business name or "The ${businessName} Team"
- If rating <= 3, include an invitation to contact directly (phone/email) to resolve

Write ONLY the reply text, nothing else.`;

      const response = await this.client!.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You write authentic, human review responses for small businesses. Never use corporate templates.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: Math.ceil(maxLength / 3),
        temperature: 0.8,
        presence_penalty: 0.3,
        frequency_penalty: 0.3,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) throw new Error('Empty response from OpenAI');

      return { reply: content, generationMethod: 'OpenAI GPT-4o-mini' };
    } catch (error) {
      console.error('[AI Review Reply] Generation failed:', error);
      return this.generateFallbackReply(review, businessName, options);
    }
  }

  private generateFallbackReply(
    review: Review,
    businessName: string,
    options: { tone?: string; includeName?: boolean }
  ): { reply: string; generationMethod: string } {
    const starMap: Record<string, number> = {
      ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
    };
    const rating = starMap[review.starRating] || 0;
    const reviewerName = options.includeName !== false ? (review.reviewer?.displayName || 'there') : 'there';

    const templates: Record<number, string[]> = {
      5: [
        `Thank you so much, ${reviewerName}! We're thrilled you had a great experience at ${businessName}. Your kind words mean the world to our team!`,
        `Wow, ${reviewerName} - thank you for the 5 stars! 🌟 We love hearing that you enjoyed ${businessName}. Hope to see you again soon!`,
      ],
      4: [
        `Thanks for the great review, ${reviewerName}! We're glad you enjoyed your experience at ${businessName}. We'll keep working hard to earn that 5th star next time!`,
        `Thank you, ${reviewerName}! We appreciate you taking the time to share your experience at ${businessName}. Your feedback helps us grow!`,
      ],
      3: [
        `Thank you for your feedback, ${reviewerName}. We appreciate you sharing your experience at ${businessName}. We're always looking to improve - if there's anything specific we could do better, please let us know!`,
        `Thanks for the honest review, ${reviewerName}. We take all feedback seriously at ${businessName}. If you'd like to discuss further, we'd love to hear from you directly.`,
      ],
      2: [
        `I'm sorry to hear about your experience, ${reviewerName}. This isn't the standard we aim for at ${businessName}. Please reach out to us directly so we can make this right - your satisfaction matters to us.`,
        `Thank you for sharing this, ${reviewerName}. I apologize that we fell short. We'd love the chance to fix this - please contact us directly and we'll do whatever it takes.`,
      ],
      1: [
        `${reviewerName}, I'm truly sorry for your experience. This is not acceptable at ${businessName}. I take personal responsibility - please contact me directly so I can resolve this for you.`,
        `I'm deeply sorry, ${reviewerName}. We failed you, and I own that. Please give us a chance to make it right - reach out directly and I'll personally handle this.`,
      ],
    };

    const fallbackTemplates = templates[rating] || templates[3];
    const reply = fallbackTemplates[Math.floor(Math.random() * fallbackTemplates.length)];

    return { reply, generationMethod: 'Fallback Template' };
  }
}

// Singleton instance
const aiReplyGenerator = new AIReviewReplyGenerator();

/**
 * Enhanced Google Business API v2 using @openpromo/google-business-profile SDK
 */
export const GoogleBusinessApiV2 = {
  /**
   * Create a typed client with the SDK
   */
  createClient(accessToken: string) {
    return GoogleBusinessProfile.createClient({
      accessToken,
      debug: process.env.NODE_ENV === 'development',
    });
  },

  /**
   * Get user's GBP accounts using SDK
   */
  async getAccounts(accessToken: string): Promise<BusinessAccount[]> {
    const client = this.createClient(accessToken);
    try {
      const result = await client.resources.accounts.list({ pageSize: 100 });
      return result.accounts ?? [];
    } catch (error) {
      console.error('[GBP API v2] getAccounts failed:', error);
      // Fallback to resilient call
      const res = await resilientCall({
        url: 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
        accessToken,
        label: 'accounts',
        maxRetries: 0,
      });
      return res.data?.accounts ?? [];
    }
  },

  /**
   * Get locations for an account using SDK
   */
  async getLocations(accessToken: string, accountId: string): Promise<BusinessLocation[]> {
    const client = this.createClient(accessToken);
    // Normalize account ID
    const normalizedAccountId = accountId.startsWith('accounts/') ? accountId : `accounts/${accountId}`;
    
    try {
      const result = await client.resources.locations.list(normalizedAccountId, { pageSize: 100 });
      return result.locations ?? [];
    } catch (error) {
      console.error('[GBP API v2] getLocations failed:', error);
      // Fallback to resilient call
      const res = await resilientCall({
        url: `https://mybusinessbusinessinformation.googleapis.com/v1/${normalizedAccountId}/locations`,
        accessToken,
        label: 'locations',
        maxRetries: 0,
      });
      return res.data?.locations ?? [];
    }
  },

  /**
   * Get reviews for a location using SDK (v4 API for reviews)
   * Note: Reviews still live on legacy v4 API per Google
   */
  async getReviews(
    accessToken: string,
    accountId: string,
    locationId: string,
    options: { pageSize?: number; pageToken?: string; orderBy?: string } = {}
  ): Promise<ListReviewsResponse> {
    const normalizedAccountId = accountId.startsWith('accounts/') ? accountId : `accounts/${accountId}`;
    const normalizedLocationId = locationId.startsWith('locations/') ? locationId : 
      locationId.includes('/') ? locationId : `locations/${locationId}`;
    const fullLocationName = `${normalizedAccountId}/${normalizedLocationId}`;

    // Use resilient call directly for v4 reviews API
    const res = await resilientCall({
      url: `https://mybusiness.googleapis.com/v4/${fullLocationName}/reviews`,
      accessToken,
      label: 'reviews',
      method: 'GET',
    });

    const reviews = res.data?.reviews ?? [];
    const averageRating = res.data?.averageRating ?? 0;
    const totalReviewCount = res.data?.totalReviewCount ?? reviews.length;

    return {
      reviews,
      averageRating,
      totalReviewCount,
      nextPageToken: res.data?.nextPageToken,
    };
  },

  /**
   * Get a single review
   */
  async getReview(accessToken: string, accountId: string, locationId: string, reviewId: string): Promise<Review | null> {
    const normalizedAccountId = accountId.startsWith('accounts/') ? accountId : `accounts/${accountId}`;
    const normalizedLocationId = locationId.startsWith('locations/') ? locationId : 
      locationId.includes('/') ? locationId : `locations/${locationId}`;
    const fullLocationName = `${normalizedAccountId}/${normalizedLocationId}`;

    const res = await resilientCall({
      url: `https://mybusiness.googleapis.com/v4/${fullLocationName}/reviews/${reviewId}`,
      accessToken,
      label: 'get-review',
    });

    return res.data ?? null;
  },

  /**
   * Reply to a review using SDK (v4 API)
   */
  async replyToReview(
    accessToken: string,
    accountId: string,
    locationId: string,
    reviewId: string,
    comment: string
  ): Promise<ReviewReplyResponse> {
    const normalizedAccountId = accountId.startsWith('accounts/') ? accountId : `accounts/${accountId}`;
    const normalizedLocationId = locationId.startsWith('locations/') ? locationId : 
      locationId.includes('/') ? locationId : `locations/${locationId}`;
    const fullLocationName = `${normalizedAccountId}/${normalizedLocationId}`;

    const res = await resilientCall({
      url: `https://mybusiness.googleapis.com/v4/${fullLocationName}/reviews/${reviewId}/reply`,
      accessToken,
      method: 'PUT',
      body: { comment },
      label: 'review-reply',
    });

    return res.data?.reviewReply ?? { comment, updateTime: new Date().toISOString() };
  },

  /**
   * Delete a review reply
   */
  async deleteReviewReply(
    accessToken: string,
    accountId: string,
    locationId: string,
    reviewId: string
  ): Promise<void> {
    const normalizedAccountId = accountId.startsWith('accounts/') ? accountId : `accounts/${accountId}`;
    const normalizedLocationId = locationId.startsWith('locations/') ? locationId : 
      locationId.includes('/') ? locationId : `locations/${locationId}`;
    const fullLocationName = `${normalizedAccountId}/${normalizedLocationId}`;

    await resilientCall({
      url: `https://mybusiness.googleapis.com/v4/${fullLocationName}/reviews/${reviewId}/reply`,
      accessToken,
      method: 'DELETE',
      label: 'delete-review-reply',
    });
  },

  /**
   * Create a local post using SDK
   */
  async createPost(
    accessToken: string,
    accountId: string,
    locationId: string,
    postData: {
      summary: string;
      topicType: 'STANDARD' | 'EVENT' | 'OFFER' | 'ALERT';
      languageCode?: string;
      callToAction?: { actionType: string; url?: string };
      event?: { title: string; startDate: string; endDate?: string };
      offer?: { couponCode?: string; redeemOnlineUrl?: string; termsConditions?: string };
      media?: Array<{ mediaFormat: 'PHOTO' | 'VIDEO'; sourceUrl: string }>;
    }
  ) {
    const client = this.createClient(accessToken);
    const normalizedAccountId = accountId.startsWith('accounts/') ? accountId : `accounts/${accountId}`;
    const normalizedLocationId = locationId.startsWith('locations/') ? locationId : 
      locationId.includes('/') ? locationId : `locations/${locationId}`;
    const fullLocationName = `${normalizedAccountId}/${normalizedLocationId}`;

    try {
      return await client.resources.localPosts.create(fullLocationName, postData as any);
    } catch (error) {
      console.error('[GBP API v2] createPost failed:', error);
      throw error;
    }
  },

  /**
   * Get local posts using SDK
   */
  async getPosts(accessToken: string, accountId: string, locationId: string) {
    const client = this.createClient(accessToken);
    const normalizedAccountId = accountId.startsWith('accounts/') ? accountId : `accounts/${accountId}`;
    const normalizedLocationId = locationId.startsWith('locations/') ? locationId : 
      locationId.includes('/') ? locationId : `locations/${locationId}`;
    const fullLocationName = `${normalizedAccountId}/${normalizedLocationId}`;

    try {
      const result = await client.resources.localPosts.list(fullLocationName, { pageSize: 50 });
      return result.localPosts ?? [];
    } catch (error) {
      console.error('[GBP API v2] getPosts failed:', error);
      return [];
    }
  },

  /**
   * Delete a local post using SDK
   */
  async deletePost(accessToken: string, postName: string): Promise<void> {
    const client = this.createClient(accessToken);
    try {
      await client.resources.localPosts.delete(postName);
    } catch (error) {
      console.error('[GBP API v2] deletePost failed:', error);
      throw error;
    }
  },

  /**
   * Get performance insights using SDK
   */
  async getInsights(
    accessToken: string,
    accountId: string,
    locationId: string,
    options: {
      dailyMetrics: string[];
      startDate: { year: number; month: number; day: number };
      endDate: { year: number; month: number; day: number };
    }
  ) {
    const client = this.createClient(accessToken);
    const normalizedAccountId = accountId.startsWith('accounts/') ? accountId : `accounts/${accountId}`;
    const normalizedLocationId = locationId.startsWith('locations/') ? locationId : 
      locationId.includes('/') ? locationId : `locations/${locationId}`;
    const fullLocationName = `${normalizedAccountId}/${normalizedLocationId}`;

    try {
      return await client.resources.performance.fetchMultiDailyMetricsTimeSeries(fullLocationName, options as any);
    } catch (error) {
      console.error('[GBP API v2] getInsights failed:', error);
      return null;
    }
  },

  /**
   * Generate AI-powered review reply
   */
  async generateAIReviewReply(
    review: Review,
    businessName: string,
    options: {
      tone?: 'professional' | 'friendly' | 'empathetic' | 'concise';
      maxLength?: number;
      includeName?: boolean;
    } = {}
  ) {
    return aiReplyGenerator.generateReply(review, businessName, options);
  },

  /**
   * Check if AI reply generation is available
   */
  isAIReplyEnabled(): boolean {
    return aiReplyGenerator.isEnabled();
  },

  /**
   * Get user info via OAuth2
   */
  async getUserInfo(accessToken: string) {
    const res = await resilientCall({
      url: 'https://www.googleapis.com/oauth2/v2/userinfo',
      accessToken,
      label: 'userinfo',
    });
    return res.data ?? {};
  },

  /**
   * OAuth helpers - create OAuth client for token refresh
   */
  createOAuthClient(config: { clientId: string; clientSecret: string; redirectUri: string }) {
    return createGoogleBusinessProfileOAuth({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    });
  },
};

export default GoogleBusinessApiV2;

// Export types for consumers
export type { BusinessAccount, BusinessLocation, Review, ListReviewsResponse, ReviewReplyResponse };