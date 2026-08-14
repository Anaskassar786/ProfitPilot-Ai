export const LEGAL_SLUGS = ['privacy', 'terms', 'security', 'cookies', 'dpa'] as const
export type LegalSlug = (typeof LEGAL_SLUGS)[number]

export type LegalConfig = Readonly<{
  entityName: string
  entityAddress: string
  jurisdiction: string
  supportEmail: string
}>

export type LegalSection = Readonly<{
  heading: string
  paragraphs: readonly string[]
  bullets?: readonly string[]
}>

export type LegalDocument = Readonly<{
  slug: LegalSlug
  title: string
  effectiveDate: string
  entityName: string
  jurisdiction: string
  supportEmail: string
  sections: readonly LegalSection[]
  physicalAddress: string
}>

export const LIABILITY_DISCLAIMER = 'ProfitPilot and its creators are not responsible for any losses, unexpected outcomes, or business decisions arising from the use of this AI-powered tool. All recommendations are advisory in nature. Final decisions and their consequences remain the sole responsibility of the merchant. Users acknowledge that AI systems may occasionally produce unexpected results, and merchants must review all actions before approval.'

type LegalEnv = Readonly<Record<string, string | undefined>>

export function legalConfigFromEnv(env: LegalEnv): LegalConfig {
  return {
    entityName: requiredLegalEnv(env, 'LEGAL_ENTITY_NAME'),
    entityAddress: requiredLegalEnv(env, 'LEGAL_ENTITY_ADDRESS'),
    jurisdiction: requiredLegalEnv(env, 'LEGAL_JURISDICTION'),
    supportEmail: validSupportEmail(requiredLegalEnv(env, 'SUPPORT_EMAIL')),
  }
}

export function legalDocument(slug: LegalSlug, config: LegalConfig, now = new Date()): LegalDocument {
  const effectiveDate = now.toISOString().slice(0, 10)
  const common = { entityName: config.entityName, supportEmail: config.supportEmail, jurisdiction: config.jurisdiction, physicalAddress: config.entityAddress }
  if (slug === 'privacy') return { ...common, slug, title: 'Privacy Policy', effectiveDate, sections: privacySections(config) }
  if (slug === 'terms') return { ...common, slug, title: 'Terms of Service', effectiveDate, sections: termsSections(config) }
  if (slug === 'security') return { ...common, slug, title: 'Security', effectiveDate, sections: securitySections(config) }
  if (slug === 'cookies') return { ...common, slug, title: 'Cookie Policy', effectiveDate, sections: cookieSections(config) }
  return { ...common, slug, title: 'Data Processing Addendum', effectiveDate, sections: dpaSections(config) }
}

export function legalDocuments(config: LegalConfig, now = new Date()): readonly LegalDocument[] {
  return LEGAL_SLUGS.map((slug) => legalDocument(slug, config, now))
}

export function legalBodyText(document: LegalDocument): string {
  return [document.title, ...document.sections.flatMap((section) => [section.heading, ...section.paragraphs, ...(section.bullets ?? [])]), document.entityName, document.physicalAddress, document.supportEmail].join('\n')
}

export function renderLegalHtml(document: LegalDocument): string {
  const sections = document.sections.map((section) => {
    const paragraphs = section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')
    const bullets = section.bullets && section.bullets.length > 0 ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>` : ''
    return `<section><h2>${escapeHtml(section.heading)}</h2>${paragraphs}${bullets}</section>`
  }).join('')
  const nav = LEGAL_SLUGS.map((slug) => `<a href="/legal/${slug}">${escapeHtml(slug.toUpperCase())}</a>`).join(' · ')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(document.title)} · ProfitPilot</title></head><body><header><nav aria-label="Legal pages">${nav}</nav><p>ProfitPilot legal information</p></header><main><h1>${escapeHtml(document.title)}</h1><p>Effective date: <time datetime="${escapeHtml(document.effectiveDate)}">${escapeHtml(document.effectiveDate)}</time></p>${sections}</main><footer><p><strong>${escapeHtml(document.entityName)}</strong><br>${escapeHtml(document.physicalAddress)}</p><p>Questions and data-rights requests: <a href="mailto:${escapeHtml(document.supportEmail)}">${escapeHtml(document.supportEmail)}</a></p><p><a href="/legal/privacy#california-rights">California privacy rights</a> · <a href="/legal/privacy#delete">Request deletion</a></p></footer></body></html>`
}

function privacySections(config: LegalConfig): readonly LegalSection[] {
  return [
    {
      heading: '1. Controller and scope',
      paragraphs: [`${config.entityName} operates ProfitPilot in ${config.jurisdiction}. This Privacy Policy explains how ProfitPilot processes merchant account, Shopify store, billing, support, automation, and product-usage information. It applies to merchants, team members, and visitors who use ProfitPilot.`],
    },
    {
      heading: '2. Information we process',
      paragraphs: ['We process account identifiers, store identifiers, Shopify installation metadata, encrypted access-token ciphertext, configuration choices, billing records, support messages, workflow and campaign settings, audit events, and technical request logs. Shopify data is synchronized only for an installed store and remains tenant-scoped.', 'ProfitPilot minimizes customer personal data. Customer data needed for a deterministic store rule is reduced to the fields required for that rule. Customer names, email addresses, phone numbers, postal addresses, and other direct identifiers are not sent to language-model providers.'],
      bullets: ['Information you provide during installation, billing, support, or merchant-email verification.', 'Information received from Shopify after the merchant authorizes the requested scopes.', 'Security and reliability signals such as request identifiers, rate-limit events, webhook receipts, and session rotation events.', 'Aggregated or derived metrics generated from real synchronized store records.'],
    },
    {
      heading: '3. Purposes and legal bases',
      paragraphs: ['We use information to authenticate users, synchronize and display authorized Shopify records, calculate deterministic recommendations, execute only approved actions, provide support, measure attribution, prevent abuse, maintain security, and comply with law. For people in the European Economic Area or United Kingdom, the legal bases are performance of a contract, legitimate interests in security and service improvement, consent where required, and legal obligation.'],
    },
    {
      heading: '4. AI and automated processing',
      paragraphs: ['ProfitPilot rules calculate numbers from store data. AI providers may receive minimized, non-PII evidence context only to phrase an explanation; AI does not create source numbers. Recommendations are not solely automated legal or similarly significant decisions. Merchants review every action before approval.'],
    },
    {
      heading: '5. Service providers and transfers',
      paragraphs: ['We use infrastructure and service providers for hosting, PostgreSQL storage, Redis-backed queues, Shopify APIs, transactional email, optional SMS, and language-model requests. Providers receive only the data necessary for their documented service. Where data leaves its original region, we use appropriate contractual and transfer safeguards required by applicable law.'],
    },
    {
      heading: '6. Retention and deletion',
      paragraphs: ['We retain records for the period needed to provide the service, meet accounting and legal duties, resolve disputes, and maintain security audit trails. A merchant may request deletion of personal data by contacting the support address. We will verify the request, delete or anonymize data that is not legally required, and instruct processors to do the same where applicable.'],
    },
    {
      heading: '7. GDPR rights',
      paragraphs: ['Subject to applicable exceptions, European users may request access, rectification, erasure, restriction, portability, objection, and withdrawal of consent. A request may be sent to the support address. You may also complain to your local supervisory authority.'],
    },
    {
      heading: '8. CCPA and CPRA rights',
      paragraphs: ['California residents may request to know, access, correct, or delete personal information, obtain a portable copy, and limit or opt out of certain uses where applicable. ProfitPilot does not sell personal information. We do not discriminate for exercising a privacy right. Use the support address or the California privacy-rights link below to submit a verifiable request.'],
    },
    {
      heading: '9. Contact and changes',
      paragraphs: [`Privacy questions, rights requests, and complaints may be sent to ${config.supportEmail}. We may update this policy when our processing changes; the effective date above identifies the current version.`],
    },
  ]
}

function termsSections(config: LegalConfig): readonly LegalSection[] {
  return [
    {
      heading: '1. Agreement and eligibility',
      paragraphs: [`These Terms govern access to ProfitPilot, operated by ${config.entityName} in ${config.jurisdiction}. By installing or using the service, the merchant confirms authority to bind the store and agrees to these Terms and the Privacy Policy.`],
    },
    {
      heading: '2. Service and merchant responsibility',
      paragraphs: ['ProfitPilot is an AI employee for Shopify operations. It monitors authorized data, detects deterministic signals, explains them, requests approval, executes approved actions, and measures outcomes. The merchant is responsible for lawful store operations, Shopify permissions, customer notices, pricing, inventory, communications, and review of every proposed action.'],
    },
    {
      heading: '3. Approvals, automation, and messaging',
      paragraphs: ['No recommendation or automation should be enabled without merchant review. The merchant must use lawful email and SMS consent practices, maintain suppression lists, provide unsubscribe controls, and supply an accurate physical address in commercial email footers. SMS features remain unavailable until TCPA-compliant opt-in, opt-out, sender identification, quiet hours, and consent records are configured.'],
    },
    {
      heading: '4. Fees, trials, and cancellation',
      paragraphs: ['Paid plans, annual pricing, trial limits, gift access, and renewal terms are shown at checkout. The merchant authorizes the applicable Shopify billing charge. Cancellation stops future billing according to the selected plan; accrued fees and legally required records remain due.'],
    },
    {
      heading: '5. Intellectual property and feedback',
      paragraphs: ['ProfitPilot, its software, documentation, trademarks, and design are owned by the operator or its licensors. The merchant retains rights in store data and grants only the limited license needed to provide the service. Feedback may be used to improve the service without identifying the merchant publicly.'],
    },
    {
      heading: '6. MANDATORY LIABILITY DISCLAIMER',
      paragraphs: [LIABILITY_DISCLAIMER],
    },
    {
      heading: '7. Availability, security, and termination',
      paragraphs: ['We work to maintain reliable, secure service but do not promise uninterrupted availability or error-free integrations. We may suspend access for abuse, security risk, non-payment, legal requirement, or a Shopify authorization change. On termination, the merchant may request export or deletion subject to retention duties.'],
    },
    {
      heading: '8. Governing law and contact',
      paragraphs: [`These Terms are governed by the laws and courts of ${config.jurisdiction}, subject to mandatory consumer protections. Questions about these Terms may be sent to ${config.supportEmail}.`],
    },
  ]
}

function securitySections(config: LegalConfig): readonly LegalSection[] {
  return [
    {
      heading: '1. Security commitments',
      paragraphs: [`${config.entityName} designs ProfitPilot around tenant isolation, least privilege, auditable actions, and data minimization. The service uses encrypted token storage, signed Shopify OAuth and webhook verification, rotating sessions, role-based permissions, race-safe compare-and-set writes, and idempotency ledgers.`],
    },
    {
      heading: '2. Application and infrastructure controls',
      paragraphs: ['Production requests receive strict content-security and transport-related headers, allow-listed CORS, endpoint rate limits, bounded JSON payloads, secure HttpOnly SameSite=Lax session cookies, CSRF checks for cookie-authenticated writes, redacted request logging, and sanitized error responses. Database access uses parameterized queries and PostgreSQL row-level security policies for tenant tables.'],
      bullets: ['JWT signatures, issuer, expiry, token kind, and active session state are verified.', 'Webhook HMAC signatures are checked before replay-safe receipt claims.', 'Access-token and refresh-token material is never written to application logs.', 'Role assignments and administrative changes produce an immutable access-review trail.'],
    },
    {
      heading: '3. Responsible disclosure',
      paragraphs: [`Report a suspected vulnerability privately to ${config.supportEmail}. Please include reproduction steps without sending live customer data or credentials. We will acknowledge a credible report and coordinate a safe response.`],
    },
    {
      heading: '4. Incident response',
      paragraphs: ['We investigate security events, contain affected credentials or sessions, preserve relevant audit evidence, and notify affected parties or regulators when required by applicable law. Merchants should immediately revoke suspicious Shopify sessions and rotate exposed credentials.'],
    },
    {
      heading: '5. Shared responsibility',
      paragraphs: ['Merchants must use strong administrator credentials, review permissions, protect their Shopify account, configure lawful messaging consent, and promptly notify us of unauthorized access. Security controls are not a guarantee against every threat.'],
    },
  ]
}

function cookieSections(config: LegalConfig): readonly LegalSection[] {
  return [
    {
      heading: '1. What cookies are used',
      paragraphs: ['ProfitPilot uses only cookies needed for secure sessions and request protection. The session cookie is HttpOnly, Secure in production, scoped to the application path, and SameSite=Lax. The CSRF double-submit cookie is readable by the application so a matching request header can be required for cookie-authenticated state changes.'],
      bullets: ['Strictly necessary session and refresh-rotation cookies.', 'Strictly necessary CSRF token cookie.', 'No advertising, cross-site profiling, or sale of cookie-derived personal information.'],
    },
    {
      heading: '2. Consent and controls',
      paragraphs: ['Necessary cookies do not require consent where local law permits them because the service cannot securely operate without them. Browser settings can delete or block cookies, but doing so may sign the merchant out or prevent protected actions.'],
    },
    {
      heading: '3. Third-party links',
      paragraphs: ['Shopify, support, payment, and provider pages may set their own cookies under their own policies. Review those policies before continuing to an external service.'],
    },
    {
      heading: '4. Contact',
      paragraphs: [`Cookie questions may be sent to ${config.supportEmail}.`],
    },
  ]
}

function dpaSections(config: LegalConfig): readonly LegalSection[] {
  return [
    {
      heading: '1. Roles and processing instructions',
      paragraphs: [`For merchant store and customer data, the merchant is the controller and ${config.entityName} is the processor, except where ${config.entityName} independently determines processing for security, billing, or legal compliance. We process data only to provide ProfitPilot, follow documented merchant instructions, and meet legal obligations.`],
    },
    {
      heading: '2. Processing details',
      paragraphs: ['The subject matter is Shopify store operations, analytics, recommendations, approved automations, support, billing, and security. The duration is the subscription term plus the retention period described in the Privacy Policy. Data types may include identifiers, transaction and catalog records, configuration, audit records, and limited customer attributes required for a merchant-approved rule. Data subjects may include the merchant, team members, customers, and store contacts.'],
    },
    {
      heading: '3. Confidentiality and security',
      paragraphs: ['Personnel and subprocessors are bound by confidentiality. Technical and organizational measures include encryption in transit and at rest where supported, token vaulting, least privilege, tenant-scoped access, RLS, signed requests, rate limiting, vulnerability response, backups, audit logs, and tested restoration procedures.'],
    },
    {
      heading: '4. Subprocessors',
      paragraphs: ['The merchant authorizes the use of infrastructure, database, queue, Shopify, transactional-email, optional SMS, and language-model providers required by enabled features. We remain responsible for processor instructions, maintain a current subprocessor record, and provide notice of material changes where required. Customer personal data is minimized before any AI explanation request.'],
    },
    {
      heading: '5. Assistance and data-subject requests',
      paragraphs: [`We will reasonably assist with access, correction, deletion, portability, security, and breach-response requests. The merchant remains responsible for responding to data subjects and verifying their identity. Send processor instructions or a deletion request to ${config.supportEmail}.`],
    },
    {
      heading: '6. Deletion and audit',
      paragraphs: ['At the end of the service, the merchant may request return or deletion of personal data, subject to legal retention and immutable security audit requirements. We will provide reasonable compliance information and cooperate with an audit that is proportionate, confidential, and does not compromise other tenants.'],
    },
    {
      heading: '7. International transfers and governing terms',
      paragraphs: [`International processing uses lawful transfer mechanisms where required. This Addendum is interpreted with the Privacy Policy and Terms under ${config.jurisdiction}; mandatory data-protection law prevails if inconsistent.`],
    },
  ]
}

function requiredLegalEnv(env: LegalEnv, key: string): string {
  const value = env[key]?.trim()
  if (!value) throw new Error(`Missing required legal environment variable ${key}`)
  return value
}

function validSupportEmail(value: string): string {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('SUPPORT_EMAIL must be a valid email address')
  return value
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
