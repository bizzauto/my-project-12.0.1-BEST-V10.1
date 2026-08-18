import { prisma } from '../db.js';
import { EvolutionApiService } from './evolution.service.js';

/**
 * WhatsAppSendRouter
 *
 * Unified WhatsApp send router. Resolves which WhatsApp channel a business uses
 * and routes every user-facing send through it.
 *
 * Strategy (user-confirmed): Evolution (QR/mobile) is PRIMARY; Meta Cloud API is
 * an optional upgrade.
 *
 * Resolution order:
 *   1. If `business.waPhoneNumberId` AND `business.waAccessToken` are set → Meta Cloud API
 *   2. Else if an active Integration (type 'evolution_api', isActive true) exists → Evolution API
 *   3. Else → channel is null (not configured)
 *
 * This fixes the defect where businesses connected on mobile (Evolution) got silently-failing
 * lead auto-replies because LeadCaptureService only used the Meta path.
 */

export type WhatsAppChannel = 'meta' | 'evolution' | null;

export interface ResolveChannelResult {
  channel: WhatsAppChannel;
}

export interface SendTextOptions {
  messageId?: string;
  useProxy?: boolean;
  delay?: number;
  linkPreview?: boolean;
}

export interface SendTemplateOptions {
  messageId?: string;
  useProxy?: boolean;
  delay?: number;
}

export interface BulkMessage {
  to: string;
  type: 'text' | 'template';
  content: string;
  templateData?: any;
  contactId?: string;
}

export interface BulkSendOptions {
  rateLimit?: number;
  useProxy?: boolean;
  delayBetween?: number;
  campaignId?: string;
}

export class WhatsAppSendRouter {
  /**
   * Resolve which WhatsApp channel a business should use.
   */
  static async resolveChannel(businessId: string): Promise<ResolveChannelResult> {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { waPhoneNumberId: true, waAccessToken: true },
    });

    // Meta Cloud API configured (optional upgrade)
    if (business?.waPhoneNumberId && business?.waAccessToken) {
      return { channel: 'meta' };
    }

    // Fall back to Evolution API (QR/mobile connect)
    const evolutionIntegration = await prisma.integration.findFirst({
      where: { businessId, type: 'evolution_api', isActive: true },
      select: { id: true },
    });

    if (evolutionIntegration) {
      return { channel: 'evolution' };
    }

    return { channel: null };
  }

  /**
   * Send a text message, routed to the resolved channel.
   */
  static async sendText(
    businessId: string,
    to: string,
    message: string,
    opts: SendTextOptions = {}
  ): Promise<any> {
    const { channel } = await this.resolveChannel(businessId);

    if (channel === 'evolution') {
      return EvolutionApiService.sendText(businessId, to, message, {
        delay: opts.delay,
        linkPreview: opts.linkPreview,
      });
    }

    if (channel === 'meta') {
      const { WhatsAppService } = await import('./whatsapp.service.js');
      return WhatsAppService.sendTextMessage(businessId, to, message, {
        messageId: opts.messageId,
        useProxy: opts.useProxy,
      });
    }

    throw new Error('WhatsApp not configured for this business');
  }

  /**
   * Send a template message, routed to the resolved channel.
   */
  static async sendTemplate(
    businessId: string,
    to: string,
    templateData: any,
    opts: SendTemplateOptions = {}
  ): Promise<any> {
    const { channel } = await this.resolveChannel(businessId);

    if (channel === 'evolution') {
      return EvolutionApiService.sendTemplate(businessId, to, templateData, {
        delay: opts.delay,
      });
    }

    if (channel === 'meta') {
      const { WhatsAppService } = await import('./whatsapp.service.js');
      return WhatsAppService.sendTemplate(
        businessId,
        to,
        templateData?.templateName ?? templateData?.name ?? '',
        templateData?.language ?? 'en',
        templateData?.variables ?? [],
        { useProxy: opts.useProxy }
      );
    }

    throw new Error('WhatsApp not configured for this business');
  }

  /**
   * Bulk send messages, routed to the resolved channel.
   */
  static async bulkSend(
    businessId: string,
    messages: BulkMessage[],
    opts: BulkSendOptions = {}
  ): Promise<any> {
    const { channel } = await this.resolveChannel(businessId);

    if (channel === 'evolution') {
      return EvolutionApiService.bulkSend(businessId, messages, {
        delayBetween: opts.delayBetween,
        campaignId: opts.campaignId,
      });
    }

    if (channel === 'meta') {
      const { WhatsAppService } = await import('./whatsapp.service.js');
      return WhatsAppService.bulkSend(businessId, messages, {
        rateLimit: opts.rateLimit,
        useProxy: opts.useProxy,
        campaignId: opts.campaignId,
      });
    }

    throw new Error('WhatsApp not configured for this business');
  }
}

export default WhatsAppSendRouter;
