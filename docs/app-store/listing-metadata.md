# ProfitPilot Shopify App Store listing template

Use `pnpm generate:shopify` after the Railway secret variables are loaded. The generator writes the local, ignored `shopify.app.toml`; never commit an app secret.

## Listing metadata

- **App name:** ProfitPilot
- **Tagline:** A review-first AI employee for Shopify operations.
- **Category:** Store management
- **Secondary category:** Marketing and merchandising (select only if the current Shopify review scope permits it)
- **Pricing:** Start, Growth, and Commander plans are shown by the live billing service. Do not publish a price that differs from the billing configuration.
- **Support email:** Read from `SUPPORT_EMAIL` in the deployment environment.
- **Privacy policy:** `https://<SHOPIFY_APP_URL>/legal/privacy`
- **Terms:** `https://<SHOPIFY_APP_URL>/legal/terms`
- **Security:** `https://<SHOPIFY_APP_URL>/legal/security`
- **Cookie policy:** `https://<SHOPIFY_APP_URL>/legal/cookies`
- **Data processing addendum:** `https://<SHOPIFY_APP_URL>/legal/dpa`
- **Support URL:** `SHOPIFY_SUPPORT_URL` when set (absolute `https://` help page), otherwise `mailto:<SUPPORT_EMAIL>`, otherwise `https://<SHOPIFY_APP_URL>/help`

App Store review requires every listing link to be an **absolute URL**; relative paths such as `/legal/privacy` are rejected. `apps/api/src/app-store-assets.ts` (`listingUrlsFromEnv` / `appListingMetadata`) generates these URLs from `SHOPIFY_APP_URL` (falling back to `APP_URL`), and `pnpm generate:shopify` prints them alongside the generated `shopify.app.toml` as commented Partner Dashboard paste values.

## Description template

ProfitPilot helps Shopify merchants run a safer operating loop: monitor authorized store data, detect deterministic signals, explain the evidence in plain language, request approval, execute approved actions, and measure outcomes.

ProfitPilot does not invent store numbers. Rules calculate metrics from synchronized Shopify records. Optional language-model providers write explanations from minimized evidence; direct customer identifiers are excluded from those prompts. Merchants remain in control: recommendations and automations require review, typed outcomes, idempotency, tenant isolation, and auditable history.

**Best for:** merchants who want evidence-backed inventory, revenue, customer, pricing, automation, and campaign operations without surrendering final approval.

**Important:** AI recommendations are advisory. Merchants must review actions, consent, pricing, inventory, and communication compliance before approval.

## Screenshot pack

Submit four PNG screenshots at **1600 × 1000 px**, sRGB, max **5 MB** each. Use real connected-store records with merchant permission; redact customer personal data and never use fabricated metrics.

1. `dashboard.png` — live store-health and sync state.
2. `recommendations.png` — immutable evidence and approval controls.
3. `automation.png` — workflow safety caps and execution history.
4. `billing.png` — plan, usage, trial, and ROI state.

Avoid browser chrome, placeholder data, unsupported badges, competitor logos, or claims that cannot be reproduced by the current release.

## Review checklist

- Verify OAuth scopes match the generated TOML and Shopify Partner configuration.
- Verify all listing links are absolute URLs and resolve over HTTPS in the deployed environment (including the Support URL).
- Verify the Support URL is set in the Partner Dashboard: `SHOPIFY_SUPPORT_URL` (https page) or `mailto:SUPPORT_EMAIL`.
- Test install, uninstall, data request, and redaction flows in a test store.
- Confirm legal entity, physical address, support email, and jurisdiction come from the production environment.
- Confirm merchant email footers include the configured physical address and unsubscribe link.
- Run the security, load, and accessibility suites before submission.
