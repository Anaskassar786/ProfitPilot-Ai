import type { ActionTool, ExecutionRequest } from './executor.js'

export type ActionToolAdapters = Readonly<{
  tagCustomer: (request: ExecutionRequest) => Promise<Readonly<Record<string, string | number | boolean | null>>>
  sendEmail: (request: ExecutionRequest) => Promise<Readonly<Record<string, string | number | boolean | null>>>
  createDiscount: (request: ExecutionRequest) => Promise<Readonly<Record<string, string | number | boolean | null>>>
}>

export function createActionTools(adapters: ActionToolAdapters): Readonly<Partial<Record<ExecutionRequest['actionType'], ActionTool>>> {
  return { TAG_CUSTOMER: adapters.tagCustomer, SEND_EMAIL: adapters.sendEmail, CREATE_DISCOUNT: adapters.createDiscount }
}
