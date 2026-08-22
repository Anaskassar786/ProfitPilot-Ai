/**
 * Polaris-facing primitives used across the embedded app.
 * Buttons accept mixed icon+text children (the old Lucide pattern) and
 * render Shopify Polaris Button with an `icon` prop + string label.
 */
import { Children, forwardRef, isValidElement, useCallback, useEffect, useMemo, useState } from 'react'
import type { ButtonHTMLAttributes, MouseEvent, ReactElement, ReactNode } from 'react'
import {
  Banner,
  Box,
  Button as PolarisButton,
  EmptyState,
  Frame,
  Icon,
  InlineStack,
  Modal,
  Spinner,
  Text,
  Toast as PolarisToast,
  UnstyledButton,
} from '@shopify/polaris'
import type { BannerProps, ButtonProps as PolarisButtonProps, UnstyledButtonProps } from '@shopify/polaris'
import { SaveBar, TitleBar } from '@shopify/app-bridge-react'
import { embeddedHost, ensureEmbeddedAppBridgeRedirect, isEmbeddedShopifyApp } from './shopify-app-bridge.js'

export const EMPTY_STATE_IMAGE = 'https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png'

export type ToastKind = 'success' | 'info' | 'warning' | 'error'

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children)
  return ''
}

function firstElement(node: ReactNode): ReactElement | undefined {
  const found = Children.toArray(node).find((child) => isValidElement(child))
  return isValidElement(found) ? found : undefined
}

/**
 * Icon detection for mixed children: an icon is an element child that carries
 * NO text of its own. Textual elements (e.g. `<strong>Label</strong>`) are
 * content, not icons — treating them as the icon made Polaris render the same
 * text twice ("VIP Customer Tagging VIP Customer Tagging").
 */
function firstIconElement(node: ReactNode): ReactElement | undefined {
  const found = Children.toArray(node).find((child) => isValidElement(child) && nodeText(child).trim() === '')
  return isValidElement(found) ? found : undefined
}

function classList(className: string | undefined): string {
  return ` ${className ?? ''} `
}

// `variant`/`size` are omitted from the DOM attributes on purpose: React's
// ButtonHTMLAttributes now declares its own `variant?: 'primary' | 'breadcrumb'
// | null` (HTMLButtonElement) and a numeric `size`, which would intersect the
// Polaris unions and collapse them to `'primary'` / `never`.
export type UiButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'variant' | 'size'> & Readonly<{
  loading?: boolean
  variant?: PolarisButtonProps['variant']
  tone?: PolarisButtonProps['tone']
  size?: PolarisButtonProps['size']
  fullWidth?: boolean
  disclosure?: PolarisButtonProps['disclosure']
  icon?: PolarisButtonProps['icon']
  onClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined
  ref?: unknown
}>

export const UiButton = forwardRef<HTMLElement, UiButtonProps>(function UiButton({
  children,
  className,
  disabled,
  onClick,
  type,
  title,
  id,
  loading,
  variant,
  tone,
  size,
  fullWidth,
  disclosure,
  icon,
  ...rest
}, _ref) {
  const classes = classList(className)
  const resolvedVariant: PolarisButtonProps['variant'] = variant
    ?? (classes.includes(' primary ') || classes.includes(' approve ') ? 'primary'
      : classes.includes(' ghost ') || classes.includes(' text-button ') || classes.includes(' plain ') ? 'plain'
        : classes.includes(' icon-button ') || classes.includes(' tertiary ') ? 'tertiary'
          : 'secondary')
  const resolvedTone = tone
    ?? (classes.includes(' danger ') || classes.includes(' reject ') || classes.includes(' critical ') ? 'critical'
      : classes.includes(' success ') || classes.includes(' approve ') ? 'success'
        : undefined)
  const resolvedSize: PolarisButtonProps['size'] = size
    ?? (classes.includes(' sm ') || classes.includes(' slim ') || classes.includes(' btn-sm ') ? 'slim' : 'medium')
  const text = nodeText(children).replace(/\s+/g, ' ').trim()
  const iconChild = icon ?? firstIconElement(children) ?? (text ? undefined : firstElement(children))
  const accessibilityLabel = (rest['aria-label'] as string | undefined) ?? title ?? (text || undefined)
  const props: Record<string, unknown> = {
    variant: resolvedVariant,
    size: resolvedSize,
    disabled: Boolean(disabled),
    loading: Boolean(loading) || classes.includes(' loading ') || classes.includes(' spin '),
    submit: type === 'submit',
    fullWidth: Boolean(fullWidth) || classes.includes(' full-width ') || classes.includes(' full '),
    pressed: rest['aria-pressed'] === true || rest['aria-pressed'] === 'true',
  }
  if (id) props.id = id
  if (resolvedTone) props.tone = resolvedTone
  if (onClick) props.onClick = onClick
  if (accessibilityLabel) props.accessibilityLabel = accessibilityLabel
  if (disclosure !== undefined) props.disclosure = disclosure
  if (iconChild) props.icon = iconChild
  if (rest['aria-expanded'] !== undefined) props.ariaExpanded = rest['aria-expanded']
  if (rest['aria-controls']) props.ariaControls = rest['aria-controls']
  if (text) props.children = text
  return <PolarisButton {...(props as PolarisButtonProps)} />
})

/** Drop-in name used after the native button → Polaris Button migration. */
export const Button = UiButton

export type RichButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'> & Readonly<{
  type?: 'button' | 'submit'
  onClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined
}>

/**
 * Rich-content button for composite controls (filter tabs with counts,
 * locked-feature cards, template card bodies, sidebar composites). The regular
 * `Button` shim flattens children into an icon + string label, which destroys
 * multi-part content (e.g. `All Items` + count renders as `All Items All
 * Items27`). RichButton renders Polaris' `UnstyledButton` — a real, keyboard
 * accessible `<button>` — and passes `children` and `className` straight
 * through, so the page CSS keeps full control of the layout. Use the regular
 * `Button` for simple icon + short-label buttons.
 */
export const RichButton = forwardRef<HTMLButtonElement, RichButtonProps>(function RichButton({
  children,
  className,
  disabled,
  onClick,
  type,
  title,
  id,
  ...rest
}, ref) {
  const checked: 'true' | 'false' | undefined = rest['aria-checked'] === true || rest['aria-checked'] === 'true' ? 'true' : rest['aria-checked'] === false || rest['aria-checked'] === 'false' ? 'false' : undefined
  const buttonProps: Record<string, unknown> = {
    ref,
    id,
    className,
    submit: type === 'submit',
    disabled: Boolean(disabled),
    accessibilityLabel: rest['aria-label'] ?? title,
    role: rest['role'],
    ariaControls: rest['aria-controls'],
    ariaExpanded: rest['aria-expanded'] === true || rest['aria-expanded'] === 'true',
    ariaDescribedBy: rest['aria-describedby'],
    ariaChecked: checked,
    pressed: rest['aria-pressed'] === true || rest['aria-pressed'] === 'true',
    onClick,
    ...(rest as Record<string, unknown>),
  }
  return (
    <UnstyledButton {...(buttonProps as unknown as UnstyledButtonProps)}>
      {children}
    </UnstyledButton>
  )
})

export function PolarisEmpty({
  heading,
  description,
  action,
  onAction,
  secondaryAction,
}: Readonly<{
  heading: string
  description?: string
  action?: string
  onAction?: () => void
  secondaryAction?: BannerProps['secondaryAction']
}>) {
  return (
    <EmptyState
      heading={heading}
      image={EMPTY_STATE_IMAGE}
      {...(action && onAction ? { action: { content: action, onAction } } : {})}
      {...(secondaryAction ? { secondaryAction } : {})}
    >
      {description ? <p>{description}</p> : null}
    </EmptyState>
  )
}

export function PolarisErrorBanner({ title, children, onDismiss }: Readonly<{ title: string; children?: ReactNode; onDismiss?: () => void }>) {
  return (
    <Banner title={title} tone="critical" {...(onDismiss ? { onDismiss } : {})}>
      {typeof children === 'string' ? <p>{children}</p> : children}
    </Banner>
  )
}

export function showAppBridgeToast(message: string, kind: ToastKind = 'success'): void {
  try {
    const shopify = (window as unknown as { shopify?: { toast?: { show: (msg: string, opts?: { isError?: boolean; duration?: number }) => void } } }).shopify
    if (shopify?.toast?.show) {
      shopify.toast.show(message, { isError: kind === 'error', duration: 5000 })
      return
    }
  } catch {
    /* standalone / tests */
  }
  try {
    window.dispatchEvent(new CustomEvent('profitpilot:toast', { detail: { message, kind } }))
  } catch {
    /* jsdom */
  }
}

export function ToastHost() {
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null)
  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent).detail as { message?: string; kind?: ToastKind } | undefined
      if (detail?.message) setToast({ message: detail.message, kind: detail.kind ?? 'info' })
    }
    window.addEventListener('profitpilot:toast', onToast)
    return () => window.removeEventListener('profitpilot:toast', onToast)
  }, [])
  if (!toast) return null
  return (
    <PolarisToast
      content={toast.message}
      error={toast.kind === 'error'}
      onDismiss={() => setToast(null)}
      duration={5000}
    />
  )
}

export function AppFrame({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Frame>
      <ToastHost />
      {children}
    </Frame>
  )
}

/**
 * App Bridge v4 has no React Provider; the CDN script + meta tag boot the
 * global. This wrapper still accepts `forceRedirect` / `host` so the embedded
 * app bounces into Shopify admin when it is opened as a standalone page.
 */
export function AppBridgeProvider({
  children,
  forceRedirect = true,
  host,
}: Readonly<{ children: ReactNode; forceRedirect?: boolean; host?: string | null }>) {
  const resolvedHost = useMemo(() => host ?? (typeof window === 'undefined' ? null : embeddedHost(window.location.search)), [host])
  useEffect(() => {
    if (forceRedirect && resolvedHost) ensureEmbeddedAppBridgeRedirect()
  }, [forceRedirect, resolvedHost])
  return <>{children}</>
}

export const NAV_DESTINATIONS: readonly Readonly<{ label: string; destination: string; section: string }>[] = [
  { label: 'Dashboard', destination: '/', section: 'dashboard' },
  { label: 'AI Center', destination: '/command', section: 'command-center' },
  { label: 'Recommendations', destination: '/recommendations', section: 'recommendations' },
  { label: 'Automation', destination: '/automation', section: 'automation' },
  { label: 'Products', destination: '/products', section: 'products' },
  { label: 'Orders', destination: '/orders', section: 'orders' },
  { label: 'Customers', destination: '/customers', section: 'customers' },
  { label: 'Inventory', destination: '/inventory', section: 'inventory' },
  { label: 'Analytics', destination: '/analytics', section: 'analytics' },
  { label: 'Store Coach', destination: '/ai-growth-command/coach', section: 'store-coach' },
  { label: 'GrowthIQ', destination: '/ai-growth-command/growthiq', section: 'ai-executive' },
  { label: 'PatternAI', destination: '/ai-growth-command/patternai', section: 'patternai' },
  { label: 'AI Command', destination: '/ai-command', section: 'ai-command' },
  { label: 'Reports', destination: '/reports', section: 'reports' },
  { label: 'Exports', destination: '/exports', section: 'exports' },
  { label: 'Help & Support', destination: '/support', section: 'support' },
  { label: 'Billing', destination: '/billing', section: 'billing' },
  { label: 'Settings', destination: '/settings', section: 'settings' },
]

export function AppNavigationMenu({ onNavigate }: Readonly<{ onNavigate?: (section: string) => void }> = {}) {
  // App Bridge v4 reads `<ui-nav-menu>` and paints the links in the Shopify
  // admin sidebar. The element must stay in the DOM but never paint inside
  // the iframe — unknown custom elements otherwise render as raw inline
  // `<a>` text ("DashboardAI Command CenterRecommendations…").
  //
  // HOTFIX 3: plain anchors here hard-navigate the embedded iframe (full
  // reload + full bootstrap re-run on every admin-side tab click). Every
  // anchor now intercepts the click and routes CLIENT-SIDE via `onNavigate`
  // (SPA `history.pushState`), which App Bridge treats as in-app navigation:
  // the admin URL stays in sync without ever reloading the app.
  const intercept = (event: MouseEvent<HTMLAnchorElement>, section: string): void => {
    event.preventDefault()
    onNavigate?.(section)
  }
  return (
    <ui-nav-menu data-pp-app-bridge-nav="true" aria-hidden="true">
      <a href="/" rel="home" data-section="dashboard" onClick={(event) => intercept(event, 'dashboard')}>Dashboard</a>
      {NAV_DESTINATIONS.filter((item) => item.destination !== '/').map((item) => (
        <a key={item.destination} href={item.destination} data-section={item.section} onClick={(event) => intercept(event, item.section)}>{item.label}</a>
      ))}
    </ui-nav-menu>
  )
}

export function AppTitleBar({ title, children }: Readonly<{ title: string; children?: ReactNode }>) {
  return <TitleBar title={title}>{children}</TitleBar>
}

/** True once App Bridge has registered (upgraded) the `<ui-save-bar>` custom
 *  element. Before that, app-bridge-react's SaveBar calls `.show()`/`.hide()`
 *  on a plain HTMLElement and throws `TypeError: saveBar.hide is not a
 *  function`, which unmounts the entire page — the Settings page crashed to a
 *  blank screen whenever the CDN script was missing, blocked, or slow. */
function uiSaveBarDefined(): boolean {
  try {
    return typeof window !== 'undefined'
      && typeof window.customElements !== 'undefined'
      && window.customElements.get('ui-save-bar') !== undefined
  } catch {
    return false
  }
}

function useUiSaveBarAvailable(): boolean {
  const [available, setAvailable] = useState(uiSaveBarDefined)
  useEffect(() => {
    if (available) return
    let attempts = 0
    const timer = window.setInterval(() => {
      attempts += 1
      if (uiSaveBarDefined()) {
        setAvailable(true)
        window.clearInterval(timer)
        return
      }
      // Give the deferred CDN script ~10s; after that stay on the safe
      // Polaris fallback instead of risking a page crash.
      if (attempts >= 50) window.clearInterval(timer)
    }, 200)
    return () => window.clearInterval(timer)
  }, [available])
  return available
}

export function AppSaveBar({
  open,
  onSave,
  onDiscard,
  saving,
}: Readonly<{ open: boolean; onSave: () => void; onDiscard: () => void; saving?: boolean }>) {
  const nativeSaveBar = useUiSaveBarAvailable()
  if (!nativeSaveBar) {
    // No App Bridge (standalone dev, blocked/slow CDN, tests): a Polaris-native
    // sticky save bar keeps Save/Discard usable instead of crashing the page.
    if (!open) return null
    return (
      <div style={{ position: 'sticky', bottom: 8, zIndex: 40 }}>
        <Box
          background="bg-surface"
          shadow="500"
          borderWidth="025"
          borderRadius="300"
          padding="300"
        >
          <InlineStack gap="300" align="end" blockAlign="center">
            <UiButton onClick={onDiscard}>Discard</UiButton>
            <UiButton variant="primary" loading={Boolean(saving)} onClick={onSave}>Save</UiButton>
          </InlineStack>
        </Box>
      </div>
    )
  }
  return (
    <SaveBar open={open} id="profitpilot-save-bar">
      <UiButton variant="primary" loading={Boolean(saving)} onClick={onSave}>Save</UiButton>
      <UiButton onClick={onDiscard}>Discard</UiButton>
    </SaveBar>
  )
}

export function useEmbedded(): boolean {
  return useMemo(() => isEmbeddedShopifyApp(), [])
}

export function LoadingSpinner({ label = 'Loading' }: Readonly<{ label?: string }>) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }} role="status" aria-label={label}>
      <Spinner size="large" />
      <Text as="span" variant="bodySm">{label}</Text>
    </div>
  )
}

export function SimpleModal({
  open,
  title,
  onClose,
  primaryAction,
  secondaryActions,
  children,
}: Readonly<{
  open: boolean
  title: string
  onClose: () => void
  primaryAction?: { content: string; onAction: () => void; destructive?: boolean; loading?: boolean; disabled?: boolean }
  secondaryActions?: ReadonlyArray<{ content: string; onAction: () => void }>
  children: ReactNode
}>) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      {...(primaryAction ? { primaryAction } : {})}
      secondaryActions={secondaryActions ? [...secondaryActions] : [{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>{children}</Modal.Section>
    </Modal>
  )
}

export function ChartTokenColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export function useChartColors(): Readonly<{ brand: string; success: string; caution: string; critical: string; secondary: string; text: string; border: string }> {
  const read = useCallback(() => ({
    brand: ChartTokenColor('--p-color-bg-fill-brand', 'rgb(0, 128, 96)'),
    success: ChartTokenColor('--p-color-bg-fill-success', 'rgb(41, 132, 90)'),
    caution: ChartTokenColor('--p-color-bg-fill-warning', 'rgb(153, 107, 0)'),
    critical: ChartTokenColor('--p-color-bg-fill-critical', 'rgb(142, 31, 11)'),
    secondary: ChartTokenColor('--p-color-text-secondary', 'rgb(97, 97, 97)'),
    text: ChartTokenColor('--p-color-text', 'rgb(32, 34, 35)'),
    border: ChartTokenColor('--p-color-border', 'rgb(227, 227, 227)'),
  }), [])
  const [colors, setColors] = useState(read)
  useEffect(() => {
    setColors(read())
  }, [read])
  return colors
}

export { Icon, Spinner, Text, Banner, EmptyState, Modal, Frame }
