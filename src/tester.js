'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const dns = require('dns');
const crypto = require('crypto');
const { Worker, isMainThread } = require('worker_threads');
const { execSync, exec } = require('child_process');

// ─── Helpers ─────────────────────────────────────────────────

function withTimeout(fn, ms = 8000) {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

function pass(message, details) {
  return { status: 'pass', message, ...(details ? { details } : {}) };
}
function fail(message, details) {
  return { status: 'fail', message, ...(details ? { details } : {}) };
}
function warn(message, details) {
  return { status: 'warning', message, ...(details ? { details } : {}) };
}
function skip(message, details) {
  return { status: 'skip', message, ...(details ? { details } : {}) };
}

// ─── Tests ───────────────────────────────────────────────────

async function testNodeRuntime() {
  const ver = process.versions;
  const major = parseInt(process.version.slice(1), 10);
  const details = {
    node: process.version,
    v8: ver.v8,
    openssl: ver.openssl,
    modules: ver.modules,
    platform: process.platform,
    arch: process.arch,
  };
  if (major >= 20) {
    return pass(`Node ${process.version} — fully supported`, details);
  } else if (major >= 18) {
    return warn(`Node ${process.version} — functional but v20+ recommended`, details);
  }
  return fail(`Node ${process.version} — too old, v20+ required`, details);
}

async function testEnvVars() {
  const envCount = Object.keys(process.env).length;
  const keyVars = ['PORT', 'NODE_ENV', 'DATABASE_URL', 'REDIS_URL', 'HOME', 'PATH'];
  const found = keyVars.filter((k) => process.env[k]);
  const details = {
    total_env_vars: envCount,
    key_vars_present: found,
    key_vars_missing: keyVars.filter((k) => !process.env[k]),
  };
  if (envCount > 0) {
    return pass(`${envCount} environment variables accessible`, details);
  }
  return fail('No environment variables accessible', details);
}

async function testFileSystem() {
  const tmpDir = path.join(os.tmpdir(), 'sratix-test');
  const tmpFile = path.join(tmpDir, `test-${Date.now()}.txt`);
  const content = 'SRAtix filesystem test — ' + new Date().toISOString();
  const details = { tmpDir, tmpFile };

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(tmpFile, content, 'utf-8');
    const readBack = fs.readFileSync(tmpFile, 'utf-8');
    fs.unlinkSync(tmpFile);

    if (readBack === content) {
      // Check writable dirs
      const cwd = process.cwd();
      let cwdWritable = false;
      try {
        const probe = path.join(cwd, '.sratix-probe');
        fs.writeFileSync(probe, 'test');
        fs.unlinkSync(probe);
        cwdWritable = true;
      } catch {}

      details.tmpdir_writable = true;
      details.cwd_writable = cwdWritable;
      details.cwd = cwd;
      return pass('Read/write works — temp dir and CWD tested', details);
    }
    return fail('Write succeeded but read-back mismatch', details);
  } catch (err) {
    details.error = err.message;
    return fail(`Filesystem write failed: ${err.message}`, details);
  }
}

async function testOutboundHttps() {
  return withTimeout(() => {
    return new Promise((resolve) => {
      const targets = [
        { host: 'httpbin.org', path: '/get', label: 'httpbin.org' },
        { host: 'api.stripe.com', path: '/v1/', label: 'Stripe API' },
      ];
      const results = [];
      let pending = targets.length;

      for (const t of targets) {
        const start = Date.now();
        const req = https.get({ hostname: t.host, path: t.path, timeout: 6000 }, (res) => {
          const elapsed = Date.now() - start;
          results.push({
            target: t.label,
            status: res.statusCode,
            latency_ms: elapsed,
            reachable: true,
          });
          res.resume();
          if (--pending === 0) done();
        });
        req.on('error', (err) => {
          results.push({ target: t.label, reachable: false, error: err.message });
          if (--pending === 0) done();
        });
        req.on('timeout', () => {
          req.destroy();
          results.push({ target: t.label, reachable: false, error: 'timeout' });
          if (--pending === 0) done();
        });
      }

      function done() {
        const allOk = results.every((r) => r.reachable);
        const someOk = results.some((r) => r.reachable);
        if (allOk) resolve(pass('All external HTTPS endpoints reachable', { targets: results }));
        else if (someOk) resolve(warn('Some endpoints unreachable', { targets: results }));
        else resolve(fail('No outbound HTTPS connectivity', { targets: results }));
      }
    });
  });
}

async function testWorkerThreads() {
  return withTimeout(() => {
    return new Promise((resolve) => {
      const workerCode = `
        const { parentPort } = require('worker_threads');
        const result = Array.from({ length: 1000 }, (_, i) => i).reduce((a, b) => a + b, 0);
        parentPort.postMessage({ sum: result, pid: process.pid });
      `;
      try {
        const worker = new Worker(workerCode, { eval: true });
        worker.on('message', (msg) => {
          resolve(pass(`Worker thread executed — computed sum=${msg.sum}`, {
            worker_pid: msg.pid,
            main_pid: process.pid,
          }));
        });
        worker.on('error', (err) => {
          resolve(fail(`Worker thread error: ${err.message}`));
        });
      } catch (err) {
        resolve(fail(`Cannot create worker thread: ${err.message}`));
      }
    });
  });
}

async function testChildProcess() {
  try {
    const output = execSync('node -e "console.log(JSON.stringify({ok:true,v:process.version}))"', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    const parsed = JSON.parse(output);
    if (parsed.ok) {
      return pass('Child process spawning works', { child_output: parsed });
    }
    return warn('Child process ran but unexpected output', { raw: output });
  } catch (err) {
    return fail(`Child process failed: ${err.message}`);
  }
}

async function testCrypto() {
  try {
    // HMAC — needed for signed QR codes
    const key = crypto.randomBytes(32);
    const hmac = crypto.createHmac('sha256', key).update('ticket_12345').digest('hex');

    // AES-256-GCM — needed for check-in pack encryption
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    let encrypted = cipher.update('SRAtix test payload', 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    return pass('HMAC-SHA256 + AES-256-GCM fully functional', {
      hmac_sample: hmac.substring(0, 16) + '...',
      aes_roundtrip: decrypted === 'SRAtix test payload',
      available_hashes: crypto.getHashes().filter((h) => ['sha256', 'sha384', 'sha512'].includes(h)),
      available_ciphers: crypto.getCiphers().filter((c) => c.includes('aes-256')).slice(0, 5),
    });
  } catch (err) {
    return fail(`Crypto operations failed: ${err.message}`);
  }
}

async function testMemory() {
  const mem = process.memoryUsage();
  const totalMB = Math.round(os.totalmem() / 1048576);
  const freeMB = Math.round(os.freemem() / 1048576);
  const heapTotalMB = Math.round(mem.heapTotal / 1048576);
  const heapUsedMB = Math.round(mem.heapUsed / 1048576);
  const rssMB = Math.round(mem.rss / 1048576);

  const details = {
    system_total_mb: totalMB,
    system_free_mb: freeMB,
    heap_total_mb: heapTotalMB,
    heap_used_mb: heapUsedMB,
    rss_mb: rssMB,
    external_mb: Math.round((mem.external || 0) / 1048576),
  };

  // Puppeteer needs ~200MB+, NestJS needs ~100MB baseline
  if (totalMB >= 512) {
    return pass(`${totalMB}MB total, ${freeMB}MB free — sufficient for SRAtix`, details);
  } else if (totalMB >= 256) {
    return warn(`${totalMB}MB total — tight for Puppeteer badge generation`, details);
  }
  return fail(`${totalMB}MB total — insufficient, need 512MB+`, details);
}

async function testDns() {
  return withTimeout(() => {
    return new Promise((resolve) => {
      const targets = ['api.stripe.com', 'smtp.gmail.com', 'github.com'];
      const results = [];
      let pending = targets.length;

      for (const host of targets) {
        const start = Date.now();
        dns.resolve4(host, (err, addresses) => {
          results.push({
            host,
            resolved: !err,
            addresses: addresses || [],
            latency_ms: Date.now() - start,
            error: err?.code,
          });
          if (--pending === 0) {
            const allOk = results.every((r) => r.resolved);
            if (allOk) resolve(pass('DNS resolution works for all targets', { targets: results }));
            else resolve(warn('Some DNS resolutions failed', { targets: results }));
          }
        });
      }
    });
  });
}

async function testMariaDB() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return skip('DATABASE_URL not set — set it to test MariaDB connectivity');
  }

  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch {
    return fail('mysql2 module not installed (was in optionalDependencies — npm install may have skipped it)');
  }

  return withTimeout(async () => {
    let connection;
    try {
      connection = await mysql.createConnection(dbUrl);
      const [rows] = await connection.execute('SELECT VERSION() AS v, DATABASE() AS db, NOW() AS ts');
      const row = rows[0];

      // Test table creation capability
      await connection.execute('CREATE TABLE IF NOT EXISTS _sratix_probe (id INT PRIMARY KEY, val VARCHAR(50), ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
      await connection.execute('INSERT INTO _sratix_probe (id, val) VALUES (1, "probe") ON DUPLICATE KEY UPDATE val="probe", ts=CURRENT_TIMESTAMP');
      const [probeRows] = await connection.execute('SELECT * FROM _sratix_probe WHERE id = 1');
      await connection.execute('DROP TABLE IF EXISTS _sratix_probe');

      // Test JSON support
      await connection.execute('CREATE TABLE IF NOT EXISTS _sratix_json_probe (id INT PRIMARY KEY, data JSON)');
      await connection.execute('INSERT INTO _sratix_json_probe VALUES (1, ?)', [JSON.stringify({ test: true, nested: { a: 1 } })]);
      const [jsonRows] = await connection.execute('SELECT JSON_EXTRACT(data, "$.nested.a") AS val FROM _sratix_json_probe WHERE id = 1');
      const jsonSupport = jsonRows[0]?.val == 1;
      await connection.execute('DROP TABLE IF EXISTS _sratix_json_probe');

      await connection.end();
      return pass(`Connected — ${row.db} (${row.v})`, {
        version: row.v,
        database: row.db,
        server_time: row.ts,
        table_create: true,
        insert_update: probeRows.length > 0,
        json_support: jsonSupport,
        json_extract: jsonSupport,
      });
    } catch (err) {
      try { if (connection) await connection.end(); } catch {}
      return fail(`MariaDB connection failed: ${err.message}`);
    }
  }, 10000);
}

async function testRedis() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return skip('REDIS_URL not set — set it to test Redis connectivity');
  }

  let Redis;
  try {
    Redis = require('ioredis');
  } catch {
    return fail('ioredis module not installed (was in optionalDependencies — npm install may have skipped it)');
  }

  return withTimeout(async () => {
    const client = new Redis(redisUrl, { connectTimeout: 5000, lazyConnect: true });
    try {
      await client.connect();
      await client.set('sratix:test', 'hello', 'EX', 10);
      const val = await client.get('sratix:test');
      await client.del('sratix:test');
      const info = await client.info('server');
      const versionMatch = info.match(/redis_version:(.+)/);
      await client.quit();
      return pass(`Connected — Redis ${versionMatch ? versionMatch[1].trim() : 'unknown'}`, {
        roundtrip_ok: val === 'hello',
        version: versionMatch ? versionMatch[1].trim() : 'unknown',
      });
    } catch (err) {
      try { await client.quit(); } catch {}
      return fail(`Redis connection failed: ${err.message}`);
    }
  });
}

async function testChromium() {
  const possiblePaths = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/local/bin/chromium',
    '/snap/bin/chromium',
  ];

  // Check which command
  const checkCmd = process.platform === 'win32' ? 'where chrome' : 'which chromium-browser || which chromium || which google-chrome 2>/dev/null';

  let foundPath = null;
  let version = null;

  // Try `which` first
  try {
    foundPath = execSync(checkCmd, { encoding: 'utf-8', timeout: 3000 }).trim().split('\n')[0];
  } catch {}

  // Try known paths
  if (!foundPath) {
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        foundPath = p;
        break;
      }
    }
  }

  if (foundPath) {
    try {
      version = execSync(`"${foundPath}" --version`, { encoding: 'utf-8', timeout: 3000 }).trim();
    } catch {}
    return pass(`Chromium found at ${foundPath}`, { path: foundPath, version });
  }

  // Check if puppeteer is installed (would bring its own Chromium)
  try {
    const puppeteer = require('puppeteer');
    return pass('Puppeteer installed with bundled Chromium', { bundled: true });
  } catch {}

  return warn(
    'No Chromium found — Puppeteer badge generation will need a bundled Chromium install or an alternative approach',
    {
      searched: possiblePaths,
      suggestion: 'Install puppeteer as a dependency (it bundles Chromium) or use a lighter PDF library',
    }
  );
}

async function testProcessPersistence(ctx) {
  const uptimeSec = Math.floor((Date.now() - (ctx?.startTime || Date.now())) / 1000);
  const hb = ctx?.heartbeatCount || 0;
  const details = { uptime_seconds: uptimeSec, heartbeats: hb };

  if (uptimeSec < 2) {
    return pass('Process just started — check again later to verify persistence', details);
  }
  if (hb >= uptimeSec - 2) {
    return pass(`Process alive for ${uptimeSec}s with ${hb} heartbeats — persistent`, details);
  }
  return warn(`Heartbeat drift: ${hb} beats in ${uptimeSec}s`, details);
}

async function testTls(ctx) {
  // In a server context we can't directly test TLS termination without
  // an incoming request. We report what we know.
  const details = {
    note: 'TLS termination is typically handled by reverse proxy or Cloudflare',
    suggestion: 'Check the dashboard — if it loaded via HTTPS, TLS termination works',
    node_tls_support: !!require('tls').createServer,
    openssl_version: process.versions.openssl,
  };
  return pass('Node TLS module available — external termination expected (Cloudflare/proxy)', details);
}

async function testDiskSpace() {
  try {
    let output;
    if (process.platform === 'win32') {
      output = execSync('wmic logicaldisk get size,freespace,caption', {
        encoding: 'utf-8',
        timeout: 3000,
      });
    } else {
      output = execSync('df -h / /tmp 2>/dev/null || df -h /', { encoding: 'utf-8', timeout: 3000 });
    }
    return pass('Disk space information retrieved', { raw: output.trim() });
  } catch (err) {
    return warn(`Could not check disk space: ${err.message}`);
  }
}

async function testNativeFetch() {
  if (typeof globalThis.fetch !== 'function') {
    return fail('Native fetch() not available — Node 18+ required');
  }

  try {
    const res = await fetch('https://httpbin.org/get', { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    return pass(`Native fetch() works — status ${res.status}`, {
      status: res.status,
      origin: data.origin,
    });
  } catch (err) {
    return warn(`Native fetch() exists but request failed: ${err.message}`);
  }
}

async function testScheduling() {
  return new Promise((resolve) => {
    const start = Date.now();
    let ticks = 0;
    const iv = setInterval(() => {
      ticks++;
      if (ticks >= 3) {
        clearInterval(iv);
        const elapsed = Date.now() - start;
        resolve(pass(`setInterval works — 3 ticks in ${elapsed}ms (expected ~300ms)`, {
          ticks,
          elapsed_ms: elapsed,
          drift_ms: elapsed - 300,
        }));
      }
    }, 100);
  });
}

// ─── Runner ──────────────────────────────────────────────────

async function runAllTests(ctx = {}) {
  const tests = [
    { name: 'Node.js Runtime', category: 'core', fn: testNodeRuntime },
    { name: 'Environment Variables', category: 'core', fn: testEnvVars },
    { name: 'File System (R/W)', category: 'core', fn: testFileSystem },
    { name: 'Memory', category: 'core', fn: testMemory },
    { name: 'Crypto (HMAC + AES)', category: 'core', fn: testCrypto },
    { name: 'Worker Threads', category: 'core', fn: testWorkerThreads },
    { name: 'Child Process', category: 'core', fn: testChildProcess },
    { name: 'Scheduling (setInterval)', category: 'core', fn: testScheduling },
    { name: 'Native fetch()', category: 'network', fn: testNativeFetch },
    { name: 'Outbound HTTPS', category: 'network', fn: testOutboundHttps },
    { name: 'DNS Resolution', category: 'network', fn: testDns },
    { name: 'TLS / HTTPS', category: 'network', fn: testTls },
    { name: 'MariaDB', category: 'services', fn: testMariaDB },
    { name: 'Redis', category: 'services', fn: testRedis },
    { name: 'Chromium / Puppeteer', category: 'heavy', fn: testChromium },
    { name: 'Disk Space', category: 'heavy', fn: testDiskSpace },
    { name: 'Process Persistence', category: 'runtime', fn: (c) => testProcessPersistence(ctx) },
  ];

  const results = [];
  for (const test of tests) {
    const started = Date.now();
    try {
      const result = await test.fn(ctx);
      results.push({
        name: test.name,
        category: test.category,
        duration_ms: Date.now() - started,
        ...result,
      });
    } catch (err) {
      results.push({
        name: test.name,
        category: test.category,
        duration_ms: Date.now() - started,
        status: 'error',
        message: err.message,
        details: { stack: err.stack },
      });
    }
  }

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    warning: results.filter((r) => r.status === 'warning').length,
    skip: results.filter((r) => r.status === 'skip').length,
    error: results.filter((r) => r.status === 'error').length,
  };

  return {
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    summary,
    results,
  };
}

module.exports = { runAllTests };
