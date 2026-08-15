import type { JarvisPreference } from './f8-model.js'
import type { Recommendation } from './model.js'

export const PASSIVE_RECOMMENDATION_INTERVAL_MS = 60_000
export const PASSIVE_SNOOZE_MS = 60 * 60 * 1_000

export function passiveRecommendationsAllowed(preference: JarvisPreference | null, now = Date.now()): boolean {
  if (!preference) return false
  if (preference.engagementMode === 'quiet' || preference.engagementMode === 'answer-only' || preference.onlyAnswerWhenAsked) return false
  return preference.silenceUntil === null || preference.silenceUntil <= now
}

export function selectPassiveRecommendation(input: Readonly<{
  recommendations: readonly Recommendation[]
  preference: JarvisPreference | null
  dismissedIds: ReadonlySet<string>
  shownIds: ReadonlySet<string>
  snoozedUntil: Readonly<Record<string, number>>
  now?: number
}>): Recommendation | null {
  const now = input.now ?? Date.now()
  if (!passiveRecommendationsAllowed(input.preference, now)) return null
  return [...input.recommendations]
    .filter((recommendation) => recommendation.status === 'PENDING')
    .filter((recommendation) => !input.dismissedIds.has(recommendation.id) && !input.shownIds.has(recommendation.id))
    .filter((recommendation) => (input.snoozedUntil[recommendation.id] ?? 0) <= now)
    .sort((left, right) => right.confidence - left.confidence || Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null
}
