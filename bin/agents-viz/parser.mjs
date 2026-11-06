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

// Keeps the end of a long value (paths: the file name matters, not the drive).
function truncateStart(s, max = TARGET_MAX) {
  const one = String(s).replace(/\s+/g, ' ').trim();
  return one.length > max ? '…' + one.slice(one.length - max + 1) : one;
}

const PATH_KEYS = new Set(['file_path', 'notebook_path', 'path']);
const CD_PREFIX = /^\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s&;]+)\s*(?:&&|;)\s*/;

// Drops leading `cd "<dir>" &&` hops so the real command stays visible.
export function stripCd(command) {
  let c = String(command || '');
  for (let i = 0; i < 5 && CD_PREFIX.test(c); i++) c = c.replace(CD_PREFIX, '');
  return c.trim();
}

export function toolTarget(input) {
  if (!input || typeof input !== 'object') return '';
  const keys = ['file_path', 'notebook_path', 'command', 'pattern', 'path', 'url',
    'query', 'skill', 'description', 'prompt'];
  for (const k of keys) {
    if (typeof input[k] !== 'string' || !input[k]) continue;
    if (PATH_KEYS.has(k)) return truncateStart(input[k]);
    if (k === 'command') return truncate(stripCd(input[k]) || input[k]);
    return truncate(input[k]);
  }
  return '';
}

// ---------- human labels ----------

const LABEL_OBJECT_MAX = 60;
const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const TEST_CMD = /^(?:npm (?:run )?test|npx vitest|vitest|npx jest|jest|pytest|python3? -m pytest|node --test|go test|cargo test)\b/;
const INSTALL_CMD = /^(?:npm (?:i|install)|pnpm add|yarn add|pip3? install)\b/;

const lbl = (verb, verbPast, object = '') => ({ verb, verbPast, object: truncate(object, LABEL_OBJECT_MAX) });

export const STARTING_LABEL = lbl('Đang khởi động agent…', 'Đã khởi động agent', '');

// Plain-language label for one tool call: {verb, verbPast, object}.
export function toolLabel(name, input) {
  const i = input && typeof input === 'object' ? input : {};
  const str = (k) => (typeof i[k] === 'string' ? i[k] : '');
  const tool = String(name || '');
  switch (tool) {
    case 'Read': return lbl('Đang đọc', 'Đã đọc', basename(str('file_path')));
    case 'Edit': case 'MultiEdit': return lbl('Đang sửa', 'Đã sửa', basename(str('file_path')));
    case 'Write': return lbl('Đang tạo', 'Đã tạo', basename(str('file_path')));
    case 'NotebookEdit': return lbl('Đang sửa notebook', 'Đã sửa notebook', basename(str('notebook_path')));
    case 'Bash': {
      const cmd = stripCd(str('command')).replace(/\s+/g, ' ');
      if (TEST_CMD.test(cmd)) return lbl('Đang chạy test', 'Đã chạy test');
      const git = /^git\s+([A-Za-z][\w-]*)/.exec(cmd);
      if (git) return lbl('Đang thao tác git', 'Đã thao tác git', `git ${git[1]}`);
      if (INSTALL_CMD.test(cmd)) return lbl('Đang cài package', 'Đã cài package');
      return lbl('Đang chạy lệnh', 'Đã chạy lệnh', truncate(cmd, 40));
    }
    case 'Grep': return lbl('Đang tìm', 'Đã tìm', str('pattern') ? `"${truncate(str('pattern'), LABEL_OBJECT_MAX - 2)}"` : '');
    case 'Glob': return lbl('Đang liệt kê tệp', 'Đã liệt kê tệp', str('pattern'));
    case 'Skill': return lbl('Đang dùng skill', 'Đã dùng skill', str('skill').replace(/^osf:/, ''));
    case 'Agent': case 'Task': return lbl('Đang giao việc cho agent', 'Đã giao việc', str('description'));
    case 'WebSearch': return lbl('Đang tìm trên web', 'Đã tìm trên web', truncate(str('query'), 30));
    case 'WebFetch': {
      let host = '';
      try { host = new URL(str('url')).hostname; } catch { /* not a URL */ }
      return lbl('Đang đọc trang', 'Đã đọc trang', host);
    }
    case 'TodoWrite': return lbl('Đang cập nhật checklist', 'Đã cập nhật checklist');
    default: break;
  }
  if (/^mcp__codebase-retrieval__/.test(tool)) return lbl('Đang tra cứu codebase', 'Đã tra cứu codebase');
  const mcp = /^mcp__(.+?)__/.exec(tool);
  if (mcp) return lbl('Đang gọi công cụ', 'Đã gọi công cụ', mcp[1]);
  if (/^Task[A-Z]/.test(tool)) return lbl('Đang cập nhật checklist', 'Đã cập nhật checklist');
  return lbl('Đang dùng', 'Đã dùng', tool);
}

// First "Gate:" / "## " line of a final report, without the markdown hashes.
export function resultLine(report) {
  const lines = String(report || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => /^#{1,3}\s*Gate:/.test(l) || /^Gate:/.test(l) || /^## /.test(l)) || lines[0] || '';
  return truncate(hit.replace(/^#+\s*/, '').replace(/\*\*/g, ''), 100);
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
      timeline.push({ tool: c.name, target: toolTarget(c.input), label: toolLabel(c.name, c.input), ts: rec.timestamp || null });
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
        skills.push({ id: `cmd-${rec.uuid || order}`, name: m[1], args: truncate(a ? a[1] : '', 300), rawArgs: a ? a[1] : '', ts: rec.timestamp || null, source: 'command', order });
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
        skills.push({ id: b.id, name: String(input.skill || 'skill'), args: truncate(input.args || '', 300), rawArgs: String(input.args || ''), ts: rec.timestamp || null, source: 'tool', order, calledBy: rec.attributionSkill || null });
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

  for (const a of out) {
    const busy = a.status === 'running' || a.status === 'stalled';
    a.doingNowLabel = a.placeholder && busy ? STARTING_LABEL : (a.lastTool ? a.lastTool.label : null);
    a.resultLine = busy ? '' : resultLine(a.report);
  }
  const pipeline = computePipeline({ agents: out, waves, skills, mainMtimeMs, now });

  return {
    pipeline,
    title,
    skills: skills.map(({ order, rawArgs, ...s }) => s),
    agents: out,
    waves,
    idleTypes,
    counts,
    warnings,
  };
}

// ---------- pipeline (stepper) ----------

export const STEP_ORDER = ['kickoff', 'spec', 'specGate', 'tdd', 'coding', 'e2e', 'security', 'verify', 'archive'];
export const STEP_LABEL = {
  kickoff: 'Kickoff', spec: 'Spec', specGate: 'Spec gate', tdd: 'TDD', coding: 'Coding',
  e2e: 'E2E', security: 'Security', verify: 'Verify', archive: 'Archive',
};
// security and verify share a position: they run together as the gates.
const STEP_IDX = { kickoff: 0, spec: 1, specGate: 2, tdd: 3, coding: 4, e2e: 5, security: 6, verify: 6, archive: 7 };
const TYPE_STEP = {
  'osf-spec-review': 'specGate', 'osf-tdd': 'tdd', 'osf-apply': 'coding', 'osf-e2e': 'e2e',
  'osf-security': 'security', 'osf-verify': 'verify', 'osf-archive': 'archive',
  'osf-analyze': 'spec', 'osf-researcher': 'spec',
};
const KICKOFF_TYPES = new Set(['osf-pm', 'osf-ba', 'osf-qa']);
const SKILL_STEP = { proposal: 'spec', tdd: 'tdd', e2e: 'e2e' };
const skillKey = (name) => String(name || '').replace(/^\//, '').replace(/^osf:/, '');
const tsNum = (ts) => { const n = Date.parse(ts || ''); return Number.isNaN(n) ? Infinity : n; };
// Review steps: a fresh wave after a cut or a skill call is a re-run, not fan-out.
const GATE_STEPS = new Set(['specGate', 'security', 'verify', 'archive']);
// "Security gate review (rerun)" / "Spec gate re-review" -> same work as the first run.
export function normDesc(d) {
  return String(d || '').toLowerCase()
    .replace(/\([^)]*\b(?:re-?run|retry|again|redo|attempt|round)\b[^)]*\)/g, ' ')
    .replace(/\b(?:re-?run|retry|again|redo)\b/g, ' ')
    .replace(/\bre-(?=[a-z])/g, '')
    .replace(/\b(?:attempt|round|try)\s*#?\d+\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const workKey = (a) => { const d = normDesc(a.description); return d ? `${shortType(a.type)}|${d}` : null; };

function stateOf(agents) {
  const st = new Set(agents.map((a) => a.status));
  if (st.has('running')) return 'running';
  if (st.has('stalled')) return 'stalled';
  if (st.has('cut')) return 'cut';
  return 'done';
}

/**
 * Maps agents onto the osf pipeline steps and finds the current step.
 * Sets agent.step on every agent; returns
 * {kind, finished, stopped, stoppedAt, round, steps:[{key,label,state,agentIds,attempts,round,startedAt,endedAt}],
 *  current:[key], loops:[{from,to,round}], otherAgentIds}.
 * Step state: pending | waiting | running | stalled | cut | done | skipped.
 */
export function computePipeline({ agents, waves, skills, mainMtimeMs, now }) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const waveByIdx = new Map(waves.map((w) => [w.index, w]));
  const skillById = new Map(skills.map((s) => [s.id, s]));
  const hasSkill = (k) => skills.some((s) => skillKey(s.name) === k);
  const hasTeam = hasSkill('team');

  const isKickoffWave = (w) => {
    const sk = skillById.get(w.skillId);
    if (sk && skillKey(sk.name) === 'team') return true;
    return w.agentIds.some((id) => byId.has(id) && KICKOFF_TYPES.has(shortType(byId.get(id).type)));
  };
  const stepOf = (a, depth = 0) => {
    if (a.step !== undefined) return a.step;
    const parent = a.parentAgentId && byId.get(a.parentAgentId);
    if (parent && parent !== a && depth < 20) return (a.step = stepOf(parent, depth + 1));
    const w = a.wave != null ? waveByIdx.get(a.wave) : null;
    if (w && !w.parentAgentId && isKickoffWave(w)) return (a.step = 'kickoff');
    return (a.step = TYPE_STEP[shortType(a.type)] || 'other');
  };
  for (const a of agents) delete a.step;
  for (const a of agents) stepOf(a);

  const keys = STEP_ORDER.filter((k) => k !== 'kickoff' || hasTeam || agents.some((a) => a.step === 'kickoff'));
  // standalone: a single osf skill (e2e, tdd, apply, ...) ran without autopilot/team.
  const kind = keys.includes('kickoff') ? 'team'
    : hasSkill('autopilot') ? 'autopilot'
    : (hasSkill('proposal') || agents.some((a) => a.step !== 'other')) ? 'standalone' : 'none';
  const standalone = kind === 'standalone';
  const flagged = (flag) => skills.some((s) => ['autopilot', 'team'].includes(skillKey(s.name)) &&
    new RegExp(`(^|\\s)${flag}(\\s|$)`).test(s.rawArgs || s.args || ''));
  const noTdd = flagged('--no-tdd');
  const noE2e = flagged('--no-e2e');

  // Root waves in time order; unlinked root agents count as their own wave.
  const rootWaves = waves.filter((w) => !w.parentAgentId).map((w) => ({ ts: w.ts, agentIds: w.agentIds }));
  for (const a of agents) if (a.wave == null && !a.parentAgentId) rootWaves.push({ ts: a.startedAt, agentIds: [a.id] });
  rootWaves.sort((x, y) => tsNum(x.ts) - tsNum(y.ts));

  const info = Object.fromEntries(keys.map((k) => [k, { attempts: 0, round: null, latest: null, latestTs: null, firstTs: null, all: [], ran: new Set() }]));
  // A wave starts a new attempt only when it re-runs work already done in
  // this round; consecutive fan-out waves of the same step are one attempt.
  const isRerun = (k, list, ts) => {
    const s = info[k];
    if (s.latest == null) return false;
    if (list.some((a) => s.ran.has(workKey(a)))) return true;
    if (!GATE_STEPS.has(k) || s.latest.some((a) => a.status === 'running' || a.status === 'stalled')) return false;
    if (s.latest.some((a) => a.status === 'cut')) return true;
    const from = tsNum(s.latestTs);
    const to = tsNum(ts);
    return skills.some((sk) => tsNum(sk.ts) > from && tsNum(sk.ts) < to);
  };
  const loops = [];
  let round = 1;
  let maxIdx = -1;
  let prevKeys = null;
  const stepped = []; // [{ts, groups: Map(step -> agents)}]
  for (const w of rootWaves) {
    const groups = new Map();
    for (const id of w.agentIds) {
      const a = byId.get(id);
      if (!a || !info[a.step]) continue;
      if (!groups.has(a.step)) groups.set(a.step, []);
      groups.get(a.step).push(a);
    }
    if (!groups.size) continue;
    stepped.push({ ts: w.ts, groups });
    if (groups.has('coding') && maxIdx > STEP_IDX.coding) {
      round++;
      const from = prevKeys.some((k) => k === 'security' || k === 'verify') ? 'gates'
        : prevKeys.reduce((m, k) => (STEP_IDX[k] > STEP_IDX[m] ? k : m), prevKeys[0]);
      loops.push({ from, to: 'coding', round });
      for (const k of keys) {
        if (STEP_IDX[k] >= STEP_IDX.coding) Object.assign(info[k], { attempts: 0, latest: null, latestTs: null, firstTs: null, round: null, ran: new Set() });
      }
      maxIdx = STEP_IDX.coding;
    }
    for (const [k, list] of groups) {
      const s = info[k];
      if (!s.latest) { s.attempts = 1; s.latest = list; }
      else if (isRerun(k, list, w.ts)) { s.attempts++; s.latest = list; }
      else s.latest = s.latest.concat(list);
      s.latestTs = w.ts;
      for (const a of list) { const wk = workKey(a); if (wk) s.ran.add(wk); }
      s.round = round;
      if (!s.firstTs) s.firstTs = w.ts;
      s.all.push(...list.map((a) => a.id));
      for (const a of list) a.round = round;
      maxIdx = Math.max(maxIdx, STEP_IDX[k]);
    }
    prevKeys = [...groups.keys()];
  }
  // Nested agents work for their parent's step (and round).
  const rootOf = (a, depth = 0) => (a.parentAgentId && byId.get(a.parentAgentId) && depth < 20 ? rootOf(byId.get(a.parentAgentId), depth + 1) : a);
  for (const a of agents) {
    if (a.round === undefined) a.round = a.parentAgentId ? (rootOf(a).round ?? null) : null;
    if (a.parentAgentId && info[a.step] && !info[a.step].all.includes(a.id)) info[a.step].all.push(a.id);
  }

  const anyRunning = agents.some((a) => a.status === 'running');
  const idle = !anyRunning && (typeof mainMtimeMs !== 'number' || now - mainMtimeMs > STALLED_MS);
  const proposalSkill = skills.find((s) => skillKey(s.name) === 'proposal');
  const laterStarted = (k) => keys.some((o) => STEP_IDX[o] > STEP_IDX[k] && info[o].latest);

  const state = {};
  for (const k of keys) {
    const s = info[k];
    if (s.latest) state[k] = stateOf(s.latest);
    // An inline proposal skill in an idle session has returned.
    else if (k === 'spec' && proposalSkill) state[k] = laterStarted(k) || idle ? 'done' : 'running';
    else if ((k === 'tdd' && noTdd) || (k === 'e2e' && noE2e)) state[k] = 'skipped';
    else if (laterStarted(k)) state[k] = 'skipped';
    else state[k] = 'pending';
  }

  // Current step.
  let current = [];
  let finished = false;
  let stopped = false;
  let stoppedAt = null;
  for (let i = stepped.length - 1; i >= 0 && !current.length; i--) {
    const { groups } = stepped[i];
    const busy = [...groups.values()].flat().some((a) => a.status === 'running' || a.status === 'stalled');
    if (busy) current = [...groups.keys()];
  }
  if (!current.length && !idle) {
    const lastTs = stepped.length ? tsNum(stepped[stepped.length - 1].ts) : -Infinity;
    const sk = [...skills].reverse().find((s) => SKILL_STEP[skillKey(s.name)] && tsNum(s.ts) > lastTs &&
      keys.includes(SKILL_STEP[skillKey(s.name)]));
    if (sk) {
      const k = SKILL_STEP[skillKey(sk.name)];
      current = [k];
      state[k] = 'running';
    }
  }
  // Standalone sessions show only the steps that actually ran.
  const ran = (k) => !!info[k].latest || (k === 'spec' && !!proposalSkill) || current.includes(k);
  const last = stepped[stepped.length - 1];
  if (standalone && !current.length) {
    const shownKeys = keys.filter(ran);
    if (idle) {
      if (shownKeys.every((k) => state[k] === 'done')) finished = true;
      else {
        stopped = true;
        const reached = last ? [...last.groups.keys()] : shownKeys;
        stoppedAt = reached.reduce((m, k) => (m == null || STEP_IDX[k] > STEP_IDX[m] || (STEP_IDX[k] === STEP_IDX[m] && k === 'security') ? k : m), null) || shownKeys[0] || null;
      }
    } else {
      // Active between agents: the next step is unknown, stay on the last one that ran.
      current = last ? [...last.groups.keys()] : shownKeys.slice(-1);
    }
  } else if (!current.length) {
    if (state.archive === 'done' || (idle && kind === 'none')) finished = true;
    else if (idle) {
      // Idle: finished only when nothing is left to do — or a Verified run whose
      // last wave was the gates, all done (archive never reached).
      const lastAgents = last ? [...last.groups.values()].flat() : [];
      const gatesDone = !!last && (last.groups.has('security') || last.groups.has('verify')) &&
        !last.groups.has('coding') && lastAgents.every((a) => a.status === 'done');
      const open = keys.some((k) => state[k] !== 'done' && state[k] !== 'skipped');
      if (gatesDone || !open) {
        finished = true;
        for (const k of keys) if (state[k] === 'pending') state[k] = 'skipped';
      } else {
        stopped = true;
        const reached = last ? [...last.groups.keys()] : keys.filter((k) => state[k] !== 'pending' && state[k] !== 'skipped');
        stoppedAt = reached.reduce((m, k) => (m == null || STEP_IDX[k] > STEP_IDX[m] || (STEP_IDX[k] === STEP_IDX[m] && k === 'security') ? k : m), null) || keys[0];
      }
    } else {
      const next = keys.find((k) => state[k] !== 'done' && state[k] !== 'skipped');
      if (!next) finished = true;
      else {
        current = next === 'security' || next === 'verify'
          ? ['security', 'verify'].filter((k) => state[k] !== 'done' && state[k] !== 'skipped')
          : [next];
        for (const k of current) if (state[k] === 'pending') state[k] = 'waiting';
      }
    }
  }

  const steps = (standalone ? keys.filter(ran) : keys).map((k) => {
    const s = info[k];
    const st = state[k];
    let endedAt = null;
    if (s.latest && (st === 'done' || st === 'cut')) {
      endedAt = s.latest.map((a) => a.endedAt || a.lastActivityAt).filter(Boolean).sort().pop() || null;
    }
    return {
      key: k, label: STEP_LABEL[k], state: st, agentIds: s.all, attempts: s.attempts,
      round: s.round, startedAt: s.firstTs || (k === 'spec' && proposalSkill ? proposalSkill.ts : null), endedAt,
    };
  });
  return {
    kind,
    finished,
    stopped,
    stoppedAt,
    round,
    steps,
    current,
    loops,
    otherAgentIds: agents.filter((a) => !info[a.step]).map((a) => a.id),
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
