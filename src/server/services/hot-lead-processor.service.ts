import { prisma } from '../db.js';
import { WhatsAppRateLimiter } from './whatsapp-rate-limiter.service.js';
import { WhatsAppService } from './whatsapp.service.js';
import { EvolutionApiService } from './evolution.service.js';

/**
 * Hot Lead Auto-Processing Service
 * Automatically:
 * 1. Adds hot leads to CRM pipeline
 * 2. Notifies team via WhatsApp/push
 * 3. Sends scheduled marketing messages
 */
export class HotLeadProcessor {
  
  // Score threshold for "hot lead"
  private static readonly HOT_LEAD_THRESHOLD = 70;
  
  // Pipeline stage for new hot leads
  private static readonly DEFAULT_STAGE = 'New Lead';
  private static readonly HOT_STAGE = 'Hot Lead';

  /**
   * Process a new lead - auto-add to CRM if hot
   */
  static async processNewLead(
    businessId: string,
    contactId: string,
    leadData: {
      name: string;
      phone: string;
      email?: string;
      source: string;
      score?: number;
      product?: string;
      requirement?: string;
    }
  ): Promise<{
    addedToPipeline: boolean;
    teamNotified: boolean;
    marketingScheduled: boolean;
    pipelineDealId?: string;
  }> {
    const result = {
      addedToPipeline: false,
      teamNotified: false,
      marketingScheduled: false,
      pipelineDealId: undefined as string | undefined,
    };

    // 1. Calculate or use provided lead score
    const leadScore = leadData.score || await this.calculateLeadScore(businessId, contactId);
    const isHotLead = leadScore >= this.HOT_LEAD_THRESHOLD;

    // 2. Auto-add to CRM pipeline if hot
    if (isHotLead) {
      try {
        const deal = await this.addToPipeline(businessId, contactId, {
          ...leadData,
          score: leadScore,
        });
        result.addedToPipeline = true;
        result.pipelineDealId = deal.id;
        console.log(`[HotLead] Added ${leadData.name} to pipeline (score: ${leadScore})`);
      } catch (error: any) {
        console.error('[HotLead] Failed to add to pipeline:', error.message);
      }
    }

    // 3. Notify team for hot leads
    if (isHotLead) {
      try {
        await this.notifyTeam(businessId, contactId, {
          ...leadData,
          score: leadScore,
        });
        result.teamNotified = true;
        console.log(`[HotLead] Team notified for ${leadData.name}`);
      } catch (error: any) {
        console.error('[HotLead] Failed to notify team:', error.message);
      }
    }

    // 4. Schedule marketing messages (for all leads, not just hot)
    try {
      await this.scheduleMarketingMessages(businessId, contactId, leadData);
      result.marketingScheduled = true;
      console.log(`[HotLead] Marketing scheduled for ${leadData.name}`);
    } catch (error: any) {
      console.error('[HotLead] Failed to schedule marketing:', error.message);
    }

    return result;
  }

  /**
   * Add lead to CRM pipeline
   */
  private static async addToPipeline(
    businessId: string,
    contactId: string,
    leadData: any
  ): Promise<any> {
    // Get or create default pipeline
    let pipeline = await prisma.pipeline.findFirst({
      where: { businessId, name: 'Sales Pipeline' },
    });

    if (!pipeline) {
      pipeline = await prisma.pipeline.create({
        data: {
          businessId,
          name: 'Sales Pipeline',
          description: 'Auto-created for hot leads',
          stages: ['New Lead', 'Hot Lead', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'],
        },
      });
    }

    // Get stage ID for "Hot Lead"
    const stages = (pipeline.stages as string[]) || ['New Lead', 'Hot Lead', 'Contacted'];
    const hotStageIndex = stages.indexOf('Hot Lead');
    
    // Create deal
    const deal = await prisma.contact.update({
      where: { id: contactId },
      data: {
        dealStage: 'Hot Lead',
        pipelineId: pipeline.id,
        dealValue: this.estimateDealValue(leadData),
        dealNotes: `Auto-added as hot lead. Score: ${leadData.score}. Source: ${leadData.source}`,
        tags: {
          push: ['Hot Lead', 'Auto-Processed'],
        },
      },
    });

    // Create activity
    await prisma.activity.create({
      data: {
        businessId,
        contactId,
        type: 'deal_created',
        title: 'Hot lead auto-added to pipeline',
        content: `Score: ${leadData.score}, Source: ${leadData.source}`,
        metadata: {
          pipelineId: pipeline.id,
          stage: 'Hot Lead',
          score: leadData.score,
          autoProcessed: true,
        },
        createdBy: 'hot_lead_processor',
      },
    });

    return deal;
  }

  /**
   * Notify team via WhatsApp and push notification
   */
  private static async notifyTeam(
    businessId: string,
    contactId: string,
    leadData: any
  ): Promise<void> {
    // Get team members
    const teamMembers = await prisma.user.findMany({
      where: {
        businessId,
        role: { in: ['ADMIN', 'OWNER', 'MEMBER'] },
        isActive: true,
      },
      select: { id: true, phone: true, name: true },
    });

    // Create notification message
    const message = [
      `🔥 *HOT LEAD ALERT!*`,
      ``,
      `*Name:* ${leadData.name}`,
      `*Phone:* ${leadData.phone}`,
      `*Source:* ${leadData.source}`,
      `*Score:* ${leadData.score}/100`,
      leadData.product ? `*Product:* ${leadData.product}` : '',
      leadData.requirement ? `*Requirement:* ${leadData.requirement}` : '',
      ``,
      `⚡ *Action Required:* Contact within 15 minutes!`,
      ``,
      `View in CRM: ${process.env.BASE_URL || 'https://bizzautoai.com'}/crm?contact=${contactId}`,
    ].filter(Boolean).join('\n');

    // Send WhatsApp to team members (with rate limiting)
    for (const member of teamMembers) {
      if (member.phone) {
        try {
          const canSend = await WhatsAppRateLimiter.canSend(businessId, member.phone);
          if (canSend.allowed) {
            await WhatsAppService.sendTextMessage(businessId, member.phone, message);
            WhatsAppRateLimiter.recordSend(businessId, member.phone);
          } else {
            // Queue for later
            await WhatsAppRateLimiter.queueMessage(businessId, member.phone, message, {
              priority: 'high',
              metadata: { type: 'hot_lead_alert', contactId },
            });
          }
        } catch (error: any) {
          console.error(`[HotLead] Failed to notify ${member.name}:`, error.message);
        }
      }
    }

    // Create in-app notification
    for (const member of teamMembers) {
      await prisma.notification.create({
        data: {
          userId: member.id,
          businessId,
          type: 'hot_lead',
          title: '🔥 Hot Lead Alert',
          message: `${leadData.name} from ${leadData.source} (Score: ${leadData.score})`,
          data: { contactId, leadScore: leadData.score },
        },
      });
    }
  }

  /**
   * Schedule marketing messages for new lead
   */
  private static async scheduleMarketingMessages(
    businessId: string,
    contactId: string,
    leadData: any
  ): Promise<void> {
    // Get marketing templates
    const templates = await prisma.messageTemplate.findMany({
      where: {
        businessId,
        isActive: true,
        category: 'lead_followup',
      },
    });

    if (templates.length === 0) {
      // Create default follow-up sequence
      await this.createDefaultFollowUpSequence(businessId);
      return;
    }

    // Schedule messages based on templates
    const now = new Date();
    const schedule = [
      { delay: 5 * 60 * 1000, templateIndex: 0 },      // 5 min
      { delay: 2 * 60 * 60 * 1000, templateIndex: 1 },  // 2 hours
      { delay: 24 * 60 * 60 * 1000, templateIndex: 2 }, // 1 day
    ];

    for (const item of schedule) {
      if (item.templateIndex < templates.length) {
        const template = templates[item.templateIndex];
        const scheduledTime = new Date(now.getTime() + item.delay);

        // Personalize message
        const message = this.personalizeMessage(template.content, leadData);

        // Queue with rate limiter
        await WhatsAppRateLimiter.queueMessage(businessId, leadData.phone, message, {
          priority: 'normal',
          sendAt: scheduledTime,
          metadata: {
            type: 'marketing_followup',
            contactId,
            templateId: template.id,
            sequenceStep: item.templateIndex + 1,
          },
        });
      }
    }
  }

  /**
   * Create default follow-up sequence
   */
  private static async createDefaultFollowUpSequence(businessId: string): Promise<void> {
    const defaultTemplates = [
      {
        name: 'Welcome (5 min)',
        content: `Hi {{name}}! 👋\n\nThank you for your interest in {{product}}.\n\nOur team is reviewing your requirement and will contact you shortly.\n\n有任何问题请随时提问!`,
        delayMinutes: 5,
      },
      {
        name: 'Value Proposition (2 hours)',
        content: `Hi {{name}}! 👋\n\nJust wanted to share why businesses trust us:\n\n✅ 10+ years experience\n✅ 500+ happy clients\n✅ Quality certified products\n\nWould you like a quick callback?`,
        delayMinutes: 120,
      },
      {
        name: 'Follow-up (1 day)',
        content: `Hi {{name}}! 👋\n\nFollowing up on your inquiry about {{product}}.\n\nWe have some exciting offers running this week:\n\n🎯 Special discount for new customers\n🚚 Free delivery on bulk orders\n\nInterested? Reply YES and we'll call you!`,
        delayMinutes: 1440,
      },
    ];

    for (const template of defaultTemplates) {
      await prisma.messageTemplate.create({
        data: {
          businessId,
          name: template.name,
          content: template.content,
          category: 'lead_followup',
          isActive: true,
          variables: ['name', 'product', 'company'],
        },
      });
    }
  }

  /**
   * Personalize message with lead data
   */
  private static personalizeMessage(template: string, leadData: any): string {
    return template
      .replace(/\{\{name\}\}/g, leadData.name || 'there')
      .replace(/\{\{phone\}\}/g, leadData.phone || '')
      .replace(/\{\{product\}\}/g, leadData.product || 'our products')
      .replace(/\{\{company\}\}/g, leadData.company || '')
      .replace(/\{\{source\}\}/g, leadData.source || 'our website');
  }

  /**
   * Calculate lead score based on available data
   */
  private static async calculateLeadScore(
    businessId: string,
    contactId: string
  ): Promise<number> {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: {
        activities: { take: 10, orderBy: { createdAt: 'desc' } },
        messages: { take: 5, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!contact) return 0;

    let score = 0;

    // Source score
    const sourceScores: Record<string, number> = {
      indiamart: 30,
      facebook_ads: 25,
      instagram_ads: 20,
      google_ads: 25,
      website: 15,
      referral: 35,
      justdial: 20,
    };
    score += sourceScores[contact.source || ''] || 10;

    // Contact completeness
    if (contact.phone) score += 15;
    if (contact.email) score += 10;
    if (contact.company) score += 10;

    // Engagement signals
    if (contact.activities.length > 3) score += 15;
    if (contact.messages.length > 0) score += 20;

    // Time-based urgency (lead from last 24h gets bonus)
    const hoursSinceCreation = (Date.now() - contact.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceCreation < 1) score += 20;
    else if (hoursSinceCreation < 24) score += 10;

    return Math.min(100, score);
  }

  /**
   * Estimate deal value based on lead data
   */
  private static estimateDealValue(leadData: any): number {
    // Basic estimation - can be enhanced with AI
    const baseValues: Record<string, number> = {
      indiamart: 50000,
      facebook_ads: 30000,
      instagram_ads: 25000,
      google_ads: 40000,
      referral: 75000,
    };
    return baseValues[leadData.source] || 25000;
  }
}

export default HotLeadProcessor;
