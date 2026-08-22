import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, requestId, storeId, success } from '@profitpilot/types'
import type { Permission } from '@profitpilot/types'
import { assertAccess } from '@profitpilot/billing'
import type { BillingRepository, Subscription } from '@profitpilot/billing'
import { activateWorkflow, compileTemplate, installTemplate, isWorkflowCategory, isWorkflowStatus, MerchantEmailVerifier, planAllowsTemplate, priorityForPlan, templateFor, triggerSummary, validateWorkflow, WORKFLOW_CATEGORIES, WORKFLOW_TEMPLATES } from '@profitpilot/automation'
import type { AutomationExecutionService, CampaignTemplate, MerchantEmailConfigRepository, RunRepository, TemplateRepository, Ticket, TicketStore, WorkflowDefinition, WorkflowListQuery, WorkflowPatch, WorkflowRepository, WorkflowStatus } from '@profitpilot/automation'
import type { TargetedCampaignInput, TargetedCampaignService } from './targeted-campaigns.js'
import { writeCsv, writePdf, writeXlsx } from '@profitpilot/reporting'
import type { ExportRow, ExportFormat } from '@profitpilot/reporting'
import { getAuthContext } from './security.js'

export type AutomationRouteDependencies = Readonly<{
  workflows: WorkflowRepository
  templates: TemplateRepository
  emailVerifier: MerchantEmailVerifier
  merchantEmails?: MerchantEmailConfigRepository
  targetedCampaigns?: Pick<TargetedCampaignService, 'preview' | 'send' | 'unsubscribe'>
  tickets: TicketStore
  runs?: RunRepository
  execution?: AutomationExecutionService
  billing?: BillingRepository
  requirePermission?: (storeId: string, userId: string, permission: Permission) => Promise<void>
  exportRows?: (storeId: string, dataset: 'orders' | 'catalog' | 'audit' | 'revenue') => Promise<readonly import('@profitpilot/reporting').ExportRow[]>
  sendVerificationEmail?: (input: Readonly<{ shopId: string; email: string; fromName: string; token: string }>) => Promise<boolean>
}>

export function createAutomationRouter(dependencies: AutomationRouteDependencies): Router {
  const router = Router()

  router.get('/automation/workflows', asyncRoute(async (request) => {
    const tenant = queryStore(request); await permit(dependencies, request, tenant, 'automation:read')
    return dependencies.workflows.list(tenant, listQuery(request))
  }))
  router.get('/automation/workflows/:id', asyncRoute(async (request) => {
    const tenant = queryStore(request); await permit(dependencies, request, tenant, 'automation:read')
    return required(await dependencies.workflows.get(tenant, param(request.params.id)), 'Workflow not found')
  }))
  router.post('/automation/workflows', asyncRoute(async (request) => {
    const body = record(request.body); const tenant = requiredString(body.storeId, 'storeId'); await permit(dependencies, request, tenant, 'automation:write')
    const used = await dependencies.workflows.count(tenant); await assertWorkflowAccess(dependencies, tenant, used)
    const definition = definitionFrom(body, tenant, randomUUID()); await assertAiPlan(dependencies,tenant,definition); validateWorkflow(definition)
    return dependencies.workflows.put(definition, actor(request))
  }, 201))
  router.patch('/automation/workflows/:id', asyncRoute(async (request) => {
    const body = record(request.body); const tenant = requiredString(body.storeId, 'storeId'); await permit(dependencies, request, tenant, 'automation:write')
    const current = required(await dependencies.workflows.get(tenant, param(request.params.id)), 'Workflow not found')
    if (current.status === 'ARCHIVED') throw new AppError('CONFLICT', 'Archived workflows cannot be edited', 409)
    const patch = workflowPatch(body); const candidate = { ...current, ...patch, version: patch.nodes ? current.version + 1 : current.version } as WorkflowDefinition; await assertAiPlan(dependencies,tenant,candidate); validateWorkflow(candidate)
    return required(await dependencies.workflows.patch(tenant, current.id, patch, actor(request)), 'Workflow not found')
  }))
  router.delete('/automation/workflows/:id', asyncRoute(async (request) => statusChange(dependencies, request, 'ARCHIVED')))
  router.post('/automation/workflows/:id/activate', asyncRoute(async (request) => {
    const tenant = storeFromRequest(request); await permit(dependencies, request, tenant, 'automation:write')
    const draft = required(await dependencies.workflows.get(tenant, param(request.params.id)), 'Workflow not found')
    await assertAiPlan(dependencies,tenant,draft); const activated = activateWorkflow(draft, new Date().toISOString())
    return dependencies.workflows.activate(tenant, activated, actor(request))
  }))
  router.post('/automation/workflows/:id/pause', asyncRoute(async (request) => statusChange(dependencies, request, 'PAUSED')))
  router.post('/automation/workflows/:id/resume', asyncRoute(async (request) => statusChange(dependencies, request, 'ACTIVE')))
  router.post('/automation/workflows/:id/clone', asyncRoute(async (request) => {
    const body = record(request.body); const tenant = requiredString(body.storeId, 'storeId'); await permit(dependencies, request, tenant, 'automation:write'); await assertWorkflowAccess(dependencies, tenant, await dependencies.workflows.count(tenant))
    const current = required(await dependencies.workflows.get(tenant, param(request.params.id)), 'Workflow not found'); const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : `${current.name} copy`
    return required(await dependencies.workflows.clone(tenant, current.id, randomUUID(), name, actor(request)), 'Workflow not found')
  }, 201))
  router.post('/automation/workflows/:id/validate', asyncRoute(async (request) => {
    const body = record(request.body); const tenant = requiredString(body.storeId, 'storeId'); await permit(dependencies, request, tenant, 'automation:write'); const current = required(await dependencies.workflows.get(tenant, param(request.params.id)), 'Workflow not found'); const candidate = body.nodes ? { ...current, nodes: parseNodes(body.nodes) } : current; validateWorkflow(candidate); return { valid: true, nodeCount: candidate.nodes.length, triggerSummary: triggerSummary(candidate) }
  }))
  router.get('/automation/workflows/:id/versions', asyncRoute(async (request) => { const tenant=queryStore(request);await permit(dependencies,request,tenant,'automation:read');return dependencies.workflows.versions(tenant,param(request.params.id)) }))
  router.post('/automation/workflows/:id/rollback', asyncRoute(async (request) => { const body=record(request.body);const tenant=requiredString(body.storeId,'storeId');await permit(dependencies,request,tenant,'automation:write');const version=typeof body.version==='number'?body.version:NaN;if(!Number.isInteger(version)||version<1)throw new AppError('VALIDATION_ERROR','version is required',400);const historical=required(await dependencies.workflows.version(tenant,param(request.params.id),version),'Workflow version not found');const current=required(await dependencies.workflows.get(tenant,historical.id),'Workflow not found');const patch:WorkflowPatch={name:historical.name,description:historical.description,category:historical.category,tags:historical.tags,nodes:historical.nodes,timezone:historical.timezone,overlapPolicy:historical.overlapPolicy};return required(await dependencies.workflows.patch(tenant,current.id,patch,actor(request)),'Workflow not found') }))
  router.post('/automation/workflows/:id/run', asyncRoute(async (request) => startRun(dependencies, request, false), 202))
  router.post('/automation/workflows/:id/test', asyncRoute(async (request) => startRun(dependencies, request, true), 202))
  router.get('/automation/workflows/:id/runs', asyncRoute(async (request) => {
    const tenant=queryStore(request);await permit(dependencies,request,tenant,'automation:read');if(!dependencies.runs)throw unavailable('Run history');return dependencies.runs.list(tenant,param(request.params.id),limit(request),cursor(request))
  }))
  router.get('/automation/runs/:runId', asyncRoute(async (request) => {
    const tenant=queryStore(request);await permit(dependencies,request,tenant,'automation:read');if(!dependencies.runs)throw unavailable('Run history');const run=required(await dependencies.runs.get(tenant,param(request.params.runId)),'Workflow run not found');return{...run,steps:await dependencies.runs.steps(tenant,run.id)}
  }))
  router.post('/automation/runs/:runId/cancel', asyncRoute(async (request) => {
    const tenant=storeFromRequest(request);await permit(dependencies,request,tenant,'automation:write');if(!dependencies.runs)throw unavailable('Run cancellation');const run=required(await dependencies.runs.get(tenant,param(request.params.runId)),'Workflow run not found');if(run.status!=='RUNNING'&&run.status!=='WAITING'&&run.status!=='QUEUED')throw new AppError('CONFLICT','Only active runs can be cancelled',409);return dependencies.runs.transition(tenant,run.id,'CANCELLED',{error:'Cancelled by merchant'})
  }))
  router.post('/automation/runs/:runId/retry', asyncRoute(async (request) => {
    const tenant=storeFromRequest(request);await permit(dependencies,request,tenant,'automation:write');if(!dependencies.runs||!dependencies.execution)throw unavailable('Run retry');const run=required(await dependencies.runs.get(tenant,param(request.params.runId)),'Workflow run not found');if(run.status!=='FAILED')throw new AppError('CONFLICT','Only failed runs can be retried',409);const workflow=required(await dependencies.workflows.get(tenant,run.workflowId),'Workflow not found');if(!workflow.definitionHash||!workflow.activatedAt)throw new AppError('CONFLICT','Published workflow version is unavailable',409);await dependencies.runs.transition(tenant,run.id,'QUEUED',{error:null});void dependencies.execution.execute({...workflow,definitionHash:workflow.definitionHash,activatedAt:workflow.activatedAt},run.id);return dependencies.runs.get(tenant,run.id)
  },202))
  router.get('/automation/templates', asyncRoute(async (request) => {
    const tenant=queryStore(request);await permit(dependencies,request,tenant,'automation:read');const plan=await planFor(dependencies,tenant);return WORKFLOW_TEMPLATES.map(template=>({...template,locked:!planAllowsTemplate(plan,template.minimumPlan),nodes:template.nodes.length}))
  }))
  router.post('/automation/templates/:templateId/install', asyncRoute(async (request) => {
    const body=record(request.body);const tenant=requiredString(body.storeId,'storeId');await permit(dependencies,request,tenant,'automation:write');const template=required(templateFor(param(request.params.templateId)),'Template not found');const plan=await planFor(dependencies,tenant);if(!planAllowsTemplate(plan,template.minimumPlan))throw new AppError('PAYMENT_REQUIRED','Upgrade Plan to install this template',402,{reason:'UPGRADE_REQUIRED'});await assertWorkflowAccess(dependencies,tenant,await dependencies.workflows.count(tenant));const name=requiredString(body.name,'name');const definition=installTemplate(template,{id:randomUUID(),storeId:tenant,name,actor:actor(request)});validateWorkflow(definition);return dependencies.workflows.put(definition,actor(request))
  },201))
  router.get('/automation/usage', asyncRoute(async (request) => { const tenant=queryStore(request);await permit(dependencies,request,tenant,'automation:read');const plan=await planFor(dependencies,tenant);const used=await dependencies.workflows.count(tenant);const max=workflowLimit(plan);return{plan,used,limit:max,remaining:max===null?null:Math.max(0,max-used),limitReached:max!==null&&used>=max} }))
  router.get('/automation/summary', asyncRoute(async (request) => { const tenant=queryStore(request);await permit(dependencies,request,tenant,'automation:read');if(!dependencies.runs){const page=await dependencies.workflows.list(tenant,{limit:1});return{workflows:{active:0,draft:page.total,paused:0,archived:0},runs:{today:0,thisMonth:0,previousMonth:0,completed:0,failed:0,waiting:0,successRate:null},impact:{emailsSent:0,customersTagged:0,discountsCreated:0,notificationsSent:0},approvalsPending:0,recentActivity:[]}}return dependencies.runs.summary(tenant) }))
  router.get('/automation/approvals', asyncRoute(async (request) => { const tenant=queryStore(request);await permit(dependencies,request,tenant,'automation:read');if(!dependencies.runs)throw unavailable('Approval inbox');const status=typeof request.query.status==='string'?request.query.status as never:undefined;return dependencies.runs.approvals(tenant,status) }))
  router.post('/automation/approvals/:id/approve', asyncRoute(async (request) => decideApproval(dependencies,request,'APPROVED')))
  router.post('/automation/approvals/:id/reject', asyncRoute(async (request) => decideApproval(dependencies,request,'REJECTED')))

  // Adjacent campaign/template APIs remain unchanged and are not used as fake workflow data.
  router.get('/campaigns/templates', asyncRoute(async (request) => dependencies.templates.list(queryStore(request))))
  router.post('/campaigns/templates', asyncRoute(async (request) => { const body=record(request.body);if(typeof body.storeId!=='string')throw new AppError('VALIDATION_ERROR','storeId is required for campaign templates',400);const template=compileTemplate(body as Omit<CampaignTemplate,'variables'>);await dependencies.templates.put(template);return template },201))
  router.post('/campaigns/preview', asyncRoute(async (request) => {if(!dependencies.targetedCampaigns)throw unavailable('Targeted campaign delivery');return dependencies.targetedCampaigns.preview(targetedInput(request.body,false))}))
  router.post('/campaigns/send', asyncRoute(async (request) => {if(!dependencies.targetedCampaigns)throw unavailable('Targeted campaign delivery');return dependencies.targetedCampaigns.send(targetedInput(request.body,true))}))
  router.get('/campaigns/unsubscribe', async(request,response,next)=>{try{if(!dependencies.targetedCampaigns)throw unavailable('Campaign unsubscribe');const token=typeof request.query.token==='string'?request.query.token:'';const result=await dependencies.targetedCampaigns.unsubscribe(token);response.status(200).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unsubscribed</title></head><body><main><h1>You are unsubscribed</h1><p>${result.alreadySuppressed?'This email was already unsubscribed.':'Marketing email for this store has been disabled.'}</p></main></body></html>`)}catch(error:unknown){next(error)}})
  router.post('/exports', asyncRoute(async(request)=>{const body=record(request.body);if(!isFormat(body.format))throw new AppError('VALIDATION_ERROR','format is required',400);const dataset=isDataset(body.dataset)?body.dataset:null;const supplied=Array.isArray(body.rows)?body.rows.filter(isExportRow):[];const tenant=typeof body.storeId==='string'?body.storeId:typeof request.query.storeId==='string'?request.query.storeId:'';const rows=dataset&&dependencies.exportRows&&tenant?await dependencies.exportRows(tenant,dataset):supplied;const file=body.format==='CSV'?writeCsv(`${dataset??'export'}-${randomUUID()}.csv`,rows):body.format==='XLSX'?writeXlsx(`${dataset??'export'}-${randomUUID()}.xlsx`,rows):writePdf(`${dataset??'export'}-${randomUUID()}.pdf`,rows);return{filename:file.filename,contentType:file.contentType,bodyBase64:file.body.toString('base64'),rows:rows.length,ceiling:50_000,ceilingNote:'Technical safety limit for one file — not a plan quota.'}}))
  router.get('/support/tickets',asyncRoute(async(request)=>dependencies.tickets.list(queryStore(request))))
  router.post('/support/tickets',asyncRoute(async(request)=>{const body=record(request.body);if(typeof body.shopId!=='string'||typeof body.subject!=='string'||!isPlan(body.plan))throw new AppError('VALIDATION_ERROR','shopId, subject, and plan are required',400);const now=Date.now();const priority=body.priority==='NORMAL'||body.priority==='HIGH'||body.priority==='URGENT'?body.priority:priorityForPlan(body.plan);const ticket:Ticket={id:randomUUID(),shopId:body.shopId,subject:body.subject.trim().slice(0,200)||'Support request',description:typeof body.description==='string'?body.description.trim().slice(0,4_000):'',priority,status:'OPEN',createdAt:now,updatedAt:now,version:0};return dependencies.tickets.create(ticket)},201))
  router.get('/settings/merchant-email', asyncRoute(async (request) => {
    const shopId = typeof request.query.shopId === 'string' ? request.query.shopId : typeof request.query.storeId === 'string' ? request.query.storeId : ''
    if (!shopId.trim()) throw new AppError('VALIDATION_ERROR', 'shopId is required', 400)
    const durable = dependencies.merchantEmails ? await dependencies.merchantEmails.get(shopId) : null
    return durable ?? dependencies.emailVerifier.get(shopId)
  }))
  router.post('/settings/merchant-email', asyncRoute(async (request) => {
    const body = record(request.body)
    if (typeof body.shopId !== 'string' || typeof body.email !== 'string' || typeof body.fromName !== 'string') throw new AppError('VALIDATION_ERROR', 'shopId, email, and fromName are required', 400)
    const saved = dependencies.emailVerifier.save(body.shopId, body.email, body.fromName)
    const config = { ...saved, verificationSentAt: Date.now() }
    dependencies.emailVerifier.hydrate(config)
    await dependencies.merchantEmails?.put(config)
    const verificationToken = dependencies.emailVerifier.token(body.shopId, body.email, Date.now() + 86_400_000)
    let emailSent = false
    if (dependencies.sendVerificationEmail) {
      try { emailSent = await dependencies.sendVerificationEmail({ shopId: body.shopId, email: body.email, fromName: body.fromName, token: verificationToken }) }
      catch { emailSent = false }
    }
    return { config, verificationRequired: true, verificationToken, emailSent }
  }))
  router.post('/settings/merchant-email/verify', asyncRoute(async (request) => {
    const body = record(request.body)
    if (typeof body.token !== 'string') throw new AppError('VALIDATION_ERROR', 'verification token is required', 400)
    const claimedStore = body.token.split('|')[0] ?? ''
    if (claimedStore && dependencies.merchantEmails) {
      const durable = await dependencies.merchantEmails.get(claimedStore)
      if (durable) dependencies.emailVerifier.hydrate(durable)
    }
    const config = dependencies.emailVerifier.verify(body.token)
    await dependencies.merchantEmails?.put(config)
    return config
  }))
  router.get('/settings/workspace', asyncRoute(async (request) => {
    const tenant = typeof request.query.storeId === 'string' ? request.query.storeId : typeof request.query.shopId === 'string' ? request.query.shopId : ''
    if (!tenant.trim()) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400)
    return workspacePreferences.get(tenant) ?? { storeId: tenant }
  }))
  router.put('/settings/workspace', asyncRoute(async (request) => {
    const body = record(request.body)
    const tenant = typeof body.storeId === 'string' ? body.storeId : typeof body.shopId === 'string' ? body.shopId : ''
    if (!tenant.trim()) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400)
    const next = { ...(workspacePreferences.get(tenant) ?? { storeId: tenant }), ...body, storeId: tenant }
    workspacePreferences.set(tenant, next)
    return next
  }))
  return router
}

const workspacePreferences = new Map<string, Readonly<Record<string, unknown>>>()

async function startRun(deps:AutomationRouteDependencies,request:Request,testMode:boolean){const body=record(request.body);const tenant=requiredString(body.storeId,'storeId');await permit(deps,request,tenant,'automation:write');if(!deps.runs||!deps.execution)throw unavailable('Workflow execution');const workflow=required(await deps.workflows.get(tenant,param(request.params.id)),'Workflow not found');if(!testMode&&workflow.status!=='ACTIVE')throw new AppError('CONFLICT','Publish the workflow before running it',409);const activated=workflow.definitionHash&&workflow.activatedAt?{...workflow,definitionHash:workflow.definitionHash,activatedAt:workflow.activatedAt}:activateWorkflow(workflow,new Date().toISOString());const context=isRecord(body.context)?body.context:{};const run=await deps.execution.start(activated,{triggerType:testMode?'TEST':'MANUAL',context,testMode});void deps.execution.execute(activated,run.id);return run}
async function decideApproval(deps:AutomationRouteDependencies,request:Request,decision:'APPROVED'|'REJECTED'){const body=record(request.body);const tenant=requiredString(body.storeId,'storeId');await permit(deps,request,tenant,'automation:write');if(!deps.runs||!deps.execution)throw unavailable('Approval inbox');const approval=required(await deps.runs.decideApproval(tenant,param(request.params.id),decision,actor(request),typeof body.reason==='string'?body.reason:undefined),'Approval is no longer pending');if(decision==='REJECTED'){await deps.runs.transition(tenant,approval.runId,'CANCELLED',{error:approval.decisionReason??'Action rejected by merchant'});return approval}const workflow=required(await deps.workflows.get(tenant,approval.workflowId),'Workflow not found');if(!workflow.definitionHash||!workflow.activatedAt)throw new AppError('CONFLICT','Published workflow version is unavailable',409);void deps.execution.execute({...workflow,definitionHash:workflow.definitionHash,activatedAt:workflow.activatedAt},approval.runId,approval.nodeId);return approval}
async function statusChange(deps:AutomationRouteDependencies,request:Request,status:WorkflowStatus){const tenant=storeFromRequest(request);await permit(deps,request,tenant,'automation:write');const workflow=required(await deps.workflows.get(tenant,param(request.params.id)),'Workflow not found');if(status==='ACTIVE'&&!workflow.definitionHash)throw new AppError('CONFLICT','Publish this draft before resuming it',409);return required(await deps.workflows.setStatus(tenant,workflow.id,status,actor(request)),'Workflow not found')}
async function assertWorkflowAccess(deps:AutomationRouteDependencies,tenant:string,used:number){const subscription=await subscriptionFor(deps,tenant);if(subscription.state==='PENDING_CONFIRMATION'||subscription.state==='TRIAL_EXPIRED'||subscription.state==='PAST_DUE'||subscription.state==='SUSPENDED'||subscription.state==='CANCELLED')throw new AppError('PAYMENT_REQUIRED','Your trial or subscription is not active. Upgrade Subscription to continue.',402,{reason:'SUBSCRIPTION_REQUIRED',plan:subscription.plan});try{assertAccess(subscription,{feature:'automation_workflows',used})}catch{throw new AppError('PAYMENT_REQUIRED','Workflow limit reached. Upgrade Plan to create another workflow.',402,{reason:'UPGRADE_REQUIRED',used,limit:workflowLimit(subscription.plan),plan:subscription.plan})}}
async function subscriptionFor(deps:AutomationRouteDependencies,tenant:string):Promise<Subscription>{return await deps.billing?.get(tenant)??{storeId:tenant,plan:'trial',state:'TRIAL_LIMITED',currentPeriodEnd:null,version:0}}
async function planFor(deps:AutomationRouteDependencies,tenant:string){return(await subscriptionFor(deps,tenant)).plan}
async function assertAiPlan(deps:AutomationRouteDependencies,tenant:string,workflow:WorkflowDefinition){if(workflow.nodes.some(node=>node.type==='ai')&&(await planFor(deps,tenant))!=='commander')throw new AppError('PAYMENT_REQUIRED','Upgrade Plan to use AI workflow nodes',402,{reason:'UPGRADE_REQUIRED',feature:'automation_ai_nodes'})}
function workflowLimit(plan:Subscription['plan']){return plan==='trial'?2:plan==='start'?5:plan==='growth'?20:null}
async function permit(deps:AutomationRouteDependencies,request:Request,tenant:string,permission:Permission){const auth=getAuthContext(request);if(deps.requirePermission&&auth)await deps.requirePermission(tenant,String(auth.claims.sub),permission)}
function actor(request:Request){return String(getAuthContext(request)?.claims.sub??'merchant')}
function definitionFrom(body:Readonly<Record<string,unknown>>,tenant:string,id:string):WorkflowDefinition{return{id:typeof body.id==='string'?body.id:id,storeId:storeId(tenant),name:requiredString(body.name,'name').trim(),description:typeof body.description==='string'?body.description.trim()||null:null,category:isWorkflowCategory(body.category)?body.category:'Operations',tags:Array.isArray(body.tags)?body.tags.filter((x):x is string=>typeof x==='string'):[],version:typeof body.version==='number'?body.version:1,nodes:parseNodes(body.nodes??[{id:'trigger',type:'trigger',config:{trigger:'manual'},next:[]}]),timezone:typeof body.timezone==='string'?body.timezone:'UTC',overlapPolicy:body.overlapPolicy==='QUEUE'||body.overlapPolicy==='PARALLEL'?body.overlapPolicy:'SKIP'}}
function workflowPatch(body:Readonly<Record<string,unknown>>):WorkflowPatch{const patch:Record<string,unknown>={};if(typeof body.name==='string')patch.name=body.name.trim();if(body.description===null||typeof body.description==='string')patch.description=body.description;if(isWorkflowCategory(body.category))patch.category=body.category;if(Array.isArray(body.tags))patch.tags=body.tags.filter((x):x is string=>typeof x==='string');if(body.nodes!==undefined)patch.nodes=parseNodes(body.nodes);if(typeof body.enabled==='boolean')patch.enabled=body.enabled;if(typeof body.timezone==='string')patch.timezone=body.timezone;if(body.overlapPolicy==='SKIP'||body.overlapPolicy==='QUEUE'||body.overlapPolicy==='PARALLEL')patch.overlapPolicy=body.overlapPolicy;return patch as WorkflowPatch}
function parseNodes(value:unknown):WorkflowDefinition['nodes']{if(!Array.isArray(value))throw new AppError('VALIDATION_ERROR','nodes must be an array',400);return value as WorkflowDefinition['nodes']}
function listQuery(request:Request):WorkflowListQuery{return{...(isWorkflowStatus(request.query.status)?{status:request.query.status}:{}),...(isWorkflowCategory(request.query.category)?{category:request.query.category}:{}),...(typeof request.query.search==='string'?{search:request.query.search.slice(0,100)}:{}),...(request.query.sort==='name'||request.query.sort==='created'||request.query.sort==='lastRun'||request.query.sort==='successRate'?{sort:request.query.sort}:{}),...(request.query.direction==='asc'?{direction:'asc' as const}:{}),...(typeof request.query.cursor==='string'?{cursor:request.query.cursor}:{}),limit:limit(request)}}
function queryStore(request:Request){const value=request.query.storeId;if(typeof value!=='string'||!value.trim())throw new AppError('VALIDATION_ERROR','storeId is required',400);return value}
function storeFromRequest(request:Request){const body=isRecord(request.body)?request.body:{};return typeof body.storeId==='string'?body.storeId:queryStore(request)}
function requiredString(value:unknown,field:string){if(typeof value!=='string'||!value.trim())throw new AppError('VALIDATION_ERROR',`${field} is required`,400);return value}
function required<T>(value:T|null|undefined,message:string):T{if(value===null||value===undefined)throw new AppError('NOT_FOUND',message,404);return value}
function param(value:string|string[]|undefined){const result=Array.isArray(value)?value[0]:value;if(!result?.trim())throw new AppError('VALIDATION_ERROR','id is required',400);return result}
function limit(request:Request){const parsed=Number(request.query.limit??20);return Number.isInteger(parsed)?Math.min(50,Math.max(1,parsed)):20}
function cursor(request:Request){return typeof request.query.cursor==='string'?request.query.cursor:undefined}
function asyncRoute(handler:(request:Request)=>Promise<unknown>,status=200){return async(request:Request,response:import('express').Response,next:import('express').NextFunction)=>{try{response.status(status).json(success(await handler(request),requestIdFrom(request)))}catch(error:unknown){next(error)}}}
function unavailable(capability:string){return new AppError('DEPENDENCY_ERROR',`${capability} is unavailable`,503)}
function targetedInput(value:unknown,requireReview:boolean):TargetedCampaignInput{const body=record(value);if(typeof body.storeId!=='string'||typeof body.customerId!=='string'||typeof body.templateId!=='string'||typeof body.idempotencyKey!=='string')throw new AppError('VALIDATION_ERROR','storeId, customerId, templateId, and idempotencyKey are required',400);for(const forbidden of['email','recipientEmail','acceptsMarketing','marketingState','phone'])if(forbidden in body)throw new AppError('VALIDATION_ERROR',`Client-supplied ${forbidden} is not accepted`,400);if(requireReview&&body.reviewed!==true)throw new AppError('VALIDATION_ERROR','Explicit merchant review is required',400);return{storeId:storeId(body.storeId),customerId:body.customerId,templateId:body.templateId,idempotencyKey:body.idempotencyKey,reviewed:body.reviewed===true}}
function requestIdFrom(request:Request){return requestId(request.header('x-request-id')||randomUUID())}
function record(value:unknown):Readonly<Record<string,unknown>>{if(!isRecord(value))throw new AppError('VALIDATION_ERROR','JSON object body is required',400);return value}
function isRecord(value:unknown):value is Readonly<Record<string,unknown>>{return typeof value==='object'&&value!==null&&!Array.isArray(value)}
function isFormat(value:unknown):value is ExportFormat{return value==='CSV'||value==='XLSX'||value==='PDF'}
function isDataset(value:unknown):value is 'orders'|'catalog'|'audit'|'revenue'{return value==='orders'||value==='catalog'||value==='audit'||value==='revenue'}
function isExportRow(value:unknown):value is ExportRow{return isRecord(value)&&Object.values(value).every(item=>item===null||typeof item==='string'||typeof item==='number'||typeof item==='boolean')}
function isPlan(value:unknown):value is 'start'|'growth'|'commander'{return value==='start'||value==='growth'||value==='commander'}
