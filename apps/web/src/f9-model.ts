export type MaintenanceState = Readonly<{ enabled: boolean; message: string; version: number; updatedBy: string; updatedAt: number }>
export type MerchantFlags = Readonly<{ storeId: string; aiEnabled: boolean; automationEnabled: boolean; suspended: boolean; version: number; updatedBy: string; updatedAt: number }>
export type OpsJob = Readonly<{ id: string; storeId: string; type: string; status: string; attempts: number; lastError: string | null; availableAt: number; createdAt: number }>
export type QueueSnapshot = Readonly<{ queue: string; queued: number; processing: number; failed: number; deadLetter: number; jobs: readonly OpsJob[] }>
export type OpsMetrics = Readonly<{ capturedAt: number; queue: QueueSnapshot; completed: number; failed: number; retried: number; activeStores: number }>
