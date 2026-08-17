import { Router, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { cacheResponse } from '../middleware/cache.js';
import { GoogleBusinessApiV2 } from '../services/google-business-api-v2.service.js';
import { decrypt } from '../utils/auth.js';

const router = Router();

// Get reviews with enhanced filtering and AI reply generation
router.get('/', authenticate, cacheResponse(30), async (req: AuthRequest, res: Response) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      status,
      rating,
      platform = 'google',
      hasReply,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const where: any = { businessId: req.user.businessId };

    if (platform) where.platform = platform;
    if (status === 'unread') where.isRead = false;
    else if (status === 'read') where.isRead = true;
    if (rating) where.rating = Number(rating);
    if (hasReply === 'true') where.replyText = { not: null };
    else if (hasReply === 'false') where.replyText = null;

    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({ 
        where, 
        skip: (Number(page) - 1) * Number(limit), 
        take: Number(limit), 
        orderBy 
      }),
      prisma.review.count({ where }),
    ]);

    res.json({ success: true, data: { reviews, pagination: { total, page: Number(page), limit: Number(limit) } } });
  } catch (error: any) {
    console.error('Get reviews error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
  }
});

// Get review stats
router.get('/stats', authenticate, cacheResponse(30), async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user.businessId;

    const [totalReviews, averageRating, reviewsByRating, recentReviews, unreadCount] = await Promise.all([
      prisma.review.count({ where: { businessId } }),
      prisma.review.aggregate({ where: { businessId }, _avg: { rating: true } }),
      prisma.review.groupBy({ by: ['rating'], where: { businessId }, _count: true }),
      prisma.review.findMany({ where: { businessId }, orderBy: { createdAt: 'desc' }, take: 5 }),
      prisma.review.count({ where: { businessId, isRead: false } }),
    ]);

    const ratingDistribution = reviewsByRating.reduce((acc: any, stat: any) => {
      acc[stat.rating] = stat._count;
      return acc;
    }, {});

    // Get platform breakdown
    const platformStats = await prisma.review.groupBy({
      by: ['platform'],
      where: { businessId },
      _count: true,
    });

    res.json({
      success: true,
      data: {
        totalReviews,
        averageRating: averageRating._avg.rating || 0,
        ratingDistribution,
        recentReviews,
        unreadCount,
        platformBreakdown: platformStats.reduce((acc: any, stat: any) => {
          acc[stat.platform] = stat._count;
          return acc;
        }, {}),
      },
    });
  } catch (error: any) {
    console.error('Get review stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch review stats' });
  }
});

// Get single review
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const review = await prisma.review.findFirst({
      where: { id: req.params.id, businessId: req.user.businessId },
    });

    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }

    res.json({ success: true, data: review });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to fetch review' });
  }
});

// Update review reply (internal DB)
router.put('/:id/reply', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { replyText } = req.body;
    await prisma.review.update({
      where: { id: req.params.id },
      data: { replyText, repliedAt: new Date(), replyStatus: 'sent', isRead: true },
    });
    res.json({ success: true, message: 'Reply saved locally' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to save reply' });
  }
});

// Generate AI reply for a review
router.post('/:id/ai-reply', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const review = await prisma.review.findFirst({
      where: { id: req.params.id, businessId: req.user.businessId },
    });

    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }

    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { name: true, gbpAccessToken: true, gbpAccountId: true, gbpLocationId: true },
    });

    if (!business) {
      return res.status(404).json({ success: false, error: 'Business not found' });
    }

    // Check if AI is enabled
    if (!GoogleBusinessApiV2.isAIReplyEnabled()) {
      return res.status(400).json({ 
        success: false, 
        error: 'AI reply generation not configured. Please add OPENAI_API_KEY to environment.' 
      });
    }

    // Convert DB review to GBP review format
    const gbpReview = {
      name: review.externalId || review.id,
      reviewId: review.externalId || review.id,
      reviewer: { displayName: review.reviewerName || 'Anonymous', isAnonymous: !review.reviewerName || review.reviewerName === 'Anonymous' },
      starRating: ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'][review.rating - 1] || 'FIVE',
      comment: review.text || '',
      createTime: review.reviewDate?.toISOString() || new Date().toISOString(),
      updateTime: review.reviewDate?.toISOString() || new Date().toISOString(),
    } as any;

    const { reply, generationMethod } = await GoogleBusinessApiV2.generateAIReviewReply(
      gbpReview,
      business.name,
      { tone: 'empathetic', maxLength: 300, includeName: true }
    );

    res.json({ 
      success: true, 
      data: { reply, generationMethod },
      message: 'AI reply generated successfully' 
    });
  } catch (error: any) {
    console.error('AI reply generation error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate AI reply' });
  }
});

// Post AI reply to Google Business Profile
router.post('/:id/post-reply', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { replyText } = req.body;
    if (!replyText || !replyText.trim()) {
      return res.status(400).json({ success: false, error: 'Reply text is required' });
    }

    const review = await prisma.review.findFirst({
      where: { id: req.params.id, businessId: req.user.businessId },
    });

    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }

    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccessToken: true, gbpAccountId: true, gbpLocationId: true, name: true },
    });

    if (!business?.gbpAccessToken || !business?.gbpAccountId || !business?.gbpLocationId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Google Business Profile not connected. Please connect in Settings → Integrations.' 
      });
    }

    const accessToken = decrypt(business.gbpAccessToken);

    // Post reply to Google
    const result = await GoogleBusinessApiV2.replyToReview(
      accessToken,
      business.gbpAccountId,
      business.gbpLocationId,
      review.externalId,
      replyText.trim()
    );

    // Update local DB
    await prisma.review.update({
      where: { id: req.params.id },
      data: { 
        replyText: replyText.trim(), 
        repliedAt: new Date(), 
        replyStatus: 'sent',
        isRead: true 
      },
    });

    res.json({ 
      success: true, 
      data: { googleReply: result },
      message: 'Reply posted to Google successfully' 
    });
  } catch (error: any) {
    console.error('Post reply to Google error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to post reply to Google' });
  }
});

// Sync reviews from Google Business Profile (enhanced with v2 API)
router.post('/sync', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccessToken: true, gbpAccountId: true, gbpLocationId: true, name: true },
    });

    if (!business?.gbpAccessToken || !business?.gbpAccountId || !business?.gbpLocationId) {
      return res.status(400).json({
        success: false,
        error: 'Google Business Profile not connected. Please connect in Settings → Integrations.',
      });
    }

    const accessToken = decrypt(business.gbpAccessToken);

    // Fetch reviews using v2 API
    const response = await GoogleBusinessApiV2.getReviews(
      accessToken,
      business.gbpAccountId,
      business.gbpLocationId,
      { pageSize: 100 }
    );

    const gbpReviews = response.reviews || [];
    let synced = 0;
    let newReviews = 0;
    let updatedReviews = 0;

    for (const gbpReview of gbpReviews) {
      const starMap: Record<string, number> = {
        FIVE: 5, FOUR: 4, THREE: 3, TWO: 2, ONE: 1,
      };
      const rating = starMap[gbpReview.starRating] || 0;
      const externalId = gbpReview.reviewId || gbpReview.name;

      if (!externalId) continue;

      const existing = await prisma.review.findFirst({
        where: { businessId: req.user.businessId, externalId },
      });

      const reviewData = {
        businessId: req.user.businessId,
        platform: 'google' as const,
        externalId,
        reviewerName: gbpReview.reviewer?.displayName || 'Anonymous',
        reviewerEmail: undefined,
        rating,
        text: gbpReview.comment || '',
        reviewDate: gbpReview.createTime ? new Date(gbpReview.createTime) : new Date(),
        isPublished: true,
        replyText: gbpReview.reviewReply?.comment || null,
        replyStatus: gbpReview.reviewReply?.comment ? 'replied' as const : null,
        repliedAt: gbpReview.reviewReply?.updateTime ? new Date(gbpReview.reviewReply.updateTime) : null,
        isRead: !!gbpReview.reviewReply?.comment,
      };

      if (existing) {
        await prisma.review.update({
          where: { id: existing.id },
          data: reviewData,
        });
        updatedReviews++;
      } else {
        await prisma.review.create({ data: reviewData });
        newReviews++;
      }
      synced++;
    }

    res.json({
      success: true,
      message: `Synced ${synced} reviews from Google Business Profile (${newReviews} new, ${updatedReviews} updated)`,
      data: { synced, newReviews, updatedReviews, totalFromGoogle: gbpReviews.length },
    });
  } catch (error: any) {
    console.error('Review sync error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to sync reviews' });
  }
});

// Get GBP connection status and account info
router.get('/gbp/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { 
        gbpAccessToken: true, 
        gbpAccountId: true, 
        gbpLocationId: true,
      },
    });

    if (!business?.gbpAccessToken || !business?.gbpAccountId || !business?.gbpLocationId) {
      return res.json({ 
        success: true, 
        data: { connected: false, message: 'Not connected' } 
      });
    }

    const accessToken = decrypt(business.gbpAccessToken);

    // Try to fetch accounts to verify connection
    try {
      const accounts = await GoogleBusinessApiV2.getAccounts(accessToken);
      const locations = await GoogleBusinessApiV2.getLocations(accessToken, business.gbpAccountId);
      
      res.json({
        success: true,
        data: {
          connected: true,
          accountName: accounts[0]?.name || null,
          locationName: locations[0]?.name || null,
          accountsCount: accounts.length,
          locationsCount: locations.length,
        },
      });
    } catch (error) {
      res.json({
        success: true,
        data: {
          connected: false,
          message: 'Token may be expired or invalid',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  } catch (error: any) {
    console.error('GBP status error:', error);
    res.status(500).json({ success: false, error: 'Failed to check GBP status' });
  }
});

// Get locations for connected GBP account
router.get('/gbp/locations', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccessToken: true, gbpAccountId: true },
    });

    if (!business?.gbpAccessToken || !business?.gbpAccountId) {
      return res.status(400).json({ success: false, error: 'Google Business Profile not connected' });
    }

    const accessToken = decrypt(business.gbpAccessToken);
    const locations = await GoogleBusinessApiV2.getLocations(accessToken, business.gbpAccountId);

    res.json({ success: true, data: { locations } });
  } catch (error: any) {
    console.error('GBP locations error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch locations' });
  }
});

// Create local post on Google Business Profile
router.post('/gbp/posts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { summary, topicType, callToAction, event, offer, media, languageCode = 'en' } = req.body;

    if (!summary || !topicType) {
      return res.status(400).json({ success: false, error: 'Summary and topicType are required' });
    }

    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccessToken: true, gbpAccountId: true, gbpLocationId: true },
    });

    if (!business?.gbpAccessToken || !business?.gbpAccountId || !business?.gbpLocationId) {
      return res.status(400).json({ success: false, error: 'Google Business Profile not connected' });
    }

    const accessToken = decrypt(business.gbpAccessToken);

    const post = await GoogleBusinessApiV2.createPost(accessToken, business.gbpAccountId, business.gbpLocationId, {
      summary,
      topicType,
      languageCode,
      callToAction,
      event,
      offer,
      media,
    });

    res.json({ success: true, data: { post }, message: 'Local post created successfully' });
  } catch (error: any) {
    console.error('Create GBP post error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create post' });
  }
});

// Get local posts
router.get('/gbp/posts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccessToken: true, gbpAccountId: true, gbpLocationId: true },
    });

    if (!business?.gbpAccessToken || !business?.gbpAccountId || !business?.gbpLocationId) {
      return res.status(400).json({ success: false, error: 'Google Business Profile not connected' });
    }

    const accessToken = decrypt(business.gbpAccessToken);
    const posts = await GoogleBusinessApiV2.getPosts(accessToken, business.gbpAccountId, business.gbpLocationId);

    res.json({ success: true, data: { posts } });
  } catch (error: any) {
    console.error('Get GBP posts error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch posts' });
  }
});

// Delete local post
router.delete('/gbp/posts/:postName', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccessToken: true },
    });

    if (!business?.gbpAccessToken) {
      return res.status(400).json({ success: false, error: 'Google Business Profile not connected' });
    }

    const accessToken = decrypt(business.gbpAccessToken);
    await GoogleBusinessApiV2.deletePost(accessToken, req.params.postName);

    res.json({ success: true, message: 'Post deleted successfully' });
  } catch (error: any) {
    console.error('Delete GBP post error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete post' });
  }
});

// Get performance insights
router.get('/gbp/insights', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, metrics } = req.query;

    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
      select: { gbpAccessToken: true, gbpAccountId: true, gbpLocationId: true },
    });

    if (!business?.gbpAccessToken || !business?.gbpAccountId || !business?.gbpLocationId) {
      return res.status(400).json({ success: false, error: 'Google Business Profile not connected' });
    }

    const accessToken = decrypt(business.gbpAccessToken);

    const defaultMetrics = [
      'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
      'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
      'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
      'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
      'WEBSITE_CLICKS',
      'CALL_CLICKS',
      'BUSINESS_DIRECTION_REQUESTS',
    ];

    const insights = await GoogleBusinessApiV2.getInsights(accessToken, business.gbpAccountId, business.gbpLocationId, {
      dailyMetrics: (metrics as string)?.split(',') || defaultMetrics,
      startDate: startDate ? JSON.parse(startDate as string) : { year: new Date().getFullYear(), month: new Date().getMonth(), day: 1 },
      endDate: endDate ? JSON.parse(endDate as string) : { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: 0 },
    });

    res.json({ success: true, data: { insights } });
  } catch (error: any) {
    console.error('Get GBP insights error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch insights' });
  }
});

// Mark review as read
router.put('/:id/read', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.review.update({
      where: { id: req.params.id },
      data: { isRead: true },
    });
    res.json({ success: true, message: 'Marked as read' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to mark as read' });
  }
});

// Bulk mark as read
router.put('/bulk/read', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'IDs array required' });
    }
    await prisma.review.updateMany({
      where: { id: { in: ids }, businessId: req.user.businessId },
      data: { isRead: true },
    });
    res.json({ success: true, message: `${ids.length} reviews marked as read` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to mark as read' });
  }
});

// AI reply generation status
router.get('/ai-status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        enabled: GoogleBusinessApiV2.isAIReplyEnabled(),
        model: process.env.OPENAI_API_KEY ? 'gpt-4o-mini' : null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to check AI status' });
  }
});

export default router;

// Sync reviews from Google Business Profile (enhanced with v2 API)