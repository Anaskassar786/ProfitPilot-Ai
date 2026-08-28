#!/usr/bin/env node
/**
 * End-to-end verification for the three production fixes (2026-08-28).
 *
 *   node scripts/verify-production-fixes.mjs
 *
 * Proof 1 — pg SSL-mode alias downgrade: drives the REAL pg code path
 * (`new ConnectionParameters(url)` from pg 8.23, which delegates to
 * pg-connection-string 2.14.0 — the module that prints "SECURITY WARNING:
 * The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases
 * for 'verify-full'"). Shows the warning fires on sslmode=require, and that
 * normalizePostgresSslMode() removes it while preserving every other byte of
 * the URL (including encoded credentials). The pg-connection-string warning
 * fires only once per process (module-level `warned` flag), so each case runs
 * in a fresh node child process.
 *
 * Proof 2 — OpenRouter model validation: runs OpenRouterClient.validateModels()
 * (the exact method apps/api/src/f8-bootstrap.ts calls at every boot) with a
 * fetcher replaying payloads LIVE-CAPTURED from
 * https://openrouter.ai/api/v1/models/{id}/endpoints on 2026-08-28 (see
 * scripts/openrouter-captures/). Old Render slugs must come back unavailable,
 * the new slugs must validate, and the startup logger must stop emitting
 * "every configured OpenRouter model is unavailable".
 *
 * Proof 3 — TLS guard: exercises enforceSecureTls() against a process.env-like
 * object, mirroring what apps/api and apps/worker now run before any socket.
 */
import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
let failures = 0

function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

async function importDist(packageName) {
  return import(join(root, 'packages', packageName, 'dist', 'index.js'))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nProof 1 — pg sslmode alias warning (real pg code path, fresh process per case)\n')

const RAW_URL = 'postgresql://merchant:p%40ss%3Aword@db.example.com:5432/profitpilot?sslmode=require&application_name=profitpilot&connect_timeout=10'

const childSource = `
const warnings = []
process.on('warning', (w) => warnings.push(String(w.message).split('\\n')[0]))
;(async () => {
  const db = await import(process.env.DB_MODULE)
  let url = process.env.DB_URL
  let normalizedFrom = null
  if (process.env.NORMALIZE === '1') {
    const normalized = db.normalizePostgresSslMode(url)
    url = normalized.connectionString
    normalizedFrom = normalized.rewrittenFrom
  }
  // pg/lib/connection-parameters.js is the exact module pg's Client itself
  // requires internally — the real pg parse path, just not re-exported on the
  // package root in pg 8.23.
  const ConnectionParameters = require('pg/lib/connection-parameters.js')
  const params = new ConnectionParameters(url)
  setTimeout(() => {
    console.log('__RESULT__' + JSON.stringify({
      url,
      warnings,
      normalizedFrom,
      host: params.host,
      port: params.port,
      database: params.database,
      applicationName: params.application_name,
      ssl: params.ssl === undefined ? null : params.ssl,
    }))
  }, 100)
})().catch((error) => { console.error(error); process.exit(1) })
`

function runPgCase(label, url, normalize) {
  const child = spawnSync(process.execPath, ['-e', childSource], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DB_MODULE: join(root, 'packages/db/dist/index.js'),
      DB_URL: url,
      NORMALIZE: normalize ? '1' : '0',
    },
  })
  const line = child.stdout.split('\n').find((l) => l.startsWith('__RESULT__'))
  if (!line) throw new Error(`pg case "${label}" produced no result. stderr: ${child.stderr}`)
  return JSON.parse(line.slice('__RESULT__'.length))
}

// 1a. Exactly what Render ships today: sslmode=require, unmodified.
const raw = runPgCase('raw sslmode=require', RAW_URL, false)
console.log(`  URL    ${RAW_URL}`)
console.log(`  parsed host=${raw.host} db=${raw.database} app=${raw.applicationName} ssl=${JSON.stringify(raw.ssl)}`)
for (const warning of raw.warnings) console.log(`  pg emitted: "${warning}"`)
check('pg warns on sslmode=require (the production noise)', raw.warnings.some((w) => w.includes("aliases for 'verify-full'")))
check('alias branch keeps TLS on (ssl object; verification via Node defaults today)', typeof raw.ssl === 'object' && raw.ssl !== null)

// 1b. The same URL after normalizePostgresSslMode().
const normalized = runPgCase('normalized sslmode=verify-full', RAW_URL, true)
console.log(`  URL    ${normalized.url}`)
console.log(`  parsed host=${normalized.host} db=${normalized.database} app=${normalized.applicationName} ssl=${JSON.stringify(normalized.ssl)}`)
check('normalizedFrom reports the original mode', normalized.normalizedFrom === 'require')
check('no pg warning after normalization', normalized.warnings.length === 0)
check('ssl behaviour unchanged (TLS still on, same object shape as the alias branch)', JSON.stringify(normalized.ssl) === JSON.stringify(raw.ssl))
check('host/port/database/application_name preserved byte-for-byte',
  raw.host === normalized.host && raw.port === normalized.port && raw.database === normalized.database && raw.applicationName === normalized.applicationName)
check('encoded credentials preserved byte-for-byte (p%40ss%3Aword never re-encoded)',
  normalized.url.startsWith('postgresql://merchant:p%40ss%3Aword@db.example.com:5432/profitpilot?'))
check('other query params preserved', normalized.url.includes('application_name=profitpilot') && normalized.url.includes('connect_timeout=10'))

// 1c. uselibpqcompat=true is an explicit opt-out: the URL must pass through untouched,
// and pg gives it the weaker libpq semantics — ssl.rejectUnauthorized=false with no
// warning. That unverified-TLS state is exactly what the pg v9 alias downgrade does,
// and what normalizePostgresSslMode() prevents by pinning verify-full.
const compatUrl = 'postgresql://db.example.com:5432/profitpilot?sslmode=require&uselibpqcompat=true'
const compat = runPgCase('uselibpqcompat opt-out', compatUrl, true)
check('uselibpqcompat=true left untouched (rewrittenFrom null)', compat.normalizedFrom === null && compat.url === compatUrl)
check('pg does not warn for the explicit opt-out (warning belongs to the alias branch only)', compat.warnings.length === 0)
check('opt-out parses to ssl.rejectUnauthorized=false — the concrete pg9-style downgrade we avoid by default', compat.ssl?.rejectUnauthorized === false)

// 1d. Full env → config → pool wiring, including the PostgresDatabase warn (stderr).
const dbPkg = await importDist('db')
const dbConfig = dbPkg.databaseConfigFromEnv({ DATABASE_URL: RAW_URL, NODE_ENV: 'production' })
check('databaseConfigFromEnv rewrites to verify-full and reports it',
  dbConfig.connectionString.includes('sslmode=verify-full') && !dbConfig.connectionString.includes('sslmode=require') && dbConfig.sslModeRewrittenFrom === 'require' && dbConfig.ssl === true)
const database = new dbPkg.PostgresDatabase(dbConfig) // constructor logs the normalization warning; Pool connects lazily
await database.close()

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nProof 2 — OpenRouterClient.validateModels() with live-captured endpoint payloads (2026-08-28)\n')

const { OpenRouterClient } = await importDist('ai')
const captures = new Map()
for (const file of (await readdir(join(here, 'openrouter-captures'))).filter((f) => f.endsWith('.json')).sort()) {
  const capture = JSON.parse(await readFile(join(here, 'openrouter-captures', file), 'utf8'))
  captures.set(capture.body.data?.id ?? file, capture)
}
const replayingFetcher = (input) => {
  const model = input.replace('https://openrouter.ai/api/v1/models/', '').replace(/\/endpoints$/, '')
  const capture = captures.get(model) ?? { httpStatus: 404, body: { error: { message: 'Not Found', code: 404 } } }
  return Promise.resolve(new Response(JSON.stringify(capture.body), { status: capture.httpStatus, headers: { 'content-type': 'application/json' } }))
}
const bootLog = []
// Mirrors apps/api/src/f8-bootstrap.ts validateOpenRouterModels() emit rules.
function emitBootValidation(validations) {
  let unavailable = 0
  for (const validation of validations) {
    if (validation.available) bootLog.push(['info', 'OpenRouter model validated', { model: validation.model, status_code: validation.statusCode }])
    else {
      unavailable += 1
      bootLog.push(['error', 'STARTUP ALERT: OpenRouter model slug is invalid or has no active endpoints — update AI_MODEL_PRIMARY/AI_MODEL_FALLBACK*', { model: validation.model, reason: validation.reason, status_code: validation.statusCode }])
    }
  }
  if (validations.length > 0 && unavailable === validations.length) {
    bootLog.push(['error', 'STARTUP ALERT: every configured OpenRouter model is unavailable — AI features will return fallback messaging until the model list is fixed', { models: validations.map((v) => v.model) }])
  }
  return unavailable
}

const provider = (models) => new OpenRouterClient({ keys: ['sk-or-v1-replay'], models, timeoutMs: 5_000, fetcher: replayingFetcher })

// 2a. The dead Render chain (primary was the LiquidAI embedding display name).
const oldChain = ['liquid/lfm-2.5-350m-embed:free', 'nvidia/nemotron-3-nano-omni:free', 'meta-llama/llama-3.1-8b-instruct:free', 'nvidia/nemotron-3-nano-30b-a3b:free']
const oldValidations = await provider(oldChain).validateModels()
for (const validation of oldValidations) console.log(`  old slug ${validation.model.padEnd(46)} → available=${validation.available} reason=${validation.reason} status=${validation.statusCode}`)
check('every old Render slug is unavailable', oldValidations.every((v) => !v.available))
check('nemotron-3-nano-omni is a hard 404 (not_found)', oldValidations.find((v) => v.model === 'nvidia/nemotron-3-nano-omni:free')?.reason === 'not_found')
check('empty-endpoint slugs report no_endpoints', oldValidations.filter((v) => v.model.includes('llama-3.1') || v.model.includes('nano-30b')).every((v) => v.reason === 'no_endpoints'))
const oldUnavailable = emitBootValidation(oldValidations)
check('boot reproduces the production alert "every configured OpenRouter model is unavailable"',
  oldUnavailable === oldValidations.length && bootLog.some(([level, message]) => level === 'error' && message.includes('every configured OpenRouter model is unavailable')))

// 2b. The new chain from .env.example, plus the reserved AI_COMMAND slots.
const newChain = ['nvidia/nemotron-3-super-120b-a12b:free', 'google/gemma-4-26b-a4b-it:free', 'inclusionai/ling-3.0-flash-fin:free']
const commandChain = ['cohere/north-mini-code:free', 'google/gemma-4-26b-a4b-it:free']
const newValidations = [...await provider(newChain).validateModels(), ...await provider(commandChain).validateModels()]
for (const validation of newValidations) console.log(`  new slug ${validation.model.padEnd(46)} → available=${validation.available} reason=${validation.reason} provider=${captures.get(validation.model)?.body.data.endpoints[0]?.provider_name}`)
check('every new slug validates with a live endpoint', newValidations.every((v) => v.available))
check('boot logs "OpenRouter model validated" for every new slug', emitBootValidation(newValidations) === 0 && newValidations.every((v) => bootLog.some(([, message, context]) => message === 'OpenRouter model validated' && context.model === v.model)))
const providers = new Set(newChain.map((model) => captures.get(model)?.body.data.endpoints[0]?.provider_name))
check('AI_MODEL_* chain spans 3 distinct providers (one outage cannot kill the chain)', providers.size === 3 && JSON.stringify([...providers].sort()) === '["Google AI Studio","Novita","Nvidia"]')
check('AI_COMMAND_MODEL_PRIMARY is on a 4th provider (Cohere)', captures.get('cohere/north-mini-code:free')?.body.data.endpoints[0]?.provider_name === 'Cohere')

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nProof 3 — enforceSecureTls() startup guard (what apps/api & apps/worker run first)\n')

const { enforceSecureTls } = await importDist('monitoring')
const insecureEnv = { NODE_TLS_REJECT_UNAUTHORIZED: ' 0 ' }
const logs = []
const guard = enforceSecureTls(insecureEnv, (message) => logs.push(message))
console.log(`  env { NODE_TLS_REJECT_UNAUTHORIZED: ' 0 ' } → '${insecureEnv.NODE_TLS_REJECT_UNAUTHORIZED}' (enforced=${guard.enforced}, previous=${JSON.stringify(guard.previous)})`)
check("trimmed '0' is restored to '1'", insecureEnv.NODE_TLS_REJECT_UNAUTHORIZED === '1' && guard.enforced === true && guard.previous === ' 0 ')
check('an error is logged pointing at the Render env group', logs.some((m) => m.includes('NODE_TLS_REJECT_UNAUTHORIZED') && m.includes('TLS certificate verification')))
const secureEnv = { NODE_TLS_REJECT_UNAUTHORIZED: '1', PORT: '3000' }
check('secure and absent values are left alone', enforceSecureTls(secureEnv).enforced === false && enforceSecureTls({}).enforced === false && secureEnv.NODE_TLS_REJECT_UNAUTHORIZED === '1')

console.log(`\n${failures === 0 ? 'ALL PROOFS PASSED' : failures + ' PROOF(S) FAILED'}\n`)
process.exit(failures === 0 ? 0 : 1)
