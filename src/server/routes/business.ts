import { Router } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireBusinessOwner } from '../middleware/auth.js';
import { encryptBusinessData, decryptBusinessData } from '../services/secrets.service.js';

const router = Router();

// Get business settings
router.get('/', authenticate, async (req: any, res: any) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
    });

    if (!business) {
      return res.status(404).json({ success: false, error: 'Business not found' });
    }

    // Decrypt sensitive fields before sending to client
    const safeData = decryptBusinessData(business as any);
    res.json({ success: true, data: safeData });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to fetch business' });
  }
});

// Update business settings
router.put('/', authenticate, async (req: any, res: any) => {
  try {
    const { name, type, city, phone, email, brandColors, timezone } = req.body;

    // Encrypt any sensitive fields in the update data
    const updateData = {
      ...(name && { name }),
      ...(type && { type }),
      ...(city && { city }),
      ...(phone && { phone }),
      ...(email && { email }),
      ...(brandColors && { brandColors }),
      ...(timezone && { timezone }),
    };
    const encryptedData = encryptBusinessData(updateData);

    const business = await prisma.business.update({
      where: { id: req.user.businessId },
      data: encryptedData,
    });

    res.json({ success: true, data: business });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to update business' });
  }
});

// Persist onboarding progress (Phase E.1) — not sensitive, no encryption needed
router.put('/onboarding', authenticate, async (req: any, res: any) => {
  try {
    const { onboardingCompleted, onboardingStep } = req.body;
    const updateData: any = {};
    if (typeof onboardingCompleted === 'boolean') updateData.onboardingCompleted = onboardingCompleted;
    if (typeof onboardingStep === 'number') updateData.onboardingStep = onboardingStep;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, error: 'No onboarding fields provided' });
    }

    const business = await prisma.business.update({
      where: { id: req.user.businessId },
      data: updateData,
    });

    res.json({ success: true, data: { onboardingCompleted: business.onboardingCompleted, onboardingStep: business.onboardingStep } });
  } catch (error: any) {
    console.error('[Business] Onboarding update error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update onboarding' });
  }
});

// Get business settings (alias for frontend compatibility)
router.get('/settings', authenticate, async (req: any, res: any) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user.businessId },
    });

    if (!business) {
      return res.status(404).json({ success: false, error: 'Business not found' });
    }

    res.json({ success: true, data: business });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to fetch business settings' });
  }
});

// Update business settings (alias for frontend compatibility)
router.put('/settings', authenticate, async (req: any, res: any) => {
  try {
    const { name, type, city, phone, email, brandColors, timezone, ...rest } = req.body;

    const updateData = {
      ...(name && { name }),
      ...(type && { type }),
      ...(city && { city }),
      ...(phone && { phone }),
      ...(email && { email }),
      ...(brandColors && { brandColors }),
      ...(timezone && { timezone }),
      ...rest,
    };
    // Encrypt any sensitive fields that may be in rest (WhatsApp tokens, etc.)
    const encryptedData = encryptBusinessData(updateData);

    const business = await prisma.business.update({
      where: { id: req.user.businessId },
      data: encryptedData,
    });

    res.json({ success: true, data: business });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to update business settings' });
  }
});

// Update WhatsApp configuration
router.put('/whatsapp', authenticate, requireBusinessOwner, async (req: any, res: any) => {
  try {
    const { wabaId, waPhoneNumberId, waAccessToken, waWebhookSecret, waPhoneNumber } = req.body;

    const encryptedData = encryptBusinessData({
      wabaId,
      waPhoneNumberId,
      waAccessToken,
      waWebhookSecret,
      waPhoneNumber,
    });

    const business = await prisma.business.update({
      where: { id: req.user.businessId },
      data: encryptedData,
    });

    res.json({ success: true, data: business });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to update WhatsApp config' });
  }
});

// Update social media tokens
router.put('/social-media', authenticate, requireBusinessOwner, async (req: any, res: any) => {
  try {
    const { fbPageId, fbAccessToken, igUserId, igAccessToken } = req.body;

    const encryptedData = encryptBusinessData({ fbPageId, fbAccessToken, igUserId, igAccessToken });

    const business = await prisma.business.update({
      where: { id: req.user.businessId },
      data: encryptedData,
    });

    res.json({ success: true, data: business });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to update social media config' });
  }
});

// Get pipelines
router.get('/pipelines', authenticate, async (req: any, res: any) => {
  try {
    const pipelines = await prisma.pipeline.findMany({
      where: { businessId: req.user.businessId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: pipelines });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to fetch pipelines' });
  }
});

// Create pipeline
router.post('/pipelines', authenticate, async (req: any, res: any) => {
  try {
    const { name, stages } = req.body;

    const pipeline = await prisma.pipeline.create({
      data: { businessId: req.user.businessId, name, stages: stages || [] },
    });

    res.status(201).json({ success: true, data: pipeline });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Failed to create pipeline' });
  }
});

export default router;
