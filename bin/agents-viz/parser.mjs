// osf agents-viz parser — reads Claude Code transcripts (read-only) and builds
// the agent tree for one session. Pure parsing functions take strings; the
// small I/O helpers at the bottom only read the paths they are given.
import fs from 'node:fs';
import path from 'node:path';

export const RUNNING_MS = 2 * 60 * 1000;
export const STALLED_MS = 10 * 60 * 1000;
const TARGET_MAX = 120;
const TIMELINE_MAX = 500;
const AGENT_TOOLS = new Set(['Agent', 'Task']);
export const MAX_JSONL_BYTES = 8 * 1024 * 1024; // per file; larger files keep head + tail
const HEAD_BYTES = 256 * 1024;

// ---------- path safety ----------

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export function isSafeName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 &&
    SAFE_NAME.test(name) && !name.includes('..') && name !== '.';
}

// Joins validated names under root; returns null when any name is unsafe or
// the resolved path escapes root.
export function safeJoin(root, ...names) {
  if (!names.every(isSafeName)) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, ...names);
  const rel = path.relative(base, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

// Claude Code names project dirs by replacing every non-alphanumeric char of
// the cwd with "-" (C:\Users\admin -> C--Users-admin).
export function projectDirName(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, '-');
}

// ---------- jsonl ----------

export function parseJsonl(text) {
  const records = [];
  let malformed = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec === 'object') records.push(rec);
      else malformed++;
    } catch {
      malformed++;
    }
  }
  return { records, malformed };
}

function parseJson(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

const contentOf = (rec) => {
  const c = rec && rec.message && rec.message.content;
  return Array.isArray(c) ? c : [];
};

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text).join('\n');
}

function truncate(s, max = TARGET_MAX) {
  const one = String(s).replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

export function toolTarget(input) {
  if (!input || typeof input !== 'object') return '';
  const keys = ['file_path', 'notebook_path', 'command', 'pattern', 'path', 'url',
    'query', 'skill', 'description', 'prompt'];
  for (const k of keys) {
    if (typeof input[k] === 'string' && input[k]) return truncate(input[k]);
  }
  return '';
}

// ---------- status ----------

// Text-only fallback for the exact usage-limit wording; everything else must
// come from the real error flags so a normal report mentioning "rate limit"
// is never marked as cut.
const LIMIT_TEXT = /^\s*You['’]ve hit your .{0,40}limit/i;

// Expected closing report per osf agent type. A missing header is reported as
// a warning, not as a cut: real plan-mode runs end with prose reports.
const CLOSING = {
  'osf-security': [/^#{2,3} .*Gate:/m, /^## .*Threat Model/m, /^## .*Security Review/m],
  'osf-spec-review': [/^#{2,3} .*Gate:/m],
  'osf-verify': [/^## .*Verification Report/m],
  'osf-apply': [/^## ✅/m, /^## ⛔/m],
  'osf-archive': [/^## .*Archive Complete/m],
};
const CLOSING_LABEL = {
  'osf-security': '### Gate:',
  'osf-spec-review': '### Gate:',
  'osf-verify': '## Verification Report',
  'osf-apply': '## ✅ …',
  'osf-archive': '## Archive Complete',
};

export function shortType(type) {
  return String(type || '').replace(/^osf:/, '');
}

export function errorMarker(rec) {
  if (!rec) return null;
  const text = textOf(rec.message && rec.message.content);
  if (rec.isApiErrorMessage === true || (rec.message && rec.message.model === '<synthetic>') ||
      (typeof rec.error === 'string' && rec.error)) {
    return truncate(text || rec.error || 'API error', 200);
  }
  if (LIMIT_TEXT.test(text) && text.length < 400) return truncate(text, 200);
  return null;
}

// Decides status from facts; `now` and `mtimeMs` are passed in so tests stay
// deterministic.
export function agentStatus({ finished, lastAssistant, report, type, mtimeMs, now }) {
  const err = errorMarker(lastAssistant);
  if (finished) {
    if (err) return { status: 'cut', reason: err };
    if (!report || !report.trim()) return { status: 'cut', reason: 'Kết thúc mà không có báo cáo cuối' };
    const want = CLOSING[shortType(type)];
    if (want && !want.some((re) => re.test(report))) {
      return { status: 'done', reason: null, reportWarning: `Thiếu báo cáo đóng ${CLOSING_LABEL[shortType(type)]}` };
    }
    return { status: 'done', reason: null };
  }
  const age = typeof mtimeMs === 'number' ? now - mtimeMs : Infinity;
  if (err && age > RUNNING_MS) return { status: 'cut', reason: err };
  if (age > STALLED_MS) return { status: 'stalled', reason: `Không ghi gì trong ${Math.round(age / 60000)} phút` };
  return { status: 'running', reason: null };
}

// ---------- subagent transcript ----------

export function parseAgentTranscript(records) {
  let brief = '';
  let startedAt = null;
  let lastTs = null;
  let lastAssistant = null;
  let lastToolIdx = -1;
  const assistants = [];
  const timeline = [];
  const agentCalls = []; // nested Agent calls: {toolUseId, messageId, ts}
  const toolUseIds = [];

  for (const rec of records) {
    if (rec.timestamp) {
      if (!startedAt) startedAt = rec.timestamp;
      lastTs = rec.timestamp;
    }
    if (rec.type === 'user' && !brief && !rec.toolUseResult) {
      const c = rec.message && rec.message.content;
      const t = typeof c === 'string' ? c : textOf(c);
      if (t) brief = t;
    }
    if (rec.type !== 'assistant') continue;
    assistants.push(rec);
    lastAssistant = rec;
    for (const c of contentOf(rec)) {
      if (!c || c.type !== 'tool_use') continue;
      lastToolIdx = assistants.length - 1;
      toolUseIds.push(c.id);
      timeline.push({ tool: c.name, target: toolTarget(c.input), ts: rec.timestamp || null });
      if (AGENT_TOOLS.has(c.name)) {
        agentCalls.push({ toolUseId: c.id, messageId: (rec.message && rec.message.id) || rec.uuid, ts: rec.timestamp, input: c.input || {} });
      }
    }
  }
  const report = assistants.slice(lastToolIdx + 1).map((r) => textOf(r.message && r.message.content))
    .filter(Boolean).join('\n\n');
  return {
    brief,
    startedAt,
    lastTs,
    lastAssistant,
    report,
    timeline: timeline.length > TIMELINE_MAX ? timeline.slice(-TIMELINE_MAX) : timeline,
    agentCalls,
    toolUseIds,
  };
}

// ---------- orchestrator transcript ----------

const stripTags = (s) => String(s).replace(/<\/?(?:command-[a-z]+|local-command-[a-z]+|system-reminder)>/g, ' ');
const CMD_RE = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/;
const ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/;

export function parseMainTranscript(records) {
  const skills = [];
  const calls = []; // Agent/Task tool_use in the orchestrator
  const results = new Map(); // tool_use_id -> {isError, status}
  let title = '';
  records.forEach((rec, order) => {
    if (rec.type === 'last-prompt' && typeof rec.lastPrompt === 'string' && !title) title = rec.lastPrompt;
    if (rec.type === 'user') {
      const c = rec.message && rec.message.content;
      const t = typeof c === 'string' ? c : textOf(c);
      const m = t && CMD_RE.exec(t);
      if (m) {
        const a = ARGS_RE.exec(t);
        skills.push({ id: `cmd-${rec.uuid || order}`, name: m[1], args: truncate(a ? a[1] : '', 300), ts: rec.timestamp || null, source: 'command', order });
        if (!title) title = `/${m[1]} ${a ? a[1] : ''}`;
      }
      if (!title && t && !rec.toolUseResult && !rec.isMeta) title = stripTags(t);
      for (const b of contentOf(rec)) {
        if (b && b.type === 'tool_result' && b.tool_use_id) {
          const tur = rec.toolUseResult;
          results.set(b.tool_use_id, { isError: b.is_error === true, status: tur && typeof tur === 'object' ? tur.status : null });
        }
      }
      return;
    }
    if (rec.type !== 'assistant') return;
    for (const b of contentOf(rec)) {
      if (!b || b.type !== 'tool_use') continue;
      const input = b.input || {};
      if (b.name === 'Skill') {
        skills.push({ id: b.id, name: String(input.skill || 'skill'), args: truncate(input.args || '', 300), ts: rec.timestamp || null, source: 'tool', order, calledBy: rec.attributionSkill || null });
      } else if (AGENT_TOOLS.has(b.name)) {
        calls.push({ toolUseId: b.id, messageId: (rec.message && rec.message.id) || rec.uuid, ts: rec.timestamp || null, input, order, attributionSkill: rec.attributionSkill || null });
      }
    }
  });
  return { skills, calls, results, title: truncate(title, 160) };
}

// ---------- session ----------

/**
 * @param {object} p
 * @param {string} p.mainText orchestrator jsonl
 * @param {number} [p.mainMtimeMs]
 * @param {boolean} [p.mainTruncated] the orchestrator jsonl was read partially
 * @param {Array<{agentId:string, metaText?:string, jsonlText?:string, mtimeMs?:number, truncated?:boolean}>} p.agents
 * @param {number} p.now
 * @param {string[]} [p.knownTypes] osf agent types for the idle panel (e.g. "osf-apply")
 */
export function parseSession({ mainText, mainMtimeMs, mainTruncated = false, agents = [], now, knownTypes = [] }) {
  const warnings = { malformedLines: 0, unlinkedAgents: 0, badMeta: 0, truncated: mainTruncated ? 1 : 0 };
  const main = parseJsonl(mainText);
  warnings.malformedLines += main.malformed;
  const { skills, calls, results, title } = parseMainTranscript(main.records);

  const out = [];
  const byToolUse = new Map(); // tool_use id -> agent
  const parentOfToolUse = new Map(); // tool_use id -> agentId (nested calls)
  const nestedCalls = [];

  for (const a of agents) {
    const meta = a.metaText != null ? parseJson(a.metaText) : null;
    if (a.metaText != null && !meta) warnings.badMeta++;
    if (a.truncated) warnings.truncated++;
    const parsed = parseJsonl(a.jsonlText || '');
    warnings.malformedLines += parsed.malformed;
    const t = parseAgentTranscript(parsed.records);
    const finished = !!(meta && meta.finished === true);
    const type = (meta && meta.agentType) || 'unknown';
    const st = agentStatus({ finished, lastAssistant: t.lastAssistant, report: t.report, type, mtimeMs: a.mtimeMs, now });
    const lastTool = t.timeline[t.timeline.length - 1] || null;
    const agent = {
      id: a.agentId,
      type,
      isOsf: /^osf:/.test(type),
      description: (meta && meta.description) || '',
      parentToolUseId: (meta && meta.toolUseId) || null,
      parentAgentId: null,
      skillId: null,
      wave: null,
      spawnDepth: (meta && meta.spawnDepth) || 1,
      background: !!(meta && meta.requestShape === 'background'),
      model: (meta && meta.pickedEffortModel) || null,
      brief: t.brief,
      toolTimeline: t.timeline,
      doingNow: st.status === 'running' || st.status === 'stalled' ? lastTool : null,
      lastTool,
      report: t.report,
      status: st.status,
      statusReason: st.reason,
      reportWarning: st.reportWarning || null,
      startedAt: t.startedAt,
      endedAt: finished ? t.lastTs : null,
      lastActivityAt: t.lastTs,
    };
    out.push(agent);
    if (agent.parentToolUseId) byToolUse.set(agent.parentToolUseId, agent);
    for (const id of t.toolUseIds) parentOfToolUse.set(id, a.agentId);
    for (const c of t.agentCalls) nestedCalls.push({ ...c, parentAgentId: a.agentId });
  }

  // Placeholders: Agent calls in the orchestrator without a subagent file yet.
  for (const c of calls) {
    if (byToolUse.has(c.toolUseId)) continue;
    const r = results.get(c.toolUseId);
    let status = 'running';
    let reason = 'Chưa có transcript của agent';
    if (r && r.isError) { status = 'cut'; reason = 'Không khởi chạy được agent'; }
    else if (r && r.status === 'completed') { status = 'done'; reason = null; }
    else if (typeof mainMtimeMs === 'number' && now - mainMtimeMs > STALLED_MS) status = 'stalled';
    const type = String(c.input.subagent_type || 'general-purpose');
    const agent = {
      id: `pending-${c.toolUseId}`, type, isOsf: /^osf:/.test(type), description: String(c.input.description || ''),
      parentToolUseId: c.toolUseId, parentAgentId: null, skillId: null, wave: null, spawnDepth: 1,
      background: c.input.run_in_background === true, model: null,
      brief: typeof c.input.prompt === 'string' ? c.input.prompt : '', toolTimeline: [], doingNow: null, lastTool: null,
      report: '', status, statusReason: reason, reportWarning: null, startedAt: c.ts, endedAt: null, lastActivityAt: c.ts,
      placeholder: true,
    };
    out.push(agent);
    byToolUse.set(c.toolUseId, agent);
  }

  // Waves: Agent calls in the same assistant message (same message.id).
  const waves = [];
  const addWaves = (list, parentAgentId) => {
    const groups = new Map();
    for (const c of list) {
      const key = c.messageId || c.toolUseId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    for (const [messageId, group] of groups) {
      const agentIds = group.map((c) => byToolUse.get(c.toolUseId)).filter(Boolean).map((a) => a.id);
      if (!agentIds.length) continue;
      const wave = { index: waves.length + 1, parentAgentId, skillId: null, messageId, ts: group[0].ts, agentIds };
      waves.push(wave);
      for (const id of agentIds) {
        const ag = out.find((x) => x.id === id);
        ag.wave = wave.index;
        ag.parentAgentId = parentAgentId;
      }
      if (parentAgentId === null) {
        wave.skillId = skillFor(group[0], skills);
        for (const id of agentIds) out.find((x) => x.id === id).skillId = wave.skillId;
      }
    }
  };
  addWaves(calls, null);
  addWaves(nestedCalls, '__nested__');
  for (const w of waves) {
    if (w.parentAgentId === '__nested__') {
      const firstCall = nestedCalls.find((c) => byToolUse.get(c.toolUseId) && byToolUse.get(c.toolUseId).id === w.agentIds[0]);
      w.parentAgentId = firstCall ? firstCall.parentAgentId : null;
      for (const id of w.agentIds) out.find((x) => x.id === id).parentAgentId = w.parentAgentId;
    }
  }
  // Agents whose toolUseId was found in no transcript: attach to the root.
  for (const a of out) {
    if (a.wave !== null) continue;
    warnings.unlinkedAgents++;
    const owner = a.parentToolUseId && parentOfToolUse.get(a.parentToolUseId);
    a.parentAgentId = owner || null;
  }

  const idleTypes = knownTypes.map((t) => {
    const inst = out.filter((a) => shortType(a.type) === t);
    if (inst.some((a) => a.status === 'running')) return null;
    return { type: t, state: inst.length ? 'idle' : 'not-spawned', count: inst.length };
  }).filter(Boolean);

  out.sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  const counts = { running: 0, done: 0, cut: 0, stalled: 0 };
  for (const a of out) counts[a.status] = (counts[a.status] || 0) + 1;

  return {
    title,
    skills: skills.map(({ order, ...s }) => s),
    agents: out,
    waves,
    idleTypes,
    counts,
    warnings,
  };
}

function skillFor(call, skills) {
  const before = skills.filter((s) => s.order < call.order);
  if (call.attributionSkill) {
    for (let i = before.length - 1; i >= 0; i--) if (before[i].name === call.attributionSkill) return before[i].id;
  }
  return before.length ? before[before.length - 1].id : null;
}

// ---------- I/O helpers (read-only) ----------

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// Reads a jsonl file whole when it fits in maxBytes; otherwise keeps a head
// chunk (the brief / first prompt) plus a tail chunk (latest activity and the
// final report), both trimmed to whole lines.
export function readJsonlBounded(p, maxBytes = MAX_JSONL_BYTES) {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const size = fs.fstatSync(fd).size;
    if (size <= maxBytes) {
      const buf = Buffer.alloc(size);
      const n = fs.readSync(fd, buf, 0, size, 0);
      return { text: buf.subarray(0, n).toString('utf8'), truncated: false };
    }
    const headLen = Math.min(HEAD_BYTES, Math.floor(maxBytes / 4));
    const tailLen = maxBytes - headLen;
    const head = Buffer.alloc(headLen);
    const tail = Buffer.alloc(tailLen);
    const hn = fs.readSync(fd, head, 0, headLen, 0);
    const tn = fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    const h = head.subarray(0, hn);
    const t = tail.subarray(0, tn);
    const headPart = h.subarray(0, h.lastIndexOf(10) + 1);
    const tailPart = t.subarray(t.indexOf(10) + 1);
    return { text: headPart.toString('utf8') + tailPart.toString('utf8'), truncated: true };
  } catch {
    return { text: null, truncated: false };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

export function readKnownTypes(agentsDir) {
  try {
    return fs.readdirSync(agentsDir).filter((f) => /^osf-.*\.md$/.test(f)).map((f) => f.slice(0, -3)).sort();
  } catch {
    return [];
  }
}

export function listProjects(root) {
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  return names.filter(isSafeName).map((name) => {
    const dir = path.join(root, name);
    let latest = 0;
    let sessions = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        sessions++;
        const st = statSafe(path.join(dir, f));
        if (st && st.mtimeMs > latest) latest = st.mtimeMs;
      }
    } catch { /* unreadable dir */ }
    return { name, sessions, updatedAt: latest ? new Date(latest).toISOString() : null };
  }).filter((p) => p.sessions > 0).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function readHead(p, bytes) {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

function sessionTitle(mainPath) {
  const head = readHead(mainPath, 64 * 1024);
  const lines = head.split(/\r?\n/);
  lines.pop(); // possibly cut
  for (const line of lines) {
    const rec = parseJson(line);
    if (!rec) continue;
    if (rec.type === 'queue-operation' && typeof rec.content === 'string' && rec.content) return truncate(rec.content, 160);
    if (rec.type === 'user' && !rec.isMeta && !rec.toolUseResult) {
      const c = rec.message && rec.message.content;
      const t = typeof c === 'string' ? c : textOf(c);
      if (t) return truncate(stripTags(t), 160);
    }
  }
  return '';
}

function agentFiles(subDir) {
  let files = [];
  try { files = fs.readdirSync(subDir); } catch { return []; }
  return files.filter((f) => /^agent-[A-Za-z0-9_-]+\.meta\.json$/.test(f)).map((f) => f.slice(6, -10));
}

export function listSessions(root, project, now = Date.now(), limit = 200) {
  const dir = safeJoin(root, project);
  if (!dir) return null;
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && isSafeName(f)); } catch { return null; }
  const rows = files.map((f) => {
    const st = statSafe(path.join(dir, f));
    return { id: f.slice(0, -6), mtimeMs: st ? st.mtimeMs : 0 };
  }).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
  return rows.map(({ id, mtimeMs }) => {
    const subDir = path.join(dir, id, 'subagents');
    const ids = agentFiles(subDir);
    let anyRunning = false;
    for (const aid of ids) {
      const meta = parseJson(readSafe(path.join(subDir, `agent-${aid}.meta.json`)) || '');
      if (meta && meta.finished === true) continue;
      const st = statSafe(path.join(subDir, `agent-${aid}.jsonl`));
      if (st && now - st.mtimeMs <= STALLED_MS) { anyRunning = true; break; }
    }
    return {
      id,
      title: sessionTitle(path.join(dir, `${id}.jsonl`)),
      updatedAt: new Date(mtimeMs).toISOString(),
      agentCount: ids.length,
      anyRunning,
    };
  });
}

// Returns the parsed session, or null when the path is unsafe / missing.
export function loadSession(root, project, id, { now = Date.now(), knownTypes = [], maxBytes = MAX_JSONL_BYTES } = {}) {
  const mainPath = safeJoin(root, project, `${id}.jsonl`);
  if (!mainPath || !isSafeName(id)) return null;
  const st = statSafe(mainPath);
  if (!st || !st.isFile()) return null;
  const subDir = path.join(path.dirname(mainPath), id, 'subagents');
  const agents = agentFiles(subDir).map((agentId) => {
    const jp = path.join(subDir, `agent-${agentId}.jsonl`);
    const ast = statSafe(jp);
    const j = readJsonlBounded(jp, maxBytes);
    return {
      agentId,
      metaText: readSafe(path.join(subDir, `agent-${agentId}.meta.json`)),
      jsonlText: j.text || '',
      truncated: j.truncated,
      mtimeMs: ast ? ast.mtimeMs : undefined,
    };
  });
  const main = readJsonlBounded(mainPath, maxBytes);
  const session = parseSession({ mainText: main.text || '', mainMtimeMs: st.mtimeMs, mainTruncated: main.truncated, agents, now, knownTypes });
  return { project, id, updatedAt: new Date(st.mtimeMs).toISOString(), ...session };
}
