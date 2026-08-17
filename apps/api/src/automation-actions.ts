import { AppError, storeId } from '@profitpilot/types'
import type { SqlExecutor } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import { ShopifyClient } from '@profitpilot/shopify'
import type { StoreDirectory } from '@profitpilot/db'
import type { TokenVault } from '@profitpilot/shopify'
import type { WorkflowActionAdapters, WorkflowNode } from '@profitpilot/automation'
import type { TargetedCampaignService } from './targeted-campaigns.js'

type WorkflowAi = Readonly<{ generate(system:string,user:string,context?:Readonly<{requestId?:string;maxTokens?:number}>):Promise<Readonly<{text:string;model:string}>> }>
export class ProductionWorkflowActions implements WorkflowActionAdapters {
  public constructor(private readonly database:SqlExecutor,private readonly directory:StoreDirectory,private readonly tokens:TokenVault,private readonly campaigns:Pick<TargetedCampaignService,'send'>|null,private readonly ai:WorkflowAi|null,private readonly apiVersion='2025-10'){}
  public async execute(tenant:string,node:WorkflowNode,context:Readonly<Record<string,unknown>>,idempotencyKey:string,testMode:boolean){
    if(node.type==='ai'){
      if(testMode)return{action:'ai',wouldExecute:true}
      if(!this.ai)throw new AppError('DEPENDENCY_ERROR','AI workflow execution is not configured for this store',503)
      const operation=String(node.config.operation??'classify')
      const generation=await this.ai.generate('You are a bounded Shopify workflow node. Return one concise plain-text result based only on the supplied redacted context. Do not invent numbers, reveal PII, or issue store actions.',JSON.stringify({operation,context}).slice(0,8_000),{requestId:idempotencyKey,maxTokens:300})
      return{action:'ai',operation,result:generation.text.slice(0,2_000),model:generation.model}
    }
    if(node.type!=='action')return{}
    const action=String(node.config.action)
    if(testMode)return{action,wouldExecute:true}
    if(action==='internal_notification'){await withTenantContext(this.database,tenant,async c=>{await c.query(`INSERT INTO merchant_notifications(store_id,kind,title,message) VALUES($1,'WORKFLOW','Workflow notification',$2)`,[tenant,String(node.config.message??'Workflow requires attention.')])});return{action,notified:true}}
    if(action==='email'){
      if(!this.campaigns)throw new AppError('DEPENDENCY_ERROR','Email delivery is not configured',503)
      const customerId=lookupString(context,['customerId','customer.id','order.customer.id']);const templateId=String(node.config.templateId??'')
      if(!customerId||!templateId)throw new AppError('VALIDATION_ERROR','Email action requires a customer and verified email template',400)
      const result=await this.campaigns.send({storeId:storeId(tenant),customerId,templateId,idempotencyKey,reviewed:true})
      if(result.status!=='sent'&&result.status!=='suppressed')throw new AppError('DEPENDENCY_ERROR',result.reason??'Email delivery failed',502)
      return{action,status:result.status,providerMessageId:result.providerMessageId}
    }
    const client=await this.shopify(tenant)
    if(action==='tag_customer')return this.tagCustomer(client,node,context)
    if(action==='create_discount')return this.createDiscount(client,node,idempotencyKey)
    if(action==='update_inventory')return this.updateInventory(client,node,context)
    throw new AppError('VALIDATION_ERROR','Workflow action is not available',400)
  }
  private async shopify(tenant:string){const connection=await this.directory.get(storeId(tenant));if(!connection)throw new AppError('NOT_FOUND','Shopify store is not connected',404);const token=await this.tokens.get(connection.shopDomain);if(!token)throw new AppError('DEPENDENCY_ERROR','Shopify access token is missing',503);return new ShopifyClient(connection.shopDomain,token,fetch,this.apiVersion)}
  private async tagCustomer(client:ShopifyClient,node:WorkflowNode,context:Readonly<Record<string,unknown>>){const id=lookupString(context,['customerId','customer.id','order.customer.id']);if(!id)throw new AppError('VALIDATION_ERROR','Customer tag action requires a customer id',400);const current=await client.request<{customer:{id:number|string;tags:string}}>({path:`/customers/${encodeURIComponent(id)}.json`});const tag=String(node.config.tag??'').trim();const tags=new Set(current.data.customer.tags.split(',').map(x=>x.trim()).filter(Boolean));if(node.config.operation==='remove')tags.delete(tag);else tags.add(tag);await client.request({method:'PUT',path:`/customers/${encodeURIComponent(id)}.json`,body:JSON.stringify({customer:{id,tags:[...tags].join(', ')}})});return{action:'tag_customer',customerId:id,tag,operation:String(node.config.operation??'add')}}
  private async createDiscount(client:ShopifyClient,node:WorkflowNode,key:string){const amount=Number(node.config.amount);const usageLimit=Number(node.config.usageLimit);if(amount<1||amount>50||!Number.isInteger(usageLimit)||usageLimit<1)throw new AppError('VALIDATION_ERROR','Discount safety limits are invalid',400);const code=`PP-${key.replace(/[^a-zA-Z0-9]/g,'').slice(-12).toUpperCase()}`;const startsAt=new Date().toISOString();const endsAt=typeof node.config.expiresAt==='string'?node.config.expiresAt:null;const query=`mutation CreateDiscount($input: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $input) { codeDiscountNode { id } userErrors { field message } } }`;const variables={input:{title:`ProfitPilot ${code}`,code,startsAt,...(endsAt?{endsAt}:{}),usageLimit,customerSelection:{all:true},customerGets:{value:{percentage:amount/100},items:{all:true}}}};const result=await client.request<{data:{discountCodeBasicCreate:{codeDiscountNode:{id:string}|null;userErrors:readonly {message:string}[]}}}>({method:'POST',path:'/graphql.json',body:JSON.stringify({query,variables})});const payload=result.data.data.discountCodeBasicCreate;if(payload.userErrors.length)throw new AppError('VALIDATION_ERROR',payload.userErrors[0]?.message??'Shopify rejected the discount',400);return{action:'create_discount',discountId:payload.codeDiscountNode?.id??'',code,amount}}
  private async updateInventory(client:ShopifyClient,node:WorkflowNode,context:Readonly<Record<string,unknown>>){const inventoryItemId=lookupString(context,['inventoryItemId','inventory_item_id']);const locationId=lookupString(context,['locationId','location_id']);const adjustment=Number(node.config.adjustment);if(!inventoryItemId||!locationId)throw new AppError('VALIDATION_ERROR','Inventory action requires inventory item and location ids',400);if(!Number.isInteger(adjustment)||Math.abs(adjustment)>1000)throw new AppError('VALIDATION_ERROR','Inventory adjustment exceeds the safety cap',400);await client.request({method:'POST',path:'/inventory_levels/adjust.json',body:JSON.stringify({inventory_item_id:inventoryItemId,location_id:locationId,available_adjustment:adjustment})});return{action:'update_inventory',inventoryItemId,locationId,adjustment}}
}
function lookupString(context:Readonly<Record<string,unknown>>,paths:readonly string[]){for(const path of paths){const value=path.split('.').reduce<unknown>((current,key)=>typeof current==='object'&&current!==null?(current as Record<string,unknown>)[key]:undefined,context);if(typeof value==='string'||typeof value==='number')return String(value)}return null}
