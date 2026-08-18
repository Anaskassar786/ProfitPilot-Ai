import { ApiClientError, initializeCsrf, requestJson } from './api.js'
import type { Fetcher } from './api.js'
import type { AiCommandConversation, AiCommandPreferences, AiCommandQuickCommand, AiCommandSavedCommand, AiCommandUsage, ChatResult } from './ai-command-model.js'
import { isRecord, parseSseBlocks, parseSseFrame } from './ai-command-model.js'

export function fetchAiCommandConversations(storeId: string, fetcher: Fetcher = fetch): Promise<readonly AiCommandConversation[]> {
  return requestJson(`/ai-command/conversations?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}
export function fetchAiCommandConversation(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<AiCommandConversation> {
  return requestJson(`/ai-command/conversations/${encodeURIComponent(id)}?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}
export function deleteAiCommandConversation(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<Readonly<{ deleted: boolean }>> {
  return requestJson(`/ai-command/conversations/${encodeURIComponent(id)}?storeId=${encodeURIComponent(storeId)}`, { method: 'DELETE' }, fetcher)
}
export function archiveAiCommandConversation(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<AiCommandConversation> {
  return requestJson(`/ai-command/conversations/${encodeURIComponent(id)}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) }, fetcher)
}
export async function sendAiCommandMessage(storeId: string, text: string, conversationId?: string, fetcher: Fetcher = fetch): Promise<ChatResult> {
  await initializeCsrf(fetcher)
  return requestJson('/ai-command/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, text, ...(conversationId ? { conversationId } : {}) }) }, fetcher)
}
export async function streamAiCommandMessage(storeId: string, text: string, conversationId: string | undefined, onEvent: (event: string, payload: unknown) => void, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<ChatResult> {
  await initializeCsrf(fetcher)
  const response = await fetcher('/ai-command/chat', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ storeId, text, stream: true, ...(conversationId ? { conversationId } : {}) }), ...(signal ? { signal } : {}) })
  if (!response.ok || !response.body) throw new ApiClientError('AI Command streaming unavailable', response.status)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: ChatResult | null = null
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    buffer += decoder.decode(step.value, { stream: true })
    const parsed = parseSseBlocks(buffer)
    buffer = parsed.rest
    for (const frame of parsed.frames) {
      const event = parseSseFrame(frame)
      if (!event) continue
      onEvent(event.event, event.data)
      if (event.event === 'result' && isRecord(event.data) && isRecord(event.data.conversation)) result = event.data as unknown as ChatResult
      if (event.event === 'error') {
        const message = isRecord(event.data) && typeof event.data.message === 'string' ? event.data.message : 'AI Command stream failed'
        throw new ApiClientError(message, response.status)
      }
    }
  }
  if (!result) throw new ApiClientError('AI Command stream ended without a result', response.status)
  return result
}
export function approveAiCommandAction(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<unknown> {
  return requestJson(`/ai-command/actions/${encodeURIComponent(id)}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) }, fetcher)
}
export function cancelAiCommandAction(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<unknown> {
  return requestJson(`/ai-command/actions/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) }, fetcher)
}
export function rollbackAiCommandAction(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<unknown> {
  return requestJson(`/ai-command/actions/${encodeURIComponent(id)}/rollback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) }, fetcher)
}
export function fetchAiCommandUsage(storeId: string, fetcher: Fetcher = fetch): Promise<AiCommandUsage> {
  return requestJson(`/ai-command/usage?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}
export function fetchAiCommandUsageHistory(storeId: string, days = 7, fetcher: Fetcher = fetch): Promise<readonly AiCommandUsage[]> {
  return requestJson(`/ai-command/usage/history?storeId=${encodeURIComponent(storeId)}&days=${days}`, {}, fetcher)
}
export function fetchAiCommandSaved(storeId: string, fetcher: Fetcher = fetch): Promise<readonly AiCommandSavedCommand[]> {
  return requestJson(`/ai-command/saved?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}
export function saveAiCommandCommand(storeId: string, name: string, commandText: string, fetcher: Fetcher = fetch): Promise<AiCommandSavedCommand> {
  return requestJson('/ai-command/saved', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, name, commandText }) }, fetcher)
}
export function deleteAiCommandSaved(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<Readonly<{ deleted: boolean }>> {
  return requestJson(`/ai-command/saved/${encodeURIComponent(id)}?storeId=${encodeURIComponent(storeId)}`, { method: 'DELETE' }, fetcher)
}
export function executeAiCommandSaved(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<ChatResult> {
  return requestJson(`/ai-command/saved/${encodeURIComponent(id)}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) }, fetcher)
}
export function fetchAiCommandPreferences(storeId: string, fetcher: Fetcher = fetch): Promise<AiCommandPreferences> {
  return requestJson(`/ai-command/preferences?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}
export function updateAiCommandPreferences(storeId: string, patch: Partial<AiCommandPreferences>, fetcher: Fetcher = fetch): Promise<AiCommandPreferences> {
  return requestJson('/ai-command/preferences', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, ...patch }) }, fetcher)
}
export function fetchAiCommandQuickCommands(storeId: string, fetcher: Fetcher = fetch): Promise<readonly AiCommandQuickCommand[]> {
  return requestJson(`/ai-command/quick-commands?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}
