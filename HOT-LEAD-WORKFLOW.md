# 🎯 Hot Lead Auto-Processing Workflow

## Overview

This system automatically processes leads from IndiaMART, JustDial, Facebook, and Instagram with:

1. **Rate-Limited WhatsApp Messages** (3 msg/min per number)
2. **Auto-Add Hot Leads to CRM Pipeline**
3. **Team Notifications** (WhatsApp + Push)
4. **Scheduled Marketing Follow-ups**

---

## 🔄 Complete Flow

```
Lead Source (IndiaMART/Facebook/etc.)
        ↓
┌─────────────────────────────────────┐
│  1. Lead Capture Service            │
│     - Upsert contact                │
│     - Check rate limit              │
│     - Send auto-reply (if allowed)  │
│     - OR queue for later            │
└─────────────────────────────────────┘
        ↓
┌─────────────────────────────────────┐
│  2. Hot Lead Processor              │
│     - Calculate lead score (0-100)  │
│     - If score >= 70:               │
│       • Add to CRM pipeline        │
│       • Notify team via WhatsApp   │
│       • Send push notifications    │
│     - Schedule marketing messages  │
└─────────────────────────────────────┘
        ↓
┌─────────────────────────────────────┐
│  3. Scheduled Message Worker        │
│     - Process queue every minute    │
│     - Respect rate limits (3/min)   │
│     - Auto-retry on failure        │
└─────────────────────────────────────┘
```

---

## 📊 Lead Scoring Logic

| Factor | Points |
|--------|--------|
| Source: IndiaMART | +30 |
| Source: Referral | +35 |
| Source: Facebook/Google Ads | +25 |
| Has phone number | +15 |
| Has email | +10 |
| Has company | +10 |
| 3+ activities | +15 |
| Has messages | +20 |
| Created < 1 hour ago | +20 |
| Created < 24 hours ago | +10 |

**Hot Lead Threshold: 70+ points**

---

## ⏱️ Rate Limiting (3 msg/min)

### How It Works

1. **In-Memory Tracking**: Each phone number tracks message timestamps
2. **Per-Minute Limit**: Max 3 messages per minute per unique number
3. **Cooldown Period**: 5 minutes after hitting rate limit
4. **Automatic Queuing**: Messages exceeding limit are queued

### Example Scenario

```
Time 0:00 - Lead A from IndiaMART → WhatsApp sent ✅
Time 0:15 - Lead B from IndiaMART → WhatsApp sent ✅
Time 0:30 - Lead C from IndiaMART → WhatsApp sent ✅
Time 0:45 - Lead D from IndiaMART → WhatsApp QUEUED ⏳
Time 1:00 - Lead D auto-sent (rate limit reset) ✅
```

---

## 🔥 Auto-CRM Pipeline

When a hot lead (score ≥ 70) is detected:

1. **Get/Create Pipeline**: Uses "Sales Pipeline" or creates one
2. **Create Deal**: Contact is updated with deal info
3. **Set Stage**: Automatically set to "Hot Lead"
4. **Estimate Value**: Based on source (IndiaMART: ₹50K, Referral: ₹75K)
5. **Log Activity**: Record in activity feed

### Pipeline Stages

```
New Lead → Hot Lead → Contacted → Qualified → Proposal → Negotiation → Closed Won/Lost
```

---

## 📢 Team Notifications

### WhatsApp Alert (to all team members)

```
🔥 HOT LEAD ALERT!

Name: Rahul Sharma
Phone: 9876543210
Source: IndiaMART
Score: 85/100
Product: LED Driver 60W

⚡ Action Required: Contact within 15 minutes!

View in CRM: https://bizzautoai.com/crm?contact=xxx
```

### In-App Notification

- Type: `hot_lead`
- Title: "🔥 Hot Lead Alert"
- Visible in notification bell

---

## 📅 Scheduled Marketing Messages

### Default Follow-up Sequence

| Timing | Message |
|--------|---------|
| **5 minutes** | Welcome + Thank you |
| **2 hours** | Value proposition |
| **1 day** | Follow-up + Offer |

### Example Messages

**5 min (Welcome):**
```
Hi Rahul! 👋

Thank you for your inquiry about LED Drivers on IndiaMART.

We've received your requirement and our team will get back to you shortly.
```

**2 hours (Value):**
```
Hi Rahul! 👋

Just wanted to share why businesses trust us:

✅ 10+ years experience
✅ 500+ happy clients
✅ Quality certified products

Would you like a quick callback?
```

**1 day (Follow-up):**
```
Hi Rahul! 👋

Following up on your inquiry about LED Drivers.

We have some exciting offers running this week:

🎯 Special discount for new customers
🚚 Free delivery on bulk orders

Interested? Reply YES and we'll call you!
```

---

## 🛠️ API Endpoints

### Check Rate Limit
```bash
GET /api/whatsapp/rate-limit/:phone

Response:
{
  "success": true,
  "data": {
    "phone": "9876543210",
    "messagesInWindow": 2,
    "maxMessages": 3,
    "resetInMs": 30000,
    "isCooldown": false,
    "canSendNow": true
  }
}
```

### Schedule Message
```bash
POST /api/whatsapp/schedule-message

{
  "phone": "9876543210",
  "message": "Hi! Thanks for your interest.",
  "sendAt": "2026-08-11T10:00:00Z",
  "priority": "high",
  "contactId": "xxx"
}
```

### Process Pending Messages
```bash
POST /api/whatsapp/process-pending

Response:
{
  "success": true,
  "data": {
    "processed": 15,
    "message": "Processed 15 pending messages"
  }
}
```

### Get Scheduled Stats
```bash
GET /api/whatsapp/scheduled-stats

Response:
{
  "success": true,
  "data": {
    "stats": {
      "pending": 23,
      "sent": 156,
      "failed": 3
    },
    "upcoming": [...]
  }
}
```

---

## 🔧 Configuration

### Environment Variables

```env
# Rate Limiting
WHATSAPP_RATE_LIMIT_PER_MINUTE=3
WHATSAPP_RATE_LIMIT_COOLDOWN_MS=300000

# Hot Lead Detection
HOT_LEAD_THRESHOLD=70

# Scheduled Messages
SCHEDULED_MESSAGE_PROCESS_INTERVAL=60000
```

### Business Settings (in Database)

```typescript
// Business.autoReplyMessage - Custom welcome message
// Business.waPhoneNumberId - WhatsApp Business API phone
// Business.waAccessToken - WhatsApp Business API token
```

---

## 📁 File Structure

```
src/server/
├── services/
│   ├── whatsapp-rate-limiter.service.ts  # Rate limiting logic
│   ├── hot-lead-processor.service.ts     # Auto-CRM + notifications
│   ├── lead-capture.service.ts           # Updated with rate limiting
│   └── whatsapp.service.ts               # Existing WhatsApp service
├── workers/
│   ├── scheduled-message.worker.ts       # Queue processor
│   └── index.ts                          # Updated with new worker
├── routes/
│   └── whatsapp-rate-limit.ts            # API endpoints
└── prisma/
    └── schema.prisma                     # Updated with new fields
```

---

## ✅ Testing Checklist

- [ ] Lead from IndiaMART triggers auto-reply
- [ ] Rate limiter blocks 4th message in same minute
- [ ] Queued messages send after rate limit resets
- [ ] Hot lead (score ≥ 70) added to CRM pipeline
- [ ] Team receives WhatsApp notification
- [ ] Scheduled messages send at correct times
- [ ] Messages personalize with lead data
- [ ] Old messages cleaned up after 7 days

---

## 🚀 Deployment

```bash
# 1. Run Prisma migration
npx prisma migrate dev --name add-rate-limit-fields

# 2. Build
npm run build

# 3. Restart server
npm run start

# 4. Verify
curl http://localhost:3000/api/whatsapp/rate-limit/9876543210
```

---

## 🎯 Summary

| Feature | Status |
|---------|--------|
| Rate Limiting (3/min) | ✅ Implemented |
| Auto-CRM Pipeline | ✅ Implemented |
| Team Notifications | ✅ Implemented |
| Scheduled Marketing | ✅ Implemented |
| Lead Scoring | ✅ Implemented |
| Message Queuing | ✅ Implemented |

**All systems go!** 🚀
