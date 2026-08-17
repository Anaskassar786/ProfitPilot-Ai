import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkflowCard } from './WorkflowCard.js'
import type { WorkflowRecord } from './automation-model.js'
const workflow:WorkflowRecord={id:'69e1bd58-9328-46d0-a32f-cbd6d6f226dd',storeId:'store-1',name:'High-value order alert',description:'Notify the operations team.',category:'Operations',tags:[],version:1,nodes:[],status:'ACTIVE',definitionHash:'hash',activatedAt:'2026-08-17T00:00:00.000Z',createdAt:'2026-08-17T00:00:00.000Z',updatedAt:'2026-08-17T00:00:00.000Z',createdBy:'owner',updatedBy:'owner',lastRunAt:null,successCount:0,failureCount:0,enabled:true,triggerSummary:'When Shopify orders create',nodeCount:3,nextRunAt:null,timezone:'UTC',overlapPolicy:'SKIP'}
describe('Automation workflow card',()=>{it('renders merchant language without leaking the workflow UUID',()=>{const html=renderToStaticMarkup(createElement(WorkflowCard,{workflow,onOpen:()=>{},onCommand:()=>{}}));expect(html).toContain('High-value order alert');expect(html).toContain('When Shopify orders create');expect(html).not.toContain(workflow.id)});it('never offers SMS in the workflow surface',()=>{const html=renderToStaticMarkup(createElement(WorkflowCard,{workflow,onOpen:()=>{},onCommand:()=>{}}));expect(html.toLowerCase()).not.toContain('sms')})})
