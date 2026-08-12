import { createApi } from './app.js'
import { Logger } from '@profitpilot/logger'
import { readinessChecksFromEnv } from './readiness.js'

const port = Number(process.env.PORT ?? '3000')
const logger = new Logger()
const app = createApi({ logger, readinessChecks: readinessChecksFromEnv(process.env) })
app.listen(port, '0.0.0.0', () => logger.info('ProfitPilot API listening', { port }))
