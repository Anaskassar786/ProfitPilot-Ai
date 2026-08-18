import { useEffect, useState } from 'react'
import { fetchBilling } from './api.js'
import { AiCommandWorkspace, resolveAiCommandPlan } from './ai-command.js'
import { AiCommandMark } from './ai-command-logo.js'
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
      <div className="page-header">
        <div className="aic-page-title">
          <span className="aic-page-logo"><AiCommandMark size={30} variant="badge" /></span>
          <div>
            <div className="page-eyebrow">Universal command center</div>
            <h1>AI Command</h1>
            <p>One command controls everything. Answers come from live store data. Actions wait for your approval.</p>
          </div>
        </div>
      </div>
      <AiCommandWorkspace context={context} plan={plan} onToast={onToast} onNavigateBilling={onNavigateBilling} initialConversationId={conversationIdFromHash(window.location.hash)} />
    </div>
  )
}
