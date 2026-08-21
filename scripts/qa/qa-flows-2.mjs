// QA-only: second wave of flow tests — AI agent runs, PatternAI generation,
// store coach huddles/priorities lifecycle, automation template install, etc.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { Client } from 'pg';


async function storeIdFor(shopDomain) {
  const pg = new Client({ connectionString: process.env.QA_PG_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5433/postgres' });
  await pg.connect();
  const r = await pg.query('SELECT id::text AS id FROM stores WHERE shop_domain = $1', [shopDomain]);
  await pg.end();
  if (!r.rows[0]) throw new Error('seed store missing: ' + shopDomain);
  return r.rows[0].id;
}

const BASE = 'http://127.0.0.1:3000';
const A = process.env.QA_STORE_A ?? (await storeIdFor('qa-store.myshopify.com'));
const B = process.env.QA_STORE_B ?? (await storeIdFor('qa-empty.myshopify.com'));

const results = [];
async function call(name, path, { method = 'GET', body, storeId = A, timeout = 90000, expect } = {}) {
  const key = 'storeId';
  const url = path.includes('?') ? `${BASE}${path}&${key}=${storeId}` : `${BASE}${path}?${key}=${storeId}`;
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let status = -1; let text = ''; let ok = false;
  try {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    status = res.status;
    text = (await res.text()).slice(0, 500);
    ok = res.ok;
  } catch (err) {
    status = 0; text = `NETWORK/TIMEOUT: ${err?.message ?? err}`;
  } finally { clearTimeout(timer); }
  const pass = expect ? expect(status, text, ok) : ok;
  results.push({ name, path, method, status, pass: Boolean(pass), ms: Date.now() - t0, body: text.replace(/\s+/g, ' ').slice(0, 260) });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${status}] ${name} ${text.replace(/\s+/g, ' ').slice(0, 110)}`);
  return { status, text, ok };
}
const has = (s, needle) => s.includes(needle);

// ── 1. AI agents: run individual agent + run-all (SSE) ────────────────────
await call('agent run (revenue)', '/ai/agents/REVENUE_AGENT/run', {
  method: 'POST', body: { storeId: A }, timeout: 120000,
  expect: (s, t) => s === 200 || s === 202 || s === 402 || s === 403,
});
await call('run-all', '/ai/run-all', {
  method: 'POST', body: { storeId: A }, timeout: 180000,
  expect: (s) => s === 200 || s === 402 || s === 403,
});

// ── 2. PatternAI: generate discoveries / patterns / personas (trial = locked features) ──
await call('patternai discoveries generate', '/patternai/discoveries/generate', {
  method: 'POST', body: { storeId: A }, timeout: 120000,
  expect: (s) => s === 200 || s === 201 || s === 402 || s === 429,
});
await call('patternai patterns detect', '/patternai/patterns/detect', {
  method: 'POST', body: { storeId: A }, timeout: 120000,
  expect: (s) => s === 200 || s === 201 || s === 402 || s === 429,
});
await call('patternai personas generate', '/patternai/personas/generate', {
  method: 'POST', body: { storeId: A }, timeout: 120000,
  expect: (s) => s === 200 || s === 201 || s === 402 || s === 429,
});
await call('patternai investigations', '/patternai/investigations', {
  method: 'POST', body: { storeId: A, question: 'Why did revenue spike in July?' }, timeout: 120000,
  expect: (s) => s === 200 || s === 201 || s === 402 || s === 429,
});
// The same flows on the empty store (honest zero-data behavior)
await call('patternai discoveries generate (empty store)', '/patternai/discoveries/generate', {
  method: 'POST', body: { storeId: B }, timeout: 120000,
  expect: (s) => s === 200 || s === 201 || s === 402 || s === 429 || s === 409,
});

// ── 3. Store Coach lifecycle ───────────────────────────────────────────────
const huddle = await call('coach huddle generate', '/store-coach/huddle/generate', {
  method: 'POST', body: { storeId: B }, timeout: 120000,
  expect: (s) => s === 200 || s === 201 || s === 402 || s === 409,
});
let huddleId = null;
try { huddleId = JSON.parse(huddle.text)?.data?.huddle?.id ?? JSON.parse(huddle.text)?.data?.id ?? null } catch { /* ignore */ }
if (huddleId) {
  await call('coach huddle viewed', `/store-coach/huddle/${huddleId}/viewed`, { method: 'POST', body: {}, expect: (s) => s === 200 });
}
const prio = await call('coach priorities generate', '/store-coach/priorities/generate', {
  method: 'POST', body: { storeId: B }, timeout: 120000,
  expect: (s) => s === 200 || s === 201 || s === 402 || s === 409,
});
let prioId = null;
try { const d = JSON.parse(prio.text)?.data; prioId = d?.priorities?.[0]?.id ?? d?.[0]?.id ?? null } catch { /* ignore */ }
if (prioId) {
  await call('coach priority complete', `/store-coach/priorities/${prioId}/complete`, { method: 'POST', body: {}, expect: (s) => s === 200 || s === 409 });
  await call('coach priority dismiss', `/store-coach/priorities/${prioId}/dismiss`, { method: 'POST', body: {}, expect: (s) => s === 200 || s === 409 });
}
await call('coach review generate', '/store-coach/review/generate', {
  method: 'POST', body: { storeId: B }, timeout: 120000,
  expect: (s) => s === 200 || s === 201 || s === 402 || s === 409,
});
await call('coach onboarding skip', '/store-coach/onboarding/skip', { method: 'POST', body: { storeId: B }, expect: (s) => s === 200 || s === 409 });
await call('coach chat clear', '/store-coach/chat/clear', { method: 'POST', body: { storeId: B }, expect: (s) => s === 200 });

// ── 4. Automation template install + validate ──────────────────────────────
const tmpl = await call('template install (welcome-customer)', '/automation/templates/welcome-customer/install', {
  method: 'POST', body: { storeId: B, name: 'QA Welcome Flow' }, timeout: 60000,
  expect: (s) => s === 200 || s === 201 || s === 402,
});
let wfId = null;
try { wfId = JSON.parse(tmpl.text)?.data?.workflow?.id ?? JSON.parse(tmpl.text)?.data?.id ?? null } catch { /* ignore */ }
if (wfId) {
  await call('workflow validate', `/automation/workflows/${wfId}/validate`, { method: 'POST', body: {}, expect: (s) => s === 200 });
  await call('workflow activate', `/automation/workflows/${wfId}/activate`, { method: 'POST', body: {}, expect: (s) => s === 200 });
  await call('workflow run (manual)', `/automation/workflows/${wfId}/run`, { method: 'POST', body: {}, expect: (s) => s === 200 || s === 202 });
}

// ── 5. AI Command extras ───────────────────────────────────────────────────
await call('ai command usage', '/ai-command/usage', { expect: (s) => s === 200 });
await call('ai command quick commands', '/ai-command/quick-commands', { expect: (s) => s === 200 });
await call('ai command suggestions', '/ai-command/suggestions?command=revenue', { expect: (s) => s === 200 || s === 503 });

// ── 6. Reports schedule + billing ROI ──────────────────────────────────────
await call('reports schedule create', '/reports/schedules', {
  method: 'POST', body: { storeId: B, frequency: 'WEEKLY', nextRunAt: Date.now() + 7 * 86400000, enabled: true },
  expect: (s) => s === 200 || s === 201 || s === 402,
});
await call('billing roi', '/billing/roi?shopId=' + A, { expect: (s) => s === 200 });

// ── 7. Analytics insights query ────────────────────────────────────────────
await call('analytics insights query', '/analytics/insights/query', {
  method: 'POST', body: { storeId: A, question: 'How is revenue trending this month?' },
  expect: (s) => s === 200 || s === 403, // 403 = correct plan gate on trial (Commander feature)
});

mkdirSync('scripts/qa/results', { recursive: true });
writeFileSync('scripts/qa/results/flows-2.json', JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\nFLOW-2 RESULTS: total=${results.length} failed=${failed.length}`);
for (const f of failed) console.log(`FAIL ${f.name} [${f.status}] ${f.body.slice(0, 180)}`);

// merge results for the board payload
const previous = JSON.parse(readFileSync('scripts/qa/results/flows.json', 'utf8'));
const merged = [...previous, ...results];
writeFileSync('scripts/qa/results/all-flows.json', JSON.stringify(merged, null, 2));
console.log('merged flows saved.');
