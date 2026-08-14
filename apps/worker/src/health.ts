import { createServer } from 'node:http'
import type { Server } from 'node:http'

export type WorkerHealthState = Readonly<{ startedAt: number; lastTickAt: number | null; lastOutcome: string; running: boolean }>

export function createWorkerHealthServer(port: number, state: { current: WorkerHealthState }, onListening?: () => void): Server {
  const server = createServer((request, response) => {
    const rawUrl = request.url ?? '/'
    const firstPart = rawUrl.split('?')[0] ?? '/'
    const pathname = firstPart.replace(/\/+$/, '') || '/'
    if (pathname === '/health' || pathname === '/live') {
      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true, service: 'worker', status: 'live' }))
      return
    }
    if (pathname === '/ready') {
      const ready = state.current.running && state.current.lastTickAt !== null
      response.statusCode = ready ? 200 : 503
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: ready, service: 'worker', state: state.current }))
      return
    }
    response.statusCode = 404
    response.end()
  })
  server.listen(port, '0.0.0.0', onListening)
  return server
}
