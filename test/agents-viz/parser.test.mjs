import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseJsonl, parseSession, agentStatus, isSafeName, safeJoin, projectDirName, loadSession, listSessions, listProjects,
  readJsonlBounded, RUNNING_MS, STALLED_MS, toolLabel, toolTarget, resultLine,
} from '../../bin/agents-viz/parser.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'projects');
const NOW = Date.parse('2026-01-02T00:00:00Z');
const jl = (...recs) => recs.map((r) => JSON.stringify(r)).join('\n');

const callLine = (msgId, toolUseId, type, extra = {}) => ({
  type: 'assistant', uuid: `u-${toolUseId}`, timestamp: '2026-01-01T10:00:00Z', ...extra,
  message: { id: msgId, role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { subagent_type: type, description: toolUseId, prompt: 'brief' } }] },
});
const agentText = (text, extra = {}) => jl(
  { type: 'user', timestamp: '2026-01-01T10:00:01Z', message: { role: 'user', content: 'Do the work.' } },
  { type: 'assistant', timestamp: '2026-01-01T10:00:02Z', message: { id: 'a1', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/x.js' } }] } },
  { type: 'assistant', timestamp: '2026-01-01T10:00:03Z', ...extra, message: { id: 'a2', model: extra.model || 'm', content: [{ type: 'text', text }] } },
);
const meta = (type, toolUseId, finished, description = 'd') => JSON.stringify({ agentType: type, description, toolUseId, spawnDepth: 1, ...(finished ? { finished: true } : {}) });

function one(type, jsonlText, { finished = true, mtimeMs = NOW - 1000 } = {}) {
  const s = parseSession({
    mainText: jl(callLine('m1', 'tu1', type)),
    agents: [{ agentId: 'aa1', metaText: meta(type, 'tu1', finished), jsonlText, mtimeMs }],
    now: NOW,
  });
  return s.agents[0];
}

test('done: kit agent finished with its closing report', () => {
  const a = one('agent:agent-verify', agentText('## Verification Report: x\n\nall good'));
  assert.equal(a.status, 'done');
  assert.equal(a.reportWarning, null);
  assert.equal(a.brief, 'Do the work.');
  assert.match(a.report, /Verification Report/);
  assert.deepEqual(a.toolTimeline.map((t) => [t.tool, t.target]), [['Edit', 'src/x.js']]);
});

test('cut: finished but last message is a rate-limit error', () => {
  const a = one('agent:agent-security', agentText("You've hit your 5-hour limit · resets 12:10pm", { isApiErrorMessage: true, error: 'rate_limit', model: '<synthetic>' }));
  assert.equal(a.status, 'cut');
  assert.match(a.statusReason, /5-hour limit/);
});

test('cut: usage-limit wording alone (no error flags) is still detected', () => {
  const a = one('general-purpose', agentText("You've hit your weekly limit · resets Mon"));
  assert.equal(a.status, 'cut');
});

test('cut: API error flagged by isApiErrorMessage', () => {
  const a = one('general-purpose', agentText('API Error: 529 overloaded_error', { isApiErrorMessage: true }));
  assert.equal(a.status, 'cut');
});

test('done: short report that mentions rate limit / API Error is not cut', () => {
  const a = one('agent:agent-security', agentText('### Gate: FAIL\n\n- HIGH: missing rate limit on /x\n- API Error handling leaks stack traces'));
  assert.equal(a.status, 'done');
  assert.equal(a.reportWarning, null);
  const g = one('general-purpose', agentText('API Error: 529 overloaded_error'));
  assert.equal(g.status, 'done', 'text without error flags is a normal report');
});

test('cut: finished with no final report after the last tool call', () => {
  const text = jl(
    { type: 'user', timestamp: '2026-01-01T10:00:01Z', message: { role: 'user', content: 'go' } },
    { type: 'assistant', timestamp: '2026-01-01T10:00:02Z', message: { id: 'a1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } },
  );
  assert.equal(one('agent:agent-apply', text).status, 'cut');
});

test('kit agent missing its closing report: done with a report warning', () => {
  const a = one('agent:agent-apply', agentText('I implemented it, tests pass.'));
  assert.equal(a.status, 'done');
  assert.match(a.reportWarning, /## ✅/);
  const s = one('agent:agent-security', agentText('Looks fine.'));
  assert.match(s.reportWarning, /### Gate:/);
});

test('new closing markers: archive failed, apply paused, e2e report, knowledge updated', () => {
  for (const [type, text] of [
    ['agent:agent-archive', '## Archive Failed\n\nStep: move'],
    ['agent:agent-apply', '## ⏸ Implementation Paused\n\nwaiting'],
    ['agent:agent-e2e', '## 🧪 E2E Report\n\n3/3 green'],
    ['agent:agent-knowledge', '## ✅ Knowledge Updated\n\n2 notes'],
  ]) {
    const a = one(type, agentText(text));
    assert.equal(a.status, 'done', type);
    assert.equal(a.reportWarning, null, type);
  }
  assert.match(one('agent:agent-e2e', agentText('All journeys pass.')).reportWarning, /E2E Report/);
  assert.match(one('agent:agent-knowledge', agentText('Saved notes.')).reportWarning, /Knowledge Updated/);
});

test('unknown agent type finished without error counts as done', () => {
  assert.equal(one('Explore', agentText('Found it.')).status, 'done');
});

test('running: not finished and written recently', () => {
  const a = one('agent:agent-apply', agentText('working'), { finished: false, mtimeMs: NOW - 30 * 1000 });
  assert.equal(a.status, 'running');
  assert.deepEqual(a.doingNow && a.doingNow.tool, 'Edit');
  const mid = one('agent:agent-apply', agentText('working'), { finished: false, mtimeMs: NOW - 5 * 60 * 1000 });
  assert.equal(mid.status, 'running', 'between 2 and 10 min is still running');
});

test('stalled: not finished and no write for more than 10 min', () => {
  const a = one('agent:agent-apply', agentText('working'), { finished: false, mtimeMs: NOW - STALLED_MS - 1000 });
  assert.equal(a.status, 'stalled');
});

test('agentStatus boundaries', () => {
  const base = { finished: false, lastAssistant: null, report: '', type: 'x', now: NOW };
  assert.equal(agentStatus({ ...base, mtimeMs: NOW - RUNNING_MS + 1 }).status, 'running');
  assert.equal(agentStatus({ ...base, mtimeMs: NOW - STALLED_MS + 1 }).status, 'running');
  assert.equal(agentStatus({ ...base, mtimeMs: NOW - STALLED_MS - 1 }).status, 'stalled');
});

test('parallel wave: two Agent calls in one assistant message share a wave', () => {
  const s = parseSession({
    mainText: jl(callLine('mA', 'tu1', 'agent:agent-tdd'), callLine('mA', 'tu2', 'agent:agent-tdd'), callLine('mB', 'tu3', 'agent:agent-verify')),
    agents: [
      { agentId: 'x1', metaText: meta('agent:agent-tdd', 'tu1', true), jsonlText: agentText('ok'), mtimeMs: NOW },
      { agentId: 'x2', metaText: meta('agent:agent-tdd', 'tu2', true), jsonlText: agentText('ok'), mtimeMs: NOW },
      { agentId: 'x3', metaText: meta('agent:agent-verify', 'tu3', true), jsonlText: agentText('## Verification Report'), mtimeMs: NOW },
    ],
    now: NOW,
  });
  const w = Object.fromEntries(s.agents.map((a) => [a.id, a.wave]));
  assert.equal(w.x1, w.x2);
  assert.notEqual(w.x1, w.x3);
  assert.equal(s.waves.length, 2);
  assert.deepEqual(s.waves[0].agentIds.sort(), ['x1', 'x2']);
});

test('skill call node: agents attach to the skill that spawned them', () => {
  const s = parseSession({
    mainText: jl(
      { type: 'user', uuid: 'c1', timestamp: '2026-01-01T09:00:00Z', message: { role: 'user', content: '<command-name>/agent:autopilot</command-name><command-args>go</command-args>' } },
      { type: 'assistant', uuid: 'k1', timestamp: '2026-01-01T09:01:00Z', message: { id: 'mk', content: [{ type: 'tool_use', id: 'sk1', name: 'Skill', input: { skill: 'agent:tdd', args: 'x' } }] } },
      callLine('mw', 'tu1', 'agent:agent-tdd', { attributionSkill: 'agent:autopilot' }),
      callLine('mz', 'tu2', 'agent:agent-tdd'),
    ),
    agents: [
      { agentId: 'x1', metaText: meta('agent:agent-tdd', 'tu1', true), jsonlText: agentText('ok'), mtimeMs: NOW },
      { agentId: 'x2', metaText: meta('agent:agent-tdd', 'tu2', true), jsonlText: agentText('ok'), mtimeMs: NOW },
    ],
    now: NOW,
  });
  assert.deepEqual(s.skills.map((k) => [k.name, k.source]), [['agent:autopilot', 'command'], ['agent:tdd', 'tool']]);
  const byId = Object.fromEntries(s.agents.map((a) => [a.id, a.skillId]));
  assert.equal(byId.x1, s.skills[0].id, 'attributionSkill wins when the skill appears earlier');
  assert.equal(byId.x2, 'sk1', 'otherwise the most recent skill call');
});

test('nested agent links to the subagent that spawned it', () => {
  const parentText = jl(
    { type: 'user', timestamp: '2026-01-01T10:00:01Z', message: { role: 'user', content: 'lead' } },
    { type: 'assistant', timestamp: '2026-01-01T10:00:02Z', message: { id: 'pm', content: [{ type: 'tool_use', id: 'tuNested', name: 'Agent', input: { subagent_type: 'Explore', description: 'n' } }] } },
    { type: 'assistant', timestamp: '2026-01-01T10:00:03Z', message: { id: 'pm2', content: [{ type: 'text', text: 'done' }] } },
  );
  const s = parseSession({
    mainText: jl(callLine('m1', 'tu1', 'general-purpose')),
    agents: [
      { agentId: 'p1', metaText: meta('general-purpose', 'tu1', true), jsonlText: parentText, mtimeMs: NOW },
      { agentId: 'c1', metaText: JSON.stringify({ agentType: 'Explore', toolUseId: 'tuNested', spawnDepth: 2, finished: true }), jsonlText: agentText('found'), mtimeMs: NOW },
    ],
    now: NOW,
  });
  const c = s.agents.find((a) => a.id === 'c1');
  assert.equal(c.parentAgentId, 'p1');
  assert.ok(c.wave);
});

test('malformed lines are counted, never thrown', () => {
  assert.deepEqual(parseJsonl('{"a":1}\nnot json\n{broken\n\n{"b":2}').malformed, 2);
  let s;
  assert.doesNotThrow(() => {
    s = parseSession({
      mainText: 'garbage\n' + jl(callLine('m1', 'tu1', 'agent:agent-apply')),
      agents: [{ agentId: 'a', metaText: '{not json', jsonlText: '{"type":"user"\n' + agentText('## ✅ Done'), mtimeMs: NOW }],
      now: NOW,
    });
  });
  assert.equal(s.warnings.malformedLines, 2);
  assert.equal(s.warnings.badMeta, 1);
});

test('placeholder for an Agent call whose transcript does not exist yet', () => {
  const s = parseSession({ mainText: jl(callLine('m1', 'tu9', 'agent:agent-verify')), mainMtimeMs: NOW, agents: [], now: NOW });
  assert.equal(s.agents.length, 1);
  assert.equal(s.agents[0].status, 'running');
  assert.equal(s.agents[0].placeholder, true);
});

test('idle types: running types hidden, others idle or not spawned', () => {
  const s = parseSession({
    mainText: jl(callLine('m1', 'tu1', 'agent:agent-apply'), callLine('m2', 'tu2', 'agent:agent-verify')),
    agents: [
      { agentId: 'x1', metaText: meta('agent:agent-apply', 'tu1', false), jsonlText: agentText('w'), mtimeMs: NOW },
      { agentId: 'x2', metaText: meta('agent:agent-verify', 'tu2', true), jsonlText: agentText('## Verification Report'), mtimeMs: NOW },
    ],
    now: NOW,
    knownTypes: ['agent-apply', 'agent-verify', 'agent-tdd'],
  });
  assert.deepEqual(s.idleTypes, [{ type: 'agent-verify', state: 'idle', count: 1 }, { type: 'agent-tdd', state: 'not-spawned', count: 0 }]);
});

test('path safety rejects traversal and absolute paths', () => {
  for (const bad of ['../x', '..', 'a/../b', 'a/b', 'a\\b', '/etc/passwd', 'C:\\Windows', 'C:', '', '.', 'x..y']) {
    assert.equal(isSafeName(bad), false, bad);
  }
  assert.equal(safeJoin(ROOT, '../x'), null);
  assert.equal(safeJoin(ROOT, path.resolve('/abs')), null);
  assert.equal(safeJoin(ROOT, '.'), null);
  assert.ok(safeJoin(ROOT, 'D--demo-app', 'sess-1.jsonl'));
  assert.equal(loadSession(ROOT, '..', 'sess-1'), null);
  assert.equal(loadSession(ROOT, 'D--demo-app', '../sess-1'), null);
  assert.equal(listSessions(ROOT, '../projects'), null);
});

test('listProjects and listSessions count only sessions that spawned kit agents', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-viz-'));
  const agent = (proj, sess, id, type) => {
    fs.mkdirSync(path.join(dir, proj, sess, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(dir, proj, sess, 'subagents', `agent-${id}.meta.json`), JSON.stringify({ agentType: type }));
  };
  try {
    for (const [proj, sess] of [['P--kit', 's1'], ['P--kit', 's2'], ['P--other', 's3'], ['P--plain', 's4']]) {
      fs.mkdirSync(path.join(dir, proj), { recursive: true });
      fs.writeFileSync(path.join(dir, proj, `${sess}.jsonl`), '');
    }
    agent('P--kit', 's1', 'a1', 'agent:agent-apply');
    agent('P--kit', 's1', 'a2', 'Explore');
    agent('P--kit', 's2', 'a3', 'agent-verify');
    agent('P--other', 's3', 'a4', 'general-purpose');
    agent('P--other', 's3', 'a5', 'claude-seo:seo-content');
    const byName = Object.fromEntries(listProjects(dir).map((p) => [p.name, p]));
    assert.equal(byName['P--kit'].sessions, 2);
    assert.equal(byName['P--kit'].kitSessions, 2);
    assert.equal(byName['P--other'].kitSessions, 0, 'agents of other kits do not count');
    assert.equal(byName['P--plain'].kitSessions, 0);
    const s1 = listSessions(dir, 'P--kit').find((x) => x.id === 's1');
    assert.equal(s1.agentCount, 2);
    assert.equal(s1.kitAgentCount, 1);
    assert.equal(listSessions(dir, 'P--other')[0].kitAgentCount, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('large transcripts are read head + tail with a truncated warning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-viz-'));
  try {
    const big = path.join(dir, 'big.jsonl');
    const first = JSON.stringify({ type: 'user', message: { role: 'user', content: 'BRIEF' } });
    const filler = Array.from({ length: 400 }, (_, i) => JSON.stringify({ type: 'progress', n: i, pad: 'x'.repeat(40) }));
    const last = JSON.stringify({ type: 'assistant', message: { id: 'z', content: [{ type: 'text', text: 'FINAL' }] } });
    fs.writeFileSync(big, [first, ...filler, last].join('\n') + '\n');
    const r = readJsonlBounded(big, 4096);
    assert.equal(r.truncated, true);
    assert.ok(Buffer.byteLength(r.text) <= 4096);
    const parsed = parseJsonl(r.text);
    assert.equal(parsed.malformed, 0, 'cut lines are dropped, not counted as malformed');
    const t = parsed.records;
    assert.equal(t[0].message.content, 'BRIEF');
    assert.equal(t[t.length - 1].message.content[0].text, 'FINAL');
    assert.equal(readJsonlBounded(big).truncated, false, 'default cap reads small files whole');

    const s = loadSession(ROOT, 'D--demo-app', 'sess-1', { now: NOW, maxBytes: 1024 });
    assert.ok(s.warnings.truncated >= 1);
    assert.equal(loadSession(ROOT, 'D--demo-app', 'sess-1', { now: NOW }).warnings.truncated, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('projectDirName mirrors Claude Code naming', () => {
  assert.equal(projectDirName('C:\\Users\\admin'), 'C--Users-admin');
  assert.equal(projectDirName('D:\\Projects\\agent-kit'), 'D--Projects-agent-kit');
});

test('fixture session on disk parses into the expected tree', () => {
  const s = loadSession(ROOT, 'D--demo-app', 'sess-1', { now: NOW, knownTypes: ['agent-apply', 'agent-archive', 'agent-verify'] });
  assert.equal(s.warnings.malformedLines, 1);
  assert.deepEqual(s.skills.map((k) => k.name), ['agent:autopilot', 'agent:archive']);
  const by = Object.fromEntries(s.agents.map((a) => [a.id, a]));
  assert.equal(by.a1apply.status, 'done');
  assert.equal(by.a2explore.status, 'done');
  assert.equal(by.a3archive.status, 'cut');
  assert.equal(by.a1apply.wave, by.a2explore.wave);
  assert.notEqual(by.a1apply.wave, by.a3archive.wave);
  assert.equal(by.a1apply.skillId, s.skills[0].id);
  assert.equal(by.a3archive.skillId, 'toolu_skill_archive');
  assert.equal(by.a2explore.isKitAgent, false);
  assert.equal(s.title, '/agent:autopilot add a demo command');
});

// ---------- labels & pipeline ----------

test('labels: path keeps the file name, cd prefix is stripped, tools get plain verbs', () => {
  const abs = path.join(os.tmpdir(), 'claude', 'very', 'long', 'scratch', 'dir', 'notes', 'src', 'commands', 'tag.js');
  assert.deepEqual(toolLabel('Read', { file_path: abs }), { verb: 'Đang đọc', verbPast: 'Đã đọc', object: 'tag.js' });
  assert.equal(toolLabel('Edit', { file_path: 'C:\\x\\y\\store.js' }).object, 'store.js');
  const t = toolLabel('Bash', { command: 'cd "C:\\Users\\a b\\proj" && npm test 2>&1 | tail -20' });
  assert.equal(t.verb, 'Đang chạy test');
  assert.equal(t.object, '');
  assert.equal(toolLabel('Bash', { command: 'cd /d/x; node --test test/a.test.mjs' }).verbPast, 'Đã chạy test');
  assert.deepEqual(toolLabel('Bash', { command: 'git diff --stat' }), { verb: 'Đang thao tác git', verbPast: 'Đã thao tác git', object: 'git diff' });
  assert.equal(toolLabel('Bash', { command: 'npm i -D vitest' }).verb, 'Đang cài package');
  assert.equal(toolLabel('Bash', { command: 'cd x && ls -la src' }).object, 'ls -la src');
  assert.equal(toolLabel('Grep', { pattern: 'computePipeline' }).object, '"computePipeline"');
  assert.equal(toolLabel('Skill', { skill: 'agent:tdd' }).object, 'tdd');
  assert.equal(toolLabel('WebFetch', { url: 'https://lucide.dev/icons/x' }).object, 'lucide.dev');
  assert.equal(toolLabel('mcp__codebase-retrieval__codebase-retrieval', {}).verb, 'Đang tra cứu codebase');
  assert.equal(toolLabel('mcp__playwright__browser_click', {}).object, 'playwright');
  assert.equal(toolLabel('TaskUpdate', {}).verb, 'Đang cập nhật checklist');
  assert.deepEqual(toolLabel('Frobnicate', {}), { verb: 'Đang dùng', verbPast: 'Đã dùng', object: 'Frobnicate' });
  assert.ok(toolLabel('Read', { file_path: 'x'.repeat(200) }).object.length <= 60);

  const longPath = path.join('C:\\', 'a'.repeat(150), 'src', 'commands', 'tag.js');
  const target = toolTarget({ file_path: longPath });
  assert.ok(target.startsWith('…') && target.endsWith(path.join('src', 'commands', 'tag.js')), target);
  assert.ok(target.length <= 120);
  assert.equal(toolTarget({ command: 'cd "C:\\a b" && npm test' }), 'npm test');
  assert.equal(resultLine('Intro text\n\n### Gate: PASS — 0 blockers\nmore'), 'Gate: PASS — 0 blockers');
  assert.equal(resultLine('## ✅ Implementation Complete\nx'), '✅ Implementation Complete');
});

const T0 = Date.parse('2026-01-01T10:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
// calls: [toolUseId, type, description?] — description defaults to 'd'.
const wave = (msgId, min, ...calls) => calls.map(([tu, type, desc = 'd']) => {
  const r = callLine(msgId, tu, type, { timestamp: at(min), uuid: `u-${tu}` });
  r.message.content[0].input.description = desc;
  return r;
});
const CUT_TEXT = agentText("You've hit your 5-hour limit · resets 12:10pm", { isApiErrorMessage: true, error: 'rate_limit', model: '<synthetic>' });
const skillCall = (id, name, args, min) => ({ type: 'assistant', uuid: `s-${id}`, timestamp: at(min), message: { id: `ms-${id}`, content: [{ type: 'tool_use', id, name: 'Skill', input: { skill: name, args } }] } });
const command = (name, args, min) => ({ type: 'user', uuid: `c-${name}`, timestamp: at(min), message: { role: 'user', content: `<command-name>/${name}</command-name><command-args>${args}</command-args>` } });

// lines: transcript records; running: tool_use ids whose agent is still running;
// cut: tool_use ids whose agent ended on a rate-limit error.
// reports: tool_use id → final report text (default "### Gate: PASS").
function pipelineOf(lines, { running = [], cut = [], reports = {}, mainMtimeMs = NOW - STALLED_MS - 1000 } = {}) {
  const flat = lines.flat();
  const agents = flat.flatMap((r) => (Array.isArray(r.message.content) ? r.message.content : []))
    .filter((c) => c.type === 'tool_use' && c.name === 'Agent')
    .map((c) => ({
      agentId: `g-${c.id}`,
      metaText: meta(c.input.subagent_type, c.id, !running.includes(c.id), c.input.description),
      jsonlText: cut.includes(c.id) ? CUT_TEXT : agentText(reports[c.id] || '### Gate: PASS'),
      mtimeMs: running.includes(c.id) ? NOW - 1000 : NOW - STALLED_MS - 5000,
    }));
  return parseSession({ mainText: jl(...flat), mainMtimeMs, agents, now: NOW });
}
const stepMap = (p) => Object.fromEntries(p.steps.map((s) => [s.key, s]));
// The loop note text lives in the page; evaluate its roundNote() as-is.
const HTML = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'agents-viz', 'index.html'), 'utf8');
// Line endings depend on the checkout (autocrlf), so accept CRLF too.
const roundNote = new Function(`${/function roundNote\([\s\S]*?\r?\n}\r?\n/.exec(HTML)[0]}; return roundNote;`)();

test('pipeline: full run in the new order maps every agent to its step', () => {
  const s = pipelineOf([
    skillCall('sa', 'agent:autopilot', '--full --parallel=3 --yes', 0),
    wave('mS', 1, ['n1', 'agent:agent-analyze'], ['n2', 'agent:agent-researcher']),
    skillCall('sp', 'agent:proposal', 'create the change', 5),
    wave('mG1', 10, ['g1', 'agent:agent-spec-review']),
    wave('mT', 15, ['t1', 'agent:agent-tdd'], ['t2', 'agent:agent-tdd']),
    wave('mA', 20, ['a1', 'agent:agent-apply']),
    wave('mV', 30, ['v1', 'agent:agent-security'], ['v2', 'agent:agent-verify']),
    skillCall('se', 'agent:e2e', 'change', 35),
    wave('mE', 36, ['e1', 'agent:agent-e2e']),
    wave('mR', 45, ['r1', 'agent:agent-archive']),
    skillCall('sk', 'agent:knowledge', 'change', 50),
    wave('mN', 51, ['k1', 'agent:agent-knowledge']),
  ]);
  const p = s.pipeline;
  const st = stepMap(p);
  assert.equal(p.kind, 'autopilot');
  assert.deepEqual(p.steps.map((x) => x.key), ['spec', 'specGate', 'tdd', 'coding', 'security', 'verify', 'e2e', 'archive', 'knowledge']);
  assert.deepEqual(p.steps.map((x) => x.label), ['Spec', 'Spec gate', 'TDD', 'Coding', 'Security', 'Verify', 'E2E', 'Archive', 'Knowledge']);
  const want = { n1: 'spec', n2: 'spec', g1: 'specGate', t1: 'tdd', t2: 'tdd', a1: 'coding', v1: 'security', v2: 'verify', e1: 'e2e', r1: 'archive', k1: 'knowledge' };
  for (const [tu, step] of Object.entries(want)) {
    assert.equal(s.agents.find((a) => a.id === `g-${tu}`).step, step, tu);
    assert.ok(st[step].agentIds.includes(`g-${tu}`), tu);
  }
  for (const x of p.steps) assert.equal(x.state, 'done', x.key);
  assert.equal(p.finished, true);
  assert.equal(p.round, 1);
  assert.deepEqual(p.loops, []);
  assert.deepEqual(p.current, []);
  assert.deepEqual(p.otherAgentIds, []);
});

test('pipeline: --no-e2e skips E2E; idle after archive marks Knowledge skipped', () => {
  const s = pipelineOf([
    skillCall('sa', 'agent:autopilot', '--full --no-e2e --yes', 0),
    wave('mN', 1, ['n1', 'agent:agent-analyze']),
    wave('mG', 15, ['g1', 'agent:agent-spec-review']),
    wave('mA', 20, ['a1', 'agent:agent-apply']),
    wave('mV', 30, ['v1', 'agent:agent-security'], ['v2', 'agent:agent-verify']),
    wave('mR', 40, ['r1', 'agent:agent-archive']),
  ]);
  const p = s.pipeline;
  const st = stepMap(p);
  assert.equal(p.kind, 'autopilot');
  assert.equal(s.agents.find((a) => a.id === 'g-n1').step, 'spec');
  assert.equal(st.e2e.state, 'skipped');
  assert.equal(st.archive.state, 'done');
  assert.equal(st.knowledge.state, 'skipped', 'idle after archive: knowledge never started');
  assert.equal(p.finished, true);
});

test('pipeline: e2e finds app defects → coding fix in round 2 with an E2E loop note', () => {
  const lines = [
    skillCall('sa', 'agent:autopilot', '--full', 0),
    wave('mA1', 1, ['a1', 'agent:agent-apply', 'Implement']),
    wave('mV1', 5, ['s1', 'agent:agent-security', 'Security gate'], ['v1', 'agent:agent-verify', 'Verify gate']),
    wave('mE1', 10, ['e1', 'agent:agent-e2e', 'E2E journeys']),
    wave('mA2', 15, ['a2', 'agent:agent-apply', 'Fix e2e app defects']),
  ];
  const mid = pipelineOf(lines, { mainMtimeMs: NOW });
  let p = mid.pipeline;
  assert.deepEqual(p.loops, [{ from: 'e2e', to: 'coding', round: 2 }]);
  assert.equal(p.round, 2);
  assert.equal(stepMap(p).coding.round, 2);
  assert.equal(mid.agents.find((a) => a.id === 'g-a2').round, 2);
  assert.equal(mid.agents.find((a) => a.id === 'g-e1').round, 1);
  assert.deepEqual(stepMap(p).e2e.prevAgentIds, ['g-e1']);
  assert.equal(p.waiting, true);
  assert.deepEqual(p.current, ['security', 'verify'], 'after the fix the gates come first again');
  assert.equal(roundNote(p, 1, 2), 'E2E báo lỗi → sửa ở vòng 2');

  const done = pipelineOf([
    ...lines,
    wave('mV2', 20, ['s2', 'agent:agent-security', 'Security gate'], ['v2', 'agent:agent-verify', 'Verify gate']),
    wave('mE2', 25, ['e2', 'agent:agent-e2e', 'E2E journeys']),
    wave('mR', 30, ['r1', 'agent:agent-archive']),
    wave('mN', 35, ['k1', 'agent:agent-knowledge']),
  ]);
  p = done.pipeline;
  const st = stepMap(p);
  assert.equal(p.round, 2);
  assert.equal(p.loops.length, 1);
  assert.equal(st.e2e.round, 2);
  assert.equal(st.e2e.attempts, 1, 'the round-2 E2E run is a fresh attempt in that round');
  assert.equal(st.security.round, 2);
  assert.equal(st.knowledge.state, 'done');
  assert.equal(p.finished, true);

  // Gates loop keeps its own wording.
  assert.equal(roundNote({ loops: [{ from: 'gates', to: 'coding', round: 2 }], steps: [] }, 1, 2), 'Security, Verify báo lỗi → sửa ở vòng 2');
});

test('pipeline: active session after archive waits on Knowledge', () => {
  const s = pipelineOf([
    skillCall('sa', 'agent:autopilot', '--full', 0),
    wave('mA', 1, ['a1', 'agent:agent-apply']),
    wave('mV', 5, ['s1', 'agent:agent-security'], ['v1', 'agent:agent-verify']),
    wave('mR', 10, ['r1', 'agent:agent-archive']),
  ], { mainMtimeMs: NOW });
  const p = s.pipeline;
  assert.equal(p.finished, false);
  assert.deepEqual(p.current, ['knowledge']);
  assert.equal(stepMap(p).knowledge.state, 'waiting');
  assert.equal(stepMap(p).e2e.state, 'skipped');

  const running = pipelineOf([
    skillCall('sa', 'agent:autopilot', '--full', 0),
    wave('mR', 10, ['r1', 'agent:agent-archive']),
    skillCall('sk', 'agent:knowledge', 'change', 12),
  ], { mainMtimeMs: NOW });
  assert.deepEqual(running.pipeline.current, ['knowledge']);
  assert.equal(stepMap(running.pipeline).knowledge.state, 'running');
});

test('pipeline: an idle run whose archive failed stops at Archive, not finished', () => {
  const lines = [
    skillCall('sa', 'agent:autopilot', '--full', 0),
    wave('mA', 1, ['a1', 'agent:agent-apply']),
    wave('mV', 5, ['s1', 'agent:agent-security'], ['v1', 'agent:agent-verify']),
    wave('mR', 10, ['r1', 'agent:agent-archive']),
  ];
  const failed = pipelineOf(lines, { reports: { r1: '## Archive Failed\n\n**Reason:** target exists' } }).pipeline;
  assert.equal(failed.finished, false);
  assert.equal(failed.stopped, true);
  assert.equal(failed.stoppedAt, 'archive');

  const ok = pipelineOf(lines, { reports: { r1: '## Archive Complete' } }).pipeline;
  assert.equal(ok.finished, true);
});

test('pipeline: verified run loops apply → gates → apply → gates into round 2', () => {
  const s = pipelineOf([
    skillCall('sa', 'agent:autopilot', 'build it', 0),
    wave('m1', 1, ['a1', 'agent:agent-apply']),
    wave('m2', 10, ['s1', 'agent:agent-security'], ['v1', 'agent:agent-verify']),
    wave('m3', 12, ['a2', 'agent:agent-apply']),
    wave('m4', 15, ['s2', 'agent:agent-security'], ['v2', 'agent:agent-verify']),
    wave('m5', 20, ['u1', 'agent:agent-uiux-designer']),
  ]);
  const p = s.pipeline;
  const st = stepMap(p);
  assert.equal(p.kind, 'autopilot');
  assert.deepEqual(p.loops, [{ from: 'gates', to: 'coding', round: 2 }]);
  assert.equal(p.round, 2);
  assert.equal(st.coding.round, 2);
  assert.equal(st.coding.attempts, 1);
  assert.deepEqual(st.coding.agentIds, ['g-a1', 'g-a2']);
  for (const k of ['spec', 'specGate', 'tdd', 'e2e']) assert.equal(st[k].state, 'skipped', k);
  assert.equal(st.security.state, 'done');
  assert.equal(st.security.round, 2);
  assert.equal(st.archive.state, 'skipped', 'never-reached archive is skipped once the gates passed');
  assert.equal(p.finished, true, 'idle Verified run ending in done gates is finished');
  assert.equal(p.stopped, false);
  assert.deepEqual(p.otherAgentIds, ['g-u1']);
});

test('pipeline: Explore-only session has no pipeline', () => {
  const s = pipelineOf([wave('m1', 1, ['e1', 'Explore'], ['e2', 'general-purpose'])]);
  assert.equal(s.pipeline.kind, 'none');
  assert.deepEqual(s.pipeline.otherAgentIds.sort(), ['g-e1', 'g-e2']);
  assert.ok(s.agents.every((a) => a.step === 'other'));
});

test('pipeline: current step is the latest wave with a running agent', () => {
  const s = pipelineOf([
    skillCall('sa', 'agent:autopilot', 'x', 0),
    wave('m1', 1, ['a1', 'agent:agent-apply']),
    wave('m2', 10, ['s1', 'agent:agent-security'], ['v1', 'agent:agent-verify']),
  ], { running: ['s1'], mainMtimeMs: NOW });
  const p = s.pipeline;
  assert.deepEqual(p.current, ['security', 'verify']);
  assert.equal(stepMap(p).security.state, 'running');
  assert.equal(stepMap(p).verify.state, 'done');
  assert.equal(stepMap(p).coding.state, 'done');
  assert.equal(stepMap(p).archive.state, 'pending');
  assert.equal(p.finished, false);
});

test('pipeline: active session between steps waits on the next step; skill start makes a step active', () => {
  // After coding the gates are next.
  const gatesNext = pipelineOf([skillCall('sa', 'agent:autopilot', 'x', 0), wave('m1', 1, ['a1', 'agent:agent-apply'])], { mainMtimeMs: NOW });
  assert.deepEqual(gatesNext.pipeline.current, ['security', 'verify']);
  assert.equal(stepMap(gatesNext.pipeline).security.state, 'waiting');

  // After the gates with no e2e evidence and no step from an earlier round: the next step is unknown.
  const waiting = pipelineOf([
    skillCall('sa', 'agent:autopilot', 'x', 0), wave('m1', 1, ['a1', 'agent:agent-apply']),
    wave('m2', 5, ['s1', 'agent:agent-security'], ['v1', 'agent:agent-verify']),
  ], { mainMtimeMs: NOW });
  assert.deepEqual(waiting.pipeline.current, []);
  assert.equal(waiting.pipeline.waiting, true);
  assert.equal(waiting.pipeline.finished, false);
  assert.equal(stepMap(waiting.pipeline).e2e.state, 'pending');

  // Only E2E needs evidence: after the spec gate, TDD is still named as next.
  const knownNext = pipelineOf([skillCall('sa', 'agent:autopilot', 'x', 0), wave('mG', 1, ['g1', 'agent:agent-spec-review'])], { mainMtimeMs: NOW });
  assert.deepEqual(knownNext.pipeline.current, ['tdd'], 'steps other than e2e are still named');
  assert.equal(stepMap(knownNext.pipeline).tdd.state, 'waiting');

  const spec = pipelineOf([skillCall('sa', 'agent:autopilot', 'x', 0), skillCall('sp', 'agent:proposal', 'y', 1)], { mainMtimeMs: NOW });
  assert.deepEqual(spec.pipeline.current, ['spec']);
  assert.equal(stepMap(spec.pipeline).spec.state, 'running');
  assert.equal(spec.pipeline.kind, 'autopilot');
});

test('placeholder agent shows a starting label; finished agents carry a result line', () => {
  const s = parseSession({ mainText: jl(callLine('m1', 'tu9', 'agent:agent-verify')), mainMtimeMs: NOW, agents: [], now: NOW });
  assert.equal(s.agents[0].doingNowLabel.verb, 'Đang khởi động agent…');
  assert.equal(s.agents[0].step, 'verify');
  const a = one('agent:agent-verify', agentText('## Verification Report: x\n\nall good'));
  assert.equal(a.resultLine, 'Verification Report: x');
  assert.equal(a.doingNowLabel.verb, 'Đang sửa');
  assert.equal(a.toolTimeline[0].label.object, 'x.js');
});

test('attempts: consecutive fan-out waves of one step are one attempt; a re-run after a cut is a new one', () => {
  const s = pipelineOf([
    skillCall('sa', 'agent:autopilot', 'x --parallel=3', 0),
    wave('mT1', 1, ['t1', 'agent:agent-tdd', 'TDD part 1: store'], ['t2', 'agent:agent-tdd', 'TDD part 2: cli']),
    wave('mT2', 3, ['t3', 'agent:agent-tdd', 'TDD part 3: search']),
    wave('mA1', 5, ['a1', 'agent:agent-apply', 'Implement wave 0 batch B0']),
    wave('mA2', 7, ['a2', 'agent:agent-apply', 'Implement wave 1 batch B1'], ['a3', 'agent:agent-apply', 'Implement wave 1 batch B2']),
    wave('mV1', 9, ['s1', 'agent:agent-security', 'Security gate review'], ['v1', 'agent:agent-verify', 'Verify gate review']),
    wave('mV2', 20, ['s2', 'agent:agent-security', 'Security gate review (rerun)'], ['v2', 'agent:agent-verify', 'Verify gate review (rerun)']),
  ], { cut: ['s1', 'v1'] });
  const st = stepMap(s.pipeline);
  assert.equal(st.tdd.attempts, 1);
  assert.deepEqual(st.tdd.agentIds, ['g-t1', 'g-t2', 'g-t3']);
  assert.equal(st.coding.attempts, 1);
  assert.equal(st.coding.state, 'done');
  assert.equal(st.security.attempts, 2);
  assert.equal(st.verify.attempts, 2);
  assert.equal(st.security.state, 'done', 'the latest attempt decides the state');

  const same = pipelineOf([
    skillCall('sa', 'agent:autopilot', 'x', 0),
    wave('mA1', 1, ['a1', 'agent:agent-apply', 'Implement batch B1']),
    wave('mA2', 5, ['a2', 'agent:agent-apply', 'Implement batch B1']),
  ], { cut: ['a1'] });
  assert.equal(stepMap(same.pipeline).coding.attempts, 2, 're-run with the same description');

  const regate = pipelineOf([
    skillCall('sa', 'agent:autopilot', 'x', 0),
    wave('mG1', 1, ['g1', 'agent:agent-spec-review', 'Spec gate review']),
    wave('mG2', 5, ['g2', 'agent:agent-spec-review', 'Spec gate re-review']),
  ]);
  assert.equal(stepMap(regate.pipeline).specGate.attempts, 2, 're-review is the same work again');
});

test('stopped: idle session that stopped after Coding is not finished', () => {
  const s = pipelineOf([
    skillCall('sa', 'agent:autopilot', 'x', 0),
    wave('mT', 1, ['t1', 'agent:agent-tdd', 'TDD']),
    wave('mA', 5, ['a1', 'agent:agent-apply', 'Implement']),
  ]);
  const p = s.pipeline;
  const st = stepMap(p);
  assert.equal(p.finished, false);
  assert.equal(p.stopped, true);
  assert.equal(p.stoppedAt, 'coding');
  assert.deepEqual(p.current, []);
  assert.equal(st.coding.state, 'done');
  assert.equal(st.e2e.state, 'pending');
  assert.equal(st.security.state, 'pending');
  assert.equal(st.verify.state, 'pending');
  assert.equal(st.archive.state, 'pending');
  assert.equal(st.specGate.state, 'skipped', 'no agents before a later started step');

  const cutGates = pipelineOf([
    skillCall('sa', 'agent:autopilot', 'x', 0),
    wave('mA', 1, ['a1', 'agent:agent-apply', 'Implement']),
    wave('mV', 5, ['s1', 'agent:agent-security', 'Security'], ['v1', 'agent:agent-verify', 'Verify']),
  ], { cut: ['s1'] });
  assert.equal(cutGates.pipeline.finished, false);
  assert.equal(cutGates.pipeline.stopped, true);
  assert.equal(cutGates.pipeline.stoppedAt, 'security');
  assert.equal(stepMap(cutGates.pipeline).security.state, 'cut');
  assert.equal(stepMap(cutGates.pipeline).archive.state, 'pending');
});

test('finished: run like 9c6aba05 (fan-out, re-review, gates re-run after cut, archive)', () => {
  const s = pipelineOf([
    skillCall('sa', 'agent:autopilot', '--full --parallel=3 --no-e2e', 10),
    skillCall('sp', 'agent:proposal', 'create', 11),
    wave('mG1', 15, ['g1', 'agent:agent-spec-review', 'Spec gate review']),
    wave('mG2', 20, ['g2', 'agent:agent-spec-review', 'Spec gate re-review']),
    skillCall('st', 'agent:tdd', 'change', 24),
    wave('mT1', 25, ['t1', 'agent:agent-tdd', 'TDD part 1: note-store'], ['t2', 'agent:agent-tdd', 'TDD part 2: cli']),
    wave('mT2', 27, ['t3', 'agent:agent-tdd', 'TDD part 3: search']),
    wave('mA1', 30, ['a1', 'agent:agent-apply', 'Implement wave 0 batch B0']),
    wave('mA2', 32, ['a2', 'agent:agent-apply', 'Implement wave 1 batch B1 tag'], ['a3', 'agent:agent-apply', 'Implement wave 1 batch B2 search']),
    wave('mV1', 40, ['s1', 'agent:agent-security', 'Security gate review'], ['v1', 'agent:agent-verify', 'Verify gate review']),
    wave('mV2', 60, ['s2', 'agent:agent-security', 'Security gate review (rerun)'], ['v2', 'agent:agent-verify', 'Verify gate review (rerun)']),
    wave('mR', 70, ['r1', 'agent:agent-archive', 'Archive the completed change']),
  ], { cut: ['s1', 'v1'] });
  const p = s.pipeline;
  const st = stepMap(p);
  assert.equal(p.finished, true);
  assert.equal(p.stopped, false);
  assert.deepEqual([st.specGate.attempts, st.tdd.attempts, st.coding.attempts, st.security.attempts, st.verify.attempts, st.archive.attempts], [2, 1, 1, 2, 2, 1]);
  assert.equal(st.e2e.state, 'skipped');
  assert.equal(st.archive.state, 'done');
  assert.equal(st.knowledge.state, 'skipped');
});

test('standalone: e2e-only session shows just E2E and finishes when all agents are done', () => {
  const s = pipelineOf([
    command('agent:e2e', 'login flow', 0),
    wave('mE', 1, ['e1', 'agent:agent-e2e', 'E2E login']),
  ]);
  const p = s.pipeline;
  assert.equal(p.kind, 'standalone');
  assert.deepEqual(p.steps.map((x) => x.key), ['e2e']);
  assert.equal(p.steps[0].state, 'done');
  assert.equal(p.finished, true);
  assert.equal(p.stopped, false);
  assert.deepEqual(p.current, []);
});

test('standalone: tdd then apply shows TDD and Coding only, finished', () => {
  const s = pipelineOf([
    skillCall('st', 'agent:tdd', 'change', 0),
    wave('mT', 1, ['t1', 'agent:agent-tdd', 'TDD']),
    skillCall('sp', 'agent:apply', 'change', 5),
    wave('mA', 6, ['a1', 'agent:agent-apply', 'Implement']),
  ]);
  const p = s.pipeline;
  assert.equal(p.kind, 'standalone');
  assert.deepEqual(p.steps.map((x) => x.key), ['tdd', 'coding']);
  assert.equal(p.finished, true);
  assert.equal(p.stopped, false);
});

test('standalone: cut last agent stops at that step; running agent is the current step', () => {
  const cut = pipelineOf([
    skillCall('st', 'agent:tdd', 'change', 0),
    wave('mT', 1, ['t1', 'agent:agent-tdd', 'TDD']),
    wave('mA', 6, ['a1', 'agent:agent-apply', 'Implement']),
  ], { cut: ['a1'] });
  const p = cut.pipeline;
  assert.deepEqual(p.steps.map((x) => x.key), ['tdd', 'coding']);
  assert.equal(p.finished, false);
  assert.equal(p.stopped, true);
  assert.equal(p.stoppedAt, 'coding');

  const run = pipelineOf([
    command('agent:verify', 'change', 0),
    wave('mV', 1, ['v1', 'agent:agent-verify', 'Verify']),
  ], { running: ['v1'], mainMtimeMs: NOW });
  assert.deepEqual(run.pipeline.steps.map((x) => x.key), ['verify']);
  assert.deepEqual(run.pipeline.current, ['verify']);
  assert.equal(run.pipeline.finished, false);
});

test('labels: PowerShell maps like Bash', () => {
  assert.deepEqual(toolLabel('PowerShell', { command: 'npm test' }), { verb: 'Đang chạy test', verbPast: 'Đã chạy test', object: '' });
  assert.equal(toolLabel('PowerShell', { command: 'git status --short' }).object, 'git status');
  assert.equal(toolLabel('PowerShell', { command: 'npm install -g x' }).verb, 'Đang cài package');
  assert.deepEqual(toolLabel('PowerShell', { command: 'Get-ChildItem  src' }), { verb: 'Đang chạy lệnh', verbPast: 'Đã chạy lệnh', object: 'Get-ChildItem src' });
});

test('waiting after a coding loop: gates are next and keep earlier-round agents apart', () => {
  const s = pipelineOf([
    skillCall('sa', 'agent:autopilot', 'build it', 0),
    wave('m1', 1, ['a1', 'agent:agent-apply']),
    wave('m2', 10, ['s1', 'agent:agent-security'], ['v1', 'agent:agent-verify']),
    wave('m3', 12, ['a2', 'agent:agent-apply']),
  ], { mainMtimeMs: NOW });
  const p = s.pipeline;
  const st = stepMap(p);
  assert.equal(p.round, 2);
  assert.equal(p.waiting, true);
  assert.deepEqual(p.current, ['security', 'verify'], 'the gates follow coding');
  assert.equal(st.security.state, 'waiting');
  assert.equal(st.e2e.state, 'pending');
  assert.deepEqual(st.security.prevAgentIds, ['g-s1'], 'round-1 gate agents are earlier-round agents');
  assert.deepEqual(st.verify.prevAgentIds, ['g-v1']);
  assert.deepEqual(st.coding.prevAgentIds, ['g-a1']);
  assert.deepEqual(st.coding.agentIds, ['g-a1', 'g-a2']);

  // With e2e evidence from round 1, E2E is named as next once the gates pass again.
  const e2e = pipelineOf([
    skillCall('sa', 'agent:autopilot', 'build it', 0),
    wave('m1', 1, ['a1', 'agent:agent-apply']),
    wave('m2', 5, ['s1', 'agent:agent-security'], ['v1', 'agent:agent-verify']),
    wave('m3', 10, ['e1', 'agent:agent-e2e']),
    wave('m4', 12, ['a2', 'agent:agent-apply']),
    wave('m5', 14, ['s2', 'agent:agent-security'], ['v2', 'agent:agent-verify']),
  ], { mainMtimeMs: NOW });
  assert.deepEqual(e2e.pipeline.current, ['e2e']);
  assert.equal(stepMap(e2e.pipeline).e2e.state, 'waiting');
  assert.deepEqual(stepMap(e2e.pipeline).e2e.prevAgentIds, ['g-e1']);
});
