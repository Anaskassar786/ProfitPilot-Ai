import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiClientError } from './api.js'
import {
  archiveAiCommandConversation,
  approveAiCommandAction,
  cancelAiCommandAction,
  deleteAiCommandConversation,
  deleteAiCommandSaved,
  executeAiCommandSaved,
  exportAiCommandConversation,
  fetchAiCommandConversation,
  fetchAiCommandConversations,
  fetchAiCommandPreferences,
  fetchAiCommandQuickCommands,
  fetchStoreQuickInsights,
  fetchAiCommandSuggestions,
  fetchAiCommandUsage,
  fetchAiCommandUsageHistory,
  fetchAiCommandSaved,
  rateAiCommandMessage,
  rollbackAiCommandAction,
  saveAiCommandCommand,
  sendAiCommandMessage,
  streamAiCommandMessage,
  updateAiCommandPreferences,
} from './ai-command-api.js'
import type {
  AiCommandConversation,
  AiCommandMessage,
  AiCommandPreferences,
  AiCommandQuickCommand,
  AiCommandQuickInsights,
  AiCommandSuggestion,
  AiCommandSavedCommand,
  AiCommandUsage,
} from './ai-command-model.js'
import { merchantSafeAiCommandError } from './ai-command-model.js'

type ToastFn = (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void

export function useAiCommandWorkspace(storeId: string | null, onToast: ToastFn) {
  const [conversations, setConversations] = useState<readonly AiCommandConversation[]>([])
  const [conversation, setConversation] = useState<AiCommandConversation | null>(null)
  const [usage, setUsage] = useState<AiCommandUsage | null>(null)
  const [usageHistory, setUsageHistory] = useState<readonly AiCommandUsage[]>([])
  const [saved, setSaved] = useState<readonly AiCommandSavedCommand[]>([])
  const [quick, setQuick] = useState<readonly AiCommandQuickCommand[]>([])
  const [quickInsights, setQuickInsights] = useState<AiCommandQuickInsights | null>(null)
  const [followUps, setFollowUps] = useState<readonly AiCommandSuggestion[]>([])
  const [preferences, setPreferences] = useState<AiCommandPreferences | null>(null)
  const [thinking, setThinking] = useState<readonly string[]>([])
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limitReached, setLimitReached] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const refreshSide = useCallback(async () => {
    if (!storeId) return
    const [nextConversations, nextUsage, nextSaved, nextQuick, nextPrefs, nextHistory, nextInsights] = await Promise.allSettled([
      fetchAiCommandConversations(storeId),
      fetchAiCommandUsage(storeId),
      fetchAiCommandSaved(storeId),
      fetchAiCommandQuickCommands(storeId),
      fetchAiCommandPreferences(storeId),
      fetchAiCommandUsageHistory(storeId, 7),
      fetchStoreQuickInsights(storeId),
    ])
    if (nextConversations.status === 'fulfilled') setConversations(nextConversations.value)
    if (nextUsage.status === 'fulfilled') setUsage(nextUsage.value)
    if (nextSaved.status === 'fulfilled') setSaved(nextSaved.value)
    if (nextQuick.status === 'fulfilled') setQuick(nextQuick.value)
    if (nextPrefs.status === 'fulfilled') setPreferences(nextPrefs.value)
    if (nextHistory.status === 'fulfilled') setUsageHistory(nextHistory.value)
    if (nextInsights.status === 'fulfilled') setQuickInsights(nextInsights.value)
  }, [storeId])

  useEffect(() => { void refreshSide() }, [refreshSide])

  const openConversation = useCallback(async (id: string) => {
    if (!storeId) return
    try {
      setConversation(await fetchAiCommandConversation(storeId, id))
      setError(null)
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'Conversation could not be loaded.', 'error')
    }
  }, [storeId, onToast])

  const newChat = useCallback(() => {
    setConversation(null)
    setThinking([])
    setStreaming('')
    setFollowUps([])
    setError(null)
  }, [])

  const send = useCallback(async (text: string) => {
    if (!storeId || !text.trim() || busy) return
    const previous = conversation
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      abortRef.current?.abort()
    }, 30_000)
    setBusy(true)
    setError(null)
    setLimitReached(false)
    setThinking(['Understanding your request...'])
    setStreaming('')
    const optimistic: AiCommandMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      contentType: 'text',
      structuredData: null,
      action: null,
      thinkingSteps: null,
      timestamp: new Date().toISOString(),
    }
    setConversation((current) => current
      ? { ...current, messages: [...current.messages, optimistic] }
      : { id: 'pending', storeId, title: text.trim().slice(0, 72), messages: [optimistic], context: {}, status: 'ACTIVE', createdAt: optimistic.timestamp, updatedAt: optimistic.timestamp, lastMessageAt: optimistic.timestamp })
    try {
      const result = await streamAiCommandMessage(storeId, text.trim(), conversation && conversation.id !== 'pending' ? conversation.id : undefined, (event, payload) => {
        if (event === 'thinking' && payload && typeof payload === 'object' && 'step' in payload) {
          const step = String((payload as { step: unknown }).step)
          setThinking((current) => current.includes(step) ? current : [...current, step])
        }
        if (event === 'message' && payload && typeof payload === 'object' && 'content' in payload) {
          setStreaming(String((payload as { content: unknown }).content ?? ''))
        }
      }, undefined, abortRef.current.signal)
      setConversation(result.conversation)
      setUsage(result.usage)
      setThinking([])
      setStreaming('')
      const suggestions = await fetchAiCommandSuggestions(storeId, text.trim()).catch(() => [])
      setFollowUps(suggestions)
      await refreshSide()
    } catch (failure: unknown) {
      if (isAbortError(failure)) {
        if (timedOut) {
          setError('This command took longer than 30 seconds. Please try again.')
          onToast('Command timed out after 30 seconds.', 'error')
        } else {
          const cancelled: AiCommandMessage = {
            id: `cancelled-${Date.now()}`,
            role: 'assistant',
            content: 'Command cancelled. No result was applied.',
            contentType: 'error',
            structuredData: null,
            action: null,
            thinkingSteps: null,
            timestamp: new Date().toISOString(),
          }
          setConversation((current) => current ? { ...current, messages: [...current.messages, cancelled] } : previous)
          onToast('Command cancelled.', 'info')
        }
      } else if (shouldRetryWithoutStreaming(failure)) {
        try {
          const fallback = await sendAiCommandMessage(storeId, text.trim(), conversation && conversation.id !== 'pending' ? conversation.id : undefined, fetch, abortRef.current?.signal)
          setConversation(fallback.conversation)
          setUsage(fallback.usage)
          setFollowUps(await fetchAiCommandSuggestions(storeId, text.trim()).catch(() => []))
          await refreshSide()
        } catch (second: unknown) {
          const message = isAbortError(second) && timedOut
            ? 'This command took longer than 30 seconds. Please try again.'
            : merchantSafeAiCommandError(second instanceof Error ? second.message : '')
          setError(message)
          if (/limit|upgrade plan/i.test(message)) setLimitReached(true)
          onToast(message, 'error')
        }
      } else {
        const message = merchantSafeAiCommandError(failure instanceof Error ? failure.message : '')
        setError(message)
        if (/limit|upgrade plan/i.test(message) || failure instanceof ApiClientError && failure.status === 402) setLimitReached(true)
        setConversation(previous)
        onToast(message, 'error')
      }
    } finally {
      window.clearTimeout(timeout)
      setBusy(false)
      setThinking([])
      abortRef.current = null
    }
  }, [storeId, busy, conversation, refreshSide, onToast])

  const cancelThinking = useCallback(() => {
    if (!busy) return
    abortRef.current?.abort()
  }, [busy])

  const approve = useCallback(async (actionId: string) => {
    if (!storeId) return
    setBusy(true)
    try {
      await approveAiCommandAction(storeId, actionId)
      if (conversation && conversation.id !== 'pending') await openConversation(conversation.id)
      await refreshSide()
      if (preferences?.notificationOnActionComplete !== false) onToast('Action completed. Review the verified result below.', 'success')
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'The action could not be approved.', 'error')
    } finally { setBusy(false) }
  }, [storeId, conversation, openConversation, refreshSide, preferences?.notificationOnActionComplete, onToast])

  const cancel = useCallback(async (actionId: string) => {
    if (!storeId) return
    try {
      await cancelAiCommandAction(storeId, actionId)
      if (conversation && conversation.id !== 'pending') await openConversation(conversation.id)
      await refreshSide()
      onToast('Action cancelled. Nothing was executed.', 'info')
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'The action could not be cancelled.', 'error')
    }
  }, [storeId, conversation, openConversation, refreshSide, onToast])

  const undo = useCallback(async (actionId: string) => {
    if (!storeId) return
    try {
      await rollbackAiCommandAction(storeId, actionId)
      if (conversation && conversation.id !== 'pending') await openConversation(conversation.id)
      await refreshSide()
      onToast('Action rolled back.', 'success')
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'Undo is no longer available.', 'error')
    }
  }, [storeId, conversation, openConversation, refreshSide, onToast])

  const removeConversation = useCallback(async (id: string) => {
    if (!storeId) return
    try {
      await deleteAiCommandConversation(storeId, id)
      if (conversation?.id === id) newChat()
      await refreshSide()
      onToast('Conversation deleted.', 'success')
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'Conversation could not be deleted.', 'error')
    }
  }, [storeId, conversation, newChat, refreshSide, onToast])

  const archive = useCallback(async (id: string) => {
    if (!storeId) return
    try {
      await archiveAiCommandConversation(storeId, id)
      if (conversation?.id === id) newChat()
      await refreshSide()
      onToast('Conversation archived.', 'success')
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'Conversation could not be archived.', 'error')
    }
  }, [storeId, conversation, newChat, refreshSide, onToast])

  const saveCurrent = useCallback(async (name: string, commandText: string) => {
    if (!storeId) return
    try {
      await saveAiCommandCommand(storeId, name, commandText)
      await refreshSide()
      onToast('Command saved.', 'success')
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'The command could not be saved.', 'error')
    }
  }, [storeId, refreshSide, onToast])

  const runSaved = useCallback(async (id: string) => {
    if (!storeId) return
    setBusy(true)
    try {
      const result = await executeAiCommandSaved(storeId, id)
      setConversation(result.conversation)
      setUsage(result.usage)
      await refreshSide()
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'Saved command failed.', 'error')
    } finally { setBusy(false) }
  }, [storeId, refreshSide, onToast])

  const removeSaved = useCallback(async (id: string) => {
    if (!storeId) return
    try {
      await deleteAiCommandSaved(storeId, id)
      await refreshSide()
      onToast('Saved command deleted.', 'success')
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'Saved command could not be deleted.', 'error')
    }
  }, [storeId, refreshSide, onToast])

  const patchPreferences = useCallback(async (patch: Partial<AiCommandPreferences>) => {
    if (!storeId) return
    try {
      setPreferences(await updateAiCommandPreferences(storeId, patch))
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'Preferences could not be saved.', 'error')
    }
  }, [storeId, onToast])

  const exportConversation = useCallback(async (id: string) => {
    if (!storeId) return
    try {
      const exported = await exportAiCommandConversation(storeId, id)
      downloadCsv(exported.filename, exported.rows)
      onToast('Conversation exported.', 'success')
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'Conversation could not be exported.', 'error')
    }
  }, [storeId, onToast])

  const rateMessage = useCallback(async (messageId: string, rating: 'HELPFUL' | 'NOT_HELPFUL') => {
    if (!storeId || !conversation || conversation.id === 'pending') return
    try {
      await rateAiCommandMessage(storeId, conversation.id, messageId, rating)
      onToast('Feedback saved. Thank you!', 'success')
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'Feedback could not be saved.', 'error')
    }
  }, [storeId, conversation, onToast])

  return {
    conversations, conversation, usage, usageHistory, saved, quick, quickInsights, followUps, preferences, thinking, streaming, busy, error, limitReached,
    openConversation, newChat, send, cancelThinking, approve, cancel, undo, removeConversation, archive, saveCurrent, runSaved, removeSaved, patchPreferences, exportConversation, rateMessage, refreshSide,
  }
}

function isAbortError(failure: unknown): boolean {
  return failure instanceof Error && failure.name === 'AbortError'
}

function shouldRetryWithoutStreaming(failure: unknown): boolean {
  if (failure instanceof TypeError) return true
  if (!(failure instanceof ApiClientError)) return false
  // 403 (CSRF validation failed) is included so a stream rejected by the
  // double-submit check retries through `sendAiCommandMessage`, whose
  // `requestJson` path injects and auto-refreshes the CSRF token.
  return [403, 404, 405, 406, 415, 501].includes(failure.status)
}

function downloadCsv(filename: string, rows: readonly Readonly<Record<string, string>>[]): void {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [headers.map(escape).join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
