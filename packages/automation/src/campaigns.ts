import { AppError } from '@profitpilot/types'

export const CAMPAIGN_VARIABLES = ['customer.first_name', 'customer.lifetime_value', 'store.name', 'store.url', 'order.total', 'order.number', 'discount.code', 'discount.expires_at', 'unsubscribe.url', 'campaign.name', 'product.title'] as const
export type CampaignVariable = (typeof CAMPAIGN_VARIABLES)[number]
export type TemplateKind = 'EMAIL' | 'SMS'
export type CampaignTemplate = Readonly<{ id: string; storeId: string; name: string; kind: TemplateKind; subject: string; body: string; variables: readonly CampaignVariable[] }>
export type RenderContext = Readonly<Partial<Record<CampaignVariable, string | number>>>

export function compileTemplate(template: Omit<CampaignTemplate, 'variables'>): CampaignTemplate {
  const variables = [...new Set([...extractVariables(template.subject), ...extractVariables(template.body)])]
  const invalid = variables.filter((variable) => !isCampaignVariable(variable))
  const invalidVariable = invalid[0]
  if (invalidVariable) throw new AppError('VALIDATION_ERROR', `Invalid campaign variable: ${invalidVariable}`, 400, { variable: invalidVariable })
  if (template.kind === 'EMAIL' && !template.body.includes('{{unsubscribe.url}}')) throw new AppError('VALIDATION_ERROR', 'Email template must include {{unsubscribe.url}}', 400)
  return { ...template, variables: variables.filter(isCampaignVariable) }
}

export function renderTemplate(template: CampaignTemplate, context: RenderContext): Readonly<{ subject: string; body: string }> {
  const render = (value: string): string => value.replace(/\{\{([a-z0-9_.]+)\}\}/gi, (_full, variable: string) => { const replacement = context[variable as CampaignVariable]; if (replacement === undefined) throw new AppError('VALIDATION_ERROR', `Missing campaign variable: ${variable}`, 400, { variable }); return String(replacement) })
  return { subject: render(template.subject), body: render(template.body) }
}

export type AbVariant = Readonly<{ id: string; name: string; sends: number; opens: number; clicks: number; attributedRevenue: number }>
export type WinnerMetric = 'OPEN_RATE' | 'CLICK_RATE' | 'REVENUE'
export function chooseWinner(variants: readonly AbVariant[], metric: WinnerMetric, minimumSends = 50): AbVariant | null {
  const eligible = variants.filter((variant) => variant.sends >= minimumSends)
  if (eligible.length === 0) return null
  return [...eligible].sort((left, right) => metricValue(right, metric) - metricValue(left, metric) || left.id.localeCompare(right.id))[0] ?? null
}

function metricValue(variant: AbVariant, metric: WinnerMetric): number { if (metric === 'OPEN_RATE') return variant.sends === 0 ? 0 : variant.opens / variant.sends; if (metric === 'CLICK_RATE') return variant.sends === 0 ? 0 : variant.clicks / variant.sends; return variant.attributedRevenue }
function extractVariables(value: string): readonly string[] { return [...value.matchAll(/\{\{([a-z0-9_.]+)\}\}/gi)].map((match) => match[1] ?? '') }
function isCampaignVariable(value: string): value is CampaignVariable { return (CAMPAIGN_VARIABLES as readonly string[]).includes(value) }
