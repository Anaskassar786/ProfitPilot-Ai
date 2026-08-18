import { useEffect, useState } from 'react'
import { fetchBilling } from './api.js'
import { AiCommandWorkspace, resolveAiCommandPlan } from './ai-command.js'
import { conversationIdFromHash } from './ai-command-model.js'
import type { AiCommandPlan } from './ai-command-model.js'
import type { WorkspaceContext } from './model.js'

export function AiCommandPage({ context, onToast, onNavigateBilling }: {
  context: WorkspaceContext
  onToast: (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void
  onNavigateBilling: () => void
}) {
  const [plan, setPlan] = useState<AiCommandPlan>('trial')
  useEffect(() => {
    if (!context.storeId) return
    void fetchBilling(context.storeId).then((account) => setPlan(resolveAiCommandPlan(account.subscription?.plan ?? 'trial'))).catch(() => setPlan('trial'))
  }, [context.storeId])
  return (
    <div className="page-content">
      <AiCommandWorkspace context={context} plan={plan} onToast={onToast} onNavigateBilling={onNavigateBilling} initialConversationId={conversationIdFromHash(window.location.hash)} />
    </div>
  )
}
