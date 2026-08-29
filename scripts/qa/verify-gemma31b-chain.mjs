#!/usr/bin/env node
/**
 * Standalone replay of Proof 2 from scripts/verify-production-fixes.mjs
 * (no dist build needed): same capture-replay fetcher, same validation rules,
 * same boot-log emission rules as apps/api/src/f8-bootstrap.ts.
 */
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const capturesDir = join(here, '..', 'openrouter-captures')
let failures = 0
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

const captures = new Map()
for (const file of (await readdir(capturesDir)).filter((f) => f.endsWith('.json')).sort()) {
  const capture = JSON.parse(await readFile(join(capturesDir, file), 'utf8'))
  captures.set(capture.body.data?.id ?? file, capture)
}

// Same rules as OpenRouterClient.validateModels() in packages/ai/src/provider.ts
function validate(model) {
  const capture = captures.get(model)
  if (!capture) return { model, available: false, statusCode: 404, reason: 'not_found' }
  if (capture.httpStatus === 404) return { model, available: false, statusCode: 404, reason: 'not_found' }
  const endpoints = capture.body.data?.endpoints ?? []
  return endpoints.length > 0
    ? { model, available: true, statusCode: capture.httpStatus, reason: 'available' }
    : { model, available: false, statusCode: capture.httpStatus, reason: 'no_endpoints' }
}

// Same emission rules as apps/api/src/f8-bootstrap.ts
function emitBootValidation(validations) {
  const bootLog = []
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
  return { bootLog, unavailable }
}

console.log('\nSim — chain read from .env.example (what the deployed env vars should be)\n')
const envExample = await readFile(join(here, '..', '..', '.env.example'), 'utf8')
const env = Object.fromEntries(
  envExample.split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
)
const chain = [env.AI_MODEL_PRIMARY, env.AI_MODEL_FALLBACK1, env.AI_MODEL_FALLBACK2]
console.log(`  AI_MODEL_* chain: ${JSON.stringify(chain)}`)
const validations = chain.map(validate)
for (const v of validations) console.log(`  slug ${v.model.padEnd(46)} → available=${v.available} reason=${v.reason} status=${v.statusCode}`)
check('all 3 AI_MODEL_* slugs validate', validations.every((v) => v.available))
const { bootLog, unavailable } = emitBootValidation(validations)
check('boot logs "OpenRouter model validated" for all 3 models and no STARTUP ALERT',
  unavailable === 0 && bootLog.filter(([level, message]) => level === 'info' && message === 'OpenRouter model validated').length === 3)
check('no nemotron slug and no no_endpoints in the boot log', !JSON.stringify(bootLog).includes('nemotron-3-nano-30b-a3b') && !JSON.stringify(bootLog).includes('no_endpoints'))

console.log('\nSim — old dead slug (the one from the production alert)\n')
const dead = validate('nvidia/nemotron-3-nano-30b-a3b:free')
console.log(`  slug ${dead.model.padEnd(46)} → available=${dead.available} reason=${dead.reason}`)
check('dead nemotron-3-nano-30b-a3b still reports no_endpoints (kept out of the chain)', !dead.available && dead.reason === 'no_endpoints')

console.log('\nSim — newChain/commandChain + provider checks (mirrors updated verify-production-fixes.mjs)\n')
const newChain = ['nvidia/nemotron-3-super-120b-a12b:free', 'google/gemma-4-26b-a4b-it:free', 'google/gemma-4-31b-it:free']
const commandChain = ['cohere/north-mini-code:free', 'google/gemma-4-31b-it:free']
const newValidations = [...newChain, ...commandChain].map(validate)
for (const v of newValidations) console.log(`  slug ${v.model.padEnd(46)} → available=${v.available} provider=${captures.get(v.model)?.body.data.endpoints[0]?.provider_name}`)
check('every new slug validates with a live endpoint', newValidations.every((v) => v.available))
check('.env.example chain matches the script newChain', JSON.stringify(chain) === JSON.stringify(newChain))
check('.env.example AI_COMMAND_MODEL_FALLBACK matches the script commandChain', env.AI_COMMAND_MODEL_FALLBACK === 'google/gemma-4-31b-it:free' && commandChain[1] === env.AI_COMMAND_MODEL_FALLBACK)
const providers = new Set(newChain.map((model) => captures.get(model)?.body.data.endpoints[0]?.provider_name))
check('AI_MODEL_* primary runs on Nvidia and both fallbacks on Google AI Studio (2 distinct providers)', providers.size === 2 && JSON.stringify([...providers].sort()) === '["Google AI Studio","Nvidia"]')
check('AI_COMMAND_MODEL_PRIMARY is on a 3rd provider (Cohere)', captures.get('cohere/north-mini-code:free')?.body.data.endpoints[0]?.provider_name === 'Cohere')
const spareValidations = ['inclusionai/ling-3.0-flash-fin:free', 'dots-studio/dots-3-note-preview:free'].map(validate)
check('spares still validate (ling on Novita, dots on AtlasCloud — first promotion candidates)', spareValidations.every((v) => v.available))

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`)
process.exit(failures === 0 ? 0 : 1)
