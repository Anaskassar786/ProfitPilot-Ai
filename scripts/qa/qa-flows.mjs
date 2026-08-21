// QA-only: exercises the critical user flows end-to-end against the local API
// (gift redeem, mock upgrade, recommendations lifecycle, automation CRUD,
// store coach, AI command, reports, exports, support, settings).
// Output: flows.json (full) + summary lines on stdout.
import { writeFileSync } from 'node:fs';
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
const A = process.env.QA_STORE_A ?? (await storeIdFor('qa-store.myshopify.com')); // populated, trial
const B = process.env.QA_STORE_B ?? (await storeIdFor('qa-empty.myshopify.com')); // empty, trial

const results = [];

// Reset stores to a clean trial state before the run (gift redemption is
// one-per-store, goals are plan-capped, etc. — leftovers from earlier runs
// must not mask real behavior).
{
  const pg0 = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/postgres' });
  await pg0.connect();
  await pg0.query('DELETE FROM gift_redemptions WHERE shop_id = $1', [B]);
  await pg0.query("UPDATE billing_subscriptions SET state='TRIAL_ACTIVE', plan='trial', interval='MONTHLY', charge_id=NULL WHERE shop_id IN ($1, $2)", [A, B]);
  await pg0.query('UPDATE gift_codes SET uses = GREATEST(uses - 1, 0) WHERE code = $1', ['KASSAR786']);
  await pg0.query('DELETE FROM store_coach_goals WHERE store_id IN ($1, $2)', [A, B]);
  await pg0.query('DELETE FROM workflows WHERE store_id IN ($1, $2)', [A, B]);
  await pg0.end();
}
async function call(name, path, { method = 'GET', body, storeId = A, timeout = 60000, expect, shopParam = false } = {}) {
  const key = shopParam ? 'shopId' : 'storeId';
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
    text = (await res.text()).slice(0, 400);
    ok = res.ok;
  } catch (err) {
    status = 0; text = `NETWORK/TIMEOUT: ${err?.message ?? err}`;
  } finally { clearTimeout(timer); }
  const pass = expect ? expect(status, text, ok) : ok;
  results.push({ name, path, method, status, pass: Boolean(pass), ms: Date.now() - t0, body: text.replace(/\s+/g, ' ').slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${status}] ${name} ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
  return { status, text, ok };
}

const has = (s, needle) => s.includes(needle);
const json = (t) => { try { return JSON.parse(t); } catch { return null; } };
const dataOf = (t) => json(t)?.data ?? null;

// ── 1. Billing state + meters (real counts) ────────────────────────────────
await call('billing account', '/billing', { shopParam: true, expect: (s, t) => s === 200 && has(t, 'trial') });
await call('billing plans', '/billing/plans', { expect: (s, t) => s === 200 && has(t, '"code"') });
const usageRes = await call('billing usage meters', '/billing/usage', { shopParam: true, expect: (s) => s === 200 });
const usageData = dataOf(usageRes.text);
const meter = (key) => usageData?.meters?.find((m) => m.feature === key) ?? usageData?.find?.((m) => m.feature === key);
console.log('  meters:', JSON.stringify(usageData?.meters?.slice(0, 8) ?? usageData));

// ── 2. AI agents roster (2 unlocked on trial) ──────────────────────────────
const agentsRes = await call('ai agents', '/ai/agents', { expect: (s) => s === 200 });
const agents = dataOf(agentsRes.text)?.agents ?? dataOf(agentsRes.text);
if (Array.isArray(agents)) console.log('  agents:', agents.length, agents.map((a) => `${a.id ?? a.agentId}:${a.unlocked ?? a.status}`).join(' '));

// ── 3. Recommendations: analyze → list → approve/reject/execute ────────────
const analyzeRes = await call('recommendations analyze', '/recommendations/analyze', {
  method: 'POST', body: { storeId: A }, timeout: 120000,
  expect: (s) => s === 200,
});
const recs = dataOf(analyzeRes.text)?.recommendations ?? [];
console.log(`  recommendations generated: ${recs.length}`);
if (recs.length > 0) {
  const id = recs[0].id;
  await call('recommendation detail', `/recommendations/${id}`, { expect: (s) => s === 200 });
  await call('recommendation approve', `/recommendations/${id}/approve`, { method: 'POST', body: {}, expect: (s) => s === 200 });
  await call('recommendation undo', `/recommendations/${id}/undo`, { method: 'POST', body: {}, expect: (s) => s === 200 });
  await call('recommendation reject', `/recommendations/${id}/reject`, { method: 'POST', body: { reason: 'qa' }, expect: (s) => s === 200 });
  if (recs[1]) {
    await call('recommendation approve #2', `/recommendations/${recs[1].id}/approve`, { method: 'POST', body: {}, expect: (s) => s === 200 });
    await call('recommendation execute', `/recommendations/${recs[1].id}/execute`, { method: 'POST', body: {}, expect: (s) => s === 200 });
  }
}
await call('recommendations summary', '/recommendations/summary', { expect: (s) => s === 200 });

// ── 4. Automation: template list → create workflow → pause/resume/delete ───
await call('automation templates', '/automation/templates', { expect: (s) => s === 200 });
const wfRes = await call('workflow create', '/automation/workflows', {
  method: 'POST',
  body: { storeId: A, name: 'QA test workflow', trigger: { type: 'ORDER_CREATED' }, actions: [] },
  expect: (s) => s === 201 || s === 200,
});
const wf = dataOf(wfRes.text);
const wfId = wf?.id ?? wf?.workflow?.id;
if (wfId) {
  await call('workflow list', '/automation/workflows', { expect: (s, t) => s === 200 && has(t, wfId) });
  await call('workflow pause', `/automation/workflows/${wfId}/pause`, { method: 'POST', body: {}, expect: (s) => s === 200 });
  await call('workflow resume', `/automation/workflows/${wfId}/resume`, { method: 'POST', body: {}, expect: (s) => s === 200 });
  await call('workflow delete', `/automation/workflows/${wfId}`, { method: 'DELETE', body: {}, expect: (s) => s === 200 || s === 204 });
}

// ── 5. Store Coach ─────────────────────────────────────────────────────────
await call('store coach priorities', '/store-coach/priorities/today', { expect: (s) => s === 200 || s === 402 });
const coachChatRes = await call('store coach chat (SSE)', '/store-coach/chat', {
  method: 'POST', body: { message: 'How is my store doing?' }, timeout: 90000,
  expect: (s, t) => s === 200 && has(t, 'data:'),
});
const goalRes = await call('store coach goal create', '/store-coach/goals', {
  method: 'POST', storeId: B, body: { storeId: B, goalType: 'MONTHLY', title: 'QA goal', metric: 'REVENUE', targetValue: 100, targetCurrency: 'USD', startDate: '2026-08-01', endDate: '2026-08-31' },
  expect: (s) => s === 200 || s === 201,
});
const goalId = dataOf(goalRes.text)?.id ?? dataOf(goalRes.text)?.goal?.id;
if (goalId) await call('store coach goal delete', `/store-coach/goals/${goalId}`, { method: 'DELETE', storeId: B, expect: (s) => s === 200 || s === 204 });

// ── 6. AI Command: two different commands, different responses ─────────────
const cmd1 = await call('ai command: revenue', '/ai-command/chat', {
  method: 'POST', body: { storeId: A, text: "What's my revenue this month?" }, timeout: 90000,
  expect: (s) => s === 200 || s === 201 || s === 503 || s === 402, // 503 = AI provider not configured is honest; must not be 500
});
const cmd2 = await call('ai command: best product', '/ai-command/chat', {
  method: 'POST', body: { storeId: A, text: 'Which product sells best?' }, timeout: 90000,
  expect: (s) => s === 200 || s === 201 || s === 503 || s === 402,
});
const cmd1Body = dataOf(cmd1.text);
const cmd2Body = dataOf(cmd2.text);
const cmd1Answer = typeof cmd1Body?.answer === 'string' ? cmd1Body.answer : typeof cmd1Body?.reply === 'string' ? cmd1Body.reply : cmd1.text.slice(0, 60);
const cmd2Answer = typeof cmd2Body?.answer === 'string' ? cmd2Body.answer : typeof cmd2Body?.reply === 'string' ? cmd2Body.reply : cmd2.text.slice(0, 60);
console.log(`  cmd1 answer: ${cmd1Answer.slice(0, 140)}`);
console.log(`  cmd2 answer: ${cmd2Answer.slice(0, 140)}`);
if (cmd1.ok && cmd2.ok && cmd1Answer !== cmd2Answer) console.log('  -> answers differ: OK');

// ── 7. GrowthIQ ────────────────────────────────────────────────────────────
await call('executive report generate', '/ai-executive/reports/generate', {
  method: 'POST', body: { storeId: A, kind: 'board' }, timeout: 120000,
  expect: (s) => s === 200 || s === 201 || s === 402, // 402 = plan gate is correct on trial
});
await call('executive reports list', '/ai-executive/reports', { expect: (s) => s === 200 });

// ── 8. Reports (F8) ────────────────────────────────────────────────────────
await call('report generate', '/reports/generate', {
  method: 'POST', body: { storeId: A, frequency: 'DAILY', start: '2026-08-01', end: '2026-08-18' }, timeout: 90000,
  expect: (s) => s === 200 || s === 201 || s === 402,
});

// ── 9. Exports ─────────────────────────────────────────────────────────────
await call('export create', '/exports/catalog', {
  method: 'POST', body: { storeId: A }, timeout: 90000,
  expect: (s) => s === 200 || s === 201 || s === 402,
});
await call('exports history', '/exports/history', { expect: (s) => s === 200 });

// ── 10. Support ────────────────────────────────────────────────────────────
await call('support ticket create', '/support/tickets', {
  method: 'POST', body: { shopId: A, subject: 'QA ticket', description: 'QA', plan: 'start' },
  expect: (s) => s === 201 || s === 200,
});

// ── 11. Settings ───────────────────────────────────────────────────────────
await call('settings workspace save', '/settings/workspace', {
  method: 'PUT', body: { storeId: A, theme: 'light' },
  expect: (s) => s === 200,
});
await call('merchant email save', '/settings/merchant-email', {
  method: 'POST', body: { shopId: A, email: 'qa@example.com', fromName: 'QA Store' },
  expect: (s) => s === 200 || s === 201,
});

// ── 12. GIFT / REDEEM (on empty store B) ⭐ ─────────────────────────────────
await call('gift: empty input rejected', '/billing/gift', { method: 'POST', shopParam: true, storeId: B, body: {}, expect: (s) => s === 400 });
await call('gift: invalid code', '/billing/gift', { method: 'POST', shopParam: true, storeId: B, body: { code: 'NOT-A-REAL-CODE' }, expect: (s) => s === 400 || s === 404 });
await call('gift: valid code', '/billing/gift', { method: 'POST', shopParam: true, storeId: B, body: { code: 'KASSAR786' }, expect: (s, t) => s === 201 && has(t, 'expiresAt') });
await call('gift: already redeemed', '/billing/gift', { method: 'POST', shopParam: true, storeId: B, body: { code: 'KASSAR786' }, expect: (s) => s === 409 || s === 400 });
await call('gift: billing state after redeem', '/billing', { shopParam: true, storeId: B, expect: (s, t) => s === 200 && has(t, 'commander') });

// expired code
const pg = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/postgres' });
await pg.connect();
await pg.query(`INSERT INTO gift_codes (code, max_uses, uses, active, duration_days, access_level)
  VALUES ('EXPIREDQA', 10, 0, false, 3, 'commander') ON CONFLICT (code) DO UPDATE SET active = false`);
await pg.end();
await call('gift: expired code', '/billing/gift', { method: 'POST', shopParam: true, storeId: B, body: { code: 'EXPIREDQA' }, expect: (s) => s === 400 || s === 403 || s === 410 });

// ── 13. Mock upgrade (on store A, trial → growth → commander) ──────────────
await call('mock upgrade to START', '/billing/charge', {
  method: 'POST', shopParam: true, storeId: A, body: { plan: 'START', interval: 'MONTHLY', returnUrl: 'https://qa.example.com/billing', mock: true },
  expect: (s, t) => s === 201 && has(t, 'mock'),
});
await call('billing reflects START', '/billing', { shopParam: true, storeId: A, expect: (s, t) => s === 200 && has(t, '"start"') });
await call('mock upgrade to GROWTH', '/billing/charge', {
  method: 'POST', shopParam: true, storeId: A, body: { plan: 'GROWTH', interval: 'MONTHLY', returnUrl: 'https://qa.example.com/billing', mock: true },
  expect: (s, t) => s === 201 && has(t, 'mock'),
});
await call('billing reflects GROWTH', '/billing', { shopParam: true, storeId: A, expect: (s, t) => s === 200 && has(t, '"growth"') });
await call('mock upgrade to COMMANDER', '/billing/charge', {
  method: 'POST', shopParam: true, storeId: A, body: { plan: 'COMMANDER', interval: 'MONTHLY', returnUrl: 'https://qa.example.com/billing', mock: true },
  expect: (s, t) => s === 201 && has(t, 'mock'),
});
await call('billing reflects COMMANDER', '/billing', { shopParam: true, storeId: A, expect: (s, t) => s === 200 && has(t, '"commander"') });
// commander unlocks all agents
const agentsCmd = await call('ai agents on commander', '/ai/agents', { storeId: A, expect: (s) => s === 200 });
const agentsCmdData = dataOf(agentsCmd.text)?.agents ?? [];
console.log('  commander agents:', agentsCmdData.map((a) => `${a.id}:${a.unlocked}`).join(' '));

// reset store A back to trial for later runs
const pg2 = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/postgres' });
await pg2.connect();
await pg2.query("UPDATE billing_subscriptions SET state='TRIAL_ACTIVE', plan='trial', interval='MONTHLY' WHERE shop_id=$1", [A]);
await pg2.end();

writeFileSync('scripts/qa/results/flows.json', JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\nFLOW RESULTS: total=${results.length} failed=${failed.length}`);
for (const f of failed) console.log(`FAIL ${f.name} [${f.status}] ${f.body.slice(0, 160)}`);
