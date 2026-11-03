# OSF kit

30 OpenSpec-flow skills and 10 supporting agents for Claude Code and OMP.

Marketplace `osf-kit`, plugin `osf`, `source: "./"`.

## Install

```bash
# Claude Code
claude plugin marketplace add sonnguyen1812/osf-kit && claude plugin install osf@osf-kit

# OMP
omp plugin install github:sonnguyen1812/osf-kit
```

Claude Code TUI (if the marketplace is not registered yet):

```text
/plugin marketplace add sonnguyen1812/osf-kit
/plugin install osf@osf-kit
```

Restart the OMP session after install.

- Claude Code: `/osf:osf list` · `/osf:feat …`
- OMP: `/skill:osf list` · `/skill:osf feat …`

## Update

```bash
# Claude Code
claude plugin marketplace update osf-kit
claude plugin update osf@osf-kit

# OMP (reinstall from git; same command as install)
omp plugin install github:sonnguyen1812/osf-kit
```

Restart the OMP session after update. Claude Code: restart or `/reload-plugins`.

Version is pinned in `plugin.json`. Bump it on every release or users will not get the new tree.

## Kit

Planning: feat, fix, chore, refactor, perf, docs, test, ci, docker, setup

Spec: proposal, tdd, apply, e2e, verify, archive

Investigate: analyze, gap-audit, explain, review, security, research, browser
Utility: enhance

Automation: autopilot, git, clean-room, uiux-design

Internal: explore, osf

Agents: osf-analyze, osf-apply, osf-archive, osf-clean-room, osf-e2e, osf-gap-audit, osf-researcher, osf-tdd, osf-uiux-designer, osf-verify
