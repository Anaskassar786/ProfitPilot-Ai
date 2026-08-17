import { requestJson } from './api.js'
import type { Approval, AutomationSummary, AutomationUsage, WorkflowNode, WorkflowPage, WorkflowRecord, WorkflowRun, WorkflowTemplate } from './automation-model.js'
const json=(body:unknown)=>({headers:{'content-type':'application/json'},body:JSON.stringify(body)})
export function listWorkflows(storeId:string,params:Readonly<Record<string,string>>={}){const query=new URLSearchParams({storeId,...params});return requestJson<WorkflowPage>(`/automation/workflows?${query}`)}
export function getWorkflow(storeId:string,id:string){return requestJson<WorkflowRecord>(`/automation/workflows/${encodeURIComponent(id)}?storeId=${encodeURIComponent(storeId)}`)}
export function createAutomationWorkflow(input:Readonly<{storeId:string;name:string;description?:string;category:string;nodes?:readonly WorkflowNode[]}>){return requestJson<WorkflowRecord>('/automation/workflows',{method:'POST',...json(input)})}
export function updateAutomationWorkflow(storeId:string,id:string,patch:Readonly<Record<string,unknown>>){return requestJson<WorkflowRecord>(`/automation/workflows/${encodeURIComponent(id)}`,{method:'PATCH',...json({storeId,...patch})})}
export function workflowCommand(storeId:string,id:string,command:'activate'|'pause'|'resume'|'clone'|'run'|'test',extras:Readonly<Record<string,unknown>>={}){return requestJson<WorkflowRecord|WorkflowRun>(`/automation/workflows/${encodeURIComponent(id)}/${command}`,{method:'POST',...json({storeId,...extras})})}
export function archiveWorkflow(storeId:string,id:string){return requestJson<WorkflowRecord>(`/automation/workflows/${encodeURIComponent(id)}?storeId=${encodeURIComponent(storeId)}`,{method:'DELETE',...json({storeId})})}
export function getAutomationSummary(storeId:string){return requestJson<AutomationSummary>(`/automation/summary?storeId=${encodeURIComponent(storeId)}`)}
export function getAutomationUsage(storeId:string){return requestJson<AutomationUsage>(`/automation/usage?storeId=${encodeURIComponent(storeId)}`)}
export function getAutomationTemplates(storeId:string){return requestJson<readonly WorkflowTemplate[]>(`/automation/templates?storeId=${encodeURIComponent(storeId)}`)}
export function installAutomationTemplate(storeId:string,templateId:string,name:string){return requestJson<WorkflowRecord>(`/automation/templates/${encodeURIComponent(templateId)}/install`,{method:'POST',...json({storeId,name})})}
export function getWorkflowRuns(storeId:string,workflowId:string){return requestJson<Readonly<{items:readonly WorkflowRun[];nextCursor:string|null}>>(`/automation/workflows/${encodeURIComponent(workflowId)}/runs?storeId=${encodeURIComponent(storeId)}`)}
export function getRun(storeId:string,runId:string){return requestJson<WorkflowRun>(`/automation/runs/${encodeURIComponent(runId)}?storeId=${encodeURIComponent(storeId)}`)}
export function runCommand(storeId:string,runId:string,command:'retry'|'cancel'){return requestJson<WorkflowRun>(`/automation/runs/${encodeURIComponent(runId)}/${command}`,{method:'POST',...json({storeId})})}
export function getApprovals(storeId:string,status='PENDING'){return requestJson<readonly Approval[]>(`/automation/approvals?storeId=${encodeURIComponent(storeId)}&status=${status}`)}
export function decideApproval(storeId:string,id:string,decision:'approve'|'reject',reason?:string){return requestJson<Approval>(`/automation/approvals/${encodeURIComponent(id)}/${decision}`,{method:'POST',...json({storeId,reason})})}
