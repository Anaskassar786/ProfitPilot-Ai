#!/bin/bash
# QA-only: full local environment reset (PGlite DB + migrations + seed).
# Used by the sandbox to rebuild the QA database from scratch after restarts.
set -e
cd "$(dirname "$0")/../.."

echo "== stopping any QA servers =="
pkill -f 'pglite-db.mjs' 2>/dev/null || true
pkill -f 'apps/api/dist/main.js' 2>/dev/null || true
sleep 1

echo "== wiping local QA db =="
rm -rf .qa-pgdata

echo "== applying migrations =="
node scripts/qa/qa-db-prep.mjs

echo "== seeding stores =="
node scripts/qa/qa-seed.mjs

echo "== QA DB ready =="
