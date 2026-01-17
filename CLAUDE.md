# Codex Agent

CLI tool for delegating tasks to GPT Codex agents via tmux sessions. Designed for Claude Code orchestration with bidirectional communication.

**Stack**: TypeScript, Bun, tmux, OpenAI Codex CLI

**Structure**: Shell wrapper -> CLI entry point -> Job management -> tmux sessions

For detailed architecture, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Development

```bash
# Run directly
bun run src/cli.ts --help

# Or via shell wrapper
./bin/codex-agent --help

# Health check
bun run src/cli.ts health
```

## Key Files

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI commands and argument parsing |
| `src/jobs.ts` | Job lifecycle and persistence |
| `src/tmux.ts` | tmux session management |
| `src/config.ts` | Configuration constants |
| `src/files.ts` | File loading for context injection |

## Dependencies

- **Runtime**: Bun, tmux, codex CLI
- **NPM**: glob (file matching)

## Notes

- Jobs stored in `~/.codex-agent/jobs/`
- Uses `script` command for output logging
- Completion detected via marker string in output
