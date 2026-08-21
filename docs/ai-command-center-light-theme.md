# AI Command Center — light theme redesign

**Scope:** the light theme of the AI Command Center page only.
**Not touched:** the dark theme, and every other module (Recommendations, Automation,
AI Command/Copilot, Store Coach, GrowthIQ, PatternAI, dashboard, tables, settings …).

---

## 1. Why

The dark theme of the Command Center is the reference design: layered surfaces,
defined borders, saturated accents, real depth. The light theme was an
afterthought — a handful of "make it white" overrides bolted onto dark-theme
rules. The result read as a demo rather than a product:

| # | Problem in light mode | Root cause |
|---|---|---|
| 1 | KPI and agent cards dissolved into the page | card borders were `rgba(155,124,246,.16)` over white ≈ **1.2:1**, shadow `0 1px 3px rgba(0,0,0,.08)` |
| 2 | Every accent looked washed out | dark-theme alpha tints (`rgba(16,185,129,.1)`, `rgba(245,158,11,.1)`) collapse to near-white on white |
| 3 | Fresh activity rows were unreadable | `.cc-feed-row.is-fresh .cc-feed-title` inherited `#CDBEFF` → **1.69:1** on white |
| 4 | The 7-day sparkline rendered as a purple blob | the light override set `fill: #7C5CD6` on the `polyline`, not just the dots |
| 5 | Badges (`Active`, `Available`, `Requires …`) were flat pastels | no borders, weak text colours |
| 6 | Buttons had no presence | primary kept the dark blue-purple gradient, "View details" was a ghost outline, `Upgrade Plan` was a flat yellow slab |
| 7 | Locked agents looked abandoned | dashed grey border on `#F8FAFC`, greyscale-filtered icons |
| 8 | The activity-feed empty state was faded out | sample rows shipped at `opacity: .65` |
| 9 | Purple brand identity disappeared | the eyebrow, section chips and quotes were all neutral grey |

## 2. What changed

One new stylesheet: [`apps/web/src/command-center-light.css`](../apps/web/src/command-center-light.css),
imported **last** in `main.tsx` so it wins on cascade order without a single
`!important`. Every selector in it starts with `.app-shell.light-mode` and
targets `.cc-*` surfaces (plus the shared page header, scoped with
`:has(> .cc-workspace)` so no other page can be reached).

| Area | Treatment |
|---|---|
| Canvas & surfaces | `#F8FAFC` canvas, `#FFFFFF` cards, `#F1F5F9` raised chips |
| Card definition | `1px solid #E2E8F0` + two-layer shadow; hover → `#A78BFA` border, purple-tinted 24px shadow, 2px lift |
| Page header | eyebrow in `#6D28D9` 700, title `#0F172A`, description `#475569` |
| KPI hero | solid icon tiles (green / amber / purple / blue), purple period chips, bordered trend chips, hairline sparkline restored |
| Agent cards | bordered status pills with a pulsing dot, mono version chip, `#E2E8F0` stat rules, purple→emerald confidence bar |
| Primary actions | `linear-gradient(135deg,#7C3AED,#6D28D9)` with a purple shadow; "View details" promoted to solid purple (it is the card's only action) |
| Growth modules | white cards with a `#FAF7FF` top wash, green/amber plan badges, preview quotes on a purple 3px rule |
| Locked agents | solid border + warm `#FFFBEB → #FFFFFF` wash (inviting, not "sad"), amber icon tile, amber sample insight, amber hover glow |
| Upgrade CTA | gold gradient `#FCD34D → #F59E0B → #EA9A08`, `#D97706` border, ink label, amber glow on hover |
| Activity feed | elevated container, `#0F172A` titles, `#6D28D9` for fresh rows, bordered status chips |
| Feed empty state | purple icon tile, full-opacity sample rows, readable copy |
| Drawer | `#F8FAFC` panel, white cards, purple active tab, purple data chips, green availability banner |
| States | 200 ms transitions, hover lifts, `2px #7C3AED` focus ring with 2px offset, `prefers-reduced-motion` opt-out |

Nothing else changed: no component, no markup, no layout, no data, no
behaviour, and no font sizes or spacing (light and dark stay pixel-aligned).

## 3. Palette

```
Canvas        #F8FAFC     Surface       #FFFFFF     Raised        #F1F5F9
Border        #E2E8F0     Border hover  #CBD5E1
Text          #0F172A     Secondary     #475569     Muted         #64748B
Purple        #7C3AED     Hover         #6D28D9     Deep  #5B21B6  Tint #F3E8FF / #DDD6FE
Success       #16A34A     Text #166534  Tint #DCFCE7  Border #86EFAC
Warning       #D97706     Text #92400E  Tint #FEF3C7  Border #FCD34D
Danger        #DC2626     Text #991B1B  Tint #FEE2E2  Border #FCA5A5
Info          #2563EB     Text #1E40AF  Tint #DBEAFE  Border #93C5FD
Shadow sm     0 1px 3px rgba(15,23,42,.07), 0 1px 2px rgba(15,23,42,.05)
Shadow md     0 4px 10px rgba(15,23,42,.08), 0 2px 4px rgba(15,23,42,.05)
Shadow purple 0 10px 24px rgba(124,58,237,.16), 0 2px 6px rgba(15,23,42,.06)
```

Same palette as rgb() for tooling that consumes CSS colours directly:

```
Canvas rgb(248, 250, 252)  Surface rgb(255, 255, 255)  Raised rgb(241, 245, 249)
Border rgb(226, 232, 240)
Text   rgb(15, 23, 42)     Secondary rgb(71, 85, 105)  Muted rgb(100, 116, 139)
Purple rgb(124, 58, 237)   Hover rgb(109, 40, 217)
Success text rgb(22, 101, 52)   Warning text rgb(146, 64, 14)
```

All of it is exposed as `--cc-l-*` custom properties on `.app-shell.light-mode`;
the `cc-` prefix guarantees no other module reads or is affected by them.

## 4. Accessibility report (WCAG 2.1 AA)

### 4.1 Automated

`axe-core` `color-contrast` run against the live page in four states:

| State | Violations |
|---|---|
| Light — populated store | **0** |
| Light — fresh store (empty KPIs, empty feed) | **0** |
| Light — Shopify not connected | **0** |
| Light — agent drawer / locked drawer / growth drawer | **0** |
| Dark — populated (regression control) | 1 pre-existing (`.cc-feed-time` `#6B7280` on `#1A1D27`, 3.47:1) — **untouched by this PR**, dark styles are out of scope |

Gradients were flattened to their worst-case (lowest-contrast) stop before the
run so axe could resolve a background instead of reporting "incomplete".

### 4.2 Measured text pairs (4.5:1 required)

| Element | Foreground | Background | Ratio | |
|---|---|---|---|---|
| Page title | `#0F172A` | `#F8FAFC` | 17.06:1 | ✅ |
| Page eyebrow (AI EMPLOYEE) | `#6D28D9` | `#F8FAFC` | 6.79:1 | ✅ |
| Page description | `#475569` | `#F8FAFC` | 7.24:1 | ✅ |
| Section heading | `#0F172A` | `#F8FAFC` | 17.06:1 | ✅ |
| Section description | `#475569` | `#F8FAFC` | 7.24:1 | ✅ |
| KPI value | `#0F172A` | `#FFFFFF` | 17.85:1 | ✅ |
| KPI unit `/100` | `#64748B` | `#FFFFFF` | 4.76:1 | ✅ |
| KPI label | `#475569` | `#FFFFFF` | 7.58:1 | ✅ |
| KPI empty message | `#334155` | `#FFFFFF` | 10.35:1 | ✅ |
| Period chip (This week / Today / plan) | `#6D28D9` | `#F3E8FF` | 6.02:1 | ✅ |
| Trend chip — up | `#166534` | `#DCFCE7` | 6.49:1 | ✅ |
| Trend chip — down | `#991B1B` | `#FEE2E2` | 6.80:1 | ✅ |
| Trend chip — flat | `#475569` | `#F1F5F9` | 6.92:1 | ✅ |
| Health status — healthy | `#047857` | `#FFFFFF` | 5.48:1 | ✅ |
| Health status — warning | `#B45309` | `#FFFFFF` | 5.02:1 | ✅ |
| Health status — critical | `#B91C1C` | `#FFFFFF` | 6.47:1 | ✅ |
| Agent name | `#0F172A` | `#FFFFFF` | 17.85:1 | ✅ |
| Agent tagline | `#475569` | `#FFFFFF` | 7.58:1 | ✅ |
| Agent stat value | `#0F172A` | `#FFFFFF` | 17.85:1 | ✅ |
| Agent stat label | `#64748B` | `#FFFFFF` | 4.76:1 | ✅ |
| Version chip `v1.1.0` | `#475569` | `#F1F5F9` | 6.92:1 | ✅ |
| Status pill — Active | `#166534` | `#DCFCE7` | 6.49:1 | ✅ |
| Status pill — Paused | `#92400E` | `#FEF3C7` | 6.37:1 | ✅ |
| Status pill — Idle / Awaiting keys | `#5B21B6` | `#F3E8FF` | 7.61:1 | ✅ |
| Badge — Available | `#166534` | `#DCFCE7` | 6.49:1 | ✅ |
| Badge — Requires *plan* | `#92400E` | `#FEF3C7` | 6.37:1 | ✅ |
| Tier label on growth tint | `#475569` | `#FAF7FF` | 7.15:1 | ✅ |
| Growth preview quote | `#334155` | `#F8FAFC` | 9.90:1 | ✅ |
| Locked sample insight | `#92400E` | `#FFFBEB` | 6.84:1 | ✅ |
| Plan price chip `$49/mo` | `#92400E` | `#FEF3C7` | 6.37:1 | ✅ |
| Primary / View details label | `#FFFFFF` | `#7C3AED` | 5.70:1 | ✅ |
| Primary label (hover) | `#FFFFFF` | `#6D28D9` | 7.10:1 | ✅ |
| Secondary button label | `#334155` | `#FFFFFF` | 10.35:1 | ✅ |
| Secondary label (hover) | `#6D28D9` | `#F3E8FF` | 6.02:1 | ✅ |
| Upgrade label — gradient light stop | `#1F2937` | `#FCD34D` | 10.18:1 | ✅ |
| Upgrade label — gradient mid | `#1F2937` | `#F59E0B` | 6.83:1 | ✅ |
| Upgrade label — gradient dark stop | `#1F2937` | `#EA9A08` | 6.38:1 | ✅ |
| Feed agent | `#475569` | `#FFFFFF` | 7.58:1 | ✅ |
| Feed title | `#0F172A` | `#FFFFFF` | 17.85:1 | ✅ |
| Feed title — fresh (was 1.69:1) | `#6D28D9` | `#FFFFFF` | 7.10:1 | ✅ |
| Feed time | `#64748B` | `#FFFFFF` | 4.76:1 | ✅ |
| Feed status — Pending | `#92400E` | `#FEF3C7` | 6.37:1 | ✅ |
| Feed status — Approved / Executed | `#166534` | `#DCFCE7` | 6.49:1 | ✅ |
| Feed status — Rejected / Failed | `#991B1B` | `#FEE2E2` | 6.80:1 | ✅ |
| Feed empty title | `#0F172A` | `#FFFFFF` | 17.85:1 | ✅ |
| Feed empty body | `#475569` | `#FFFFFF` | 7.58:1 | ✅ |
| Feed sample label | `#334155` | `#F8FAFC` | 9.90:1 | ✅ |
| Feed sample detail | `#64748B` | `#F8FAFC` | 4.55:1 | ✅ |
| Error banner | `#991B1B` | `#FEE2E2` | 6.80:1 | ✅ |
| Drawer tab — active | `#6D28D9` | `#F8FAFC` | 6.79:1 | ✅ |
| Drawer tab — idle | `#64748B` | `#F8FAFC` | 4.55:1 | ✅ |
| Drawer body copy | `#475569` | `#FFFFFF` | 7.58:1 | ✅ |
| Drawer data chip | `#5B21B6` | `#F3E8FF` | 7.61:1 | ✅ |
| Availability banner | `#14532D` | `#DCFCE7` | 8.30:1 | ✅ |
| Menu item | `#334155` | `#FFFFFF` | 10.35:1 | ✅ |
| Menu item (hover) | `#5B21B6` | `#F3E8FF` | 7.61:1 | ✅ |

Lowest text ratio on the page: **4.55:1** (12px muted metadata) — above the
4.5:1 threshold. These pairs are asserted in
`apps/web/src/command-center-light.test.ts`, so a regression fails CI.

### 4.3 Non-text contrast (3:1 required — SC 1.4.11)

| Object | Foreground | Background | Ratio | |
|---|---|---|---|---|
| Focus ring on a card | `#7C3AED` | `#FFFFFF` | 5.70:1 | ✅ |
| Focus ring on the canvas | `#7C3AED` | `#F8FAFC` | 5.45:1 | ✅ |
| Primary button boundary | `#7C3AED` | `#F8FAFC` | 5.45:1 | ✅ |
| Upgrade button boundary | `#D97706` | `#FFFFFF` | 3.19:1 | ✅ |
| Active status dot | `#16A34A` | `#DCFCE7` | 3.00:1 | ✅ |
| Active agent dot | `#16A34A` | `#FFFFFF` | 3.30:1 | ✅ |
| Sparkline stroke | `#7C3AED` | `#FFFFFF` | 5.70:1 | ✅ |
| Confidence fill vs track | `#7C3AED` | `#E2E8F0` | 4.62:1 | ✅ |
| Health gauge fill vs track | `#16A34A` | `#F1F5F9` | 3.01:1 | ✅ |
| KPI icon — insights | `#7C3AED` | `#F3E8FF` | 4.83:1 | ✅ |
| KPI icon — health | `#047857` | `#DCFCE7` | 4.99:1 | ✅ |
| KPI icon — actions | `#B45309` | `#FEF3C7` | 4.51:1 | ✅ |
| KPI icon — agents | `#1E40AF` | `#DBEAFE` | 7.15:1 | ✅ |

**Documented exemptions** (SC 1.4.11 covers objects *required* to understand
content or identify a control):

* Card outlines (`#E2E8F0`, 1.18:1 on the canvas) are decorative separators —
  the same convention Linear, Notion and Vercel use. Every card additionally
  carries a two-layer shadow, so the boundary is perceivable without relying on
  the border alone, and no control is identified by it.
* The agent dot rail (`#CBD5E1` locked dots) is `aria-hidden` and duplicates the
  visible "2 of 5" text.
* Feed agent dots are decorative; the agent name sits next to them.

### 4.4 Keyboard & motion

* Every button, card action, feed row, menu item and drawer control shows a
  `2px #7C3AED` ring at `2px` offset (`:focus-visible` only, so mouse users see
  no ring).
* Tab order and DOM order are unchanged — no markup was touched.
* All hover lifts and transitions are 200 ms and are disabled under
  `prefers-reduced-motion: reduce`.

## 5. Dark-theme proof

Two independent checks:

1. **Static** — `command-center-light.test.ts` parses the new stylesheet and
   fails if any selector is not prefixed with `.app-shell.light-mode`, if any
   selector targets a non-`cc-` surface, or if `!important` appears.
2. **Runtime** — the Command Center was rendered in dark mode and the computed
   style of **every element** (557 of them, 20 properties each: colours,
   borders, shadows, fills, box metrics) was captured with the new stylesheet
   enabled and disabled:

   ```
   dark/fresh:     557 elements, 0 computed-style differences
   dark/populated: 557 elements, 0 computed-style differences
   ```

## 6. Screenshots

| File | Contents |
|---|---|
| `screenshots/ai-command-center/before-after-sections.png` | section-by-section before/after (KPIs, agents, growth modules, locked agents, feed) |
| `screenshots/ai-command-center/light-before.png` | full page, light, before |
| `screenshots/ai-command-center/light-after.png` | full page, light, after |
| `screenshots/ai-command-center/light-before-fresh-store.png` | fresh store, light, before |
| `screenshots/ai-command-center/light-after-fresh-store.png` | fresh store, light, after |
| `screenshots/ai-command-center/dark-unchanged.png` | dark theme after the change (identical to main) |
| `screenshots/ai-command-center/theme-parity.png` | light vs dark side by side |
| `screenshots/ai-command-center/light-interactive-states.png` | hover, focus, drawer, empty states |

## 7. How to review it yourself

```bash
corepack pnpm install
corepack pnpm --filter @profitpilot/web dev
```

Then open the dev-only harness (mocked API, no backend required):

| URL | State |
|---|---|
| `/cc-verify.html` | light theme, fresh store |
| `/cc-verify.html?data=populated` | light theme, populated store |
| `/cc-verify.html?theme=dark&data=populated` | dark theme control |
| `/cc-verify.html?state=nostore` | Shopify not connected |
| `/cc-verify.html?state=loading` | loading skeletons |

The toolbar at the top toggles theme and scenario live. `cc-verify.html` is
dev-only: `vite build` only emits `index.html`, exactly like the existing
`verify.html`, `preview.html` and `recs-verify.html` harnesses.

## 8. Deliberate deviations from the ticket's sample CSS

| Ticket suggested | Shipped | Why |
|---|---|---|
| `Upgrade Plan` = `linear-gradient(#F59E0B,#EA580C)` with **white** text | gold gradient with `#1F2937` ink text, `#D97706` border | white on `#F59E0B` is **2.11:1** and on `#EA580C` **3.56:1** — both fail AA. The shipped pair is 6.4–10.2:1 and keeps the gold "upgrade" identity (the dark theme already uses ink-on-gold). |
| New font sizes (32px titles, 22px section headings, …) | existing sizes kept | changing type scale in one theme only would desynchronise light and dark layouts; the ticket also requires zero layout changes. |
| `.light-theme .*` class names | `.app-shell.light-mode .cc-*` | that is the theme class this app actually ships; the ticket's names do not exist in the DOM. |
| Styling generic `.card`, `.page-*`, `h1..h4`, `a`, `button` globally | scoped to `.cc-*` (+ `:has(> .cc-workspace)` for the shared header) | global rules would repaint Recommendations, Automation, Store Coach, PatternAI and every other module, which the ticket forbids. |
