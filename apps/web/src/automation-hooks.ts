import { useCallback, useEffect, useState } from 'react'
import { getApprovals, getAutomationSummary, getAutomationTemplates, getAutomationUsage, listWorkflows } from './automation-api.js'
import type { Approval, AutomationSummary, AutomationUsage, WorkflowPage, WorkflowTemplate } from './automation-model.js'
import { cached, loadCached, remember } from './data-cache.js'

export type AutomationHubData = { workflows: WorkflowPage | null; summary: AutomationSummary | null; usage: AutomationUsage | null; templates: readonly WorkflowTemplate[]; approvals: readonly Approval[] }
type AutomationHubBundle = AutomationHubData & { error: string | null }

const EMPTY: AutomationHubData = { workflows: null, summary: null, usage: null, templates: [], approvals: [] }

/**
 * SPA tab-switch fast path (GA 2026-08-21): the Automation workspace is one of
 * the heaviest pages (5 parallel fetches). The last-good bundle is cached per
 * store so switching to Automation renders instantly from cache while a
 * silent background refresh keeps it current. Manual refreshes write through
 * to the cache too.
 */
export function useAutomationHub(storeId: string | null, filters: Readonly<Record<string, string>>) {
  const [data, setData] = useState<AutomationHubData>(EMPTY)
  const [loading, setLoading] = useState(Boolean(storeId))
  const [error, setError] = useState<string | null>(null)

  const loadBundle = useCallback(async (currentStoreId: string): Promise<AutomationHubBundle> => {
    try {
      const [workflows, summary, usage, templates, approvals] = await Promise.all([listWorkflows(currentStoreId, filters), getAutomationSummary(currentStoreId), getAutomationUsage(currentStoreId), getAutomationTemplates(currentStoreId), getApprovals(currentStoreId)])
      return { workflows, summary, usage, templates, approvals, error: null }
    } catch (reason: unknown) {
      return { ...EMPTY, error: reason instanceof Error ? reason.message : 'Automation could not be loaded.' }
    }
  }, [JSON.stringify(filters)])

  const applyBundle = useCallback((bundle: AutomationHubBundle) => {
    setData(bundle)
    setError(bundle.error)
    setLoading(false)
  }, [])

  const refresh = useCallback(async () => {
    if (!storeId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    const bundle = await loadBundle(storeId)
    remember(`automation:${storeId}:${JSON.stringify(filters)}`, bundle)
    applyBundle(bundle)
  }, [storeId, loadBundle, applyBundle, JSON.stringify(filters)])

  useEffect(() => {
    if (!storeId) { setLoading(false); return }
    const cacheKey = `automation:${storeId}:${JSON.stringify(filters)}`
    const seed = cached<AutomationHubBundle>(cacheKey)
    if (seed) applyBundle(seed)
    else setLoading(true)
    let cancelled = false
    void loadCached(cacheKey, () => loadBundle(storeId)).then((bundle) => {
      if (!cancelled) applyBundle(bundle)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [storeId, JSON.stringify(filters), loadBundle, applyBundle])

  return { ...data, loading, error, refresh }
}
