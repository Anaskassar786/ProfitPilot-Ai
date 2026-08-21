// Local QA Postgres-compatible server (PGlite WASM via @electric-sql/pglite-socket).
// Used only for sandbox QA; production uses real Postgres on Railway.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { mkdirSync } from 'node:fs';

const PORT = Number(process.env.QA_PG_PORT ?? '5433');
const DATA_DIR = process.env.QA_PG_DATA_DIR ?? '.qa-pgdata';
mkdirSync(DATA_DIR, { recursive: true });

const db = await PGlite.create(DATA_DIR, { maxConnections: 20 });
const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1', maxConnections: 20 });
await server.start();
console.log('[qa-pg] PGlite socket server on 127.0.0.1:' + PORT + ' (data: ' + DATA_DIR + ')');
