// QA-only: walks every GET route in the API for both seeded stores and
// records status code + first bytes of the body. Output: get-routes.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { Client } from 'pg';

const BASE = 'http://127.0.0.1:3000';

async function storeIdFor(shopDomain) {
  const pg = new Client({ connectionString: process.env.QA_PG_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5433/postgres' });
  await pg.connect();
  const r = await pg.query('SELECT id::text AS id FROM stores WHERE shop_domain = $1', [shopDomain]);
  await pg.end();
  if (!r.rows[0]) throw new Error('seed store missing: ' + shopDomain);
  return r.rows[0].id;
}

const STORES = {
  populated: process.env.QA_STORE_A ?? (await storeIdFor('qa-store.myshopify.com')),
  empty: process.env.QA_STORE_B ?? (await storeIdFor('qa-empty.myshopify.com')),
};

const GETS = [
  '/session/context', '/analytics', '/catalog', '/sync/status', '/ai/agents',
  '/ai/health', '/ai/rules', '/ai/cost', '/ai/cost/breakdown',
  '/ai/agents/revenue-agent/activity', '/ai/agents/inventory-agent/activity',
  '/recommendations', '/recommendations/summary',
  '/automation/workflows', '/automation/templates', '/automation/summary',
  '/automation/usage', '/automation/approvals',
  '/billing', '/billing/plans', '/billing/usage', '/billing/roi',
  '/admin/access-review', '/admin/funnel', '/admin/launch-audit',
  '/admin/maintenance', '/admin/merchant-flags', '/admin/ops/activity',
  '/admin/ops/metrics', '/admin/ops/queue',
  '/orders', '/orders/insights', '/customers', '/customers/insights',
  '/inventory', '/inventory/history', '/inventory/insights', '/inventory/locations',
  '/analytics/insights', '/analytics/channels', '/analytics/geography',
  '/analytics/cohorts', '/analytics/comparisons', '/analytics/funnel',
  '/ai-command/conversations', '/ai-command/usage', '/ai-command/usage/history',
  '/ai-command/preferences', '/ai-command/quick-commands', '/ai-command/saved',
  '/ai-command/suggestions', '/ai-command/actions', '/api/ai-command/page-metrics',
  '/ai-executive/dashboard', '/ai-executive/reports', '/ai-executive/usage',
  '/ai-executive/cost-summary', '/ai-executive/decisions', '/ai-executive/decisions/analytics',
  '/ai-executive/opportunities', '/ai-executive/risks', '/ai-executive/risks/trends',
  '/ai-executive/roadmaps', '/ai-executive/scenarios', '/ai-executive/scenarios/templates',
  '/ai-executive/health/current', '/ai-executive/health/history', '/ai-executive/health/trends',
  '/ai-executive/benchmarks', '/ai-executive/benchmarks/comparison', '/ai-executive/benchmarks/position',
  '/ai-executive/preferences',
  '/store-coach/achievements', '/store-coach/achievements/available', '/store-coach/goals',
  '/store-coach/huddle', '/store-coach/huddles', '/store-coach/preferences', '/store-coach/priorities',
  '/store-coach/reviews', '/store-coach/streak', '/store-coach/usage', '/store-coach/onboarding',
  '/patternai/overview', '/patternai/discoveries', '/patternai/data-readiness', '/patternai/status',
  '/patternai/lessons', '/patternai/patterns', '/patternai/personas', '/patternai/investigations',
  '/patternai/trends', '/patternai/trends/market', '/patternai/predictions', '/patternai/comparisons',
  '/patternai/knowledge', '/patternai/timeline', '/patternai/usage', '/patternai/preferences',
  '/insights/overview', '/insights/discoveries',
  '/reports', '/reports/schedules', '/exports/history', '/exports/overview',
  '/forecasting', '/jarvis/preferences', '/jarvis/briefing',
  '/settings/workspace', '/settings/merchant-email',
  '/security/csrf', '/legal', '/legal/privacy', '/legal/terms', '/legal/deletion',
  '/shopify/status', '/copilot/threads', '/campaigns/templates',
  '/sync/status', '/ready',
];

const results = [];
for (const [label, storeId] of Object.entries(STORES)) {
  for (const path of GETS) {
    const url = `${BASE}${path}?storeId=${storeId}`;
    let status = -1; let body = ''; let ms = 0;
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      status = res.status;
      body = (await res.text()).slice(0, 200).replace(/\s+/g, ' ');
      ms = Date.now() - t0;
    } catch (err) {
      status = 0; body = `TIMEOUT_OR_NETWORK: ${String(err?.message ?? err)}`; ms = Date.now() - t0;
    } finally {
      clearTimeout(timer);
    }
    results.push({ label, path, status, body, ms });
  }
}
mkdirSync('scripts/qa/results', { recursive: true });
writeFileSync('scripts/qa/results/get-routes.json', JSON.stringify(results, null, 2));
const failures = results.filter((r) => r.status >= 500);
const slow = results.filter((r) => r.ms > 2000);
console.log(`total=${results.length} 5xx=${failures.length} slow=${slow.length}`);
for (const f of failures) console.log(`5xx ${f.label} ${f.path} -> ${f.status} ${f.body.slice(0, 120)}`);
for (const s of slow) console.log(`slow ${s.label} ${s.path} ${s.ms}ms`);
