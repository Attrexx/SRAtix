/**
 * SRAtix Unified Startup — single entry point for Infomaniak.
 *
 * Starts:
 *   1. Next.js Dashboard on internal port 3100
 *   2. NestJS Server on public port 3000 (proxies non-API routes to Dashboard)
 *
 * Infomaniak sees ONE process on port 3000.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');

const ROOT = __dirname;
const SERVER_DIR = path.join(ROOT, 'Server');
const DASHBOARD_DIR = path.join(ROOT, 'Dashboard');

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || '3100';
const SERVER_PORT = process.env.PORT || '3000';

/** Spawn a child process with inherited stdio (logs go to Infomaniak console). */
function startProcess(label, command, args, cwd, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: process.platform === 'win32', // shell needed on Windows for npx
  });

  child.on('error', (err) => {
    console.error(`[${label}] Failed to start: ${err.message}`);
  });

  child.on('exit', (code, signal) => {
    console.error(`[${label}] Exited with code ${code} / signal ${signal}`);
    // If either process dies, kill the other and exit
    process.exit(code ?? 1);
  });

  return child;
}

// 0. Sync Prisma schema → DB (runs at startup where env vars are available)
try {
  console.log('[SRAtix] Running prisma db push...');
  execSync('npx prisma db push --skip-generate', { cwd: SERVER_DIR, stdio: 'inherit' });
  console.log('[SRAtix] Database schema synced.');
} catch (err) {
  console.error('[SRAtix] prisma db push failed:', err.message);
  // Continue anyway — tables may already exist from a previous deploy
}

// 1. Start Dashboard first (NestJS will proxy to it)
console.log(`[SRAtix] Starting Dashboard on internal port ${DASHBOARD_PORT}...`);
const dashboard = startProcess(
  'Dashboard',
  'npx',
  ['next', 'start', '--port', DASHBOARD_PORT],
  DASHBOARD_DIR,
);

// 2. Give Dashboard 2s to bind its port, then start Server
setTimeout(() => {
  console.log(`[SRAtix] Starting Server on port ${SERVER_PORT}...`);
  startProcess(
    'Server',
    'node',
    ['dist/main.js'],
    SERVER_DIR,
    { DASHBOARD_PORT },
  );
}, 2000);

// Graceful shutdown: forward SIGTERM/SIGINT to children
function shutdown(signal) {
  console.log(`[SRAtix] Received ${signal}, shutting down...`);
  dashboard.kill(signal);
  // Server child will be killed by the exit handler above
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
