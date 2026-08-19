import { Archive, ArrowRight, BarChart3, Copy, History, MoreHorizontal, Pause, Pencil, Play, RotateCcw, Zap } from 'lucide-react'
import type { JSX } from 'react'
import { useState } from 'react'
import type { WorkflowRecord } from './automation-model.js'
import { categoryIcon, friendlyStartsWhen, friendlyStatus, relativeTime } from './automation-helpers.js'

export function WorkflowCard({
  workflow,
  onOpen,
  onCommand,
  onRename,
}: {
  workflow: WorkflowRecord
  onOpen: () => void
  onCommand: (command: 'run' | 'pause' | 'resume' | 'clone' | 'archive' | 'history') => void
  onRename?: (name: string) => Promise<void>
}): JSX.Element {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(workflow.name)
  const [busy, setBusy] = useState(false)
  const Icon = categoryIcon(workflow.category)
  const total = workflow.successCount + workflow.failureCount
  const rate = total ? Math.round((workflow.successCount / total) * 100) : null

  const neverRan = workflow.lastRunAt === null && workflow.successCount === 0 && workflow.failureCount === 0

  const startRename = (): void => {
    setDraftName(workflow.name)
    setRenaming(true)
  }

  const commitRename = async (): Promise<void> => {
    if (busy) return
    const next = draftName.trim()
    if (!next || next === workflow.name) {
      setRenaming(false)
      setDraftName(workflow.name)
      return
    }
    setBusy(true)
    try {
      await onRename?.(next)
      setRenaming(false)
    } catch {
      setRenaming(false)
      setDraftName(workflow.name)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={`automation-workflow-card workflow-card category-${workflow.category.toLowerCase()} status-${workflow.status.toLowerCase()} ${workflow.status.toLowerCase()}`}>
      <div className="workflow-card-topline">
        <button className="workflow-card-icon-btn" onClick={onOpen} aria-label={`Open ${workflow.name}`}>
          <span className="automation-category-icon workflow-icon-wrap"><Icon size={18} className="workflow-icon" /></span>
        </button>
        <div className="workflow-card-heading">
          <span className={`automation-status workflow-status-badge ${workflow.status.toLowerCase()}`}>{friendlyStatus(workflow.status)}</span>
          {renaming ? (
            <input
              className="workflow-name-input"
              autoFocus
              value={draftName}
              maxLength={120}
              disabled={busy}
              aria-label="Automation name"
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commitRename()
                else if (event.key === 'Escape') {
                  setRenaming(false)
                  setDraftName(workflow.name)
                }
              }}
              onBlur={() => void commitRename()}
            />
          ) : (
            <button className="workflow-name-button" onClick={startRename} title="Rename automation">
              <h3 className="workflow-name">{workflow.name}</h3>
              <Pencil size={12} className="workflow-name-edit-icon" aria-hidden="true" />
            </button>
          )}
          {workflow.description && <p>{workflow.description}</p>}
        </div>
      </div>
      <button className="workflow-card-body" onClick={onOpen}>
        <div className="workflow-trigger">
          <Zap size={15} className="workflow-trigger-icon" />
          <span>Starts when {friendlyStartsWhen(workflow.triggerSummary)}</span>
        </div>
        <div className="workflow-card-stats workflow-stats">
          <span className="workflow-stat"><strong className="workflow-stat-value">{workflow.nodeCount}</strong> step{workflow.nodeCount === 1 ? '' : 's'}</span>
          <span className="workflow-stat"><strong className="workflow-stat-value">{workflow.successCount}</strong> successful run{workflow.successCount === 1 ? '' : 's'}</span>
          {workflow.failureCount > 0 && (
            <span className="workflow-stat"><strong className="workflow-stat-value">{workflow.failureCount}</strong> with issue{workflow.failureCount === 1 ? '' : 's'}</span>
          )}
          {rate !== null && <span className="workflow-stat"><strong className="workflow-stat-value">{rate}%</strong> success rate</span>}
          <span className="workflow-stat">
            <strong className="workflow-stat-value">{workflow.lastRunAt ? relativeTime(workflow.lastRunAt) : 'Never'}</strong> last run
          </span>
        </div>
        {neverRan && (
          <div className="workflow-empty-hint">
            <Zap size={14} className="workflow-empty-hint-icon" />
            <span>This automation has not run yet. Activate it to start tracking results.</span>
            <ArrowRight size={14} className="workflow-empty-hint-arrow" aria-hidden="true" />
          </div>
        )}
      </button>
      <div className="workflow-card-actions workflow-actions">
        <button className="workflow-action-btn edit" onClick={onOpen}><Pencil size={15} /> Edit</button>
        <button className="workflow-action-btn view-report" onClick={() => onCommand('history')}><BarChart3 size={15} /> View Report</button>
        {workflow.status === 'ACTIVE' && (
          <button className="workflow-action-btn pause" onClick={() => onCommand('pause')}><Pause size={15} /> Pause</button>
        )}
        {workflow.status === 'PAUSED' && (
          <button className="workflow-action-btn resume" onClick={() => onCommand('resume')}><RotateCcw size={15} /> Resume</button>
        )}
        <div className="workflow-more workflow-more-menu">
          <button aria-label="More automation actions" onClick={() => setMenu((value) => !value)}>
            <MoreHorizontal size={17} />
          </button>
          {menu && (
            <div className="workflow-menu">
              {workflow.status === 'ACTIVE' && (
                <button
                  onClick={() => {
                    setMenu(false)
                    onCommand('run')
                  }}
                >
                  <Play size={15} /> Run Now
                </button>
              )}
              <button
                onClick={() => {
                  setMenu(false)
                  onCommand('clone')
                }}
              >
                <Copy size={15} /> Duplicate
              </button>
              <button
                onClick={() => {
                  setMenu(false)
                  onCommand('history')
                }}
              >
                <History size={15} /> Run history
              </button>
              <button
                className="danger"
                onClick={() => {
                  setMenu(false)
                  onCommand('archive')
                }}
              >
                <Archive size={15} /> Archive
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
