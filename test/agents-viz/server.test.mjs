import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', '..', 'bin', 'agents-viz', 'server.mjs');
const ROOT = path.join(HERE, 'fixtures', 'projects');

function get(base, p) {
  return new Promise((resolve, reject) => {
    http.get(base + p, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function getWith(base, p, headers) {
  return new Promise((resolve, reject) => {
    http.get(base + p, { headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

function firstEvent(base, p) {
  return new Promise((resolve, reject) => {
    const req = http.get(base + p, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c;
        const m = /event: session\ndata: (.*)\n\n/.exec(buf);
        if (m) { req.destroy(); resolve({ status: res.statusCode, type: res.headers['content-type'], data: JSON.parse(m[1]) }); }
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
    setTimeout(() => { req.destroy(); reject(new Error('no SSE event within 5s')); }, 5000);
  });
}

test('server smoke: health, sessions, session tree, SSE, path safety', async (t) => {
  const child = spawn(process.execPath, [SERVER, `--root=${ROOT}`, '--no-open', '--port=0', '--project=D--demo-app'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const base = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
      const m = /osf agents → (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
      if (m) resolve(m[1]);
    });
    child.on('exit', (code) => reject(new Error(`server exited ${code}: ${out}`)));
    setTimeout(() => reject(new Error('server did not start')), 5000);
  });

  const health = JSON.parse((await get(base, '/api/health')).body);
  assert.equal(health.app, 'osf-agents-viz');
  assert.equal(health.defaultProject, 'D--demo-app');

  const sessions = JSON.parse((await get(base, '/api/sessions?project=D--demo-app')).body).sessions;
  assert.deepEqual(sessions.map((s) => [s.id, s.agentCount, s.anyRunning]), [['sess-1', 3, false]]);

  const s = JSON.parse((await get(base, '/api/session?project=D--demo-app&id=sess-1')).body);
  const status = Object.fromEntries(s.agents.map((a) => [a.id, a.status]));
  assert.deepEqual(status, { a1apply: 'done', a2explore: 'done', a3archive: 'cut' });
  assert.equal(s.waves.length, 2);
  assert.deepEqual(s.waves[0].agentIds.sort(), ['a1apply', 'a2explore']);
  assert.ok(s.idleTypes.some((x) => x.type === 'osf-verify' && x.state === 'not-spawned'));

  const page = await get(base, '/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(page.headers['access-control-allow-origin'], undefined);

  const ev = await firstEvent(base, '/api/events?project=D--demo-app&id=sess-1');
  assert.match(ev.type, /text\/event-stream/);
  assert.equal(ev.data.agents.length, 3);

  for (const bad of [
    '/api/sessions?project=..',
    '/api/sessions?project=..%2F..%2Fx',
    '/api/session?project=D--demo-app&id=..%2Fsess-1',
    '/api/session?project=%2Fetc&id=passwd',
    '/api/session?project=C%3A%5CWindows&id=x',
    '/api/events?project=..&id=x',
  ]) {
    const r = await get(base, bad);
    assert.ok(r.status === 400 || r.status === 404, `${bad} -> ${r.status}`);
  }
  assert.equal((await get(base, '/api/session?project=D--demo-app&id=nope')).status, 404);

  // DNS rebinding: Host and Origin must be our own loopback origin.
  const port = new URL(base).port;
  for (const p of ['/api/health', '/', '/api/events?project=D--demo-app&id=sess-1']) {
    assert.equal(await getWith(base, p, { Host: `evil.example:${port}` }), 403, `evil Host ${p}`);
  }
  assert.equal(await getWith(base, '/api/health', { Host: `127.0.0.1:${Number(port) + 1}` }), 403, 'wrong port');
  assert.equal(await getWith(base, '/api/health', { Origin: 'http://evil.example' }), 403, 'bad Origin');
  assert.equal(await getWith(base, '/api/health', { Origin: 'null' }), 403, 'null Origin');
  assert.equal(await getWith(base, '/api/health', { Host: `localhost:${port}` }), 200, 'localhost Host');
  assert.equal(await getWith(base, '/api/health', { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` }), 200, 'own Origin');
});

test('server caps concurrent SSE streams with 503', async (t) => {
  const { createServer } = await import(pathToFileURL(SERVER).href);
  const server = createServer({ root: ROOT, project: 'D--demo-app', maxSseClients: 1 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.closeAll());
  const base = `http://127.0.0.1:${server.address().port}`;
  const p = '/api/events?project=D--demo-app&id=sess-1';
  const first = await new Promise((resolve, reject) => {
    const req = http.get(base + p, (res) => resolve({ req, status: res.statusCode }));
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
  assert.equal(first.status, 200);
  assert.equal(await getWith(base, p, {}), 503);
  first.req.destroy();
});
