import { Router, Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';

const router = Router();

const JWT_SECRET = process.env.RESELLER_JWT_SECRET || process.env.WL_JWT_SECRET;
const whiteLabelEnabled = !!JWT_SECRET;

if (!JWT_SECRET) {
  console.warn('[WhiteLabel] ⚠️ RESELLER_JWT_SECRET not set — white-label module DISABLED. Set RESELLER_JWT_SECRET to enable.');
}

const JWT_REFRESH_FALLBACK = process.env.JWT_REFRESH_SECRET;
if (JWT_SECRET && JWT_REFRESH_FALLBACK && JWT_REFRESH_FALLBACK === JWT_SECRET) {
  throw new Error('CRITICAL: RESELLER_JWT_SECRET must be distinct from JWT_REFRESH_SECRET to prevent token-confusion attacks.');
}
const PLAN_PRICES: Record<string, number> = { STARTER: 999, PRO: 4999, ENTERPRISE: 9999 };

// Auth middleware for white-label routes
const wlAuth = async (req: Request, res: Response, next: Function) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      audience: 'reseller',
      issuer: 'bizzauto',
    }) as { resellerId: string };
    (req as any).resellerId = decoded.resellerId;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

// Middleware to check if white-label module is enabled
const requireWhiteLabel = (req: Request, res: Response, next: Function) => {
  if (!whiteLabelEnabled) {
    return res.status(503).json({ 
      success: false, 
      error: 'White-label module not configured. Set RESELLER_JWT_SECRET to enable.' 
    });
  }
  next();
};

// ==================== AUTH ====================

// POST /api/wl/auth/login
router.post('/auth/login', requireWhiteLabel, async (req: AuthRequest, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const reseller = await prisma.wlReseller.findFirst({ where: { email } });
    if (!reseller) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    if (!reseller.isActive) {
      return res.status(403).json({ success: false, error: 'Account is deactivated' });
    }

    const validPassword = await bcrypt.compare(password, reseller.password);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const clients = await prisma.wlClient.findMany({ where: { resellerId: reseller.id } });
    const activeClients = clients.filter((c: any) => c.status === 'active').length;

    const token = jwt.sign({ resellerId: reseller.id }, JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256', audience: 'reseller', issuer: 'bizzauto' });

    const { password: _, ...safeReseller } = reseller;

    res.json({
      success: true,
      data: {
        reseller: {
          ...safeReseller,
          clients: clients.length,
          activeClients,
          revenue: `₹${(reseller.revenue || 0).toLocaleString()}`,
        },
        clients: clients.map((c: any) => ({
          ...c,
          createdAt: c.createdAt.toISOString().split('T')[0],
        })),
        token,
      },
    });
  } catch (err) {
    console.error('WL login error:', err);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// POST /api/wl/auth/register
router.post('/auth/register', requireWhiteLabel, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, phone, company, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email and password required' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    const existing = await prisma.wlReseller.findFirst({ where: { email } });
    if (existing) {
      return res.status(409).json({ success: false, error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newReseller = await prisma.wlReseller.create({
      data: {
        name,
        email,
        password: hashedPassword,
        company: company || `${name}'s Company`,
        phone: phone || null,
        plan: 'STARTER',
        domain: `${name.toLowerCase().replace(/\s+/g, '')}.resellerpro.com`,
        primaryColor: '#6366f1',
      },
    });

    const { password: _, ...safeReseller } = newReseller;

    res.status(201).json({
      success: true,
      data: { reseller: safeReseller },
    });
  } catch (err) {
    console.error('WL register error:', err);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// GET /api/wl/auth/me
router.get('/auth/me', requireWhiteLabel, wlAuth, async (req: AuthRequest, res: Response) => {
  try {
    const resellerId = (req as any).resellerId;
    const reseller = await prisma.wlReseller.findUnique({ where: { id: resellerId } });
    if (!reseller) {
      return res.status(404).json({ success: false, error: 'Reseller not found' });
    }

    const clients = await prisma.wlClient.findMany({ where: { resellerId } });
    const { password: _, ...safeReseller } = reseller;

    res.json({
      success: true,
      data: {
        reseller: {
          ...safeReseller,
          clients: clients.length,
          activeClients: clients.filter((c: any) => c.status === 'active').length,
          revenue: `₹${(reseller.revenue || 0).toLocaleString()}`,
        },
      },
    });
  } catch (err) {
    console.error('WL me error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch profile' });
  }
});

// ==================== CLIENTS ====================

// GET /api/wl/clients
router.get('/clients', requireWhiteLabel, wlAuth, async (req: AuthRequest, res: Response) => {
  try {
    const resellerId = (req as any).resellerId;
    const clients = await prisma.wlClient.findMany({
      where: { resellerId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: {
        clients: clients.map((c: any) => ({
          ...c,
          createdAt: c.createdAt.toISOString().split('T')[0],
        })),
      },
    });
  } catch (err) {
    console.error('WL get clients error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch clients' });
  }
});

// POST /api/wl/clients
router.post('/clients', requireWhiteLabel, wlAuth, async (req: AuthRequest, res: Response) => {
  try {
    const resellerId = (req as any).resellerId;
    const { name, email, phone, product, plan } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'Name and email required' });
    }

    const newClient = await prisma.wlClient.create({
      data: {
        resellerId,
        name,
        email,
        phone: phone || '',
        product: product || 'google-reviews',
        plan: plan || 'STARTER',
        status: 'pending',
      },
    });

    // Update reseller revenue
    await prisma.wlReseller.update({
      where: { id: resellerId },
      data: { revenue: { increment: PLAN_PRICES[plan || 'STARTER'] || 999 } },
    });

    res.status(201).json({
      success: true,
      data: {
        client: {
          ...newClient,
          createdAt: newClient.createdAt.toISOString().split('T')[0],
        },
      },
    });
  } catch (err) {
    console.error('WL create client error:', err);
    res.status(500).json({ success: false, error: 'Failed to create client' });
  }
});

// DELETE /api/wl/clients/:id
router.delete('/clients/:id', requireWhiteLabel, wlAuth, async (req: AuthRequest, res: Response) => {
  try {
    const resellerId = (req as any).resellerId;
    const client = await prisma.wlClient.findFirst({
      where: { id: req.params.id as string, resellerId },
    });

    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    await prisma.wlClient.delete({ where: { id: req.params.id as string } });

    // Subtract revenue
    await prisma.wlReseller.update({
      where: { id: resellerId },
      data: { revenue: { decrement: PLAN_PRICES[client.plan] || 999 } },
    });

    res.json({ success: true, message: 'Client removed' });
  } catch (err) {
    console.error('WL delete client error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete client' });
  }
});

// PATCH /api/wl/clients/:id/status
router.patch('/clients/:id/status', wlAuth, async (req: AuthRequest, res: Response) => {
  try {
    const resellerId = (req as any).resellerId;
    const { status } = req.body;

    if (!['active', 'pending', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const client = await prisma.wlClient.findFirst({
      where: { id: req.params.id as string, resellerId },
    });

    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const updated = await prisma.wlClient.update({
      where: { id: req.params.id as string },
      data: { status },
    });

    res.json({ success: true, data: { client: updated } });
  } catch (err) {
    console.error('WL update client status error:', err);
    res.status(500).json({ success: false, error: 'Failed to update status' });
  }
});

// GET /api/wl/clients/stats
router.get('/clients/stats', requireWhiteLabel, wlAuth, async (req: AuthRequest, res: Response) => {
  try {
    const resellerId = (req as any).resellerId;
    const clients = await prisma.wlClient.findMany({ where: { resellerId } });

    res.json({
      success: true,
      data: {
        total: clients.length,
        active: clients.filter((c: any) => c.status === 'active').length,
        pending: clients.filter((c: any) => c.status === 'pending').length,
        suspended: clients.filter((c: any) => c.status === 'suspended').length,
      },
    });
  } catch (err) {
    console.error('WL client stats error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// ==================== BRANDING ====================

// GET /api/wl/branding
router.get('/branding', requireWhiteLabel, wlAuth, async (req: AuthRequest, res: Response) => {
  try {
    const resellerId = (req as any).resellerId;
    const reseller = await prisma.wlReseller.findUnique({ where: { id: resellerId } });

    if (!reseller) {
      return res.status(404).json({ success: false, error: 'Reseller not found' });
    }

    res.json({
      success: true,
      data: {
        company: reseller.company,
        domain: reseller.domain,
        logo: reseller.logo,
        primaryColor: reseller.primaryColor,
      },
    });
  } catch (err) {
    console.error('WL get branding error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch branding' });
  }
});

// PUT /api/wl/branding
router.put('/branding', requireWhiteLabel, wlAuth, async (req: AuthRequest, res: Response) => {
  try {
    const resellerId = (req as any).resellerId;
    const { company, domain, logo, primaryColor } = req.body;

    const reseller = await prisma.wlReseller.findUnique({ where: { id: resellerId } });
    if (!reseller) {
      return res.status(404).json({ success: false, error: 'Reseller not found' });
    }

    const updated = await prisma.wlReseller.update({
      where: { id: resellerId },
      data: {
        ...(company !== undefined && { company }),
        ...(domain !== undefined && { domain }),
        ...(logo !== undefined && { logo }),
        ...(primaryColor !== undefined && { primaryColor }),
      },
    });

    res.json({
      success: true,
      data: {
        company: updated.company,
        domain: updated.domain,
        logo: updated.logo,
        primaryColor: updated.primaryColor,
      },
    });
  } catch (err) {
    console.error('WL update branding error:', err);
    res.status(500).json({ success: false, error: 'Failed to update branding' });
  }
});

// ==================== PRODUCTS ====================

// GET /api/wl/products
router.get('/products', requireWhiteLabel, (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      products: [
        {
          id: 'google-reviews', name: 'AI Google Reviews QR', tagline: 'Automate Google Reviews with AI',
          description: 'AI-powered Google Review QR code system with auto-reply, review filtering, and NFC card integration.',
          icon: 'Star', price: '₹499/mo', color: '#f59e0b',
          features: ['AI-powered Google Review QR codes', 'Smart auto-reply to reviews', 'Negative review filtering & redirect', 'NFC card integration', 'White-label branding', 'Real-time review monitoring', 'Review request automation', 'Analytics dashboard'],
        },
        {
          id: 'digital-vcard', name: 'Digital V-Card Maker', tagline: 'Smart Digital Business Cards with NFC',
          description: 'Create stunning digital business cards with 30+ templates, NFC support, media galleries, and full white-label customization.',
          icon: 'CreditCard', price: '₹399/mo', color: '#6366f1',
          features: ['30+ ready-to-use templates', 'NFC technology support', 'Add products & services', 'Social media integration', 'Image & video galleries', 'Fully editable anytime', 'Powerful admin dashboard', '100% white-label solution'],
        },
        {
          id: 'website-builder', name: 'Single Page Website Builder', tagline: 'No-Code Website Builder for Businesses',
          description: 'Build beautiful single-page websites in minutes. No coding required. Perfect for portfolios, landing pages, and small businesses.',
          icon: 'Globe', price: '₹599/mo', color: '#14b8a6',
          features: ['Drag-and-drop no-code builder', 'Responsive mobile-first design', '20+ professional templates', 'Custom domain support', 'SEO optimized', 'Analytics integration', 'Contact form builder', 'White-label under your brand'],
        },
      ],
    },
  });
});

export default router;
