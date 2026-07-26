import { Router, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { GoogleSheetsService } from '../services/google-sheets.service.js';
import { EmailService } from '../services/email.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/integrations
 * List all integrations for business
 */
router.get('/', async (req: any, res: Response) => {
  try {
    const businessId = req.user.businessId;

    const integrations = await prisma.integration.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: integrations });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/integrations/google-sheets
 * Configure Google Sheets integration
 */
router.post('/google-sheets', async (req: any, res: Response) => {
  try {
    const businessId = req.user.businessId;
    const { spreadsheetId, accessToken, refreshToken, expiryDate, autoSync, syncInterval } =
      req.body;

    const integration = await GoogleSheetsService.configureIntegration(businessId, {
      spreadsheetId,
      accessToken,
      refreshToken,
      expiryDate,
      autoSync,
      syncInterval,
    });

    res.json({ success: true, data: integration });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/integrations/google-sheets/oauth-url
 * Get Google OAuth URL
 */
router.get('/google-sheets/oauth-url', async (req: any, res: Response) => {
  try {
    const { popup } = req.query;
    const oauthUrl = GoogleSheetsService.getOAuthUrl();

    // Append popup flag to state so callback knows
    const state = `popup=${popup === 'true'}`;
    const url = `${oauthUrl}&state=${encodeURIComponent(state)}`;

    res.json({ success: true, data: { oauthUrl: url } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/integrations/google-sheets/callback
 * Handle Google OAuth callback - supports both redirect and popup flows
 */
router.get('/google-sheets/callback', async (req: any, res: Response) => {
  try {
    const { code, state, popup } = req.query;
    const businessId = req.query.businessId || req.query.state?.split('businessId=')[1]; // Can be in state or separate

    // Parse state for popup flag
    let isPopup = popup === 'true';
    if (state && state.includes('popup=true')) {
      isPopup = true;
    }

    if (!code || !businessId) {
      const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Google Sheets Integration Error</title></head>
        <body style="font-family: system-ui; padding: 20px; text-align: center;">
          <h2>❌ Integration Failed</h2>
          <p>Missing authorization code or business ID.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'GOOGLE_SHEETS_OAUTH_RESULT',
                success: false,
                error: 'Missing code or businessId'
              }, '${new URL(req.headers.origin || 'http://localhost:5173').origin}');
              window.close();
            }
          </script>
        </body>
        </html>
      `;
      return res.send(errorHtml);
    }

    const result = await GoogleSheetsService.handleOAuthCallback(businessId as string, code as string);
    const origin = new URL(req.headers.origin || 'http://localhost:5173').origin;

    // If popup mode, return HTML that posts message to parent
    if (isPopup) {
      const successHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Google Sheets Connected</title></head>
        <body style="font-family: system-ui; padding: 20px; text-align: center;">
          <h2>✅ Google Sheets Connected!</h2>
          <p>You can close this window.</p>
          <script>
            window.opener?.postMessage({
              type: 'GOOGLE_SHEETS_OAUTH_RESULT',
              success: true,
              spreadsheetId: '${result.spreadsheetId}',
              spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/${result.spreadsheetId}'
            }, '${origin}');
            window.close();
          </script>
        </body>
        </html>
      `;
      return res.send(successHtml);
    }

    // Standard JSON response for redirect flow
    res.json({
      success: true,
      message: 'Google Sheets connected successfully',
      data: result,
    });
  } catch (error: any) {
    const origin = new URL(req.headers.origin || 'http://localhost:5173').origin;
    const isPopup = req.query.popup === 'true' || (req.query.state && req.query.state.includes('popup=true'));

    if (isPopup) {
      const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Google Sheets Integration Error</title></head>
        <body style="font-family: system-ui; padding: 20px; text-align: center;">
          <h2>❌ Integration Failed</h2>
          <p>${error.message}</p>
          <script>
            window.opener?.postMessage({
              type: 'GOOGLE_SHEETS_OAUTH_RESULT',
              success: false,
              error: '${error.message.replace(/'/g, "\\'")}'
            }, '${origin}');
            window.close();
          </script>
        </body>
        </html>
      `;
      return res.send(errorHtml);
    }

    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/integrations/google-sheets/sync
 * Sync contacts to Google Sheets
 */
router.post('/google-sheets/sync', async (req: any, res: Response) => {
  try {
    const businessId = req.user.businessId;
    const { spreadsheetId, sheetName, filter } = req.body;

    const result = await GoogleSheetsService.syncContacts(businessId, {
      spreadsheetId,
      sheetName,
      filter,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/integrations/google-sheets/import
 * Import contacts from Google Sheets
 */
router.post('/google-sheets/import', async (req: any, res: Response) => {
  try {
    const businessId = req.user.businessId;
    const { spreadsheetId, sheetName, range } = req.body;

    const result = await GoogleSheetsService.importContacts(businessId, {
      spreadsheetId,
      sheetName,
      range,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/integrations/google-sheets/create
 * Create new spreadsheet
 */
router.post('/google-sheets/create', async (req: any, res: Response) => {
  try {
    const businessId = req.user.businessId;
    const { title } = req.body;

    const result = await GoogleSheetsService.createSpreadsheet(businessId, title || 'CRM Contacts');

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/integrations/email
 * Configure email integration
 */
router.post('/email', async (req: any, res: Response) => {
  try {
    const businessId = req.user.businessId;
    const {
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPass,
      fromName,
      enableAutoReply,
      autoReplyMessage,
    } = req.body;

    const integration = await EmailService.configureEmail(businessId, {
      host: smtpHost || 'smtp.gmail.com',
      port: smtpPort || 587,
      secure: smtpSecure || false,
      user: smtpUser,
      pass: smtpPass,
      fromName: fromName || smtpUser,
    });

    res.json({ success: true, data: integration });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/integrations/email/test
 * Test email configuration
 */
router.post('/email/test', async (req: any, res: Response) => {
  try {
    const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass } = req.body;


    const isValid = await EmailService.testEmailConfig({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
    });

    res.json({ success: true, data: { valid: isValid } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/integrations/proxy
 * Add proxy for WhatsApp
 */
router.post('/proxy', async (req: any, res: Response) => {
  try {
    const businessId = req.user.businessId;
    const { url, username, password } = req.body;

    const proxy = await WhatsAppService.addProxy(businessId, {
      url,
      username,
      password,
    });

    res.json({ success: true, data: proxy });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/integrations
 * Create custom integration
 */
router.post('/', async (req: any, res: Response) => {
  try {
    const businessId = req.user.businessId;
    const { type, name, config, isActive } = req.body;

    if (!type || !name) {
      return res.status(400).json({
        success: false,
        error: 'Type and name are required',
      });
    }

    const integration = await prisma.integration.create({
      data: {
        businessId,
        type,
        name,
        config: config || {},
        isActive: isActive !== false,
      },
    });

    res.json({ success: true, data: integration });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/integrations/:id
 * Update integration
 */
router.put('/:id', async (req: any, res: Response) => {
  try {
    const businessId = req.user.businessId;
    const { id } = req.params;
    const { name, config, isActive } = req.body;

    const integration = await prisma.integration.update({
      where: { id, businessId },
      data: {
        ...(name && { name }),
        ...(config && { config }),
        ...(typeof isActive === 'boolean' && { isActive }),
      },
    });

    res.json({ success: true, data: integration });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/integrations/:id
 * Delete integration
 */
router.delete('/:id', async (req: any, res: Response) => {
  try {
    const businessId = req.user.businessId;
    const { id } = req.params;

    await prisma.integration.delete({
      where: { id, businessId },
    });

    res.json({ success: true, message: 'Integration deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
