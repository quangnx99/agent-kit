// Trigger indexing on the local Context Engine (codebase-retrieval MCP) and print progress %.
// Usage: node indexing.mjs [workspace] [--status]   (--status: only show current status, no re-index)
import path from 'node:path';

const BASE = 'http://localhost:6699';
const args = process.argv.slice(2);
const statusOnly = args.includes('--status');
// On Windows the server keys repos by lowercased path (see /api/index-status); elsewhere paths are case-sensitive.
const isWin = process.platform === 'win32';
const norm = p => { const t = String(p).replace(/[\\/]+$/, ''); return isWin ? t.toLowerCase() : t; };
const repo = norm(path.resolve(args.find(a => a !== '--status') || process.cwd()));
const repoId = Buffer.from(repo, 'utf8').toString('base64url');

// A network failure (engine not running) ends the script with a clear message instead of a stack trace.
const call = async (url, init) => {
  try {
    return await fetch(url, init);
  } catch (e) {
    console.log(`Không kết nối được Context Engine tại ${BASE} (${e.cause?.code || e.message}). Engine đã chạy chưa?`);
    process.exit(1);
  }
};

const getStatus = async () =>
  (await (await call(`${BASE}/api/index-status`)).json()).find(s => norm(s.repo) === repo);

const fmt = s => {
  if (!s) return 'chưa có trong Context Engine';
  if (s.state !== 'indexing') return `${s.state} — ${s.indexed_files ?? 0} files${s.last_error ? ' — ' + s.last_error : ''}`;
  if (s.phase_total > 0) return `${s.phase} ${Math.round((s.phase_done / s.phase_total) * 100)}% (${s.phase_done}/${s.phase_total})`;
  if (s.total_files > 0) return `${s.phase || 'embedding'} ${Math.round((s.indexed_files / s.total_files) * 100)}% (${s.indexed_files}/${s.total_files})`;
  return `${s.phase || 'đang chuẩn bị'}…`;
};

console.log(`Repo: ${repo}`);
if (statusOnly) { console.log(fmt(await getStatus())); process.exit(0); }

// The engine ignores index requests for repos missing from config.repos — register it like the UI's Add button does.
const cfg = await (await call(`${BASE}/api/config`)).json();
if (!cfg.repos.some(r => norm(r) === repo)) {
  cfg.repos.push(repo);
  const put = await call(`${BASE}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg)
  });
  if (!put.ok) {
    console.log(`Đăng ký repo lỗi ${put.status}: ${await put.text()}`);
    process.exit(1);
  }
  console.log('Đã thêm repo vào Context Engine.');
}

const res = await call(`${BASE}/api/repos/${repoId}/index`, { method: 'POST' });
if (!res.ok) {
  console.log(`POST index lỗi ${res.status}: ${await res.text()}`);
  process.exit(1);
}

let last = '', seenIndexing = false;
const started = Date.now();
for (;;) {
  const s = await getStatus();
  const line = fmt(s);
  if (line !== last) console.log(`[${new Date().toLocaleTimeString()}] ${line}`);
  last = line;
  if (s?.state === 'indexing') seenIndexing = true;
  // Safety net: never wait forever if the engine still doesn't list the repo.
  if (!s && Date.now() - started > 60000) {
    console.log('Sau 60s repo vẫn chưa xuất hiện trong /api/index-status — kiểm tra UI http://localhost:6699.');
    process.exit(2);
  }
  // Right after POST the status may still show the old 'indexed' state, so wait for 'indexing' (max 20s).
  const finished = s && s.state !== 'indexing' && s.state !== 'queued' && (seenIndexing || Date.now() - started > 20000);
  if (finished) {
    // Never saw 'indexing': it either finished between two polls or the engine ignored the request.
    if (!seenIndexing && s.state !== 'error') {
      console.log('⚠️ Không thấy trạng thái indexing sau 20s — có thể engine đã bỏ qua yêu cầu; số file ở trên có thể là của lần index trước. Kiểm tra lại bằng --status hoặc UI http://localhost:6699.');
    }
    process.exit(s.state === 'error' ? 1 : 0);
  }
  await new Promise(r => setTimeout(r, 2000));
}
