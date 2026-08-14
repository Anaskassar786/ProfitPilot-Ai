export type LatencyMeasurement = Readonly<{ samples: number; p95Ms: number; maxMs: number; budgetMs: number; withinBudget: boolean }>
export type Clock = () => number

export function percentile95(samples: readonly number[]): number {
  if (samples.length === 0) return 0
  const ordered = [...samples].sort((left, right) => left - right)
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * 0.95) - 1))
  return ordered[index] ?? 0
}

export function latencyMeasurement(samples: readonly number[], budgetMs: number): LatencyMeasurement {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new RangeError('Latency budget must be positive')
  const normalized = samples.filter((sample) => Number.isFinite(sample) && sample >= 0)
  const p95Ms = percentile95(normalized)
  const maxMs = normalized.length === 0 ? 0 : Math.max(...normalized)
  return { samples: normalized.length, p95Ms, maxMs, budgetMs, withinBudget: normalized.length > 0 && p95Ms < budgetMs }
}

export async function measureParallel(count: number, operation: (index: number) => Promise<void>, budgetMs: number, clock: Clock = () => Date.now()): Promise<LatencyMeasurement> {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('Parallel load count must be positive')
  const durations: number[] = []
  await Promise.all(Array.from({ length: count }, async (_value, index) => {
    const started = clock()
    await operation(index)
    durations.push(Math.max(0, clock() - started))
  }))
  return latencyMeasurement(durations, budgetMs)
}

export function assertLatencyBudget(measurement: LatencyMeasurement): void {
  if (!measurement.withinBudget) throw new Error(`P95 latency budget exceeded: ${measurement.p95Ms}ms >= ${measurement.budgetMs}ms`)
}
