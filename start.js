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

/** Kill any process occupying a port (Linux). */
function killPort(port) {
  try {
    execSync(`fuser -k ${port}/tcp 2>/dev/null || true`, { stdio: 'ignore' });
    // Give the OS a moment to release the port
  } catch {
    // ignore — fuser may not exist or port may already be free
  }
}

let server = null;

/** Spawn a child process with inherited stdio (logs go to Infomaniak console). */
function startProcess(label, command, args, cwd, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('error', (err) => {
    console.error(`[${label}] Failed to start: ${err.message}`);
  });

  child.on('exit', (code, signal) => {
    console.error(`[${label}] Exited with code ${code} / signal ${signal}`);
    // Kill sibling process before exiting
    if (label === 'Dashboard' && server) server.kill();
    if (label === 'Server' && dashboard) dashboard.kill();
    // Small delay so killed children release ports before Infomaniak restarts us
    setTimeout(() => process.exit(code ?? 1), 500);
  });

  return child;
}

// 0. Clean up any leftover processes from previous crash
killPort(DASHBOARD_PORT);
killPort(SERVER_PORT);

// 1. Start Dashboard first (NestJS will proxy to it)
console.log(`[SRAtix] Starting Dashboard on internal port ${DASHBOARD_PORT}...`);
const dashboard = startProcess(
  'Dashboard',
  'npx',
  ['next', 'start', '--port', DASHBOARD_PORT],
  DASHBOARD_DIR,
);

// 2. Give Dashboard 3s to bind its port, then start Server
setTimeout(() => {
  console.log(`[SRAtix] Starting Server on port ${SERVER_PORT}...`);
  server = startProcess(
    'Server',
    'node',
    ['dist/main.js'],
    SERVER_DIR,
    { DASHBOARD_PORT },
  );
}, 3000);

// Graceful shutdown: forward SIGTERM/SIGINT to children
function shutdown(signal) {
  console.log(`[SRAtix] Received ${signal}, shutting down...`);
  if (dashboard) dashboard.kill(signal);
  if (server) server.kill(signal);
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
