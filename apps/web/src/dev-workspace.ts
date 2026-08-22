/**
 * Developer / app-owner workspace detection.
 *
 * ProfitPilot ships a single bundle to every merchant, so operator-only
 * surfaces (Admin Ops) must be gated at render time. A workspace counts as a
 * developer workspace when:
 *
 *   1. The bundle is a Vite dev build (`import.meta.env.DEV`), i.e. local
 *      development — never true for the production bundle merchants load; or
 *   2. The connected shop domain matches `VITE_ADMIN_SHOP_DOMAIN`, a
 *      build-time env var the app owner sets to their own dev store
 *      (e.g. `profitpilot-dev.myshopify.com`). When the var is unset — the
 *      default for production builds — no merchant ever matches.
 *
 * This is a UI-visibility gate only. Real security for Admin Ops lives
 * server-side: every `/admin/*` route requires the `ADMIN_KEY` step-up token,
 * so hiding the menu is defense-in-depth, not the last line of defense.
 */

export type DevWorkspaceEnv = Readonly<{ DEV?: boolean; VITE_ADMIN_SHOP_DOMAIN?: string }>

function readViteEnv(): DevWorkspaceEnv {
  try {
    const meta = import.meta as ImportMeta & { env?: DevWorkspaceEnv }
    return meta.env ?? {}
  } catch {
    return {}
  }
}

/** Pure decision core — exported for tests; `isDeveloperWorkspace` binds it to the real Vite env. */
export function isDeveloperWorkspaceWith(env: DevWorkspaceEnv, context: Readonly<{ shop: string | null }>): boolean {
  if (env.DEV === true) return true
  const adminShop = typeof env.VITE_ADMIN_SHOP_DOMAIN === 'string' ? env.VITE_ADMIN_SHOP_DOMAIN.trim().toLowerCase() : ''
  if (adminShop.length > 0 && typeof context.shop === 'string' && context.shop.trim().toLowerCase() === adminShop) return true
  return false
}

export function isDeveloperWorkspace(context: Readonly<{ shop: string | null }>): boolean {
  return isDeveloperWorkspaceWith(readViteEnv(), context)
}
