#!/usr/bin/env node
/**
 * pre-start.js — Ensure port 3000 is free before NestJS boots.
 *
 * Runs before main.ts to avoid wasting ~3-6s of NestJS bootstrap when
 * the previous process is still shutting down.
 *
 * 1. Read .sratix.pid → SIGTERM old process → wait up to 5s → SIGKILL
 * 2. Verify port is free via test bind → poll 500ms, timeout 10s
 * 3. Exit 0 = safe to start main.ts,  Exit 1 = port stuck
 *
 * Zero dependencies — only Node.js built-ins.
 */
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');

const PID_FILE = path.join(__dirname, '..', '.sratix.pid');
const PORT = parseInt(process.env.PORT, 10) || 3000;
const SIGTERM_TIMEOUT = 5000;   // wait 5s after SIGTERM before SIGKILL
const PORT_POLL_INTERVAL = 500; // check port every 500ms
const PORT_TIMEOUT = 10000;     // give up after 10s

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[pre-start ${ts}] ${msg}`);
}

/** Check if a process with the given PID is alive. */
function isAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = existence check, no signal sent
    return true;
  } catch {
    return false;
  }
}

/** Try to gracefully stop the old process, escalate to SIGKILL if needed. */
async function killOldProcess() {
  let raw;
  try {
    raw = fs.readFileSync(PID_FILE, 'utf-8').trim();
  } catch {
    log('No PID file found — skipping process cleanup');
    return;
  }

  const pid = parseInt(raw, 10);
  if (!pid || isNaN(pid)) {
    log(`Invalid PID in file: "${raw}" — skipping`);
    return;
  }

  if (!isAlive(pid)) {
    log(`Old process (PID ${pid}) already dead — cleaning up PID file`);
    try { fs.unlinkSync(PID_FILE); } catch {}
    return;
  }

  // Send SIGTERM
  log(`Sending SIGTERM to old process (PID ${pid})`);
  try { process.kill(pid, 'SIGTERM'); } catch {}

  // Poll until dead or timeout
  const deadline = Date.now() + SIGTERM_TIMEOUT;
  while (Date.now() < deadline) {
    await sleep(PORT_POLL_INTERVAL);
    if (!isAlive(pid)) {
      log(`Old process (PID ${pid}) exited gracefully`);
      try { fs.unlinkSync(PID_FILE); } catch {}
      return;
    }
  }

  // Escalate to SIGKILL
  log(`Old process (PID ${pid}) still alive after ${SIGTERM_TIMEOUT / 1000}s — sending SIGKILL`);
  try { process.kill(pid, 'SIGKILL'); } catch {}
  await sleep(500);
  try { fs.unlinkSync(PID_FILE); } catch {}
}

/** Check if the port is free by attempting a test bind. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

/** Wait for port to become free, polling at PORT_POLL_INTERVAL. */
async function waitForPort() {
  const deadline = Date.now() + PORT_TIMEOUT;
  while (Date.now() < deadline) {
    if (await isPortFree(PORT)) {
      log(`Port ${PORT} is free`);
      return true;
    }
    await sleep(PORT_POLL_INTERVAL);
  }
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  log(`Ensuring port ${PORT} is free before starting NestJS...`);

  await killOldProcess();

  if (await isPortFree(PORT)) {
    log(`Port ${PORT} confirmed free — starting main application`);
    process.exit(0);
  }

  log(`Port ${PORT} still in use — waiting up to ${PORT_TIMEOUT / 1000}s...`);
  const free = await waitForPort();
  if (free) {
    log('Port freed — starting main application');
    process.exit(0);
  } else {
    log(`FATAL: Port ${PORT} still in use after ${PORT_TIMEOUT / 1000}s — aborting`);
    process.exit(1);
  }
}

main();
