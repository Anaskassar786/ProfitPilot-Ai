import { useCallback, useEffect, useRef, useState } from 'react'
import {
  archiveAiCommandConversation,
  approveAiCommandAction,
  cancelAiCommandAction,
  deleteAiCommandConversation,
  deleteAiCommandSaved,
  executeAiCommandSaved,
  fetchAiCommandConversation,
  fetchAiCommandConversations,
  fetchAiCommandPreferences,
  fetchAiCommandQuickCommands,
  fetchAiCommandUsage,
  fetchAiCommandUsageHistory,
  fetchAiCommandSaved,
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
  AiCommandSavedCommand,
  AiCommandUsage,
} from './ai-command-model.js'

type ToastFn = (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void

export function useAiCommandWorkspace(storeId: string | null, onToast: ToastFn) {
  const [conversations, setConversations] = useState<readonly AiCommandConversation[]>([])
  const [conversation, setConversation] = useState<AiCommandConversation | null>(null)
  const [usage, setUsage] = useState<AiCommandUsage | null>(null)
  const [usageHistory, setUsageHistory] = useState<readonly AiCommandUsage[]>([])
  const [saved, setSaved] = useState<readonly AiCommandSavedCommand[]>([])
  const [quick, setQuick] = useState<readonly AiCommandQuickCommand[]>([])
  const [preferences, setPreferences] = useState<AiCommandPreferences | null>(null)
  const [thinking, setThinking] = useState<readonly string[]>([])
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limitReached, setLimitReached] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const refreshSide = useCallback(async () => {
    if (!storeId) return
    const [nextConversations, nextUsage, nextSaved, nextQuick, nextPrefs, nextHistory] = await Promise.allSettled([
      fetchAiCommandConversations(storeId),
      fetchAiCommandUsage(storeId),
      fetchAiCommandSaved(storeId),
      fetchAiCommandQuickCommands(storeId),
      fetchAiCommandPreferences(storeId),
      fetchAiCommandUsageHistory(storeId, 7),
    ])
    if (nextConversations.status === 'fulfilled') setConversations(nextConversations.value)
    if (nextUsage.status === 'fulfilled') setUsage(nextUsage.value)
    if (nextSaved.status === 'fulfilled') setSaved(nextSaved.value)
    if (nextQuick.status === 'fulfilled') setQuick(nextQuick.value)
    if (nextPrefs.status === 'fulfilled') setPreferences(nextPrefs.value)
    if (nextHistory.status === 'fulfilled') setUsageHistory(nextHistory.value)
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
    setError(null)
  }, [])

  const send = useCallback(async (text: string) => {
    if (!storeId || !text.trim() || busy) return
    const previous = conversation
    abortRef.current?.abort()
    abortRef.current = new AbortController()
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
      await refreshSide()
    } catch (failure: unknown) {
      if (isAbortError(failure)) {
        setConversation(previous)
        onToast('Command cancelled.', 'info')
      } else {
        try {
          const fallback = await sendAiCommandMessage(storeId, text.trim(), conversation && conversation.id !== 'pending' ? conversation.id : undefined)
          setConversation(fallback.conversation)
          setUsage(fallback.usage)
        } catch (second: unknown) {
          const message = second instanceof Error ? second.message : 'AI Command could not answer.'
          setError(message)
          if (/limit|upgrade plan/i.test(message)) setLimitReached(true)
          onToast(message, 'error')
        }
      }
    } finally {
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
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'The action could not be approved.', 'error')
    } finally { setBusy(false) }
  }, [storeId, conversation, openConversation, refreshSide, onToast])

  const cancel = useCallback(async (actionId: string) => {
    if (!storeId) return
    try {
      await cancelAiCommandAction(storeId, actionId)
      if (conversation && conversation.id !== 'pending') await openConversation(conversation.id)
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'The action could not be cancelled.', 'error')
    }
  }, [storeId, conversation, openConversation, onToast])

  const undo = useCallback(async (actionId: string) => {
    if (!storeId) return
    try {
      await rollbackAiCommandAction(storeId, actionId)
      if (conversation && conversation.id !== 'pending') await openConversation(conversation.id)
    } catch (failure: unknown) {
      onToast(failure instanceof Error ? failure.message : 'Undo is no longer available.', 'error')
    }
  }, [storeId, conversation, openConversation, onToast])

  const removeConversation = useCallback(async (id: string) => {
    if (!storeId) return
    await deleteAiCommandConversation(storeId, id)
    if (conversation?.id === id) newChat()
    await refreshSide()
  }, [storeId, conversation, newChat, refreshSide])

  const archive = useCallback(async (id: string) => {
    if (!storeId) return
    await archiveAiCommandConversation(storeId, id)
    await refreshSide()
  }, [storeId, refreshSide])

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
    await deleteAiCommandSaved(storeId, id)
    await refreshSide()
  }, [storeId, refreshSide])

  const patchPreferences = useCallback(async (patch: Partial<AiCommandPreferences>) => {
    if (!storeId) return
    setPreferences(await updateAiCommandPreferences(storeId, patch))
  }, [storeId])

  return {
    conversations, conversation, usage, usageHistory, saved, quick, preferences, thinking, streaming, busy, error, limitReached,
    openConversation, newChat, send, cancelThinking, approve, cancel, undo, removeConversation, archive, saveCurrent, runSaved, removeSaved, patchPreferences, refreshSide,
  }
}

function isAbortError(failure: unknown): boolean {
  return failure instanceof Error && failure.name === 'AbortError'
}
