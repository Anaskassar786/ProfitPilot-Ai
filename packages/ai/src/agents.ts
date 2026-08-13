import type { AgentId, AgentStatus, RuleSignal, StoreSnapshot } from './domain.js'
import { AGENT_IDS } from './domain.js'

export type AgentPrompt = Readonly<{ id: AgentId; label: string; version: string; system: string }>

export const AGENT_PROMPTS: Readonly<Record<AgentId, AgentPrompt>> = {
  REVENUE_AGENT: { id: 'REVENUE_AGENT', label: 'Revenue Agent', version: '1.0.0', system: 'Explain revenue and sales signals using only the supplied evidence. Never calculate or invent numbers.' },
  INVENTORY_AGENT: { id: 'INVENTORY_AGENT', label: 'Inventory Agent', version: '1.0.0', system: 'Explain inventory signals using only the supplied evidence. Never invent stock, velocity, or dates.' },
  CUSTOMER_AGENT: { id: 'CUSTOMER_AGENT', label: 'Customer Agent', version: '1.0.0', system: 'Explain customer segments without names, emails, phones, or direct identifiers. Use only supplied evidence.' },
  PRICING_AGENT: { id: 'PRICING_AGENT', label: 'Pricing Agent', version: '1.0.0', system: 'Explain margin-aware pricing opportunities without introducing a number not present in evidence.' },
  CAMPAIGN_AGENT: { id: 'CAMPAIGN_AGENT', label: 'Campaign Agent', version: '1.0.0', system: 'Write concise, compliant campaign language. Do not send messages or invent performance claims.' },
  PRODUCT_AGENT: { id: 'PRODUCT_AGENT', label: 'Product Agent', version: '1.0.0', system: 'Explain catalog and cross-sell signals from evidence only. Do not alter product data.' },
  EXECUTIVE_AGENT: { id: 'EXECUTIVE_AGENT', label: 'Executive Agent', version: '1.0.0', system: 'Summarize the supplied store evidence for a merchant. Keep every number grounded.' },
}

export function agentStatuses(aiConfigured: boolean, enabledAgents: readonly AgentId[] = AGENT_IDS): readonly AgentStatus[] {
  return AGENT_IDS.map((id) => ({ id, label: AGENT_PROMPTS[id].label, promptVersion: AGENT_PROMPTS[id].version, enabled: enabledAgents.includes(id), execution: enabledAgents.includes(id) ? (aiConfigured ? 'READY' : 'UNCONFIGURED') : 'PAUSED', languageOnly: true as const }))
}

export function promptFor(signal: RuleSignal, snapshot: StoreSnapshot): Readonly<{ system: string; user: string }> {
  const agent = AGENT_PROMPTS[signal.agent]
  const evidence = signal.evidence.map((field) => `${field.label}: ${String(field.value)} [source: ${field.source}]`).join('\n')
  const user = `Decision title: ${signal.title}\nReason: ${signal.reason}\nImpact from deterministic rules: ${signal.impactValue} ${signal.currency}\nEvidence:\n${evidence}\nStore currency: ${snapshot.currency}\nRequest: explain this decision in plain language without adding numbers.`
  return { system: `${agent.system} Prompt version: ${agent.version}`, user }
}
