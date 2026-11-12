// Behavior evals: run the kit headless with `claude -p` on a copy of evals/fixture and check
// what it did. Costs tokens, so it is not part of `npm test`. Usage: npm run eval [-- <case-name>...]
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(kit, 'evals', 'fixture');

const run = (cmd, args, cwd, timeout = 600_000) =>
  new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd, timeout, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
      resolve({ out: `${stdout}${stderr}`, err }),
    );
    child.stdin.end(); // claude -p waits 3s for piped stdin otherwise
  });

const cases = {
  // Code-writing agents get the karpathy skill without calling the Skill tool. The URL is only in the skill file.
  'preload-karpathy': {
    prompt:
      "Spawn subagent agent:agent-apply with prompt: 'Use no tools, implement nothing. Reply with the URL containing x.com/karpathy from your context, or NONE.' Output only: RESULT=<its reply>",
    check: ({ out }) => /x\.com\/karpathy\/status\/\d+/.test(out) || 'agent-apply did not see the karpathy skill',
  },
  // With no MCP servers the agents fall back to Grep + Glob + Read.
  'fallback-no-mcp': {
    noMcp: true,
    prompt:
      "Spawn subagent agent:agent-analyze with prompt: 'Mode: quick. Where is the function add defined and who calls it? Answer with file names.' Output only its answer.",
    check: ({ out }) => (/math\.js/.test(out) && /index\.js/.test(out)) || 'agent-analyze did not find add without codebase-retrieval',
  },
  // brainstorm no longer stops for an enhance confirmation unless --enhance is passed.
  'brainstorm-no-enhance-pause': {
    prompt: '/agent:brainstorm add a subtract function next to add in math.js',
    check: ({ out }) => !/Enhanced prompt/i.test(out) || 'brainstorm paused for enhance without --enhance',
  },
  // chore makes the small change, updates callers, touches nothing else and adds no files.
  'chore-scope': {
    prompt: '/agent:chore rename the function add to sum in math.js and update its callers. Do not ask, just do it.',
    check: async ({ dir }) => {
      const { out: status } = await run('git', ['status', '--porcelain'], dir);
      const changed = status.split('\n').filter(Boolean).map((l) => l.slice(3)).sort().join(',');
      if (changed !== 'index.js,math.js') return `expected only index.js,math.js changed, got: ${changed || 'nothing'}`;
      const math = readFileSync(join(dir, 'math.js'), 'utf8');
      const index = readFileSync(join(dir, 'index.js'), 'utf8');
      return (/function sum\b/.test(math) && /\bsum\(/.test(index) && !/\badd\b/.test(math + index)) || 'rename incomplete';
    },
  },
};

async function runCase(name, c) {
  const dir = mkdtempSync(join(tmpdir(), `agent-kit-eval-${name}-`));
  try {
    cpSync(fixture, dir, { recursive: true });
    await run('git', ['init', '-q'], dir);
    await run('git', ['add', '-A'], dir);
    await run('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@local', 'commit', '-qm', 'fixture'], dir);
    const args = ['-p', c.prompt, '--plugin-dir', kit, '--dangerously-skip-permissions'];
    if (c.noMcp) args.push('--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}');
    const res = await run('claude', args, dir);
    const verdict = res.err?.killed ? 'timed out' : await c.check({ ...res, dir });
    return { name, pass: verdict === true, why: verdict === true ? '' : verdict, tail: res.out.trim().split('\n').slice(-3).join(' | ') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const picked = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(cases);
const unknown = picked.filter((n) => !cases[n]);
if (unknown.length) throw new Error(`unknown case: ${unknown.join(', ')}`);

const results = await Promise.all(picked.map((n) => runCase(n, cases[n])));
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.pass ? '' : ` — ${r.why}\n     last output: ${r.tail}`}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
