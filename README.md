# ProfitPilot

ProfitPilot is a premium Shopify merchant workspace designed around the AI-employee loop:

> Monitor → Detect → Explain → Approve → Execute → Measure

This repository currently contains the first buildable vertical slice of the product experience: a responsive React/Vite workspace with the 16 blueprint sections, evidence-backed recommendation review, command palette, notifications, Jarvis chat/voice-session shell, theme switching, and responsive/mobile navigation.

## Run locally

```bash
npm install
npm run dev
```

Then open the Vite URL shown in the terminal. The dev server binds to `0.0.0.0` so it also works in a hosted preview.

## Validate

```bash
npm run build
```

## Product surface included

- Dashboard with revenue trend, store health, AI opportunities, briefing, and activity
- Products, Orders, Customers, Inventory, and Analytics views
- AI Command Center for the seven specialized agents
- Recommendations queue with approve/reject actions and an immutable evidence drawer
- Automation, Campaigns, Copilot, Reports, Exports, Support, Billing, and Settings views
- Global `⌘ K` / `Ctrl K` command palette
- Notifications drawer and profile menu
- Jarvis floating orb, background live-session strip, chat panel, and voice-mode shell
- Dark-first design system with optional light theme, keyboard focus states, reduced-motion support, and responsive layouts

## Security boundary

No credentials or provider secrets are stored in this repository. Shopify, database, Redis, OpenRouter, email, storage, and monitoring integrations should be added through server-side environment variables as the data plane is implemented. The UI deliberately keeps customer information minimized and only displays masked customer contact values.
