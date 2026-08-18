import { ArrowLeft, ArrowRight, Boxes, Clock3, LockKeyhole, Mail, PackagePlus, ShoppingBag, ShoppingCart, Sparkles, Tag, Users, WandSparkles, X } from 'lucide-react'
import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import type { WorkflowTemplate } from './automation-model.js'
import { friendlyCategory, planBadgeClass, planBadgeLabel, setupLabel, templateToneClass } from './automation-helpers.js'

type TabKey =
  | 'All'
  | 'Sales & Growth'
  | 'Customer Experience'
  | 'Operations'
  | 'Inventory & Stock'
  | 'Revenue & Retention'
  | 'AI-Powered'

const TABS: Readonly<Array<{ key: TabKey; match: (template: WorkflowTemplate) => boolean }>> = [
  { key: 'All', match: () => true },
  { key: 'Sales & Growth', match: (template) => template.category === 'Marketing' },
  { key: 'Customer Experience', match: (template) => template.category === 'Customer' && template.minimumPlan !== 'commander' },
  { key: 'Operations', match: (template) => template.category === 'Operations' && template.minimumPlan !== 'commander' },
  { key: 'Inventory & Stock', match: (template) => template.category === 'Inventory' && template.minimumPlan !== 'commander' },
  { key: 'Revenue & Retention', match: (template) => template.category === 'Revenue' && template.minimumPlan !== 'commander' },
  { key: 'AI-Powered', match: (template) => template.minimumPlan === 'commander' },
]

export function TemplateGallery({
  templates,
  full = false,
  featured = false,
  onBack,
  onInstall,
  onUpgrade,
  onBrowseAll,
}: {
  templates: readonly WorkflowTemplate[]
  full?: boolean
  featured?: boolean
  onBack?: () => void
  onInstall: (template: WorkflowTemplate, name: string) => Promise<void>
  onUpgrade: () => void
  onBrowseAll?: () => void
}): JSX.Element {
  const [tab, setTab] = useState<TabKey>('All')
  const [preview, setPreview] = useState<WorkflowTemplate | null>(null)
  const [installing, setInstalling] = useState(false)
  const items = useMemo(() => templates.filter(TABS.find((t) => t.key === tab)?.match ?? (() => true)), [templates, tab])

  return (
    <section className={`automation-templates ${full ? 'full' : ''} ${featured ? 'featured' : ''}`}>
      <header className="automation-section-header">
        <div>
          {onBack && (
            <button className="automation-back" onClick={onBack}>
              <ArrowLeft size={16} /> Automations
            </button>
          )}
          <span className="automation-eyebrow">PROVEN STARTING POINTS</span>
          <h2>{full ? 'Automation templates' : 'Featured templates'}</h2>
          <p>
            {full
              ? 'Pick a proven automation, review how it works, then set it up in one click.'
              : 'Start with a proven, pre-built automation and customize it to fit your store.'}
          </p>
        </div>
        {featured && onBrowseAll && (
          <button className="browse-all-link" onClick={onBrowseAll}>
            Browse all templates <ArrowRight size={15} />
          </button>
        )}
      </header>

      {full && (
        <div className="template-tabs">
          {TABS.map(({ key }) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              {key}
            </button>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="automation-empty compact">
          <Sparkles size={26} />
          <h2>No templates in this category yet</h2>
          <p>Try another category, or build your automation from scratch.</p>
        </div>
      ) : (
        <div className={full ? 'template-gallery-grid' : 'template-strip'}>
          {items.slice(0, full ? items.length : featured ? 8 : 5).map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onPreview={() => setPreview(template)}
              onUpgrade={onUpgrade}
            />
          ))}
        </div>
      )}

      {preview && (
        <div className="automation-modal-backdrop">
          <div className="automation-modal template-preview">
            <button className="modal-close" onClick={() => setPreview(null)} aria-label="Close">
              <X size={18} />
            </button>
            <TemplateIcon template={preview} />
            <span className="template-category">{friendlyCategory(preview.category)}</span>
            <h2>{preview.name}</h2>
            <p>{preview.description}</p>

            <div className="template-impact">
              <strong>What it does for you</strong>
              <span>{preview.impact}</span>
            </div>

            <div className="template-flow-preview">
              <span>🎯 When this happens</span>
              <i />
              <span>❓ Check something</span>
              <i />
              <span>⚡ Then do this</span>
            </div>

            <div className="template-preview-meta">
              <span className="plan-badge">{planBadgeLabel(preview.minimumPlan)}</span>
              <span>{setupLabel(preview.complexity)}</span>
              <span>{preview.nodes} step{preview.nodes === 1 ? '' : 's'}</span>
            </div>

            <div className="template-preview-footer">
              <span className="template-required-note">
                {preview.locked ? 'This template needs a higher plan.' : 'Installs as a draft you can review.'}
              </span>
              {preview.locked ? (
                <button className="automation-primary" onClick={onUpgrade}>
                  <LockKeyhole size={15} /> Upgrade Plan
                </button>
              ) : (
                <button
                  className="automation-primary"
                  disabled={installing}
                  onClick={async () => {
                    setInstalling(true)
                    try {
                      await onInstall(preview, preview.name)
                      setPreview(null)
                    } finally {
                      setInstalling(false)
                    }
                  }}
                >
                  {installing ? 'Setting up…' : 'Set Up →'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function TemplateCard({
  template,
  onPreview,
  onUpgrade,
}: {
  template: WorkflowTemplate
  onPreview: () => void
  onUpgrade: () => void
}): JSX.Element {
  return (
    <article className={`template-card template-card-pro ${templateToneClass(template.category)} ${template.locked ? 'locked' : ''}`}>
      <button className="template-card-main" onClick={onPreview}>
        <span className="template-card-top">
          <TemplateIcon template={template} />
          <span className={`plan-badge template-plan-badge ${planBadgeClass(template.minimumPlan)}`}>{planBadgeLabel(template.minimumPlan)}</span>
        </span>
        <span className="template-category">{friendlyCategory(template.category)}</span>
        <h3 className="template-name">{template.name}</h3>
        <p className="template-description">{template.description}</p>
        <span className="template-impact-copy template-detail">{template.impact}</span>
      </button>
      <footer>
        <span className="setup-time template-meta">
          <Clock3 size={12} className="template-meta-icon" /> {setupLabel(template.complexity)} · {template.nodes} step{template.nodes === 1 ? '' : 's'}
        </span>
        {template.locked ? (
          <button className="upgrade-mini template-upgrade-btn" onClick={onUpgrade}>
            <LockKeyhole size={13} /> Upgrade Plan
          </button>
        ) : (
          <button className="set-up-mini template-setup-btn" onClick={onPreview}>
            Set Up <ArrowRight size={13} />
          </button>
        )}
      </footer>
    </article>
  )
}

function TemplateIcon({ template }: { template: WorkflowTemplate }): JSX.Element {
  const Icon =
    template.minimumPlan === 'commander'
      ? WandSparkles
      : template.category === 'Marketing'
        ? Mail
        : template.category === 'Customer'
          ? Users
          : template.category === 'Inventory'
            ? Boxes
            : template.category === 'Operations'
              ? PackagePlus
              : template.category === 'Revenue'
                ? Tag
                : ShoppingBag
  return (
    <span className="template-icon template-icon-wrap">
      <Icon size={20} className="template-icon-svg" />
      {template.locked && <LockKeyhole size={11} />}
    </span>
  )
}
