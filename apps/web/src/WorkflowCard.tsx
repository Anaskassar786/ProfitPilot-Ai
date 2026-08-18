import { Archive, BarChart3, Boxes, Copy, History, MoreHorizontal, Pause, Pencil, Play, RotateCcw, ShoppingBag, Tag, Users, Zap } from 'lucide-react'
import type { JSX } from 'react'
import { useState } from 'react'
import type { WorkflowRecord } from './automation-model.js'
import { friendlyStartsWhen, friendlyStatus, relativeTime } from './automation-helpers.js'

const icons = { Marketing: ShoppingBag, Operations: Boxes, Inventory: Boxes, Customer: Users, Revenue: Tag }

export function WorkflowCard({
  workflow,
  onOpen,
  onCommand,
}: {
  workflow: WorkflowRecord
  onOpen: () => void
  onCommand: (command: 'run' | 'pause' | 'resume' | 'clone' | 'archive' | 'history') => void
}): JSX.Element {
  const [menu, setMenu] = useState(false)
  const Icon = icons[workflow.category]
  const total = workflow.successCount + workflow.failureCount
  const rate = total ? Math.round((workflow.successCount / total) * 100) : null

  return (
    <article className={`automation-workflow-card category-${workflow.category.toLowerCase()}`}>
      <button className="workflow-card-body" onClick={onOpen}>
        <span className="automation-category-icon"><Icon size={18} /></span>
        <div className="workflow-card-heading">
          <span className={`automation-status ${workflow.status.toLowerCase()}`}>{friendlyStatus(workflow.status)}</span>
          <h3>{workflow.name}</h3>
          {workflow.description && <p>{workflow.description}</p>}
        </div>
        <div className="workflow-trigger">
          <Zap size={15} />
          <span>Starts when {friendlyStartsWhen(workflow.triggerSummary)}</span>
        </div>
        <div className="workflow-card-stats">
          <span><strong>{workflow.nodeCount}</strong> step{workflow.nodeCount === 1 ? '' : 's'}</span>
          <span><strong>{workflow.successCount}</strong> successful run{workflow.successCount === 1 ? '' : 's'}</span>
          {workflow.failureCount > 0 && (
            <span><strong>{workflow.failureCount}</strong> with issue{workflow.failureCount === 1 ? '' : 's'}</span>
          )}
          {rate !== null && <span><strong>{rate}%</strong> success rate</span>}
          <span>
            <strong>{workflow.lastRunAt ? relativeTime(workflow.lastRunAt) : 'Never'}</strong> last run
          </span>
        </div>
      </button>
      <div className="workflow-card-actions">
        <button onClick={onOpen}><Pencil size={15} /> Edit</button>
        <button onClick={() => onCommand('history')}><BarChart3 size={15} /> View Report</button>
        {workflow.status === 'ACTIVE' && (
          <button onClick={() => onCommand('pause')}><Pause size={15} /> Pause</button>
        )}
        {workflow.status === 'PAUSED' && (
          <button onClick={() => onCommand('resume')}><RotateCcw size={15} /> Resume</button>
        )}
        <div className="workflow-more">
          <button aria-label="More automation actions" onClick={() => setMenu((value) => !value)}>
            <MoreHorizontal size={17} />
          </button>
          {menu && (
            <div className="workflow-menu">
              {workflow.status === 'ACTIVE' && (
                <button onClick={() => onCommand('run')}><Play size={15} /> Run Now</button>
              )}
              <button onClick={() => onCommand('clone')}><Copy size={15} /> Duplicate</button>
              <button onClick={() => onCommand('history')}><History size={15} /> Run history</button>
              <button className="danger" onClick={() => onCommand('archive')}><Archive size={15} /> Archive</button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
