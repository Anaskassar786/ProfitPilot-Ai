/**
 * Deterministic voice intents for the floating Jarvis strip.
 * Chat lives in AI Command — Jarvis only handles store-related spoken asks
 * and, on Commander, a small set of safe actions.
 */

export type JarvisPlan = 'trial' | 'start' | 'growth' | 'commander'

export type JarvisWorkspacePage =
  | 'dashboard'
  | 'products'
  | 'orders'
  | 'customers'
  | 'inventory'
  | 'analytics'
  | 'automation'
  | 'recommendations'
  | 'billing'
  | 'settings'
  | 'ai-command'
  | 'reports'
  | 'exports'
  | 'support'
  | 'command-center'
  | 'store-coach'
  | 'ai-executive'
  | 'patternai'

export type JarvisVoiceIntent =
  | Readonly<{ type: 'navigate'; page: JarvisWorkspacePage }>
  | Readonly<{ type: 'create_automation'; templateId: string; name: string }>
  | Readonly<{ type: 'confirm' }>
  | Readonly<{ type: 'cancel' }>
  | Readonly<{ type: 'ask'; text: string }>

const PAGE_ALIASES: readonly Readonly<{ page: JarvisWorkspacePage; pattern: RegExp }>[] = [
  { page: 'products', pattern: /\b(products?|catalog|catalogue|inventory catalog|प्रोडक्ट)\b/i },
  { page: 'inventory', pattern: /\b(inventory|stock|stocks|इन्वेंटरी|स्टॉक)\b/i },
  { page: 'orders', pattern: /\b(orders?|ऑर्डर)\b/i },
  { page: 'customers', pattern: /\b(customers?|clients?|कस्टमर)\b/i },
  { page: 'analytics', pattern: /\b(analytics|reports? overview|एनालिटिक्स)\b/i },
  { page: 'automation', pattern: /\b(automation|workflow|ऑटोमेशन)\b/i },
  { page: 'recommendations', pattern: /\b(recommendations?|sifarish|सिफारिश)\b/i },
  { page: 'billing', pattern: /\b(billing|plans?|subscription|बिलिंग)\b/i },
  { page: 'settings', pattern: /\b(settings?|preferences|सेटिंग्स)\b/i },
  { page: 'ai-command', pattern: /\b(ai command|command center chat)\b/i },
  { page: 'dashboard', pattern: /\b(dashboard|home|होम|डैशबोर्ड)\b/i },
  { page: 'reports', pattern: /\b(business reports?|pdf reports?)\b/i },
  { page: 'exports', pattern: /\b(exports?)\b/i },
]

const NAVIGATE = /\b(take me|open|go to|show me the|le jao|le chalo|le jaao|खोलो|ले जाओ|ले चलो)\b/i
const CREATE_AUTOMATION = /\b(create|make|add|bana|banao|बना|बनाओ|बना दो)\b.*\b(automation|workflow|ऑटोमेशन)\b|\b(automation|workflow|ऑटोमेशन)\b.*\b(create|make|bana|banao|बना)\b/i
const PAGE_WALKTHROUGH = /\b(explain( this)? page|walk me through|what('?s| is).*(important|key).*(page|here)|brief( me)?|guide me|tell me about this page|is page pe kya|iss page pe kya|yahan kya|yahaan kya|samjhao|बताओ.*इंपोर्टेंट|समझाओ|इस पेज पर क्या)\b/i

/** Commander can navigate pages and take confirmed store actions. Lower plans only get spoken recommendations. */
export function canExecuteJarvisActions(plan: JarvisPlan): boolean {
  return plan === 'commander'
}

export function canNavigateWithJarvis(plan: JarvisPlan): boolean {
  return canExecuteJarvisActions(plan)
}

export function parseJarvisVoiceIntent(text: string): JarvisVoiceIntent {
  const query = text.trim()
  if (!query) return { type: 'ask', text: query }
  if (/^\s*(confirm|yes|yeah|yep|haan|ha|kar do|do it|go ahead|ok|okay|हाँ|हां|कर दो)\s*[.!]?\s*$/i.test(query)) return { type: 'confirm' }
  if (/^\s*(cancel|no|nope|nah|mat karo|stop that|रद्द|मत करो)\s*[.!]?\s*$/i.test(query)) return { type: 'cancel' }

  if (CREATE_AUTOMATION.test(query)) {
    const template = inferAutomationTemplate(query)
    return { type: 'create_automation', templateId: template.id, name: template.name }
  }

  if (NAVIGATE.test(query)) {
    const page = matchWorkspacePage(query)
    if (page) return { type: 'navigate', page }
  }

  return { type: 'ask', text: query }
}

export function wantsPageWalkthrough(text: string): boolean {
  return PAGE_WALKTHROUGH.test(text.trim())
}

export function matchWorkspacePage(text: string): JarvisWorkspacePage | null {
  for (const entry of PAGE_ALIASES) {
    if (entry.pattern.test(text)) return entry.page
  }
  return null
}

export function inferAutomationTemplate(text: string): Readonly<{ id: string; name: string }> {
  if (/\b(low.?stock|stockout|inventory alert|स्टॉक)\b/i.test(text)) return { id: 'low-stock-alert', name: 'Low-stock alert' }
  if (/\b(welcome|new customer)\b/i.test(text)) return { id: 'welcome-customer', name: 'Welcome new customer' }
  if (/\b(abandon|checkout|cart)\b/i.test(text)) return { id: 'abandoned-checkout', name: 'Abandoned checkout recovery' }
  if (/\b(win.?back|inactive)\b/i.test(text)) return { id: 'win-back', name: 'Win-back inactive customers' }
  if (/\b(thank|post.?purchase)\b/i.test(text)) return { id: 'post-purchase-thanks', name: 'Post-purchase thank you' }
  return { id: 'low-stock-alert', name: 'Low-stock alert' }
}

export function pageSpokenName(page: string): string {
  if (page === 'jarvis') return 'Jarvis'
  if (page === 'ai-command') return 'AI Command'
  if (page === 'ai-executive') return 'GrowthIQ'
  if (page === 'store-coach') return 'Store Coach'
  if (page === 'command-center') return 'AI Command Center'
  return page.replace(/-/g, ' ')
}

/** Strip protocol lines and markup so TTS reads naturally. */
export function spokenReplyText(text: string): string {
  return text
    .replace(/@jarvis:action\s*\{[\s\S]*$/g, '')
    .replace(/[*_`#]+/g, '')
    .replace(/[—–]/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** First-open spoken greeting. Jarvis then waits for the merchant to ask. */
export function jarvisStartupGreeting(addressing: string, language: 'en' | 'hi', now = new Date()): string {
  const hour = now.getHours()
  const time = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  if (language === 'hi') {
    return `Hello ${addressing}. ${time}. Main Jarvis hoon, aapka store assistant. Bataiye, main aapki kya madad karun?`
  }
  return `Hello ${addressing}. ${time}. I'm Jarvis, your store assistant. How can I help you today?`
}

export function isStartupGreeting(text: string): boolean {
  return /^hello\s+(sir|ma'?am|commander|miss)\b/i.test(text.trim())
}

/**
 * Language used for this spoken turn.
 * An explicit Hindi/English voice choice wins; Devanagari in the utterance can
 * still flip an English session to Hindi for that reply.
 */
export function resolveJarvisSpokenLanguage(preference: 'en' | 'hi' | 'auto' | undefined, transcript = ''): 'en' | 'hi' {
  if (preference === 'hi') return 'hi'
  if (/[\u0900-\u097F]/.test(transcript)) return 'hi'
  if (preference === 'en') return 'en'
  return /\b(kya|mujhe|dikhao|bhej|aaj|kal|chup|raho|batao|bataao)\b/i.test(transcript) ? 'hi' : 'en'
}

/** True when the heard phrase is substantial enough to interrupt Jarvis. */
export function isLikelyBargeIn(transcript: string): boolean {
  const clean = transcript.replace(/\s+/g, ' ').trim()
  if (clean.length < 8) return false
  if (/^(um+|uh+|ah+|hmm+|ha+|ok|okay|ya|mm+)\.?$/i.test(clean)) return false
  const words = clean.split(' ').filter(Boolean)
  return words.length >= 2 || clean.length >= 12
}

/** True when the mic likely heard Jarvis's own speech rather than the merchant. */
export function isEchoOfSpoken(heard: string, spoken: string | null | undefined): boolean {
  if (!spoken) return false
  const a = normalizeEcho(heard)
  const b = normalizeEcho(spoken)
  if (!a || !b) return false
  if (b.includes(a) || a.includes(b.slice(0, Math.min(a.length, 48)))) return true
  const heardWords = a.split(' ').filter((word) => word.length > 2)
  if (heardWords.length === 0) return false
  const spokenWords = new Set(b.split(' ').filter((word) => word.length > 2))
  let overlap = 0
  for (const word of heardWords) if (spokenWords.has(word)) overlap += 1
  return overlap / heardWords.length >= 0.7
}

function normalizeEcho(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u0900-\u097f\s]/g, ' ').replace(/\s+/g, ' ').trim()
}
