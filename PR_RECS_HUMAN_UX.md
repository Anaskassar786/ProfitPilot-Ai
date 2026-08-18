# Recommendations — Human-Friendly UX Makeover

Turns the Recommendations page from a robotic, hard-to-read workspace into a warm, merchant-friendly experience — without changing backend logic, inventing numbers, or touching any other module.

## Why

Shopify merchants were landing on a page that felt like an internal tool: technical copy, a “Run Analysis” CTA, an empty state that looked like an error, and a light theme where cards and text almost disappeared.

This PR is **Recommendations-only**. AI Command Center, Automation, Copilot, Store Coach, AI Executive, and Insights Hub are untouched.

## What changed

### Light theme (critical)
- Cards sit on `#F8F9FB` / `#FFFFFF` with visible `#E5E7EB` borders and soft shadows
- Body copy is `#111827` / `#4B5563` — WCAG AA contrast
- Search, filters, tooltips, banners, and the sidebar no longer use dark translucent fills
- Approve / Skip buttons stay readable in both themes

### Human-friendly language
| Before | After |
| --- | --- |
| Evidence-backed decisions from your synced Shopify data | Your AI team has been watching your store 🎯 |
| Run Analysis | **Discover Opportunities** |
| Ready to analyze your store | Let’s find your growth opportunities! 🚀 |
| Eight deterministic rules… | Your AI assistants work behind the scenes… |
| Stockout Risk / Dead Stock / Churn Risk | Stockout Alerts / Dead Stock Cash-Out / Save At-Risk Customers |
| Uses: Products + orders | Analyzes: Products & Orders |
| Upgrade plan | **Upgrade Plan** (never “Upgrade to Growth/Commander”) |

### Empty state
- Focused hero + pulsing **Discover Opportunities** CTA
- “What your AI team can find” bullets instead of a wall of technical rule cards
- Friendly rule cards with emoji, tagline, and a simple description
- Sample recommendation still labeled **Sample** — not real data

### Rich analysis flow
- Progress modal: “Your AI team is on it!” with staged steps (scanning products → finding patterns → preparing wins)
- Zero findings: “Great news! Your store looks healthy” plus the real product / customer / order / trigger counts from the API
- Success toast only when real recommendations were generated

### Recommendation cards
- Urgent badge, What to do / Impact / Why sections
- **Skip This** / **Approve & Take Action** (high-risk stays **Review & Approve**)
- **View Full Details** for the evidence drawer
- All numbers still come from the API

### Sidebar
- Donut chart removed (no line / donut charts)
- **Your AI Team** with live dots and distribution bars
- **Your Activity Timeline**, **Top Categories**, **Recent Decisions**
- Educational placeholders when there is no data yet

### Emotional design
- Time-of-day greeting (“Good morning”) plus store name from the shop domain
- Encouraging approve / skip toasts
- Pulse on the primary CTA (respects `prefers-reduced-motion`)
- 12px+ typography throughout the workspace

## Constraints honored

- Zero fake data — sample overlays stay labeled Sample
- Plan gating unchanged (2 / 3 / 6 / 7 agents, monthly usage, locked teammates)
- Upgrade CTAs always say **Upgrade Plan**
- Existing approve / reject / snooze / undo / bulk / deep-link / evidence-verify flows preserved
- Backend analyze / summary / decide APIs unchanged

## Tests

- `recommendations-model.test.ts`
- `recommendations-ui.test.tsx`
- `recommendations-workflow.test.tsx`

All 68 recommendations tests passing.

## How to review

1. Open Recommendations in **light** and **dark** and toggle a few times
2. Empty store: confirm the new empty state and **Discover Opportunities**
3. Run an analysis: confirm the staged modal, then the healthy-store panel or real cards
4. Approve / skip a card and confirm undo still works
5. Trial plan: locked agents still show a plan chip and open billing via **Upgrade Plan**
