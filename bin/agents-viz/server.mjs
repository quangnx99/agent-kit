#!/usr/bin/env node
// osf agents-viz — local, read-only web view of what Claude Code agents are doing.
// Zero dependencies. Binds 127.0.0.1 only. Never writes anywhere.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  isSafeName, safeJoin, projectDirName, listProjects, listSessions, loadSession, readKnownTypes,
} from './parser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ID = 'osf-agents-viz';
const PORT_FIRST = 4317;
const PORT_LAST = 4330;
const DEBOUNCE_MS = 400;
const TICK_MS = 15000;
const MAX_SSE_CLIENTS = 20;

export function parseArgs(argv) {
  const opts = { open: true, port: null, root: path.join(os.homedir(), '.claude', 'projects'), project: null };
  for (const a of argv) {
    if (a === '--no-open') opts.open = false;
    else if (a.startsWith('--port=')) opts.port = Number(a.slice(7));
    else if (a.startsWith('--root=')) opts.root = path.resolve(a.slice(7));
    else if (a.startsWith('--project=')) opts.project = a.slice(10);
  }
  return opts;
}

// Picks the existing project dir matching cwd (case-insensitive drive letter).
export function defaultProject(root, wanted, cwd = process.cwd()) {
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch { return null; }
  const pick = (name) => (name ? dirs.find((d) => d === name) || dirs.find((d) => d.toLowerCase() === name.toLowerCase()) : null);
  return pick(wanted && isSafeName(wanted) ? wanted : null) || pick(projectDirName(cwd)) || null;
}

function sendJson(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// Accepts only Host 127.0.0.1:<port> / localhost:<port> of the socket we are
// bound to, and, when present, a matching http Origin.
export function isLocalRequest(req) {
  const port = req.socket && req.socket.localPort;
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(String(req.headers.host || '').toLowerCase())) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && !hosts.some((h) => origin === `http://${h}`)) return false;
  return true;
}

export function createServer({ root, project, maxSseClients = MAX_SSE_CLIENTS }) {
  const knownTypes = readKnownTypes(path.join(HERE, '..', '..', 'agents'));
  const indexPath = path.join(HERE, 'index.html');
  const watchers = new Map(); // key -> {clients:Set, close()}

  const sessionParams = (url) => {
    const p = url.searchParams.get('project');
    const id = url.searchParams.get('id');
    if (!isSafeName(p) || !isSafeName(id) || !safeJoin(root, p, `${id}.jsonl`)) return null;
    return { p, id };
  };

  function watchSession(p, id) {
    const key = `${p}/${id}`;
    if (watchers.has(key)) return watchers.get(key);
    const projDir = safeJoin(root, p);
    const sessDir = safeJoin(root, p, id);
    const entry = { clients: new Set(), timers: [], fsw: [], last: '' };
    let pending = null;
    const push = () => {
      pending = null;
      const s = loadSession(root, p, id, { knownTypes });
      const data = JSON.stringify(s || { error: 'not_found' });
      if (data === entry.last) return;
      entry.last = data;
      for (const res of entry.clients) res.write(`event: session\ndata: ${data}\n\n`);
    };
    const schedule = () => {
      if (!pending) pending = setTimeout(push, DEBOUNCE_MS);
    };
    const tryWatch = (dir, opts, filter) => {
      try {
        const w = fs.watch(dir, opts, (_e, file) => {
          if (!filter || (file && filter(String(file)))) schedule();
        });
        w.on('error', () => {});
        entry.fsw.push(w);
        return true;
      } catch {
        return false;
      }
    };
    tryWatch(projDir, {}, (f) => f === `${id}.jsonl` || f === id);
    let sessWatched = tryWatch(sessDir, { recursive: true });
    // Periodic tick: running -> stalled transitions, and a late subagents dir.
    entry.timers.push(setInterval(() => {
      if (!sessWatched) sessWatched = tryWatch(sessDir, { recursive: true });
      schedule();
    }, TICK_MS));
    entry.timers.push(setInterval(() => {
      for (const res of entry.clients) res.write(': ping\n\n');
    }, 25000));
    entry.close = () => {
      for (const t of entry.timers) clearInterval(t);
      if (pending) clearTimeout(pending);
      for (const w of entry.fsw) try { w.close(); } catch { /* ignore */ }
      watchers.delete(key);
    };
    entry.pushNow = push;
    watchers.set(key, entry);
    return entry;
  }

  const server = http.createServer((req, res) => {
    // DNS-rebinding guard: only our own loopback origin may talk to us.
    if (!isLocalRequest(req)) return sendJson(res, 403, { error: 'forbidden_host' });
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return sendJson(res, 400, { error: 'bad_url' }); }
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
    const route = url.pathname;

    if (route === '/' || route === '/index.html') {
      fs.readFile(indexPath, (err, buf) => {
        if (err) return sendJson(res, 500, { error: 'index_missing' });
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': CSP,
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        });
        res.end(buf);
      });
      return;
    }
    if (route === '/api/health') return sendJson(res, 200, { app: APP_ID, ok: true, defaultProject: project });
    if (route === '/api/projects') return sendJson(res, 200, { projects: listProjects(root), defaultProject: project, knownTypes });
    if (route === '/api/sessions') {
      const p = url.searchParams.get('project');
      if (!isSafeName(p) || !safeJoin(root, p)) return sendJson(res, 400, { error: 'bad_project' });
      const sessions = listSessions(root, p);
      if (!sessions) return sendJson(res, 404, { error: 'project_not_found' });
      return sendJson(res, 200, { project: p, sessions });
    }
    if (route === '/api/session') {
      const sp = sessionParams(url);
      if (!sp) return sendJson(res, 400, { error: 'bad_params' });
      const s = loadSession(root, sp.p, sp.id, { knownTypes });
      if (!s) return sendJson(res, 404, { error: 'session_not_found' });
      return sendJson(res, 200, s);
    }
    if (route === '/api/events') {
      const sp = sessionParams(url);
      if (!sp) return sendJson(res, 400, { error: 'bad_params' });
      if (!fs.existsSync(safeJoin(root, sp.p, `${sp.id}.jsonl`))) return sendJson(res, 404, { error: 'session_not_found' });
      let clients = 0;
      for (const e of watchers.values()) clients += e.clients.size;
      if (clients >= maxSseClients) return sendJson(res, 503, { error: 'too_many_streams' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      });
      res.write('retry: 3000\n\n');
      const entry = watchSession(sp.p, sp.id);
      entry.clients.add(res);
      if (entry.last) res.write(`event: session\ndata: ${entry.last}\n\n`);
      else entry.pushNow();
      req.on('close', () => {
        entry.clients.delete(res);
        if (!entry.clients.size) entry.close();
      });
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
  });
  server.closeAll = () => {
    for (const e of [...watchers.values()]) e.close();
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  };
  return server;
}

function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 800 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      res.on('end', () => {
        try { resolve(JSON.parse(body).app === APP_ID); } catch { resolve(false); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function listen(server, port) {
  return new Promise((resolve) => {
    const onErr = (err) => { server.off('listening', onOk); resolve(err); };
    const onOk = () => { server.off('error', onErr); resolve(null); };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(port, '127.0.0.1');
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* no browser available */ }
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const project = defaultProject(opts.root, opts.project);
  const server = createServer({ root: opts.root, project });

  let ports;
  if (opts.port !== null && Number.isInteger(opts.port) && opts.port >= 0 && opts.port <= 65535) {
    ports = [opts.port];
  } else {
    ports = [];
    for (let p = PORT_FIRST; p <= PORT_LAST; p++) ports.push(p);
  }
  const scan = opts.port === null; // with an explicit port, never reuse another server
  for (const port of ports) {
    if (scan && await probe(port)) {
      const url = `http://127.0.0.1:${port}`;
      console.log(`osf agents → ${url} (already running)`);
      if (opts.open) openBrowser(url);
      return null;
    }
    const err = await listen(server, port);
    if (!err) {
      const url = `http://127.0.0.1:${server.address().port}`;
      console.log(`osf agents → ${url}`);
      console.log('Read-only, local only. Stop with Ctrl+C (or stop the background task).');
      if (opts.open) openBrowser(url);
      const stop = () => { server.closeAll(); process.exit(0); };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      return server;
    }
    if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') {
      console.error(`osf agents: cannot listen on ${port}: ${err.message}`);
      process.exitCode = 1;
      return null;
    }
  }
  console.error(`osf agents: no free port in ${ports[0]}–${ports[ports.length - 1]}`);
  process.exitCode = 1;
  return null;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
