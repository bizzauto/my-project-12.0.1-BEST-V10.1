# SKILL.md — UI/UX Polish: Iterative Enhancement Workflow

**Name:** ui-ux-polish
**Description:** Iterative UI/UX polishing workflow for web applications. The exact prompt and methodology for achieving Stripe-level visual polish through multiple passes.

---

## Overview & Key Insight

The skill applies when a "site/app already works and looks decent and you want to improve it." A separate approach is needed for apps requiring complete overhauls.

Two notable techniques drive effectiveness: asking the model for agreement ("don't you agree?") tends to motivate deeper polishing, and instructing the model to separately evaluate desktop versus mobile yields superior outcomes.

## The Workflow

1. App already works and looks decent
2. Run the polish prompt
3. Agent makes incremental improvements
4. Repeat 10+ iterations
5. Each pass adds small improvements that compound

### Why Multiple Passes Work

Each run produces incremental gains, even minor ones. After ~10 iterations, the cumulative effect becomes dramatic. Multiple agents can simultaneously work on polish to accelerate compounding improvements.

## The Exact Prompt

```
I still think there are strong opportunities to enhance the UI/UX look and feel and to make everything work better and be more intuitive, user-friendly, visually appealing, polished, slick, and world class in terms of following UI/UX best practices like those used by Stripe, don't you agree? And I want you to carefully consider desktop UI/UX and mobile UI/UX separately while doing this and hyper-optimize for both separately to play to the specifics of each modality. I'm looking for true world-class visual appeal, polish, slickness, etc. that makes people gasp at how stunning and perfect it is in every way.  Use ultrathink.
```

## Why This Prompt Works

**1. Asks for Agreement** — The agreement question "engages the model's reasoning about whether improvements are possible."

**2. Separates Desktop and Mobile** — Prevents the model from making compromises that are merely acceptable across both rather than excellent for each.

**3. Sets High Standards** — Anchors like "world class," Stripe reference, and "makes people gasp" push the model toward higher quality than generic prompts.

**4. Uses Ultrathink** — Extended thinking lets the model analyze the current state, consider multiple options, choose highest-impact changes, and think through edge cases.

## Best Models

| Model | Effectiveness |
|---|---|
| Claude Code + Opus 4.5 | Excellent |
| Codex + GPT 5.2 (High/Extra-High reasoning) | Excellent |
| Gemini CLI | Good |

## Tech Stack Compatibility

Works with Next.js 16 + React 19 + Tailwind 4, any modern web framework, apps using Framer Motion or similar animation libraries, and essentially anything generic enough to adapt.

## Iteration Protocol

### Single Agent

```
# First pass
[Run the UI/UX polish prompt]

# Review changes
[Agent makes improvements]

# Second pass
[Run the same prompt again]

# Repeat 10+ times until changes become minimal
```

### Multiple Agents

Multiple agents can work simultaneously on UI/UX polish — they focus on different areas. Use file reservations to avoid conflicts, and compound improvements faster.

## When to Use vs. When NOT to Use

**USE when:** App works correctly, basic styling is in place, you want to elevate from decent to world-class, ready for iterative refinement, want desktop + mobile optimization.

**DON'T use when:** App is broken or buggy (fix bugs first), styling is fundamentally wrong (needs complete overhaul), no basic design system in place, or starting from scratch. For overhauls, establish a design system and component library first.

## What the Model Typically Improves

**Visual Polish:** Spacing/padding consistency, typography hierarchy, color contrast and accessibility, shadow and depth effects, border radius consistency, hover/focus states.

**Interaction Design:** Button feedback, loading states, transitions/animations, error state handling, empty state design.

**Mobile Optimization:** Touch target sizes, responsive breakpoints, mobile-specific navigation, gesture support, performance.

**Desktop Optimization:** Keyboard navigation, hover states, multi-column layouts, sidebar navigation, power user shortcuts.

## Tracking Progress

After each iteration, look for subtle shadow improvements, better spacing rhythm, more consistent typography, smoother animations, and better responsive behavior. These compound dramatically after 10 passes.

## Integration with Beads

```
br create "Polish homepage UI/UX for desktop" -t enhancement -p 2
br create "Polish homepage UI/UX for mobile" -t enhancement -p 2
br create "Polish dashboard UI/UX for desktop" -t enhancement -p 2
br create "Polish dashboard UI/UX for mobile" -t enhancement -p 2
```

## Complete Prompt Reference

### Alternative: General Scrutiny (from agent-swarm-workflow)

```
Great, now I want you to super carefully scrutinize every aspect of the application workflow and implementation and look for things that just seem sub-optimal or even wrong/mistaken to you, things that could very obviously be improved from a user-friendliness and intuitiveness standpoint, places where our UI/UX could be improved and polished to be slicker, more visually appealing, and more premium feeling and just ultra high quality, like Stripe-level apps.
```

## Tips

1. Don't skip iterations — even small-seeming changes compound
2. Review changes to ensure the model isn't breaking things
3. Test on real devices (desktop browser ≠ mobile experience)
4. Consider accessibility — WCAG compliance matters
5. Keep performance in mind — "Pretty but slow is bad UX"
