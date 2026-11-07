// Keeps the hand-written catalogs (dispatcher, README, manifests) in step with the
// skills/ and agents/ folders, so adding a skill or agent cannot silently miss a list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const sorted = (xs) => [...new Set(xs)].sort();

const skillDirs = sorted(
  readdirSync(join(root, 'skills'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, 'skills', d.name, 'SKILL.md')))
    .map((d) => d.name),
);
const agentNames = sorted(
  readdirSync(join(root, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)),
);
const dispatcher = read('skills/osf/SKILL.md');

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(m, 'missing frontmatter');
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

test('every skill has a matching name and a real description', () => {
  for (const name of skillDirs) {
    const fm = frontmatter(read(`skills/${name}/SKILL.md`));
    assert.equal(fm.name, name, `skills/${name}: name`);
    assert.ok(fm.description && fm.description.length >= 30, `skills/${name}: description too short`);
    // Long descriptions get cut from the host's skill listing when many plugins are installed.
    assert.ok(fm.description.length <= 250, `skills/${name}: description over 250 chars`);
    assert.doesNotMatch(fm.description, /^(What to|Args?:)/, `skills/${name}: description is an argument hint`);
  }
});

test('every agent has a matching name', () => {
  for (const name of agentNames) {
    assert.equal(frontmatter(read(`agents/${name}.md`)).name, name);
  }
});

test('dispatcher catalog matches skills/', () => {
  const available = dispatcher.match(/^Available skills: (.+)$/m)[1].split(',').map((s) => s.trim());
  assert.deepEqual(sorted(available), skillDirs, 'Available skills line');

  const rows = [...dispatcher.matchAll(/^\| (?:daily|flow|investigate|tools|internal) \| ([\w-]+) \|/gm)].map((m) => m[1]);
  assert.deepEqual(sorted(rows), skillDirs, 'KIT_CATALOG rows');
  assert.equal(rows.length, skillDirs.length, 'KIT_CATALOG has duplicates');
});

test('agent lists match agents/', () => {
  const line = dispatcher.match(/^Supporting agents: (.+)$/m)[1];
  assert.deepEqual(sorted(line.match(/osf-[\w-]+/g)), agentNames, 'dispatcher "Supporting agents"');

  const readme = read('README.md').match(/^Agents: (.+)$/m)[1];
  assert.deepEqual(sorted(readme.match(/osf-[\w-]+/g)), agentNames, 'README Agents line');
});

test('README kit lists every user-facing skill', () => {
  const kit = read('README.md').match(/## Kit\r?\n([\s\S]*?)\r?\nAgents:/)[1];
  const listed = kit.match(/[a-z][\w-]*/g);
  for (const name of skillDirs) assert.ok(listed.includes(name), `README ## Kit misses ${name}`);
});

test('versions agree across manifests', () => {
  const pkg = JSON.parse(read('package.json')).version;
  assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).version, pkg, '.claude-plugin/plugin.json');
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  const versions = JSON.stringify(market).match(/"version":"[^"]+"/g) ?? [];
  for (const v of versions) assert.equal(v, `"version":"${pkg}"`, '.claude-plugin/marketplace.json');
});
