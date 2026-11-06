import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseJsonl, parseSession, agentStatus, isSafeName, safeJoin, projectDirName, loadSession, listSessions,
  readJsonlBounded, RUNNING_MS, STALLED_MS,
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
const meta = (type, toolUseId, finished) => JSON.stringify({ agentType: type, description: 'd', toolUseId, spawnDepth: 1, ...(finished ? { finished: true } : {}) });

function one(type, jsonlText, { finished = true, mtimeMs = NOW - 1000 } = {}) {
  const s = parseSession({
    mainText: jl(callLine('m1', 'tu1', type)),
    agents: [{ agentId: 'aa1', metaText: meta(type, 'tu1', finished), jsonlText, mtimeMs }],
    now: NOW,
  });
  return s.agents[0];
}

test('done: osf agent finished with its closing report', () => {
  const a = one('osf:osf-verify', agentText('## Verification Report: x\n\nall good'));
  assert.equal(a.status, 'done');
  assert.equal(a.reportWarning, null);
  assert.equal(a.brief, 'Do the work.');
  assert.match(a.report, /Verification Report/);
  assert.deepEqual(a.toolTimeline.map((t) => [t.tool, t.target]), [['Edit', 'src/x.js']]);
});

test('cut: finished but last message is a rate-limit error', () => {
  const a = one('osf:osf-security', agentText("You've hit your 5-hour limit · resets 12:10pm", { isApiErrorMessage: true, error: 'rate_limit', model: '<synthetic>' }));
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
  const a = one('osf:osf-security', agentText('### Gate: FAIL\n\n- HIGH: missing rate limit on /x\n- API Error handling leaks stack traces'));
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
  assert.equal(one('osf:osf-apply', text).status, 'cut');
});

test('osf agent missing its closing report: done with a report warning', () => {
  const a = one('osf:osf-apply', agentText('I implemented it, tests pass.'));
  assert.equal(a.status, 'done');
  assert.match(a.reportWarning, /## ✅/);
  const s = one('osf:osf-security', agentText('Looks fine.'));
  assert.match(s.reportWarning, /### Gate:/);
});

test('unknown agent type finished without error counts as done', () => {
  assert.equal(one('Explore', agentText('Found it.')).status, 'done');
});

test('running: not finished and written recently', () => {
  const a = one('osf:osf-apply', agentText('working'), { finished: false, mtimeMs: NOW - 30 * 1000 });
  assert.equal(a.status, 'running');
  assert.deepEqual(a.doingNow && a.doingNow.tool, 'Edit');
  const mid = one('osf:osf-apply', agentText('working'), { finished: false, mtimeMs: NOW - 5 * 60 * 1000 });
  assert.equal(mid.status, 'running', 'between 2 and 10 min is still running');
});

test('stalled: not finished and no write for more than 10 min', () => {
  const a = one('osf:osf-apply', agentText('working'), { finished: false, mtimeMs: NOW - STALLED_MS - 1000 });
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
    mainText: jl(callLine('mA', 'tu1', 'osf:osf-tdd'), callLine('mA', 'tu2', 'osf:osf-tdd'), callLine('mB', 'tu3', 'osf:osf-verify')),
    agents: [
      { agentId: 'x1', metaText: meta('osf:osf-tdd', 'tu1', true), jsonlText: agentText('ok'), mtimeMs: NOW },
      { agentId: 'x2', metaText: meta('osf:osf-tdd', 'tu2', true), jsonlText: agentText('ok'), mtimeMs: NOW },
      { agentId: 'x3', metaText: meta('osf:osf-verify', 'tu3', true), jsonlText: agentText('## Verification Report'), mtimeMs: NOW },
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
      { type: 'user', uuid: 'c1', timestamp: '2026-01-01T09:00:00Z', message: { role: 'user', content: '<command-name>/osf:team</command-name><command-args>go</command-args>' } },
      { type: 'assistant', uuid: 'k1', timestamp: '2026-01-01T09:01:00Z', message: { id: 'mk', content: [{ type: 'tool_use', id: 'sk1', name: 'Skill', input: { skill: 'osf:tdd', args: 'x' } }] } },
      callLine('mw', 'tu1', 'osf:osf-tdd', { attributionSkill: 'osf:team' }),
      callLine('mz', 'tu2', 'osf:osf-tdd'),
    ),
    agents: [
      { agentId: 'x1', metaText: meta('osf:osf-tdd', 'tu1', true), jsonlText: agentText('ok'), mtimeMs: NOW },
      { agentId: 'x2', metaText: meta('osf:osf-tdd', 'tu2', true), jsonlText: agentText('ok'), mtimeMs: NOW },
    ],
    now: NOW,
  });
  assert.deepEqual(s.skills.map((k) => [k.name, k.source]), [['osf:team', 'command'], ['osf:tdd', 'tool']]);
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
      mainText: 'garbage\n' + jl(callLine('m1', 'tu1', 'osf:osf-apply')),
      agents: [{ agentId: 'a', metaText: '{not json', jsonlText: '{"type":"user"\n' + agentText('## ✅ Done'), mtimeMs: NOW }],
      now: NOW,
    });
  });
  assert.equal(s.warnings.malformedLines, 2);
  assert.equal(s.warnings.badMeta, 1);
});

test('placeholder for an Agent call whose transcript does not exist yet', () => {
  const s = parseSession({ mainText: jl(callLine('m1', 'tu9', 'osf:osf-verify')), mainMtimeMs: NOW, agents: [], now: NOW });
  assert.equal(s.agents.length, 1);
  assert.equal(s.agents[0].status, 'running');
  assert.equal(s.agents[0].placeholder, true);
});

test('idle types: running types hidden, others idle or not spawned', () => {
  const s = parseSession({
    mainText: jl(callLine('m1', 'tu1', 'osf:osf-apply'), callLine('m2', 'tu2', 'osf:osf-verify')),
    agents: [
      { agentId: 'x1', metaText: meta('osf:osf-apply', 'tu1', false), jsonlText: agentText('w'), mtimeMs: NOW },
      { agentId: 'x2', metaText: meta('osf:osf-verify', 'tu2', true), jsonlText: agentText('## Verification Report'), mtimeMs: NOW },
    ],
    now: NOW,
    knownTypes: ['osf-apply', 'osf-verify', 'osf-tdd'],
  });
  assert.deepEqual(s.idleTypes, [{ type: 'osf-verify', state: 'idle', count: 1 }, { type: 'osf-tdd', state: 'not-spawned', count: 0 }]);
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
  assert.equal(projectDirName('D:\\Projects\\osf-kit'), 'D--Projects-osf-kit');
});

test('fixture session on disk parses into the expected tree', () => {
  const s = loadSession(ROOT, 'D--demo-app', 'sess-1', { now: NOW, knownTypes: ['osf-apply', 'osf-archive', 'osf-verify'] });
  assert.equal(s.warnings.malformedLines, 1);
  assert.deepEqual(s.skills.map((k) => k.name), ['osf:autopilot', 'osf:archive']);
  const by = Object.fromEntries(s.agents.map((a) => [a.id, a]));
  assert.equal(by.a1apply.status, 'done');
  assert.equal(by.a2explore.status, 'done');
  assert.equal(by.a3archive.status, 'cut');
  assert.equal(by.a1apply.wave, by.a2explore.wave);
  assert.notEqual(by.a1apply.wave, by.a3archive.wave);
  assert.equal(by.a1apply.skillId, s.skills[0].id);
  assert.equal(by.a3archive.skillId, 'toolu_skill_archive');
  assert.equal(by.a2explore.isOsf, false);
  assert.equal(s.title, '/osf:autopilot add a demo command');
});
