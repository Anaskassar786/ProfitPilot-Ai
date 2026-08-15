import { describe, expect, it } from 'vitest'
import { PASSIVE_RECOMMENDATION_INTERVAL_MS, passiveRecommendationsAllowed, selectPassiveRecommendation } from './passive-jarvis.js'
import type { JarvisPreference } from './f8-model.js'
import type { Recommendation } from './model.js'

const preference: JarvisPreference = { storeId: 's1', addressing: 'Sir', language: 'auto', engagementMode: 'balanced', silenceUntil: null, navigationSuggestions: true, onlyAnswerWhenAsked: false, updatedAt: 1 }
const recommendation = (id: string, confidence: number, status: Recommendation['status'] = 'PENDING'): Recommendation => ({ id, storeId: 's1', agent: 'REVENUE_AGENT', ruleId: 'RULE', title: `Recommendation ${id}`, reason: 'Grounded reason', impactValue: 1, impactLabel: 'Impact', currency: 'USD', confidence, confidenceLevel: confidence >= .9 ? 'HIGH' : 'MEDIUM', actionType: 'INTERNAL_ALERT', actionRisk: 'SAFE', status, evidencePack: {}, explanation: null, explanationStatus: 'AI_UNAVAILABLE', model: null, version: 0, createdAt: '2026-08-15T00:00:00.000Z' })

describe('passive in-app Jarvis recommendations', () => {
  it('uses a modest one-minute observer interval', () => expect(PASSIVE_RECOMMENDATION_INTERVAL_MS).toBe(60_000))
  it('respects quiet, answer-only, direct-answer, and silence preferences', () => {
    expect(passiveRecommendationsAllowed(preference, 1_000)).toBe(true)
    expect(passiveRecommendationsAllowed({ ...preference, engagementMode: 'quiet' }, 1_000)).toBe(false)
    expect(passiveRecommendationsAllowed({ ...preference, engagementMode: 'answer-only' }, 1_000)).toBe(false)
    expect(passiveRecommendationsAllowed({ ...preference, onlyAnswerWhenAsked: true }, 1_000)).toBe(false)
    expect(passiveRecommendationsAllowed({ ...preference, silenceUntil: 2_000 }, 1_000)).toBe(false)
  })
  it('surfaces only one persisted pending recommendation and honors dedupe, dismiss, and snooze', () => {
    const recommendations = [recommendation('approved', .99, 'APPROVED'), recommendation('shown', .98), recommendation('snoozed', .97), recommendation('candidate', .91), recommendation('lower', .7)]
    const selected = selectPassiveRecommendation({ recommendations, preference, dismissedIds: new Set(['lower']), shownIds: new Set(['shown']), snoozedUntil: { snoozed: 2_000 }, now: 1_000 })
    expect(selected?.id).toBe('candidate')
    expect(selectPassiveRecommendation({ recommendations, preference: { ...preference, engagementMode: 'quiet' }, dismissedIds: new Set(), shownIds: new Set(), snoozedUntil: {}, now: 1_000 })).toBeNull()
  })
})
