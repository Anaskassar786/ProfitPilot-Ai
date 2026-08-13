import { Logger } from '@profitpilot/logger'
import { InMemoryQueue } from '@profitpilot/queue'
import { WorkerRuntime } from './worker.js'

const runtime = new WorkerRuntime(new InMemoryQueue(), async () => undefined, new Logger())
void runtime.tick()
