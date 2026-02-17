'use strict';

const Fastify = require('fastify');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runAllTests } = require('./tester');

// ─── App Setup ───────────────────────────────────────────────
const app = Fastify({ logger: true, trustProxy: true });

const startTime = Date.now();
let requestCount = 0;
let heartbeatCount = 0;

// Heartbeat — proves the process stays alive between requests
const heartbeatInterval = setInterval(() => { heartbeatCount++; }, 1000);

// ─── Routes ──────────────────────────────────────────────────

// Dashboard
app.get('/', async (req, reply) => {
  requestCount++;
  const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf-8');
  reply.type('text/html').send(html);
});

// System info (lightweight, always available)
app.get('/api/info', async (req, reply) => {
  requestCount++;
  const mem = process.memoryUsage();
  return {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    heartbeats: heartbeatCount,
    requests: requestCount,
    pid: process.pid,
    cwd: process.cwd(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    cpu_model: os.cpus()[0]?.model || 'unknown',
    total_memory_mb: Math.round(os.totalmem() / 1048576),
    free_memory_mb: Math.round(os.freemem() / 1048576),
    heap_used_mb: Math.round(mem.heapUsed / 1048576),
    heap_total_mb: Math.round(mem.heapTotal / 1048576),
    rss_mb: Math.round(mem.rss / 1048576),
    env_keys: {
      NODE_ENV: process.env.NODE_ENV || '(not set)',
      PORT: process.env.PORT || '(not set)',
      DATABASE_URL: process.env.DATABASE_URL ? '✔ SET' : '✘ NOT SET',
      REDIS_URL: process.env.REDIS_URL ? '✔ SET' : '✘ NOT SET',
    },
  };
});

// Run all capability tests
app.get('/api/tests', async (req, reply) => {
  requestCount++;
  const results = await runAllTests({ heartbeatCount, startTime });
  return results;
});

// SSE test endpoint — streams 5 events at 500ms intervals
app.get('/api/sse-stream', async (req, reply) => {
  requestCount++;
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let count = 0;
  const iv = setInterval(() => {
    count++;
    reply.raw.write(`data: ${JSON.stringify({ count, time: new Date().toISOString() })}\n\n`);
    if (count >= 5) {
      clearInterval(iv);
      reply.raw.write('event: done\ndata: {}\n\n');
      reply.raw.end();
    }
  }, 500);

  req.raw.on('close', () => clearInterval(iv));
});

// ─── Start Server ────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = '0.0.0.0';

const start = async () => {
  try {
    const address = await app.listen({ port: PORT, host: HOST });

    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║       SRAtix Hosting Capability Tester       ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Address : ${address.padEnd(33)}║`);
    console.log(`║  Node    : ${process.version.padEnd(33)}║`);
    console.log(`║  PID     : ${String(process.pid).padEnd(33)}║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    // Attach WebSocket server for WS capability testing
    const wss = new WebSocketServer({ server: app.server });
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({
        type: 'connected',
        message: 'WebSocket connection established!',
        time: new Date().toISOString(),
      }));
      ws.on('message', (data) => {
        const msg = data.toString();
        ws.send(JSON.stringify({ type: 'echo', original: msg, time: new Date().toISOString() }));
      });
    });
    console.log('[ws] WebSocket server attached to HTTP server');

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
