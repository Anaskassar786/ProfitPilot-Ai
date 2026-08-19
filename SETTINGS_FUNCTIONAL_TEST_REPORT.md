# Settings page — complete testing report

Date: 2026-08-19 (updated — final audit pass)  
Scope: Settings workspace only (all six tabs, both themes).

## How this was tested

- Unit model tests: `apps/web/src/settings.test.ts` (13)
- Light/dark CSS contracts: `apps/web/src/settings-light.test.ts` (3)
- Functional UI sweep (jsdom, mocked real APIs): `apps/web/src/settings-functional.test.tsx` (13, including new partial-failure regression tests)
- Backend settings routes: `apps/api/src/automation-routes.test.ts` (10, including the new GET email + workspace persist case)
- `tsc -p apps/web` and `tsc -p apps/api` clean for the changed files
- Full workspace: `corepack pnpm build`, `corepack pnpm typecheck`, `corepack pnpm test` — 2664 tests pass

**39 Settings-related tests passed. Zero fake store metrics were introduced.**

## General tab

| Check | Result |
| --- | --- |
| Tab loads | Pass |
| Store context displays real Shopify domain | Pass — `commander-pilot.myshopify.com` from workspace context |
| Shopify store URL is clickable admin link | Pass — `https://{shop}/admin` |
| Tenant / store ID shown as small technical text | Pass |
| No “No store name is fabricated” copy | Pass |
| Merchant email field editable | Pass |
| From name field editable | Pass |
| Save and verify calls backend | Pass — POST `/settings/merchant-email` |
| Verification email toast | Pass — “Verification email sent!” |
| Badge updates to Pending verification | Pass |
| Confirm verification marks Verified | Pass |
| Theme Dark / Light buttons switch immediately | Pass (wired to existing shell `onTheme`) |
| Reduced motion toggle saves | Pass — local + PUT `/settings/workspace` |
| Save preferences works | Pass |
| Settings persist on reload | Pass — `profitpilot:settings:workspace:{storeId}` |

## Notifications tab

| Check | Result |
| --- | --- |
| Tab loads | Pass |
| Email + in-app toggles display | Pass (6 real preference keys) |
| Each toggle updates state immediately | Pass |
| Save notification preferences persists | Pass — local + backend |
| States survive reload | Pass |

## AI Preferences tab (was “Jarvis preferences”)

| Check | Result |
| --- | --- |
| Sidebar label is “AI Preferences” | Pass |
| Tab loads | Pass |
| AI mode Active / Balanced / Quiet works | Pass — maps to Jarvis `proactive` / `balanced` / `quiet` |
| Floating bubble toggle works | Pass — applies `hide-jarvis` on the app shell |
| Position dropdown works | Pass — bottom-right / bottom-left |
| Quiet hours save | Pass |
| Store Coach personality selector works | Pass — plan-gated extras use Upgrade Plan |
| AI Command response style + auto-suggestions | Pass — PATCH `/ai-command/preferences` |
| Save AI preferences works | Pass — Jarvis + coach + command + workspace |
| Settings persist | Pass |

## Team Members tab

| Check | Result |
| --- | --- |
| Tab loads | Pass |
| Current owner shown from real shop handle | Pass — no invented teammates |
| Invite is Coming Soon | Pass |
| Plan gating | Pass — Start/Trial show Upgrade Plan; Growth+ shows a disabled invite |

## Security & Audit tab

| Check | Result |
| --- | --- |
| Tab loads | Pass |
| Shopify OAuth status from real sync/session | Pass |
| Encryption / scoped API copy is factual | Pass |
| Activity log does not invent events | Pass — “No recent security events” when empty |
| Privacy facts shown | Pass |
| View full audit log | Pass — POST `/exports` dataset `audit` |
| Download data export | Pass — dataset `orders` |

## Danger Zone

| Check | Result |
| --- | --- |
| Tab loads | Pass |
| Warning text is clear | Pass |
| Clear AI Data requires confirmation | Pass |
| Disconnect requires typing the store domain | Pass |
| Confirming Clear AI Data only clears local AI keys | Pass — Shopify data untouched |
| Disconnect opens Shopify admin apps | Pass |

## Sidebar navigation

| Check | Result |
| --- | --- |
| All 6 tabs clickable | Pass |
| Active tab highlighted | Pass |
| Content switches with no errors | Pass |

## Both themes

| Check | Result |
| --- | --- |
| Dark professional | Pass — dedicated `settings.css` |
| Light professional | Pass — `#F8FAFC` / `#FFFFFF` cards, visible inputs, visible toggles, readable text |
| Theme toggle is immediate | Pass |

## Buttons fixed

1. Sidebar: General, Notifications, AI Preferences, Team Members, Security, Danger Zone
2. Save and verify
3. Confirm verification
4. Dark / Light theme
5. Reduced motion
6. Save preferences
7. All six notification toggles
8. Save notification preferences
9. AI mode radios
10. Floating bubble toggle
11. Position dropdown
12. Quiet hours + window
13. Store Coach personality cards
14. Response style dropdown
15. Auto-suggestions toggle
16. Save AI preferences
17. Upgrade Plan (team + locked personalities)
18. View full audit log
19. Download data export
20. Clear AI data (+ confirm / cancel)
21. Disconnect (+ type-to-confirm / cancel)

## Bugs found and fixed

1. **None of the sidebar tabs navigated** — they were inert buttons. Each tab now has real state and content.
2. **Save preferences was a fake toast** — it now writes theme, reduced motion, and workspace prefs.
3. **Reduced motion was a dead toggle** (`on={false}`). It now persists and applies `.reduce-motion` on the shell.
4. **Email never reloaded** — GET `/settings/merchant-email` added; save still verifies.
5. **Verification was a raw token UX** — save now attempts a Brevo/system verification email and shows Pending / Verified.
6. **“Jarvis preferences” was jargon** — renamed to AI Preferences; Jarvis remains the floating assistant.
7. **“WORKSPACE CONTROLS” / “No store name is fabricated”** — removed.
8. **Tenant ID was a primary row** — now small technical text.
9. **Store URL was not clickable** — now opens Shopify admin.
10. **Team / Security / Danger were empty** — implemented with real context, honest empty states, and confirmations.
11. **Light theme forms/toggles were underspecified** — dedicated Settings CSS for both themes.
12. **AI Preferences save swallowed server failures** (final audit pass) — a 500 from the Store Coach or AI Command preferences endpoint was silently ignored and the page still claimed “AI preferences saved.” Save now uses `Promise.allSettled`: a plan gate (402) still shows the upgrade prompt, a core Jarvis failure shows an error, and any other partial failure shows an honest warning instead of a false success. Two regression tests added (coach PATCH 500 → warning; Jarvis PUT 500 → error).

## Zero fake data / Upgrade Plan

- Store domain, store ID, OAuth status, billing plan, owner name, and audit/export rows all come from real context or APIs.
- Empty security activity is stated honestly.
- Team invites and extra coach personalities use the global **Upgrade Plan** CTA. No named target tier is sold in-page.
