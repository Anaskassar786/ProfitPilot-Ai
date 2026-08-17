import { describe, expect, it } from 'vitest'
import { activateWorkflow, AutomationExecutionService, InMemoryRunRepository, installTemplate, planAllowsTemplate, riskForAction, validateActionCaps, validateWorkflow, WORKFLOW_TEMPLATES } from './index.js'
import type { WorkflowActionAdapters } from './index.js'

describe('professional automation templates',()=>{
  it('ships fifteen named, valid, SMS-free definitions',()=>{expect(WORKFLOW_TEMPLATES).toHaveLength(15);for(const template of WORKFLOW_TEMPLATES){const definition=installTemplate(template,{id:`workflow-${template.id}`,storeId:'store-1',name:template.name,actor:'owner'});expect(()=>validateWorkflow(definition)).not.toThrow();expect(JSON.stringify(definition)).not.toMatch(/sms/i)}})
  it('gates templates by plan without hiding previews',()=>{expect(planAllowsTemplate('trial','trial')).toBe(true);expect(planAllowsTemplate('start','growth')).toBe(false);expect(planAllowsTemplate('commander','commander')).toBe(true)})
})
describe('action governance',()=>{
  it('classifies tags as low, one email as medium, and discounts as high risk',()=>{expect(riskForAction('tag_customer')).toBe('LOW');expect(riskForAction('email',{recipientCount:1})).toBe('MEDIUM');expect(riskForAction('create_discount')).toBe('HIGH')})
  it('rejects unsafe discount and inventory configurations',()=>{expect(()=>validateActionCaps({id:'discount',type:'action',config:{action:'create_discount',amount:80,usageLimit:1},next:[]})).toThrow('between 1 and 50');expect(()=>validateActionCaps({id:'inventory',type:'action',config:{action:'update_inventory',adjustment:5000},next:[]})).toThrow('safety cap')})
})
describe('durable execution contract',()=>{
  const adapters:WorkflowActionAdapters={async execute(_store,node,_context,_key,testMode){return{action:String(node.config.action??node.type),testMode}}}
  it('records a complete dry run without executing a production action',async()=>{const template=WORKFLOW_TEMPLATES.find(item=>item.id==='high-value-order')!;const definition=installTemplate(template,{id:'workflow-1',storeId:'store-1',name:template.name,actor:'owner'});const workflow=activateWorkflow(definition,new Date(0).toISOString());const repository=new InMemoryRunRepository();const service=new AutomationExecutionService(repository,adapters);const run=await service.start(workflow,{triggerType:'TEST',context:{order:{total:900}},testMode:true});const result=await service.execute(workflow,run.id);expect(result.status).toBe('COMPLETED');expect((await repository.steps('store-1',run.id)).every(step=>step.status==='COMPLETED')).toBe(true)})
  it('pauses a high-risk production action for approval',async()=>{const template=WORKFLOW_TEMPLATES.find(item=>item.id==='smart-discount')!;const workflow=activateWorkflow(installTemplate(template,{id:'workflow-2',storeId:'store-1',name:template.name,actor:'owner'}),new Date(0).toISOString());const repository=new InMemoryRunRepository();const service=new AutomationExecutionService(repository,adapters);const run=await service.start(workflow,{triggerType:'MANUAL'});const result=await service.execute(workflow,run.id);expect(result.status).toBe('APPROVAL_REQUIRED');expect(await repository.approvals('store-1','PENDING')).toHaveLength(1)})
})
