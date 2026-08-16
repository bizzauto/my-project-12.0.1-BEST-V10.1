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
    const qr = await prisma.reviewQRCode.findUnique({
      where: { slug: req.params.slug },
      include: { business: { select: { reviewQrNegativeRedirectUrl: true } } },
    });

    if (!qr || qr.status !== "active") {
      return res.status(404).send("Review link not found.");
    }

    // Increment scan counter (fire-and-forget)
    await prisma.reviewQRCode.update({
      where: { id: qr.id },
      data: { scans: { increment: 1 } },
    });

    const negativeUrl = qr.business.reviewQrNegativeRedirectUrl;

        // Pre-written review suggestions → tap to copy, then open Google.
        const suggestions = Array.isArray(qr.suggestedReviews)
          ? qr.suggestedReviews.filter((s: string) => s && s.trim().length > 0).slice(0, 4)
          : [];

        // Straight redirect ONLY when there is nothing to show:
        // no rating-gate AND no pre-written review templates.
        if (!negativeUrl && suggestions.length === 0) {
          return res.redirect(302, qr.url);
        }

        // Rating-gated interstitial — customers picking 1-3 stars get routed to
        // the feedback form instead of posting a public negative review.
        const safeReviewUrl = encodeURIComponent(qr.url);
        const safeNegativeUrl = encodeURIComponent(negativeUrl || "");

        const jsonSuggestions = JSON.stringify(suggestions)
          .replace(/</g, "\\u003c")
          .replace(/>/g, "\\u003e");
        const safeName = qr.name ? qr.name.replace(/[<>&"]/g, "") : "";

        res.status(200).type("html").send(`<!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Rate your experience</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px}
      .card{background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08);max-width:440px;width:100%;padding:28px;text-align:center}
      h1{font-size:20px;color:#0f172a;margin:0 0 6px}
      p{color:#64748b;font-size:14px;margin:0 0 20px}
      .stars{display:flex;justify-content:center;gap:8px;margin-bottom:20px}
      .star{font-size:36px;text-decoration:none;color:#cbd5e1;transition:transform .1s,color .1s;display:inline-block;padding:4px}
      .star:hover{transform:scale(1.25)}
      a{border-radius:12px}
      .happy{color:#f59e0b}
      .happy:hover{color:#d97706}
      .unhappy{color:#94a3b8}
      .unhappy:hover{color:#ef4444}
      .actions{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-bottom:18px}
      .btn{display:inline-flex;align-items:center;gap:6px;padding:10px 18px;font-size:14px;font-weight:600;text-decoration:none}
      .btn-primary{background:#f59e0b;color:#fff}
      .btn-ghost{background:#f1f5f9;color:#475569}
      .suggestions{text-align:left;border-top:1px dashed #e2e8f0;padding-top:16px;margin-top:16px}
      .suggestions h2{font-size:14px;font-weight:600;color:#0f172a;margin:0 0 4px}
      .suggestions p{font-size:12px;color:#94a3b8;margin:0 0 12px}
      .sug{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:13px;color:#334155;line-height:1.5;display:flex;gap:8px;align-items:flex-start}
      .sug .txt{flex:1}
      .sug button{background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
      .sug button.copied{background:#22c55e}
      .goto{margin-top:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
      .note{font-size:12px;color:#94a3b8;margin-top:14px}
    </style>
    </head>
    <body>
    <div class="card">
      <h1>How was your experience?</h1>
      <p>Tap a star to continue — it only takes a few seconds</p>
      <div class="stars">
        <a class="star happy" href="${safeReviewUrl}" title="5 stars" aria-label="5 stars">&#9733;&#9733;&#9733;&#9733;&#9733;</a>
      </div>
      <div class="actions">
        <a href="${safeReviewUrl}" class="btn btn-primary">&#11088; I had a great experience</a>
        ${negativeUrl ? `<a href="${safeNegativeUrl}" class="btn btn-ghost">&#128532; Could be better</a>` : ""}
      </div>
      ${suggestions.length > 0 ? `
      <div class="suggestions">
        <h2>&#128221; Quick reviews</h2>
        <p>Tap to copy one, then paste it in Google</p>
        <div id="sugList"></div>
        <div class="goto">
          <a href="${safeReviewUrl}" class="btn btn-primary">&#10133; Continue to Google</a>
        </div>
      </div>` : ""}
      <p class="note">${safeName ? `QR: ${safeName}` : ""}</p>
    </div>
    <script>
      var suggestions = ${jsonSuggestions};
      var reviewUrl = decodeURIComponent("${safeReviewUrl}");
      var list = document.getElementById("sugList");
      if (list && suggestions.length) {
        suggestions.forEach(function (text, i) {
          var box = document.createElement("div");
          box.className = "sug";
          var txt = document.createElement("div");
          txt.className = "txt";
          txt.textContent = text;
          var btn = document.createElement("button");
          btn.textContent = "\u2713 Copy";
          btn.onclick = function () {
            function markCopied() {
              btn.textContent = "\u2713 Copied!";
              btn.classList.add("copied");
              setTimeout(function () { btn.textContent = "\u2713 Copy"; btn.classList.remove("copied"); }, 2000);
            }
            function fallbackCopy() {
              try {
                var ta = document.createElement("textarea");
                ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
                document.body.appendChild(ta); ta.select();
                var ok = document.execCommand("copy");
                document.body.removeChild(ta);
                if (ok) markCopied();
              } catch (e) { /* nothing more we can do */ }
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
              var copied = false;
              navigator.clipboard.writeText(text).then(function () {
                copied = true;
                markCopied();
              }).catch(fallbackCopy);
              setTimeout(function () { if (!copied) fallbackCopy(); }, 400);
            } else {
              fallbackCopy();
            }
          };
          box.appendChild(txt); box.appendChild(btn);
          list.appendChild(box);
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

// ─── Auth: update QR code (name / url / colors / status) ──────────────────────
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

export default router;

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
