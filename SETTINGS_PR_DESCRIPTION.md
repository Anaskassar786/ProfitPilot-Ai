# Settings page — complete fix + professional redesign

The Settings page was a single General panel with inert sidebar tabs and buttons that did not persist. This PR rebuilds Settings as a real workspace: every tab navigates, every form saves, both themes are professional, and nothing is invented to fill empty states.

## What changed

- New Settings module (`settings.tsx`, `settings.css`, `settings-model.ts`) with six working tabs
- **General:** real Shopify store link, email save + verify, theme, reduced motion, Save preferences
- **Notifications:** six toggles persist locally and to `PUT /settings/workspace`
- **AI Preferences** (was Jarvis preferences): assistant mode, bubble + position, quiet hours, Store Coach personality, AI Command style
- **Team Members:** owner from the connected shop + Coming Soon / Upgrade Plan
- **Security:** OAuth/sync status, honest empty audit, privacy facts, real CSV exports
- **Danger Zone:** confirmation for Clear AI Data; type-the-store-domain for Disconnect
- Backend: `GET /settings/merchant-email`, optional verification email via Brevo, `GET/PUT /settings/workspace`

## Constraints honoured

- Settings page only
- Zero fake data
- “Upgrade Plan” where a feature is plan-gated
- Destructive actions require confirmation
- Both themes professional
- All Settings tests passing
