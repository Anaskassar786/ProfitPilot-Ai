import { Button } from './polaris-ui.js'
import '@xyflow/react/dist/style.css'
import { addEdge, Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState } from '@xyflow/react'
import type { Connection, Edge, Node, NodeProps } from '@xyflow/react'
import { ArrowLeft, Bell, BookOpen, Bot, Boxes, Check, Clock3, GitBranch, LayoutTemplate, Lightbulb, ListChecks, Mail, PackagePlus, Pencil, Play, Plus, Save, Search, ShieldCheck, ShoppingCart, SlidersHorizontal, Sparkles, Tag, Target, Trash2, UserRoundPlus, WandSparkles, X, XCircle } from './icons.js'
import type { LucideIcon } from './icons.js'
import { useCallback, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { updateAutomationWorkflow, workflowCommand } from './automation-api.js'
import type { AutomationUsage, WorkflowNode, WorkflowRecord } from './automation-model.js'
import { friendlyCron, friendlyNodeLabel, friendlyNodeSummary, friendlyStatus, friendlyTriggerLabel, relativeTime } from './automation-helpers.js'
import { HowItWorksModal } from './automation-tutorial.js'

type NodeKind = 'trigger' | 'condition' | 'filter' | 'action' | 'wait' | 'ai'
type NodeConfig = Record<string, string | number | boolean | null>
type LibraryItem = Readonly<{ group: string; kind: NodeKind; subtype: string; label: string; summary: string; icon: LucideIcon; config: NodeConfig; commander?: boolean }>

const LIBRARY: readonly LibraryItem[] = [
  { group: 'When this happens', kind: 'trigger', subtype: 'manual', label: 'Run on demand', summary: 'Starts when you click “Run”', icon: Play, config: { trigger: 'manual' } },
  { group: 'When this happens', kind: 'trigger', subtype: 'cron', label: 'On a schedule', summary: 'Runs at a time you choose', icon: Clock3, config: { trigger: 'cron', cron: '0 9 * * 1' } },
  { group: 'When this happens', kind: 'trigger', subtype: 'orders/create', label: 'New order received', summary: 'Starts when a customer places an order', icon: PackagePlus, config: { trigger: 'shopify_webhook', topic: 'orders/create' } },
  { group: 'When this happens', kind: 'trigger', subtype: 'customers/create', label: 'New customer signed up', summary: 'Starts when a new customer joins your store', icon: UserRoundPlus, config: { trigger: 'shopify_webhook', topic: 'customers/create' } },
  { group: 'When this happens', kind: 'trigger', subtype: 'checkouts/create', label: 'Cart abandoned', summary: 'Starts when someone leaves a cart', icon: ShoppingCart, config: { trigger: 'shopify_webhook', topic: 'checkouts/create' } },
  { group: 'When this happens', kind: 'trigger', subtype: 'inventory_levels/update', label: 'Stock level changed', summary: 'Starts when your inventory changes', icon: PackagePlus, config: { trigger: 'shopify_webhook', topic: 'inventory_levels/update' } },

  { group: 'Check something', kind: 'condition', subtype: 'order-total', label: 'Check order value', summary: 'Only continues when the order matches', icon: GitBranch, config: { field: 'order.total', operator: 'greater_than', value: 100 } },
  { group: 'Check something', kind: 'condition', subtype: 'customer', label: 'Check customer details', summary: 'Only continues when the customer matches', icon: ListChecks, config: { field: 'customer.id', operator: 'exists', value: true } },
  { group: 'Check something', kind: 'condition', subtype: 'inventory', label: 'Check stock level', summary: 'Only continues when inventory matches', icon: Boxes, config: { field: 'inventory.available', operator: 'less_than', value: 10 } },
  { group: 'Check something', kind: 'filter', subtype: 'filter', label: 'Only continue if…', summary: 'Stop unless a condition is true', icon: ShieldCheck, config: { field: 'customer.id', operator: 'exists', value: true } },

  { group: 'Do something', kind: 'action', subtype: 'email', label: 'Send email', summary: 'Send a message to your customer', icon: Mail, config: { action: 'email', templateId: '', maxRecipients: 1 } },
  { group: 'Do something', kind: 'action', subtype: 'tag_customer', label: 'Add customer tag', summary: 'Label a customer (e.g. VIP)', icon: Tag, config: { action: 'tag_customer', tag: 'VIP', operation: 'add' } },
  { group: 'Do something', kind: 'action', subtype: 'create_discount', label: 'Create discount code', summary: 'Give customers a discount', icon: Sparkles, config: { action: 'create_discount', amount: 10, usageLimit: 100 } },
  { group: 'Do something', kind: 'action', subtype: 'internal_notification', label: 'Notify you', summary: 'Send yourself an alert', icon: Bell, config: { action: 'internal_notification', message: 'Your automation needs attention.' } },
  { group: 'Do something', kind: 'action', subtype: 'update_inventory', label: 'Update stock levels', summary: 'Adjust how much you have in stock', icon: PackagePlus, config: { action: 'update_inventory', adjustment: 1 } },

  { group: 'Wait', kind: 'wait', subtype: 'wait', label: 'Wait for time', summary: 'Pause for minutes, hours, or days', icon: Clock3, config: { delayMs: 3_600_000 } },

  { group: 'AI-Powered', kind: 'ai', subtype: 'classify', label: 'Smart classification', summary: 'Sort customers or inventory automatically', icon: Bot, config: { operation: 'classify_customer' }, commander: true },
  { group: 'AI-Powered', kind: 'ai', subtype: 'generate', label: 'Generate content', summary: 'Draft helpful messages for you', icon: WandSparkles, config: { operation: 'generate_content' }, commander: true },
  { group: 'AI-Powered', kind: 'ai', subtype: 'predict', label: 'Predict outcomes', summary: 'Spot at-risk customers early', icon: Bot, config: { operation: 'predict_churn' }, commander: true },
]

const LIBRARY_GROUPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'When this happens', label: '🎯 When this happens' },
  { key: 'Check something', label: '❓ Check something' },
  { key: 'Do something', label: '⚡ Do something' },
  { key: 'Wait', label: '⏳ Wait' },
  { key: 'AI-Powered', label: '🤖 AI-Powered' },
]

const KIND_HEADERS: Readonly<Record<NodeKind, string>> = {
  trigger: 'WHEN',
  condition: 'IF',
  filter: 'IF',
  action: 'DO',
  wait: 'WAIT',
  ai: 'AI',
}

type CanvasData = { label: string; summary: string; kind: NodeKind; config: NodeConfig; invalid?: boolean }
type CanvasNode = Node<CanvasData>

const nodeTypes = { automationNode: AutomationCanvasNode }

export function WorkflowEditor(props: {
  storeId: string
  workflow: WorkflowRecord
  usage: AutomationUsage
  onBack: () => void
  onTemplates?: () => void
  onSaved: (workflow: WorkflowRecord) => void
  onRun: (runId: string) => void
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void
}): JSX.Element {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  )
}

function EditorInner({
  storeId,
  workflow,
  usage,
  onBack,
  onTemplates,
  onSaved,
  onRun,
  onToast,
}: {
  storeId: string
  workflow: WorkflowRecord
  usage: AutomationUsage
  onBack: () => void
  onTemplates?: () => void
  onSaved: (workflow: WorkflowRecord) => void
  onRun: (runId: string) => void
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void
}): JSX.Element {
  const initialNodes = useMemo(() => workflow.nodes.map((node, index) => toCanvasNode(node, index)), [workflow.id])
  const initialEdges = useMemo<Edge[]>(
    () =>
      workflow.nodes.flatMap((node) =>
        node.next.map((target, index) => ({
          id: `${node.id}-${target}-${index}`,
          source: node.id,
          target,
          ...(node.type === 'condition' ? { sourceHandle: index === 0 ? 'yes' : 'no' } : {}),
        })),
      ),
    [workflow.id],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple')
  const [selected, setSelected] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ group: string | null; replaceId: string | null } | null>(null)
  const [howOpen, setHowOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(workflow.name)
  const [renamingBusy, setRenamingBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [search, setSearch] = useState('')
  const [errors, setErrors] = useState<readonly string[]>([])
  const commander = usage.plan === 'commander'
  const selectedNode = nodes.find((node) => node.id === selected) ?? null

  const connect = useCallback((connection: Connection) => setEdges((items) => addEdge({ ...connection, id: `${connection.source}-${connection.target}-${Date.now()}` }, items)), [setEdges])

  const addNode = (item: LibraryItem, position: { x: number; y: number } | null = null): void => {
    if (item.kind === 'ai' && !commander) {
      onToast('AI steps are available with an upgraded subscription.', 'info')
      return
    }
    if (item.kind === 'trigger' && nodes.some((node) => node.data.kind === 'trigger')) {
      onToast('This automation already has a starting point. Use “Change” to switch it.', 'info')
      return
    }
    const id = `${item.kind}-${crypto.randomUUID().slice(0, 8)}`
    // Position the new node in a deterministic, non-stacking grid so rapid
    // clicks don't overlap each other on the canvas. The setter callback form
    // is used so we get the current node count, not the stale closure value.
    setNodes((items) => [
      ...items,
      {
        id,
        type: 'automationNode',
        position: position ?? { x: 220 + (items.length % 8) * 36, y: 120 + Math.floor(items.length / 8) * 70 },
        data: { label: item.label, summary: item.summary, kind: item.kind, config: { ...item.config } },
      },
    ])
    setSelected(id)
  }

  const pickLibraryItem = (item: LibraryItem, replaceId: string | null): void => {
    if (item.kind === 'ai' && !commander) {
      onToast('AI steps are available with an upgraded subscription.', 'info')
      return
    }
    if (item.kind === 'trigger') {
      if (replaceId) {
        setNodes((items) =>
          items.map((node) =>
            node.id === replaceId
              ? { ...node, data: { ...node.data, kind: item.kind, label: item.label, summary: item.summary, config: { ...item.config } } }
              : node,
          ),
        )
        setSelected(replaceId)
        setPicker(null)
        return
      }
      if (nodes.some((node) => node.data.kind === 'trigger')) {
        onToast('This automation already has a starting point. Use “Change” to switch it.', 'info')
        return
      }
    }
    addNode(item)
    setPicker(null)
  }

  const serialize = (): readonly WorkflowNode[] => {
    if (mode === 'simple') {
      // Guided mode keeps a simple linear recipe: the next step runs after the
      // current one. Checks only continue when they pass; otherwise the run ends.
      return nodes.map((node, index) => {
        const next = nodes[index + 1]
        return {
          id: node.id,
          type: node.data.kind as WorkflowNode['type'],
          config: (node.data.config ?? {}) as WorkflowNode['config'],
          next: next ? [next.id] : [],
          position: node.position,
        }
      })
    }
    return nodes.map((node) => {
      const outgoing = edges.filter((edge) => edge.source === node.id).sort((a, b) => handleOrder(a.sourceHandle) - handleOrder(b.sourceHandle))
      return { id: node.id, type: node.data.kind as WorkflowNode['type'], config: (node.data.config ?? {}) as WorkflowNode['config'], next: outgoing.map((edge) => edge.target), position: node.position }
    })
  }

  const validate = (): boolean => {
    const result: string[] = []
    if (nodes.filter((node) => node.data.kind === 'trigger').length !== 1) result.push('Choose one starting point (When this happens).')
    if (nodes.length > 50) result.push('An automation can have up to 50 steps.')
    for (const node of nodes) {
      const outgoing = edges.filter((edge) => edge.source === node.id)
      if ((node.data.kind === 'condition' || node.data.kind === 'filter') && outgoing.length === 0) {
        result.push(`“${node.data.label}” needs to connect to the next step.`)
      }
      if (node.data.kind === 'action' && node.data.config?.action === 'email' && !String(node.data.config?.templateId ?? '').trim()) {
        result.push('Choose a verified email template before activating.')
      }
    }
    setErrors(result)
    setNodes((items) =>
      items.map((node) => ({
        ...node,
        data: { ...node.data, invalid: result.some((message) => message.includes(String(node.data.label))) },
      })),
    )
    return result.length === 0
  }

  const save = async (publish = false): Promise<void> => {
    // Even saving as a draft must keep a trigger — without one the workflow is
    // unsaveable garbage that confuses the merchant when they come back later.
    // We surface the same validation error toast that publish uses, so the
    // user gets a clear "add a starting point" message instead of a 400 from
    // the server with the same info but in JSON form.
    if (nodes.length === 0 || !nodes.some((node) => node.data.kind === 'trigger')) {
      onToast('Add a starting point (When this happens) before saving.', 'info')
      return
    }
    if (publish && !validate()) return
    setSaving(true)
    try {
      let updated = await updateAutomationWorkflow(storeId, workflow.id, { nodes: serialize() })
      if (publish) updated = (await workflowCommand(storeId, workflow.id, 'activate')) as WorkflowRecord
      onSaved(updated)
      onToast(publish ? 'Your automation is live.' : 'Draft saved.', 'success')
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : 'Your automation could not be saved.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const test = async (): Promise<void> => {
    if (!validate()) return
    setTesting(true)
    try {
      await updateAutomationWorkflow(storeId, workflow.id, { nodes: serialize() })
      const run = (await workflowCommand(storeId, workflow.id, 'test', { context: { test: true } })) as { id: string }
      onToast('Test started — no real actions will be taken.', 'success')
      onRun(run.id)
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : 'Test could not be started.', 'error')
    } finally {
      setTesting(false)
    }
  }

  const updateConfig = (key: string, value: string | number | boolean): void =>
    setNodes((items) =>
      items.map((node) =>
        node.id === selected
          ? { ...node, data: { ...node.data, config: { ...node.data.config, [key]: value }, summary: friendlyNodeSummary({ type: node.data.kind, config: { ...node.data.config, [key]: value } }) } }
          : node,
      ),
    )

  const replaceConfig = (config: NodeConfig): void =>
    setNodes((items) =>
      items.map((node) =>
        node.id === selected
          ? { ...node, data: { ...node.data, config, summary: friendlyNodeSummary({ type: node.data.kind, config }) } }
          : node,
      ),
    )

  const removeNodeById = (id: string | null): void => {
    if (!id) return
    setNodes((items) => items.filter((node) => node.id !== id))
    setEdges((items) => items.filter((edge) => edge.source !== id && edge.target !== id))
    setSelected(null)
  }

  const commitRename = async (): Promise<void> => {
    if (renamingBusy) return
    const next = draftName.trim()
    if (!next || next === workflow.name) {
      setRenaming(false)
      setDraftName(workflow.name)
      return
    }
    setRenamingBusy(true)
    try {
      const updated = await updateAutomationWorkflow(storeId, workflow.id, { name: next })
      onSaved(updated)
      onToast('Automation renamed.', 'success')
      setRenaming(false)
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : 'Automation could not be renamed.', 'error')
    } finally {
      setRenamingBusy(false)
    }
  }

  const triggerNode = nodes.find((node) => node.data.kind === 'trigger') ?? null
  const checkNodes = nodes.filter((node) => node.data.kind === 'condition' || node.data.kind === 'filter')
  const waitNodes = nodes.filter((node) => node.data.kind === 'wait')
  const doNodes = nodes.filter((node) => node.data.kind === 'action' || node.data.kind === 'ai')

  return (
    <div className="workflow-editor">
      <header className="editor-topbar">
        <Button onClick={onBack}>
          <ArrowLeft size={16} /> Automations
        </Button>
        <div className="editor-title">
          {renaming ? (
            <input
              className="editor-name-input"
              autoFocus
              value={draftName}
              maxLength={120}
              disabled={renamingBusy}
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
            <Button
              className="editor-name-button"
              title="Rename automation"
              onClick={() => {
                setDraftName(workflow.name)
                setRenaming(true)
              }}
            >
              <strong>{workflow.name}</strong>
              <Pencil size={13} aria-hidden="true" />
            </Button>
          )}
          <span>
            {friendlyStatus(workflow.status)}
            {workflow.status === 'ACTIVE' ? ' · live' : workflow.status === 'DRAFT' ? ' · not active yet' : ''} · updated {relativeTime(workflow.updatedAt)}
          </span>
        </div>
        <div className="editor-top-actions">
          <Button className="mode-toggle" onClick={() => {
            // Going from advanced (free-form graph) to simple (linear recipe) can
            // silently drop YES/NO branches the merchant drew. Ask before
            // throwing that work away — going the other way is always safe.
            if (mode === 'advanced') {
              const hasCondition = nodes.some((node) => node.data.kind === 'condition')
              const hasNoBranch = edges.some((edge) => edge.sourceHandle === 'no')
              if (hasCondition && hasNoBranch) {
                const proceed = window.confirm('Switching to Simple mode will collapse the YES/NO branching you built in Advanced. Continue?')
                if (!proceed) return
              }
            }
            setMode((value) => (value === 'simple' ? 'advanced' : 'simple'))
          }} title="Toggle guided or full editor">
            {mode === 'simple' ? <SlidersHorizontal size={15} /> : <Sparkles size={15} />}
            {mode === 'simple' ? 'Switch to Advanced' : 'Back to Simple'}
          </Button>
          <Button disabled={saving} onClick={() => void save(false)}>
            <Save size={15} /> {saving ? 'Saving…' : 'Save Draft'}
          </Button>
          <Button disabled={testing} onClick={() => void test()}>
            <Play size={15} /> {testing ? 'Starting…' : 'Test Run'}
          </Button>
          <Button className="publish" disabled={saving} onClick={() => void save(true)}>
            <Check size={15} /> {workflow.status === 'ACTIVE' ? 'Save Changes' : 'Save & Activate'}
          </Button>
        </div>
      </header>

      {mode === 'simple' ? (
        <div className="simple-editor">
          <div className="simple-steps">
            <div className="simple-intro">
              <span className="automation-eyebrow">GUIDED MODE</span>
              <h2>Build your automation step by step</h2>
              <p>
                {workflow.status === 'ACTIVE'
                  ? `“${workflow.name}” is live. Edit any step below — changes apply when you save.`
                  : `Set up “${workflow.name}” — start with a starting point, then add checks, waits, and actions.`}
              </p>
            </div>

            <SimpleGroup
              step={1}
              title="When this happens"
              hint="Choose what starts your automation"
              nodes={triggerNode ? [triggerNode] : []}
              onSelect={(id) => setSelected(id)}
              onChange={(id) => setPicker({ group: 'When this happens', replaceId: id })}
              onRemove={removeNodeById}
              selected={selected}
            />
            <SimpleConnector />
            <SimpleGroup
              step={2}
              title="Check something"
              hint="Optional — only run when it makes sense"
              nodes={checkNodes}
              onSelect={(id) => setSelected(id)}
              onRemove={removeNodeById}
              selected={selected}
            />
            <SimpleConnector />
            <SimpleGroup
              step={3}
              title="Wait for time"
              hint="Optional — pause before the next step"
              nodes={waitNodes}
              onSelect={(id) => setSelected(id)}
              onRemove={removeNodeById}
              selected={selected}
            />
            <SimpleConnector />
            <SimpleGroup
              step={4}
              title="Then do this"
              hint="What your automation does for you"
              nodes={doNodes}
              onSelect={(id) => setSelected(id)}
              onRemove={removeNodeById}
              selected={selected}
            />

            <Button className="simple-add-step" onClick={() => setPicker({ group: null, replaceId: null })}>
              <Plus size={17} /> Add Step
            </Button>

            {errors.length > 0 && (
              <div className="simple-validation">
                <XCircle size={16} />
                <div>
                  <strong>Resolve before activating</strong>
                  {errors.map((error) => (
                    <span key={error}>{error}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="simple-footer-actions">
              <Button className="automation-secondary" disabled={saving} onClick={() => void save(false)}>
                <Save size={15} /> {saving ? 'Saving…' : 'Save Draft'}
              </Button>
              <Button className="automation-primary" disabled={saving} onClick={() => void save(true)}>
                <Check size={15} /> {workflow.status === 'ACTIVE' ? 'Save Changes' : 'Save & Activate'}
              </Button>
            </div>
          </div>

          <aside className="simple-panel">
            <EditorPanel
              selectedNode={selectedNode}
              update={updateConfig}
              replace={replaceConfig}
              onRemove={() => removeNodeById(selected)}
              onClear={() => setSelected(null)}
              onHow={() => setHowOpen(true)}
              onTemplates={onTemplates}
            />
          </aside>
        </div>
      ) : (
        <div className="editor-workspace">
          <aside className="node-library">
            <h2>Step library</h2>
            <label>
              <Search size={14} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search steps" />
            </label>
            {LIBRARY_GROUPS.map((group) => (
              <section key={group.key}>
                <h3>
                  {group.label}
                  {group.key === 'AI-Powered' && !commander && <span>Commander only</span>}
                </h3>
                {LIBRARY.filter(
                  (item) =>
                    item.group === group.key &&
                    (item.label.toLowerCase().includes(search.toLowerCase()) || item.summary.toLowerCase().includes(search.toLowerCase())),
                ).map((item) => {
                  const Icon = item.icon
                  const locked = item.kind === 'ai' && !commander
                  return (
                    <Button
                      draggable={!locked}
                      title={item.summary}
                      onDragStart={(event) => event.dataTransfer.setData('application/profitpilot-node', JSON.stringify(item))}
                      onClick={() => (locked ? onToast('Upgrade Plan to use AI steps.', 'info') : addNode(item))}
                      className={locked ? 'locked' : ''}
                      key={`${group.key}-${item.subtype}`}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                      {locked && <ShieldCheck size={13} />}
                    </Button>
                  )
                })}
              </section>
            ))}
          </aside>
          <main
            className="flow-canvas"
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(event) => {
              event.preventDefault()
              try {
                const item = JSON.parse(event.dataTransfer.getData('application/profitpilot-node')) as LibraryItem
                addNode(item, { x: event.clientX - 330, y: event.clientY - 150 })
              } catch {
                /* ignore foreign drops */
              }
            }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={connect}
              onNodeClick={(_event, node) => setSelected(node.id)}
              fitView
              deleteKeyCode={['Backspace', 'Delete']}
              onNodesDelete={(deleted) => {
                // Block deletion of the trigger — without one, the workflow
                // can't run. We silently keep the trigger and remove any
                // other nodes the user asked to delete, instead of letting
                // the merchant break their own automation with a key press.
                const deletingTrigger = deleted.some((node) => node.data.kind === 'trigger')
                if (deletingTrigger) {
                  onToast('The starting point cannot be removed. Change it instead.', 'info')
                  const deletable = deleted.filter((node) => node.data.kind !== 'trigger')
                  if (deletable.length === 0) return
                  const ids = new Set(deletable.map((node) => node.id))
                  setNodes((items) => items.filter((node) => !ids.has(node.id)))
                  setEdges((items) => items.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)))
                  return
                }
                const ids = new Set(deleted.map((node) => node.id))
                setEdges((items) => items.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)))
              }}
            >
              <Background gap={24} size={1} />
              <Controls />
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) =>
                  node.data.kind === 'trigger' ? 'rgb(34, 197, 94)' : node.data.kind === 'condition' ? 'rgb(245, 158, 11)' : node.data.kind === 'ai' ? 'rgb(168, 85, 247)' : 'rgb(59, 130, 246)'
                }
              />
            </ReactFlow>
            {errors.length > 0 && (
              <div className="editor-validation">
                <XCircle size={16} />
                <div>
                  <strong>Resolve before activating</strong>
                  {errors.map((error) => (
                    <span key={error}>{error}</span>
                  ))}
                </div>
              </div>
            )}
          </main>
          <aside className="property-panel">
            <EditorPanel
              selectedNode={selectedNode}
              update={updateConfig}
              replace={replaceConfig}
              onRemove={() => removeNodeById(selected)}
              onClear={() => setSelected(null)}
              onHow={() => setHowOpen(true)}
              onTemplates={onTemplates}
            />
          </aside>
        </div>
      )}

      {picker && (
        <LibraryModal
          group={picker.group}
          commander={commander}
          onClose={() => setPicker(null)}
          onPick={(item) => pickLibraryItem(item, picker.replaceId)}
        />
      )}

      {howOpen && (
        <HowItWorksModal
          onClose={() => setHowOpen(false)}
          onStartBuilding={() => setHowOpen(false)}
          onBrowseTemplates={() => {
            setHowOpen(false)
            onTemplates?.()
          }}
        />
      )}
    </div>
  )
}

function SimpleGroup({
  step,
  title,
  hint,
  nodes,
  onSelect,
  onChange,
  onRemove,
  selected,
}: {
  step: number
  title: string
  hint: string
  nodes: readonly CanvasNode[]
  onSelect: (id: string) => void
  onChange?: (id: string) => void
  onRemove: (id: string | null) => void
  selected: string | null
}): JSX.Element {
  return (
    <section className="simple-group">
      <header>
        <span className="simple-step-number">{step}</span>
        <div>
          <h3>{title}</h3>
          <p>{hint}</p>
        </div>
      </header>
      {nodes.length === 0 ? (
        <div className="simple-group-empty">Nothing here yet{step > 1 ? ' — optional' : ''}.</div>
      ) : (
        nodes.map((node) => (
          <article
            key={node.id}
            className={`simple-step ${selected === node.id ? 'selected' : ''}`}
            onClick={() => onSelect(node.id)}
          >
            <StepIcon node={node.data} />
            <div className="simple-step-body">
              <strong>{node.data.label}</strong>
              <span>{node.data.summary}</span>
            </div>
            <div className="simple-step-actions" onClick={(event) => event.stopPropagation()}>
              {onChange && node.data.kind === 'trigger' ? (
                <Button onClick={() => onChange(node.id)}>
                  <Pencil size={13} /> Change
                </Button>
              ) : (
                <Button onClick={() => onSelect(node.id)}>
                  <SlidersHorizontal size={13} /> Configure
                </Button>
              )}
              {node.data.kind !== 'trigger' && (
                <Button className="danger" aria-label="Remove step" onClick={() => onRemove(node.id)}>
                  <Trash2 size={13} />
                </Button>
              )}
            </div>
          </article>
        ))
      )}
    </section>
  )
}

function SimpleConnector(): JSX.Element {
  return (
    <div className="simple-connector" aria-hidden="true">
      <i />
    </div>
  )
}

function StepIcon({ node }: { node: CanvasData }): JSX.Element {
  if (node.kind === 'trigger') return <span className="simple-step-icon trigger"><Target size={16} /></span>
  if (node.kind === 'condition' || node.kind === 'filter') return <span className="simple-step-icon check"><ListChecks size={16} /></span>
  if (node.kind === 'wait') return <span className="simple-step-icon wait"><Clock3 size={16} /></span>
  if (node.kind === 'ai') return <span className="simple-step-icon ai"><Sparkles size={16} /></span>
  const action = String(node.config.action ?? '')
  const Icon = action === 'email' ? Mail : action === 'tag_customer' ? Tag : action === 'create_discount' ? Sparkles : action === 'internal_notification' ? Bell : PackagePlus
  return <span className="simple-step-icon action"><Icon size={16} /></span>
}

function EditorPanel({
  selectedNode,
  update,
  replace,
  onRemove,
  onClear,
  onHow,
  onTemplates,
}: {
  selectedNode: CanvasNode | null
  update: (key: string, value: string | number | boolean) => void
  replace: (config: NodeConfig) => void
  onRemove: () => void
  onClear: () => void
  onHow: () => void
  onTemplates: (() => void) | undefined
}): JSX.Element {
  if (!selectedNode) {
    return (
      <div className="property-empty getting-started">
        <span className="getting-started-icon"><Lightbulb size={22} /></span>
        <h2>Getting started</h2>
        <ol className="getting-started-steps">
          <li><span>1</span> Choose a starting point — like a new order or signup</li>
          <li><span>2</span> Add checks or a wait if you need them</li>
          <li><span>3</span> Pick what happens — send email, add a tag, notify you</li>
          <li><span>4</span> Click “Save &amp; Activate” to turn it on</li>
        </ol>
        <div className="getting-started-actions">
          <Button onClick={onHow}><BookOpen size={14} /> View Tutorial</Button>
          {onTemplates && <Button onClick={onTemplates}><LayoutTemplate size={14} /> Browse Templates</Button>}
        </div>
      </div>
    )
  }
  return (
    <>
      <div className="property-head">
        <span>STEP SETTINGS</span>
        <h2>{String(selectedNode.data.label)}</h2>
        <p>{String(selectedNode.data.summary)}</p>
      </div>
      <PropertyFields node={selectedNode} update={update} replace={replace} />
      <div className="property-actions">
        <Button className="danger" onClick={onRemove}>
          <Trash2 size={15} /> Remove step
        </Button>
        <Button className="done" onClick={onClear}>
          <Check size={15} /> Done
        </Button>
      </div>
    </>
  )
}

function LibraryModal({
  group,
  commander,
  onClose,
  onPick,
}: {
  group: string | null
  commander: boolean
  onClose: () => void
  onPick: (item: LibraryItem) => void
}): JSX.Element {
  const groups = LIBRARY_GROUPS.filter((item) => !group || item.key === group)
  return (
    <div className="automation-modal-backdrop">
      <div className="automation-modal library-modal">
        <Button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></Button>
        <span className="automation-eyebrow">STEP LIBRARY</span>
        <h2>{group ? `Change “${group}”` : 'Add a step'}</h2>
        <p>Pick what this step does — you can fine-tune the details next.</p>
        <div className="library-groups">
          {groups.map((item) => (
            <section key={item.key}>
              <h3>{item.label}</h3>
              <div className="library-grid">
                {LIBRARY.filter((entry) => entry.group === item.key).map((entry) => {
                  const Icon = entry.icon
                  const locked = entry.kind === 'ai' && !commander
                  return (
                    <Button key={entry.subtype} className={locked ? 'locked' : ''} onClick={() => onPick(entry)} disabled={locked}>
                      <Icon size={17} />
                      <span>
                        <strong>{entry.label}</strong>
                        <small>{entry.summary}</small>
                      </span>
                      {locked && <em>Commander only</em>}
                    </Button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function AutomationCanvasNode({ data }: NodeProps<CanvasNode>): JSX.Element {
  return (
    <div className={`flow-node ${data.kind} ${data.invalid ? 'invalid' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <span>{KIND_HEADERS[data.kind]}</span>
      <strong>{data.label}</strong>
      <small>{data.summary}</small>
      {data.kind === 'condition' ? (
        <>
          <Handle id="yes" type="source" position={Position.Bottom} style={{ left: '35%' }} />
          <Handle id="no" type="source" position={Position.Bottom} style={{ left: '65%' }} />
          <i className="yes-label">YES</i>
          <i className="no-label">NO</i>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} />
      )}
    </div>
  )
}

const FIELD_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'order.total', label: 'Order value' },
  { value: 'order.fulfillment_status', label: 'Order status' },
  { value: 'customer.id', label: 'Customer' },
  { value: 'customer.order_count', label: 'Customer order count' },
  { value: 'customer.days_since_order', label: 'Days since last order' },
  { value: 'inventory.available', label: 'Stock level' },
  { value: 'inventory.previous_available', label: 'Previous stock level' },
  { value: 'checkout.completed', label: 'Checkout completed' },
]

const OPERATOR_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'equals', label: 'is' },
  { value: 'not_equals', label: 'is not' },
  { value: 'greater_than', label: 'is more than' },
  { value: 'less_than', label: 'is less than' },
  { value: 'contains', label: 'contains' },
  { value: 'between', label: 'is between' },
  { value: 'exists', label: 'exists' },
]

function PropertyFields({
  node,
  update,
  replace,
}: {
  node: CanvasNode
  update: (key: string, value: string | number | boolean) => void
  replace: (config: NodeConfig) => void
}): JSX.Element {
  const config = (node.data.config ?? {}) as NodeConfig
  const kind = node.data.kind

  if (kind === 'trigger') {
    const trigger = String(config.trigger ?? 'manual')
    const topic = String(config.topic ?? '')
    const current = trigger === 'shopify_webhook' ? topic : trigger
    return (
      <div className="property-fields">
        <label>
          Starting point
          <select value={current} onChange={(event) => applyTrigger(event.target.value, replace, config)}>
            <option value="manual">Run on demand</option>
            <option value="cron">On a schedule</option>
            <option value="orders/create">New order received</option>
            <option value="customers/create">New customer signed up</option>
            <option value="checkouts/create">Cart abandoned</option>
            <option value="inventory_levels/update">Stock level changed</option>
          </select>
        </label>
        {trigger === 'cron' && (
          <>
            <Field label="Schedule" value={String(config.cron ?? '0 9 * * 1')} onChange={(value) => update('cron', value)} />
            <small>{friendlyCron(String(config.cron ?? '')) || '5-field schedule (e.g. 0 9 * * 1 = Mondays at 9 AM)'}</small>
          </>
        )}
        {trigger === 'shopify_webhook' && <small>{friendlyTriggerLabel(node as unknown as WorkflowNode)} — runs on the real store event.</small>}
      </div>
    )
  }

  if (kind === 'condition' || kind === 'filter') {
    const field = String(config.field ?? 'order.total')
    return (
      <div className="property-fields">
        <label>
          Check this
          <select value={field} onChange={(event) => update('field', event.target.value)}>
            {FIELD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Condition
          <select value={String(config.operator ?? 'equals')} onChange={(event) => update('operator', event.target.value)}>
            {OPERATOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <Field label="Value" value={String(config.value ?? '')} onChange={(value) => update('value', value)} />
        {kind === 'condition' && <small>When the check passes, the next step runs. If it doesn&rsquo;t, the automation ends (or you can add a &ldquo;no&rdquo; path in the advanced editor).</small>}
      </div>
    )
  }

  if (kind === 'wait') {
    return <WaitField delayMs={Number(config.delayMs ?? 0)} onDelayMs={(value) => update('delayMs', value)} />
  }

  if (kind === 'action') {
    const action = config.action
    if (action === 'email') {
      return (
        <div className="property-fields">
          <Field label="Email template" value={String(config.templateId ?? '')} onChange={(value) => update('templateId', value)} />
          <small>Use a verified email template. Delivery checks consent and suppression before sending.</small>
        </div>
      )
    }
    if (action === 'tag_customer') {
      return (
        <div className="property-fields">
          <Field label="Customer tag" value={String(config.tag ?? '')} onChange={(value) => update('tag', value)} />
          <label>
            Action
            <select value={String(config.operation ?? 'add')} onChange={(event) => update('operation', event.target.value)}>
              <option value="add">Add tag</option>
              <option value="remove">Remove tag</option>
            </select>
          </label>
        </div>
      )
    }
    if (action === 'create_discount') {
      return (
        <div className="property-fields">
          <Field label="Discount percentage" type="number" value={String(config.amount ?? 10)} onChange={(value) => update('amount', Math.min(50, Math.max(1, Number(value))))} />
          <Field label="Maximum uses" type="number" value={String(config.usageLimit ?? 100)} onChange={(value) => update('usageLimit', Math.max(1, Number(value)))} />
          <small>Safety range: 1%–50%. Approval is always required before a discount is created.</small>
        </div>
      )
    }
    if (action === 'internal_notification') {
      return (
        <div className="property-fields">
          <Field label="Notification message" value={String(config.message ?? '')} onChange={(value) => update('message', value)} />
        </div>
      )
    }
    if (action === 'update_inventory') {
      return (
        <div className="property-fields">
          <Field label="Inventory adjustment" type="number" value={String(config.adjustment ?? 1)} onChange={(value) => update('adjustment', Math.min(1000, Math.max(-1000, Number(value))))} />
          <small>Positive adds stock, negative removes it. Requires inventory write access.</small>
        </div>
      )
    }
  }

  if (kind === 'ai') {
    return (
      <div className="property-fields">
        <p>AI steps are part of the Commander plan. The store&rsquo;s configured AI provider handles this step, and high-risk results still pause for your approval.</p>
      </div>
    )
  }

  return <div className="property-fields"><p>Configure this step on the canvas.</p></div>
}

function WaitField({ delayMs, onDelayMs }: { delayMs: number; onDelayMs: (value: number) => void }): JSX.Element {
  const minutes = Math.max(0, Math.round(delayMs / 60_000))
  const initialUnit = minutes >= 1440 ? 1440 : minutes >= 60 ? 60 : 1
  const [unit, setUnit] = useState(initialUnit)
  const [amount, setAmount] = useState(minutes >= 1440 ? minutes / 1440 : minutes >= 60 ? minutes / 60 : minutes)
  return (
    <div className="property-fields">
      <label>
        Wait for
        <span className="field-row">
          <input
            type="number"
            min={0}
            max={unit === 1440 ? 30 : unit === 60 ? 720 : 43200}
            value={String(Number.isInteger(amount) ? amount : Math.round(amount * 10) / 10)}
            onChange={(event) => {
              const next = Math.max(0, Number(event.target.value))
              setAmount(next)
              onDelayMs(Math.min(43_200, next * unit) * 60_000)
            }}
          />
          <select
            value={String(unit)}
            onChange={(event) => {
              const nextUnit = Number(event.target.value)
              setUnit(nextUnit)
              onDelayMs(Math.min(43_200, amount * nextUnit) * 60_000)
            }}
          >
            <option value="1">minutes</option>
            <option value="60">hours</option>
            <option value="1440">days</option>
          </select>
        </span>
      </label>
      <small>Maximum wait: 30 days.</small>
    </div>
  )
}

function applyTrigger(value: string, replace: (config: NodeConfig) => void, current: NodeConfig): void {
  if (value === 'manual') replace({ trigger: 'manual' })
  else if (value === 'cron') replace({ trigger: 'cron', cron: String(current.cron ?? '0 9 * * 1') })
  else replace({ trigger: 'shopify_webhook', topic: value })
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  disabled = false,
}: {
  label: string
  value: string
  onChange?: (value: string) => void
  type?: string
  disabled?: boolean
}): JSX.Element {
  return (
    <label>
      {label}
      <input type={type} value={value} disabled={disabled} onChange={(event) => onChange?.(event.target.value)} />
    </label>
  )
}

function toCanvasNode(node: WorkflowNode, index: number): CanvasNode {
  return {
    id: node.id,
    type: 'automationNode',
    position: node.position ?? { x: 260 + (index % 3) * 260, y: 90 + Math.floor(index / 3) * 190 },
    data: { kind: node.type as NodeKind, label: friendlyNodeLabel(node), summary: friendlyNodeSummary(node), config: { ...node.config } },
  }
}

function handleOrder(handle: string | null | undefined): number {
  return handle === 'yes' ? 0 : handle === 'no' ? 1 : 0
}
