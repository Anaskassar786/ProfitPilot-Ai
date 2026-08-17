import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import { activateWorkflow, validateWorkflow } from './index.js'
import type { WorkflowDefinition } from './index.js'

const definition: WorkflowDefinition = { id: 'wf-1', storeId: storeId('s1'), name: 'Customer tagging', description: null, category: 'Customer', tags: [], timezone: 'UTC', overlapPolicy: 'SKIP', version: 1, nodes: [{ id: 'trigger', type: 'trigger', config: { trigger: 'manual' }, next: ['action'] }, { id: 'action', type: 'action', config: { action: 'tag_customer', tag: 'VIP' }, next: [] }] }

describe('workflow graph validation', () => {
  it('accepts a valid trigger and action graph', () => expect(() => validateWorkflow(definition)).not.toThrow())
  it('rejects an empty graph', () => expect(() => validateWorkflow({ ...definition, nodes: [] })).toThrow('at least one'))
  it('requires exactly one trigger', () => expect(() => validateWorkflow({ ...definition, nodes: [{ ...definition.nodes[1]!, type: 'action', id: 'another' }] })).toThrow('exactly one'))
  it('rejects duplicate node ids', () => expect(() => validateWorkflow({ ...definition, nodes: [definition.nodes[0]!, definition.nodes[1]!, definition.nodes[1]!] })).toThrow('Duplicate'))
  it('rejects edges to missing nodes', () => expect(() => validateWorkflow({ ...definition, nodes: [{ ...definition.nodes[0]!, next: ['missing'] }, definition.nodes[1]! ] })).toThrow('missing node'))
  it('rejects cycles', () => expect(() => validateWorkflow({ ...definition, nodes: [{ ...definition.nodes[0]!, next: ['action'] }, { ...definition.nodes[1]!, next: ['trigger'] }] })).toThrow('acyclic'))
  it('creates an immutable version with a hash', () => {
    const activated = activateWorkflow(definition, '2024-01-01T00:00:00.000Z')
    expect(activated.definitionHash).toHaveLength(64)
    expect(Object.isFrozen(activated)).toBe(true)
  })
  it('activates a workflow with a stable definition hash', () => expect(activateWorkflow(definition, 'now').definitionHash).toHaveLength(64))
})
