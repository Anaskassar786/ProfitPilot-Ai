# PR: Move AI_MODEL_FALLBACK2 + AI_COMMAND_MODEL_FALLBACK to google/gemma-4-31b-it:free

## Problem

Production deploy logs emitted:

```
STARTUP ALERT: OpenRouter model slug is invalid or has no active endpoints
  model: nvidia/nemotron-3-nano-30b-a3b:free
  reason: no_endpoints
```

`nvidia/nemotron-3-nano-30b-a3b:free` is dead on OpenRouter: `GET /api/v1/models/nvidia/nemotron-3-nano-30b-a3b:free/endpoints` returns HTTP 200 with an empty `endpoints` array (capture: `scripts/openrouter-captures/nvidia-nemotron-3-nano-30b-a3b-free.json`), so `OpenRouterClient.validateModels()` classifies it as `no_endpoints` and `apps/api/src/f8-bootstrap.ts` raises the startup alert on every boot.

The previous PR had already retired that slug from `.env.example`; the alert persisted because the deployed environment variables still carried it. This PR moves the two remaining requested slots onto the model that replaces it.

## Change

| Variable | Before | After |
|---|---|---|
| `AI_MODEL_FALLBACK2` | `inclusionai/ling-3.0-flash-fin:free` | `google/gemma-4-31b-it:free` |
| `AI_COMMAND_MODEL_FALLBACK` | `google/gemma-4-26b-a4b-it:free` | `google/gemma-4-31b-it:free` |

Final validated chain (boot validates the first three via `AI_MODEL_PRIMARY`/`AI_MODEL_FALLBACK1`/`AI_MODEL_FALLBACK2`):

- `AI_MODEL_PRIMARY` → `nvidia/nemotron-3-super-120b-a12b:free` (Nvidia, 262K ctx)
- `AI_MODEL_FALLBACK1` → `google/gemma-4-26b-a4b-it:free` (Google AI Studio, 262K ctx)
- `AI_MODEL_FALLBACK2` → `google/gemma-4-31b-it:free` (Google AI Studio, 262K ctx)
- `AI_COMMAND_MODEL_PRIMARY` → `cohere/north-mini-code:free` (Cohere, reserved)
- `AI_COMMAND_MODEL_FALLBACK` → `google/gemma-4-31b-it:free` (Google AI Studio, reserved)

## Live verification (2026-08-29)

Every slug above was re-verified live against `https://openrouter.ai/api/v1/models/{id}/endpoints` on 2026-08-29 — `google/gemma-4-31b-it:free` returns 1 active endpoint (Google AI Studio, `google/gemma-4-31b-it-20260402:free`, 262K ctx, $0 pricing, 99.75% uptime 1d). A fresh capture was added at `scripts/openrouter-captures/google-gemma-4-31b-it-free.json`.

`node scripts/qa/verify-gemma31b-chain.mjs` replays the exact `validateModels()` + boot-log emission rules over the captures and confirms:

- all 3 `AI_MODEL_*` slugs validate → boot emits `OpenRouter model validated` ×3, zero `STARTUP ALERT`
- no `nvidia/nemotron-3-nano-30b-a3b:free` and no `no_endpoints` anywhere in the boot log
- the dead slug still reports `no_endpoints` (it stays documented in the do-not-reintroduce list)

## Files

- `.env.example` — the two slots + the verified-active comment block (provider layout + spares)
- `scripts/openrouter-captures/google-gemma-4-31b-it-free.json` — new live capture (2026-08-29)
- `scripts/verify-production-fixes.mjs` — Proof 2 chains follow `.env.example`; provider check updated to the new layout (primary Nvidia, both fallbacks Google AI Studio); spares re-checked
- `scripts/qa/verify-gemma31b-chain.mjs` — standalone replay harness for the checks above (no dist build required)
- `DEPLOYMENT.md`, `docs/AI_COMMAND.md` — documented values + verification date

## Deployment note (required for the alert to disappear)

`.env.example` is only a template — the running service reads its own environment variables. Update the environment group / service variables (Render dashboard per `DEPLOYMENT.md`, or Railway variables) and redeploy:

```
AI_MODEL_FALLBACK2=google/gemma-4-31b-it:free
AI_COMMAND_MODEL_FALLBACK=google/gemma-4-31b-it:free
```

Also delete any lingering `nvidia/nemotron-3-nano-30b-a3b:free` value (e.g. a stale `AI_MODEL_FALLBACK2`) from the dashboard. After redeploy, expect three `OpenRouter model validated` lines and no `STARTUP ALERT`.

## Trade-off

Both fallbacks now sit on Google AI Studio (previously fallback2 was Novita), so a single Google free-tier outage would leave only the Nvidia primary. Mitigation: `inclusionai/ling-3.0-flash-fin:free` (Novita, verified active 2026-08-29) is documented as the first promotion spare in `.env.example` and `DEPLOYMENT.md`.
