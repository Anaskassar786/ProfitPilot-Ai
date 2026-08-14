import { createServer } from 'node:http'
import type { Server } from 'node:http'

export type WorkerHealthState = Readonly<{ startedAt: number; lastTickAt: number | null; lastOutcome: string; running: boolean }>
export function createWorkerHealthServer(port: number, state: { current: WorkerHealthState }): Server {
  const server = createServer((request, response) => {
    if (request.url === '/health') { response.statusCode = 200; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ok: true, service: 'worker', status: 'live' })); return }
    if (request.url === '/ready') { const ready = state.current.running && state.current.lastTickAt !== null; response.statusCode = ready ? 200 : 503; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ok: ready, service: 'worker', state: state.current })); return }
    response.statusCode = 404; response.end()
  })
  server.listen(port, '0.0.0.0')
  return server
}
