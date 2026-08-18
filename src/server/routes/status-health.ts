/**
 * Status / Health route (Phase E.5)
 * Returns a simple 4-boolean connectivity summary for the StatusPage UI:
 *   { whatsapp, n8n, ai, db }
 * Each is true if the corresponding subsystem is reachable/configured.
 */

import { Router } from 'express';
import { prisma } from '../db.js';
import { WhatsAppSendRouter } from '../services/whatsapp-send-router.service.js';

const router = Router();

/**
 * Lightweight per-subsystem connectivity checks.
 */
async function checkDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkWhatsApp(businessId?: string): Promise<boolean> {
  if (!businessId) return false;
  try {
    const { channel } = await WhatsAppSendRouter.resolveChannel(businessId);
    return channel !== null;
  } catch {
    return false;
  }
}

async function checkN8n(): Promise<boolean> {
  const url = process.env.N8N_URL;
  if (!url) return false;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: ctrl.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

function checkAi(): boolean {
  // AI provider is configured if any supported key/env is present.
  return Boolean(
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.AI_PROVIDER_URL ||
    process.env.NVIDIA_NIM_API_KEY
  );
}

router.get('/health', async (req: any, res: any) => {
  try {
    const businessId = req.user?.businessId;
    const [db, whatsapp, n8n] = await Promise.all([
      checkDb(),
      checkWhatsApp(businessId),
      checkN8n(),
    ]);
    const ai = checkAi();

    res.json({
      success: true,
      data: { db, whatsapp, n8n, ai },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Health check failed' });
  }
});

export default router;
