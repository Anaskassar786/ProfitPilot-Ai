import { describe, expect, it } from 'vitest'
import { AppError } from '@profitpilot/types'
import { AccessReviewService, InMemoryAccessReviewRepository, assertLatencyBudget, latencyMeasurement, measureParallel, percentile95 } from './index.js'

describe('F7 SOC-2-Lite access review', () => {
  it('computes role permissions from live assignments', async () => {
    let now = 1_700_000_000_000
    const service = new AccessReviewService(new InMemoryAccessReviewRepository(), () => now)
    const assignment = await service.assign({ storeId: 'store-a', userId: 'user-a', role: 'operator', actorId: 'admin-a' })
    expect(assignment.version).toBe(1)
    const report = await service.report('store-a')
    expect(report.members[0]).toMatchObject({ userId: 'user-a', role: 'operator' })
    expect(report.members[0]?.permissions).toContain('orders:write')
    expect(report.auditTrail[0]?.action).toBe('ROLE_ASSIGNED')
    now += 100
    const changed = await service.assign({ storeId: 'store-a', userId: 'user-a', role: 'analyst', actorId: 'admin-a', expectedVersion: 1 })
    expect(changed.version).toBe(2)
    expect((await service.report('store-a')).members[0]?.permissions).toContain('analytics:read')
  })

  it('rejects compare-and-set races and keeps tenants isolated', async () => {
    const service = new AccessReviewService()
    await service.assign({ storeId: 'store-a', userId: 'user-a', role: 'viewer', actorId: 'admin-a' })
    await expect(service.assign({ storeId: 'store-a', userId: 'user-a', role: 'owner', actorId: 'admin-b', expectedVersion: 0 })).rejects.toThrow(AppError)
    await expect(service.report('store-b')).resolves.toMatchObject({ members: [], auditTrail: [] })
  })

  it('revokes access and records immutable history', async () => {
    const service = new AccessReviewService()
    const created = await service.assign({ storeId: 'store-a', userId: 'user-a', role: 'admin', actorId: 'owner' })
    const revoked = await service.revoke({ storeId: 'store-a', userId: 'user-a', actorId: 'owner', expectedVersion: created.version })
    expect(revoked.revokedAt).not.toBeNull()
    const report = await service.report('store-a')
    expect(report.members).toHaveLength(0)
    expect(report.auditTrail.map((event) => event.action)).toEqual(['ROLE_ASSIGNED', 'ROLE_REVOKED'])
    await expect(service.revoke({ storeId: 'store-a', userId: 'user-a', actorId: 'owner', expectedVersion: revoked.version })).rejects.toThrow('not found')
  })

  it('exports CSV and JSON and audits the export', async () => {
    const service = new AccessReviewService()
    await service.assign({ storeId: 'store-a', userId: 'user-a', role: 'viewer', actorId: 'owner' })
    const csv = await service.export('store-a', 'owner', 'CSV')
    expect(csv.contentType).toContain('csv')
    expect(csv.body).toContain('user-a')
    const json = await service.export('store-a', 'owner', 'JSON')
    expect(JSON.parse(json.body)).toMatchObject({ storeId: 'store-a' })
    expect((await service.report('store-a')).auditTrail.at(-1)?.action).toBe('ACCESS_REVIEW_EXPORTED')
  })

  it('validates unknown roles in the service boundary', async () => {
    const service = new AccessReviewService()
    await expect(service.assign({ storeId: 'store-a', userId: 'user-a', role: 'unknown' as 'viewer', actorId: 'admin' })).rejects.toThrow('Unknown RBAC role')
  })
})

describe('F7 load measurement primitives', () => {
  it('computes p95 and enforces a strict budget', () => {
    expect(percentile95([5, 1, 3, 2, 4])).toBe(5)
    const measurement = latencyMeasurement([1, 2, 3], 10)
    expect(measurement.withinBudget).toBe(true)
    expect(() => assertLatencyBudget(measurement)).not.toThrow()
  })

  it('reports a failed budget and validates inputs', () => {
    const measurement = latencyMeasurement([10, 20], 10)
    expect(measurement.withinBudget).toBe(false)
    expect(() => assertLatencyBudget(measurement)).toThrow('P95')
    expect(latencyMeasurement([], 10).withinBudget).toBe(false)
    expect(() => latencyMeasurement([1], 0)).toThrow(RangeError)
    expect(() => percentile95([])).not.toThrow()
  })

  it('measures parallel work with a deterministic clock', async () => {
    const measurement = await measureParallel(30, async () => Promise.resolve(), 500, () => 1_000)
    expect(measurement.samples).toBe(30)
    expect(measurement.p95Ms).toBe(0)
    await expect(measureParallel(0, async () => Promise.resolve(), 500)).rejects.toThrow(RangeError)
  })
})
