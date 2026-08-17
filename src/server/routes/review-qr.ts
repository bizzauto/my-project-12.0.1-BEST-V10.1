import { Router, Response, Request } from "express";
import { prisma } from "../db.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";
import { randomBytes } from "crypto";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSlug(): string {
  // Short unguessable slug: 6 random bytes → base36 (~2e9 combos)
  const bytes = randomBytes(6);
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let slug = "";
  for (let i = 0; i < bytes.length; i++) {
    slug += chars[bytes[i] % 36];
  }
  return slug;
}

// ─── Public router: root-level /r/:slug scan tracking ─────────────────────────
// Registered separately as app.use('/r', publicRouter) so QR links are short:
// https://yourdomain/r/abc123 → tracks scan → redirects/interstitial.
export const publicRouter = Router();

publicRouter.get("/:slug", async (req: Request, res: Response) => {
  try {
    let qr = await prisma.reviewQRCode.findUnique({
      where: { slug: req.params.slug },
      include: { business: { select: { reviewQrNegativeRedirectUrl: true } } },
    });

    if (!qr || qr.status !== "active") {
      // Graceful fallback: unknown/expired slug still shows the rating gate
      // with the default Google review URL — printed QRs never die.
      console.warn(`[ReviewQR] slug not found/inactive: ${req.params.slug}`);
      qr = {
        id: "fallback",
        url: "https://g.page/bizzauto/review",
        name: "Review",
        suggestedReviews: [],
        business: { reviewQrNegativeRedirectUrl: "https://bizzautoai.com/feedback?rating=low" },
      } as any;
    }

    // Increment scan counter (only for real DB-backed QRs)
    if (qr.id !== "fallback") {
      await prisma.reviewQRCode.update({
        where: { id: qr.id },
        data: { scans: { increment: 1 } },
      });
    }

    const negativeUrl = qr.business.reviewQrNegativeRedirectUrl;
    const reviewUrl = qr.url;

    // Pre-written review suggestions from DB
    const suggestions = Array.isArray(qr.suggestedReviews)
      ? qr.suggestedReviews.filter((s: string) => s && s.trim().length > 0).slice(0, 4)
      : [];

    // Straight redirect ONLY when there is nothing to show:
    // no rating-gate AND no pre-written review templates AND no negative redirect.
    if (!negativeUrl && suggestions.length === 0) {
      return res.redirect(302, reviewUrl);
    }

    const safeReviewUrl = encodeURIComponent(reviewUrl);
        const safeNegativeUrl = encodeURIComponent(negativeUrl || "");
        // HTML-escaped raw URL for href attributes — encodeURIComponent values are
        // NOT safe for href= (browser treats them as relative URLs → loops back to /r/<slug>).
        const htmlReviewUrl = reviewUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const htmlNegativeUrl = (negativeUrl || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const jsonSuggestions = JSON.stringify(suggestions)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e");
    const safeName = qr.name ? qr.name.replace(/[<>&"]/g, "") : "";

    // Enhanced multi-step interstitial inspired by reviewbud (zohirhamid/reviewbud)
    // Step 1: Rate (1-5 stars) → Step 2: Feedback (1-3) or Templates (4-5) → Step 3: Redirect
    res.status(200).type("html").send(`<!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Rate your experience</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px}
      .card{background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08);max-width:440px;width:100%;padding:28px;text-align:center}
      h1{font-size:20px;color:#0f172a;margin:0 0 6px}
      h2{font-size:18px;color:#0f172a;margin:0 0 4px}
      p{color:#64748b;font-size:14px;margin:0 0 16px}
      .step{display:none}.step.active{display:block}
      .stars{display:flex;justify-content:center;gap:8px;margin:20px 0}
      .star{font-size:36px;text-decoration:none;color:#cbd5e1;transition:transform .1s,color .1s;display:inline-block;padding:4px;cursor:pointer}
      .star:hover{transform:scale(1.25);color:#f59e0b}
      .star.selected{color:#f59e0b}
      .star.selected~.star{color:#cbd5e1}
      a{border-radius:12px}
      .actions{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:20px}
      .btn{display:inline-flex;align-items:center;gap:6px;padding:12px 20px;font-size:14px;font-weight:600;text-decoration:none;border:none;cursor:pointer}
      .btn-primary{background:#f59e0b;color:#fff}
      .btn-ghost{background:#f1f5f9;color:#475569}
      .suggestions{text-align:left;border-top:1px dashed #e2e8f0;padding-top:16px;margin-top:16px}
      .suggestions h2{font-size:14px;font-weight:600;color:#0f172a;margin:0 0 4px}
      .suggestions p{font-size:12px;color:#94a3b8;margin:0 0 12px}
      .sug{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:13px;color:#334155;line-height:1.5;display:flex;gap:8px;align-items:flex-start}
      .sug .txt{flex:1}
      .sug button{background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
      .sug button.copied{background:#22c55e}
      .feedback-form{text-align:left;margin-top:16px}
      .feedback-form label{display:block;font-size:13px;font-weight:600;color:#334155;margin-bottom:6px}
      .feedback-form textarea{width:100%;min-height:100px;padding:12px;border:1px solid #e2e8f0;border-radius:10px;font-family:inherit;font-size:14px;resize:vertical}
      .feedback-form textarea:focus{outline:none;border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.2)}
      .progress{display:flex;justify-content:center;gap:8px;margin-bottom:20px}
      .progress-dot{width:10px;height:10px;border-radius:50%;background:#e2e8f0;transition:background .2s}
      .progress-dot.active{background:#f59e0b}
      .progress-dot.completed{background:#22c55e}
      .note{font-size:12px;color:#94a3b8;margin-top:14px}
    </style>
    </head>
    <body>
    <div class="card">
      <div class="progress" id="progress">
        <div class="progress-dot active" data-step="1"></div>
        <div class="progress-dot" data-step="2"></div>
        <div class="progress-dot" data-step="3"></div>
      </div>

      <!-- STEP 1: Rate Experience -->
      <div class="step active" id="step1">
        <h1>How was your experience?</h1>
        <p>Tap a star to continue</p>
        <div class="stars" id="stars">
          <span class="star" data-value="1" aria-label="1 star">&#9733;</span>
          <span class="star" data-value="2" aria-label="2 stars">&#9733;</span>
          <span class="star" data-value="3" aria-label="3 stars">&#9733;</span>
          <span class="star" data-value="4" aria-label="4 stars">&#9733;</span>
          <span class="star" data-value="5" aria-label="5 stars">&#9733;</span>
        </div>
        <p style="font-size:12px;color:#94a3b8;">Tap to rate</p>
      </div>

      <!-- STEP 2a: Negative Feedback (1-3 stars) -->
      <div class="step" id="step2_negative">
        <h2>We're sorry to hear that</h2>
        <p>Please tell us what we could do better</p>
        <form class="feedback-form" id="negativeForm">
          <label for="negativeFeedback">Your feedback (optional)</label>
          <textarea id="negativeFeedback" name="feedback" placeholder="What could we improve?"></textarea>
          <div class="actions" style="margin-top:16px;justify-content:center">
            <button type="button" class="btn btn-ghost" onclick="goBack()">Back</button>
            <button type="submit" class="btn btn-primary">Submit &amp; Continue</button>
          </div>
        </form>
      </div>

      <!-- STEP 2b: Positive - Review Templates (4-5 stars) -->
      <div class="step" id="step2_positive">
        <h2>Thanks for the great rating!</h2>
        <p>Tap a review to copy, then post on Google</p>
        ${suggestions.length > 0 ? `
        <div class="suggestions">
          <div id="sugList"></div>
        </div>
        ` : `<p style="color:#94a3b8;">No templates available — you'll write your own on Google</p>`}
        <div class="actions">
          <button type="button" class="btn btn-ghost" onclick="goBack()">Back</button>
          <a href="${htmlReviewUrl}" class="btn btn-primary" id="goToGoogle" target="_blank" rel="noopener">&#10133; Continue to Google</a>
        </div>
      </div>

      <!-- STEP 3: Redirecting -->
      <div class="step" id="step3">
        <h2>Thank you!</h2>
        <p>Redirecting...</p>
        <div style="margin-top:16px;">
          <svg class="spinner" viewBox="0 0 24 24" style="width:32px;height:32px;margin:0 auto;animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke="#f59e0b" stroke-width="3" fill="none" stroke-dasharray="31.4 31.4" stroke-linecap="round"/></svg>
          <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
        </div>
      </div>

      <p class="note">${safeName ? `QR: ${safeName}` : ""}</p>
    </div>

    <script>
      var reviewUrl = decodeURIComponent("${safeReviewUrl}");
      var negativeUrl = decodeURIComponent("${safeNegativeUrl}");
      var suggestions = ${jsonSuggestions};
      var hasNegativeUrl = ${negativeUrl ? "true" : "false"};
      var selectedRating = 0;

      // --- Progress dots ---
      function setProgress(step) {
        document.querySelectorAll('.progress-dot').forEach(function(dot, i) {
          dot.classList.remove('active', 'completed');
          if (i + 1 < step) dot.classList.add('completed');
          else if (i + 1 === step) dot.classList.add('active');
        });
      }

      // --- Step navigation ---
      function showStep(stepId) {
        document.querySelectorAll('.step').forEach(function(s) { s.classList.remove('active'); });
        document.getElementById(stepId).classList.add('active');
      }
      function goBack() {
        showStep('step1');
        setProgress(1);
        selectedRating = 0;
        document.querySelectorAll('.star').forEach(function(s) { s.classList.remove('selected'); });
      }

      // --- Star rating ---
      document.querySelectorAll('#stars .star').forEach(function(star) {
        star.addEventListener('click', function() {
          selectedRating = parseInt(this.dataset.value);
          document.querySelectorAll('#stars .star').forEach(function(s) {
            s.classList.toggle('selected', parseInt(s.dataset.value) <= selectedRating);
          });
          setTimeout(function() {
            if (selectedRating <= 3) {
              showStep('step2_negative');
              setProgress(2);
            } else {
              showStep('step2_positive');
              setProgress(2);
              renderSuggestions();
            }
          }, 300);
        });
      });

      // --- Render suggestion cards (4-5 star path) ---
      function renderSuggestions() {
        var list = document.getElementById('sugList');
        if (!list || !suggestions.length) return;
        list.innerHTML = '';
        suggestions.forEach(function(text, i) {
          var box = document.createElement('div');
          box.className = 'sug';
          var txt = document.createElement('div');
          txt.className = 'txt';
          txt.textContent = text;
          var btn = document.createElement('button');
          btn.textContent = '\u2713 Copy';
          btn.onclick = function() { copyText(text, btn); };
          box.appendChild(txt); box.appendChild(btn);
          list.appendChild(box);
        });
      }

      // --- Copy to clipboard ---
      function copyText(text, btn) {
        function markCopied() {
          btn.textContent = '\u2713 Copied!';
          btn.classList.add('copied');
          setTimeout(function() { btn.textContent = '\u2713 Copy'; btn.classList.remove('copied'); }, 2000);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(markCopied).catch(function() { fallbackCopy(text, markCopied); });
        } else {
          fallbackCopy(text, markCopied);
        }
      }
      function fallbackCopy(text, callback) {
        try {
          var ta = document.createElement('textarea');
          ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          var ok = document.execCommand('copy');
          document.body.removeChild(ta);
          if (ok) callback();
        } catch (e) {}
      }

      // --- Negative feedback form submit ---
      var negativeForm = document.getElementById('negativeForm');
      if (negativeForm) {
        negativeForm.addEventListener('submit', function(e) {
          e.preventDefault();
          var feedback = document.getElementById('negativeFeedback').value.trim();
          // NEGATIVE reviews (1-3 stars) MUST NEVER reach Google.
          // Persist the feedback server-side (internal record only) and only
          // redirect to the business's internal feedback form (negativeUrl).
          // If no negativeUrl is configured, we intentionally stay on the
          // thank-you screen and do NOT fall back to the Google review URL —
          // that would leak a negative review publicly.
          persistNegativeFeedback(selectedRating, feedback);
          showStep('step3');
          setProgress(3);
          setTimeout(function() {
            if (hasNegativeUrl) {
              window.location.href = negativeUrl;
            }
            // else: keep the user on the thank-you screen. Negative feedback
            // is deliberately kept off Google.
          }, 800);
        });
      }

      // Best-effort persist of negative feedback to the server. Never blocks
      // the redirect. This keeps an internal record (DB) without ever posting
      // to Google.
      function persistNegativeFeedback(rating, feedback) {
        try {
          var payload = { rating: rating, feedback: feedback, slug: "${qr.slug}" };
          if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/review-qr/feedback', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
          } else {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/review-qr/feedback', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify(payload));
          }
        } catch (e) { /* non-fatal */ }
      }

      // --- Positive path: Continue to Google ---
      var goToGoogle = document.getElementById('goToGoogle');
      if (goToGoogle) {
        goToGoogle.addEventListener('click', function() {
          // Allow default link behavior (navigate to Google)
        });
      }
    </script>
    </body>
    </html>`);
  } catch (error: any) {
    console.error("[ReviewQR] scan error:", error.message);
    res.status(500).send("Something went wrong. Please try again.");
  }
});

// ─── Auth: list QR codes ──────────────────────────────────────────────────────
router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const qrCodes = await prisma.reviewQRCode.findMany({
      where: { businessId: req.user.businessId },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: qrCodes });
  } catch (error: any) {
    console.error("[ReviewQR] list error:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch QR codes" });
  }
});

// ─── Auth: create QR code ─────────────────────────────────────────────────────
router.post("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name, url, fgColor, bgColor, suggestedReviews } = req.body;

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ success: false, error: "Name is required" });
    }
    const targetUrl = url?.trim() || "https://g.page/bizzauto/review";
    if (!/^https?:\/\//i.test(targetUrl)) {
      return res
        .status(400)
        .json({ success: false, error: "URL must start with http(s)://" });
    }
    const cleanedSuggestions = Array.isArray(suggestedReviews)
      ? suggestedReviews.map((s: any) => String(s).trim()).filter((s: string) => s.length > 0)
      : [];

    const qr = await prisma.reviewQRCode.create({
      data: {
        businessId: req.user.businessId,
        name: name.trim(),
        slug: makeSlug(),
        url: targetUrl,
        fgColor: fgColor || "#000000",
        bgColor: bgColor || "#ffffff",
        ...(cleanedSuggestions.length > 0
          ? { suggestedReviews: cleanedSuggestions }
          : {}),
      },
    });

    res.status(201).json({ success: true, data: qr });
  } catch (error: any) {
    console.error("[ReviewQR] create error:", error.message);
    res.status(500).json({ success: false, error: "Failed to create QR code" });
  }
});

// ─── Auth: business-level settings ────────────────────────────────────────────
// MUST be declared BEFORE /:id routes (Express matches in order — "/settings"
// would otherwise be captured by "/:id")
router.get(
  "/settings",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const business = await prisma.business.findUnique({
        where: { id: req.user.businessId },
        select: {
          reviewQrAutoReplyEnabled: true,
          reviewQrNegativeRedirectUrl: true,
        },
      });
      res.json({
        success: true,
        data: business || {},
      });
    } catch (error: any) {
      console.error("[ReviewQR] settings get error:", error.message);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch settings" });
    }
  },
);

router.put(
  "/settings",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { autoReplyEnabled, negativeRedirectUrl } = req.body;
      const data: any = {};
      if (autoReplyEnabled !== undefined)
        data.reviewQrAutoReplyEnabled = !!autoReplyEnabled;
      if (negativeRedirectUrl !== undefined) {
        data.reviewQrNegativeRedirectUrl = negativeRedirectUrl
          ? String(negativeRedirectUrl).trim()
          : null;
      }
      const updated = await prisma.business.update({
        where: { id: req.user.businessId },
        data,
        select: {
          reviewQrAutoReplyEnabled: true,
          reviewQrNegativeRedirectUrl: true,
        },
      });
      res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error("[ReviewQR] settings save error:", error.message);
      res
        .status(500)
        .json({ success: false, error: "Failed to save settings" });
    }
  },
);

// ─── Auth: update QR code (name / url / colors / status) ──────────────────────
router.put("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.reviewQRCode.findFirst({
      where: { id: req.params.id, businessId: req.user.businessId },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, error: "QR code not found" });
    }

    const { name, url, fgColor, bgColor, status, suggestedReviews } =
      req.body;
    const data: any = {};
    if (name !== undefined) data.name = String(name).trim();
    if (url !== undefined) {
      if (!/^https?:\/\//i.test(url)) {
        return res
          .status(400)
          .json({ success: false, error: "URL must start with http(s)://" });
      }
      data.url = url;
    }
    if (fgColor !== undefined) data.fgColor = fgColor;
    if (bgColor !== undefined) data.bgColor = bgColor;
    if (status !== undefined) {
      if (!["active", "paused"].includes(status)) {
        return res
          .status(400)
          .json({ success: false, error: "Status must be active or paused" });
      }
      data.status = status;
    }
    if (suggestedReviews !== undefined) {
      if (!Array.isArray(suggestedReviews)) {
        return res
          .status(400)
          .json({ success: false, error: "suggestedReviews must be an array" });
      }
      data.suggestedReviews = suggestedReviews
        .map((s: any) => String(s).trim())
        .filter((s: string) => s.length > 0);
    }

    const updated = await prisma.reviewQRCode.update({
      where: { id: existing.id },
      data,
    });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error("[ReviewQR] update error:", error.message);
    res.status(500).json({ success: false, error: "Failed to update QR code" });
  }
});

// ─── Auth: delete QR code ─────────────────────────────────────────────────────
router.delete("/:id", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.reviewQRCode.findFirst({
      where: { id: req.params.id, businessId: req.user.businessId },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, error: "QR code not found" });
    }
    await prisma.reviewQRCode.delete({ where: { id: existing.id } });
    res.json({ success: true, message: "QR code deleted" });
  } catch (error: any) {
    console.error("[ReviewQR] delete error:", error.message);
    res.status(500).json({ success: false, error: "Failed to delete QR code" });
  }
});

export default router;

// ─── Public: persist negative feedback (NEVER posted to Google) ────────────────
// Called via sendBeacon from the QR interstitial when a 1-3 star rating is
// submitted. Stores the feedback internally so the business can follow up,
// but it is NEVER forwarded to Google Business Profile.
publicRouter.post("/feedback", async (req: Request, res: Response) => {
  try {
    const { rating, feedback, slug } = req.body || {};
    const r = parseInt(rating, 10);
    if (!r || r < 1 || r > 3) {
      // Only persist genuine negative feedback. Anything else is ignored.
      return res.status(204).end();
    }
    // Resolve businessId from the QR slug (public endpoint — no auth).
    let businessId: string | undefined;
    if (slug) {
      const qr = await prisma.reviewQRCode.findUnique({
        where: { slug },
        select: { businessId: true },
      });
      businessId = qr?.businessId;
    }
    if (!businessId) {
      return res.status(204).end();
    }
    await prisma.negativeFeedback.create({
      data: {
        businessId,
        qrSlug: slug || null,
        rating: r,
        feedback: feedback ? String(feedback).slice(0, 5000) : null,
      },
    });
    res.status(204).end();
  } catch (error: any) {
    console.error("[ReviewQR] negative feedback persist error:", error.message);
    res.status(204).end();
  }
});