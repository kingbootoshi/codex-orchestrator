---
name: codex-orchestrator
description: DEFAULT PIPELINE for all tasks requiring execution. You (Claude) are the strategic orchestrator. Codex agents are your implementation army - hyper-focused coding specialists. Trigger on ANY task involving code, file modifications, codebase research, multi-step work, or implementation. This is NOT optional - Codex agents are the default for all execution work. Only skip if the user explicitly asks you to do something yourself.
triggers:
  - codex-orchestrator
  - spawn codex
  - use codex
  - delegate to codex
  - start agent
  - codex agent
  - init
  - setup codex
---

# Codex Orchestrator

## The Command Structure

```
USER - directs the mission
    |
    ├── CLAUDE #1 (Opus) --- General
    |       ├── CODEX agent
    |       ├── CODEX agent
    |       └── CODEX agent ...
    |
    ├── CLAUDE #2 (Opus) --- General
    |       ├── CODEX agent
    |       └── CODEX agent ...
    |
    ├── CLAUDE #3 (Opus) --- General
    |       └── CODEX agent ...
    |
    └── CLAUDE #4 (Opus) --- General
            └── CODEX agent ...
```

**The user is in command.** They set the vision, make strategic decisions, approve plans. They can direct multiple Claude instances simultaneously.

**You (Claude) are their general.** You command YOUR Codex army on the user's behalf. You are in FULL CONTROL of your agents:
- You decide which agents to spawn
- You decide what tasks to give them
- You coordinate your agents working in parallel
- You course-correct or kill agents as needed
- You synthesize your army's work into results for the user

The user can run 4+ Claude instances in parallel. Each Claude has its own Codex army. This is how massive codebases get built in days instead of weeks.

You handle the strategic layer. You translate the user's intent into actionable commands for YOUR army.

**Codex agents are the army under your command.** Hyper-focused coding specialists. Extremely thorough and effective in their domain - they read codebases deeply, implement carefully, and verify their work. They get the job done right.

Codex reports to you. You report to the user.

## CRITICAL RULES

### Rule 1: Codex Agents Are the Default

For ANY task involving:
- Writing or modifying code
- Researching the codebase
- Investigating files or patterns
- Security audits
- Testing
- Multi-step execution
- Anything requiring file access

**Spawn Codex agents. Do not do it yourself. Do not use Claude subagents.**

### Rule 2: You Are the Orchestrator, Not the Implementer

Your job:
- Discuss strategy with the user
- Write PRDs and specs
- Spawn and direct Codex agents
- Synthesize agent findings
- Make decisions about approach
- Communicate progress

Not your job:
- Implementing code yourself
- Doing extensive file reads to "understand before delegating"
- Using Claude subagents (Task tool) unless the user explicitly asks

### Rule 3: Only Exceptions

Use Claude subagents ONLY when:
- The user explicitly requests it ("you do it", "don't use Codex", "use a Claude subagent")
- Quick single-file read for conversational context

Otherwise: Codex agents. Always.

## Prerequisites

Before codex-agent can run, three things must be installed:

1. **tmux** - Terminal multiplexer (agents run in tmux sessions)
2. **Bun** - JavaScript runtime (runs the CLI)
3. **OpenAI Codex CLI** - The coding agent being orchestrated

The user must also be **authenticated with OpenAI** (`codex --login`) so agents can make API calls.

### Quick Check

```bash
codex-agent health    # checks tmux + codex are available
```

### If Not Installed

If the user says "init", "setup", or codex-agent is not found, **run the install script**:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install.sh"
```

**Always use the install script.** Do NOT manually check dependencies or try to install things yourself step-by-step. The script handles everything: detects the platform, checks each dependency, installs what's missing via official package managers, clones the repo, and adds `codex-agent` to PATH. No sudo required.

If `${CLAUDE_PLUGIN_ROOT}` is not available (manual skill install), the user can run:

```bash
bash ~/.codex-orchestrator/plugins/codex-orchestrator/scripts/install.sh
```

After installation, the user must authenticate with OpenAI if they haven't already:

```bash
codex --login
```

**All dependencies use official sources only.** tmux from system package managers, Bun from bun.sh, Codex CLI from npm. No third-party scripts or unknown URLs.

## The Factory Pipeline

```
USER'S REQUEST
     |
     v
1. IDEATION        (You + User)
     |
2. RESEARCH         (Codex, read-only)
     |
3. SYNTHESIS        (You)
     |
4. PRD              (You + User)
     |
5. IMPLEMENTATION   (Codex, workspace-write)
     |
6. REVIEW           (Codex, read-only)
     |
7. TESTING          (Codex, workspace-write)
```

**You** handle stages 1, 3, 4 - the strategic work.
**Codex agents** handle stages 2, 5, 6, 7 - the execution work.

### Pipeline Stage Detection

Detect where you are based on context:

| Signal | Stage | Action |
|--------|-------|--------|
| New feature request, vague problem | IDEATION | Discuss with user, clarify scope |
| "investigate", "research", "understand" | RESEARCH | Spawn read-only Codex agents |
| Agent findings ready, need synthesis | SYNTHESIS | You review, filter, combine |
| "let's plan", "create PRD", synthesis done | PRD | You write PRD to docs/prds/ |
| PRD exists, "implement", "build" | IMPLEMENTATION | Spawn workspace-write Codex agents |
| Implementation done, "review" | REVIEW | Spawn review Codex agents |
| "test", "verify", review passed | TESTING | Spawn test-writing Codex agents |

## Core Principles

1. **Gold Standard Quality** - No shortcuts. Security, proper patterns, thorough testing - all of it.
2. **Always Interactive** - Agents stay open for course correction. Never kill and respawn - send a message to redirect.
3. **Parallel Execution** - Multiple Claude instances can spawn multiple Codex agents simultaneously.
4. **Codebase Map Always** - Every agent gets `--map` for context.
5. **PRDs Drive Implementation** - Complex changes get PRDs in docs/prds/.
6. **Patience is Required** - Agents take time. This is normal and expected.
7. **Turn-Aware by Default** - Use `await-turn` to block until agents respond. No manual polling.

## Agent Timing Expectations (CRITICAL - READ THIS)

**Codex agents take time. This is NORMAL. Do NOT be impatient.**

| Task Type | Typical Duration |
|-----------|------------------|
| Simple research | 10-20 minutes |
| Implementation (single feature) | 20-40 minutes |
| Complex implementation | 30-60+ minutes |
| Full PRD implementation | 45-90+ minutes |

**Why agents take this long:**
- They read the codebase thoroughly (not skimming)
- They think deeply about implications
- They implement carefully with proper patterns
- They verify their work (typecheck, tests)
- They handle edge cases

**When you keep talking to an agent via `codex-agent send`**, it stays open and continues working. Sessions can extend to 60+ minutes easily - and that is FINE. A single agent that you course-correct is often better than killing and respawning.

**Do NOT:**
- Kill agents just because they have been running for 20 minutes
- Assume something is wrong if an agent runs for 30+ minutes
- Spawn new agents to replace ones that are "taking too long"
- Ask the user "should I check on the agent?" after 15 minutes

**DO:**
- Use `codex-agent await-turn <id>` in a background Bash task to get notified instantly when an agent finishes
- Check progress with `codex-agent capture <id>` if you need to peek before a turn completes
- Send clarifying messages if the agent seems genuinely stuck (no progress for 5+ minutes)
- Let agents finish their work - they are thorough for a reason
- Trust the process - quality takes time

## Codebase Map: Giving Agents Instant Context

The `--map` flag is the most important flag you'll use. It injects `docs/CODEBASE_MAP.md` into the agent's prompt - a comprehensive architecture document that gives agents instant understanding of the entire codebase: file purposes, module boundaries, data flows, dependencies, conventions, and navigation guides.

**Without a map**, agents waste time exploring and guessing at structure.
**With a map**, agents know exactly where things are and how they connect. They start working immediately instead of orienteering.

The map is generated by [Cartographer](https://github.com/kingbootoshi/cartographer), a separate Claude Code plugin that scans your codebase with parallel subagents and produces the map:

```
/plugin marketplace add kingbootoshi/cartographer
/plugin install cartographer
/cartographer
```

This creates `docs/CODEBASE_MAP.md`. After that, every `codex-agent start ... --map` command gives agents full architectural context.

**Always generate a codebase map before using codex-orchestrator on a new project.** It's the difference between agents that fumble around and agents that execute with precision.

## CLI Defaults

The CLI ships with strong defaults so most commands need minimal flags:

| Setting | Default | Why |
|---------|---------|-----|
| Model | `gpt-5.3-codex` | Full capability model with xhigh reasoning (use `--fast` for spark) |
| Reasoning | `xhigh` | Maximum reasoning depth - agents think deeply |
| Sandbox | `workspace-write` | Agents can modify files by default |

You almost never need to override these. The main flags you'll use are `--map` (include codebase context), `-s read-only` (for research tasks), and `-f` (include specific files).

## Turn-Aware Orchestration

Codex agents have a built-in notify hook that fires the instant an agent finishes responding. This means you get notified within milliseconds of an agent going idle - no polling, no delays, no forgetting to check.

### How It Works

When `codex-agent start` spawns an agent, it injects a per-job notify hook via `-c notify=...`. When the Codex agent finishes a turn, Codex calls our script with a JSON payload containing the agent's response. The script writes a signal file at `~/.codex-agent/jobs/<jobId>.turn-complete`. The `await-turn` command blocks until that file appears.

Each job gets its own notify command with its own job ID baked in. 16 agents running in the same directory? No ambiguity - each one's hook writes to its own signal file.

### The Standard Orchestration Loop

This is how you should interact with agents. Use this pattern every time.

**Step 1: Spawn** (foreground, instant - get the job ID)

```bash
codex-agent start "Your task prompt here" -r high --map -s read-only
```

Parse the job ID from the output.

**Step 2: Await** (blocks until agent responds)

Use the Bash tool with `run_in_background: true`:

```bash
JOB_ID="abc12345"
codex-agent await-turn "$JOB_ID"
echo "CODEX_AGENT_TURN_COMPLETE=$JOB_ID"
codex-agent status "$JOB_ID"
```

This gives you a `task_id` from Claude's background task system. When the agent finishes its turn, `TaskOutput` returns the agent's response.

**Step 3: React** - Read the output, decide what to do next:
- Send a follow-up: `codex-agent send $id "Now do X"`
- Close it: `codex-agent send $id "/quit"`
- Just read more: `codex-agent capture $id 200 --clean`

If you send a follow-up, repeat Step 2 to await the next turn.

### Spawning Multiple Agents in Parallel

When spawning N agents, make all Step 1 calls in parallel (single message, multiple Bash tool calls). Then make all Step 2 calls in parallel (single message, multiple Bash tool calls with `run_in_background: true`).

```
Message 1 (parallel foreground):
  - Bash: codex-agent start "Research task A" --map -s read-only
  - Bash: codex-agent start "Research task B" --map -s read-only
  - Bash: codex-agent start "Research task C" --map -s read-only

Message 2 (parallel background):
  - Bash (bg): codex-agent await-turn <jobA>; echo "DONE_A"; codex-agent status <jobA>
  - Bash (bg): codex-agent await-turn <jobB>; echo "DONE_B"; codex-agent status <jobB>
  - Bash (bg): codex-agent await-turn <jobC>; echo "DONE_C"; codex-agent status <jobC>
```

Each background task notifies you independently the instant its agent finishes. No 3-second poll gaps. No wasted time.

### Multi-Turn Conversation Pattern

For tasks requiring back-and-forth with an agent:

```bash
# Spawn
codex-agent start "Investigate the auth module" --map -s read-only
# Block until agent responds
codex-agent await-turn $id
# Read what it said
codex-agent status $id
# Send follow-up
codex-agent send $id "Now check the database layer"
# Block again
codex-agent await-turn $id
# Read response, close when done
codex-agent send $id "/quit"
```

### Checking on Agents Without Waiting

You do NOT have to use await-turn. At any time you can still:

```bash
codex-agent status <jobId>           # includes turn state, last message
codex-agent capture <jobId> 50       # peek at recent output
codex-agent send <jobId> "message"   # steer the agent
codex-agent jobs --json              # check all agents at once
```

### When "completed" Actually Fires

A Codex job status stays `running` after the agent has answered - it only transitions to `completed` when the session is closed. This happens when:
- The agent finishes and exits naturally
- You send `/quit` via `codex-agent send <id> "/quit"`
- The session times out from inactivity

So if you use `await-turn`, you get the agent's response immediately. Then you decide whether to send a follow-up or close the session.

### Signal File Interface (For Advanced Bash Scripting)

The signal file is a plain JSON file. You can check it directly from bash without spawning a subprocess:

```bash
signal="$HOME/.codex-agent/jobs/${id}.turn-complete"
# Cheapest possible check - no subprocess
while [ ! -f "$signal" ]; do sleep 1; done
# Read the agent's message
cat "$signal"
```

The `codex-bg -t` wrapper also supports turn notifications:

```bash
codex-bg -t -- codex-agent start "task"
# Prints CODEX_AGENT_TURN_COMPLETE=<id> on each turn
```

## CLI Reference

### Spawning Agents

```bash
# Research (read-only - override sandbox)
codex-agent start "Investigate auth flow for vulnerabilities" --map -s read-only

# Implementation (defaults are perfect - xhigh reasoning, workspace-write)
codex-agent start "Implement the auth refactor per PRD" --map

# With file context
codex-agent start "Review these modules" --map -f "src/auth/**/*.ts" -f "src/api/**/*.ts"
```

### Monitoring Agents

```bash
# Wait for agent to finish current turn (PREFERRED - blocks until done)
codex-agent await-turn <jobId>

# Status with turn info - shows turn state, count, last message
codex-agent status <jobId>

# Structured status - tokens, files modified, summary
codex-agent jobs --json

# Human readable table
codex-agent jobs

# Recent output
codex-agent capture <jobId>
codex-agent capture <jobId> 200    # more lines

# Full output
codex-agent output <jobId>

# Live stream
codex-agent watch <jobId>
```

### Communicating with Agents

```bash
# Send follow-up message
codex-agent send <jobId> "Focus on the database layer"
codex-agent send <jobId> "The dependency is installed. Run bun run typecheck"

# Direct tmux attach (for full interaction)
tmux attach -t codex-agent-<jobId>
# Ctrl+B, D to detach
```

**IMPORTANT**: Use `codex-agent send`, not raw `tmux send-keys`. The send command handles escaping and timing properly.

### Control

```bash
codex-agent kill <jobId>           # stop agent (last resort)
codex-agent clean                  # remove old jobs (>7 days)
codex-agent health                 # verify codex + tmux available
```

## Flags Reference

| Flag | Short | Values | Description |
|------|-------|--------|-------------|
| `--reasoning` | `-r` | low, medium, high, xhigh | Reasoning depth |
| `--sandbox` | `-s` | read-only, workspace-write, danger-full-access | File access level |
| `--file` | `-f` | glob | Include files (repeatable) |
| `--map` | | flag | Include docs/CODEBASE_MAP.md |
| `--dir` | `-d` | path | Working directory |
| `--model` | `-m` | string | Model override |
| `--fast` | | flag | Use fast model (codex-spark) |
| `--json` | | flag | JSON output (jobs only) |
| `--strip-ansi` | | flag | Clean output |
| `--dry-run` | | flag | Preview prompt without executing |

## Jobs JSON Output

```json
{
  "id": "8abfab85",
  "status": "completed",
  "elapsed_ms": 14897,
  "tokens": {
    "input": 36581,
    "output": 282,
    "context_window": 258400,
    "context_used_pct": 14.16
  },
  "files_modified": ["src/auth.ts", "src/types.ts"],
  "summary": "Implemented the authentication flow..."
}
```

## Pipeline Stages in Detail

### Stage 1: Ideation (You + User)

Talk through the problem with the user. Understand what they want. Think about how to break it down for the Codex army.

**Your role here**: Strategic thinking, asking clarifying questions, proposing approaches.

Even seemingly simple tasks go to Codex agents - remember, you are the orchestrator, not the implementer. The only exception is if the user explicitly asks you to do it yourself.

### Stage 2: Research (Codex Agents - read-only)

Spawn parallel investigation agents:

```bash
codex-agent start "Map the data flow from API to database for user creation" --map -s read-only
codex-agent start "Identify all places where user validation occurs" --map -s read-only
codex-agent start "Find security vulnerabilities in user input handling" --map -s read-only
```

Log each spawn immediately in agents.log.

### Stage 3: Synthesis (You)

Review agent findings. This is where you add value as the orchestrator:

**Filter bullshit from gold:**
- Agent suggests splitting a 9k token file - likely good
- Agent suggests adding rate limiting - good, we want quality
- Agent suggests types for code we didn't touch - skip, over-engineering
- Agent contradicts itself - investigate further
- Agent misunderstands the codebase - discount that finding

**Combine insights:**
- What's the actual state of the code?
- What are the real problems?
- What's the right approach?

Write synthesis to agents.log.

### Stage 4: PRD Creation (You + User)

For significant changes, create PRD in `docs/prds/`:

```markdown
# [Feature/Fix Name]

## Problem
[What's broken or missing]

## Solution
[High-level approach]

## Requirements
- [Specific requirement 1]
- [Specific requirement 2]

## Implementation Plan
### Phase 1: [Name]
- [ ] Task 1
- [ ] Task 2

### Phase 2: [Name]
- [ ] Task 3

## Files to Modify
- path/to/file.ts - [what changes]

## Testing
- [ ] Unit tests for X
- [ ] Integration test for Y

## Success Criteria
- [How we know it's done]
```

Review PRD with user before implementation.

### Stage 5: Implementation (Codex Agents - workspace-write)

Spawn implementation agents with PRD context:

```bash
codex-agent start "Implement Phase 1 of docs/prds/auth-refactor.md. Read the PRD first." --map -f "docs/prds/auth-refactor.md"
```

For large PRDs, implement in phases with separate agents.

### Stage 6: Review (Codex Agents - read-only)

Spawn parallel review agents:

```bash
# Security review
codex-agent start "Security review the changes. Check:
- OWASP top 10 vulnerabilities
- Auth bypass possibilities
- Data exposure risks
- Input validation
- SQL/command injection
Report any security concerns." --map -s read-only

# Error handling review
codex-agent start "Review error handling in changed files. Check for:
- Swallowed errors
- Missing validation
- Inconsistent patterns
- Raw errors exposed to clients
Report any violations." --map -s read-only

# Data integrity review
codex-agent start "Review for data integrity. Check:
- Existing data unaffected
- Database queries properly scoped
- No accidental data deletion
- Migrations are additive/safe
Report any concerns." --map -s read-only
```

**After review agents complete:**
- Synthesize findings
- Fix any critical issues before commit
- Note non-critical issues for future

### Stage 7: Testing (Codex Agents - workspace-write)

```bash
# Write tests
codex-agent start "Write comprehensive tests for the auth module changes" --map

# Run verification
codex-agent start "Run typecheck and tests. Fix any failures." --map
```

## Scaling: Multiple Claude Instances

The real power of this system is parallelism at every level:

```
USER runs 4 Claude instances simultaneously
  |
  Claude #1: researching auth module     (3 Codex agents)
  Claude #2: implementing feature A      (2 Codex agents)
  Claude #3: reviewing recent changes    (4 Codex agents)
  Claude #4: writing tests               (2 Codex agents)
```

When running multiple Claude Code sessions on the same codebase:
1. Each Claude instance spawns and manages its own agents independently
2. All instances share the same `agents.log` for coordination
3. Use job IDs to track which agent belongs to which Claude instance
4. Coordinate via agents.log entries to avoid duplicate work
5. Each Claude should claim a stage or module to prevent conflicts

This is how you get exponential execution: N Claude instances x M Codex agents each = N*M parallel workers on your codebase.

## agents.log Format

Maintain in project root. Shared across all Claude instances.

```markdown
# Agents Log

## Session: 2026-01-21T10:30:00Z
Goal: Refactor authentication system
PRD: docs/prds/auth-refactor.md

### Spawned: abc123 - 10:31
Type: research
Prompt: Investigate current auth flow, identify security gaps
Reasoning: xhigh
Sandbox: read-only

### Spawned: def456 - 10:31
Type: research
Prompt: Analyze session management patterns
Reasoning: xhigh
Sandbox: read-only

### Complete: abc123 - 10:45
Findings:
- JWT tokens stored in localStorage (XSS risk)
- No refresh token rotation
- Missing rate limiting on login endpoint
Files: src/auth/jwt.ts, src/auth/session.ts

### Complete: def456 - 10:47
Findings:
- Sessions never expire
- No concurrent session limits
Files: src/auth/session.ts, src/middleware/auth.ts

### Synthesis - 10:50
Combined: Auth system has 4 critical issues:
1. XSS-vulnerable token storage
2. No token rotation
3. No rate limiting
4. Infinite sessions
Approach: Create PRD with phased fix
Next: Write PRD to docs/prds/auth-security-hardening.md
```

## Multi-Agent Patterns

### Parallel Investigation

```bash
# Spawn 3 research agents simultaneously (parallel Bash calls)
codex-agent start "Audit auth flow" --map -s read-only          # -> jobA
codex-agent start "Review API security" --map -s read-only      # -> jobB
codex-agent start "Check data validation" --map -s read-only    # -> jobC

# Await all 3 in parallel (background Bash calls)
codex-agent await-turn $jobA; codex-agent status $jobA    # bg task 1
codex-agent await-turn $jobB; codex-agent status $jobB    # bg task 2
codex-agent await-turn $jobC; codex-agent status $jobC    # bg task 3

# Each notifies you independently the instant its agent finishes
# Quit each when done reading results
codex-agent send $jobA "/quit"
codex-agent send $jobB "/quit"
codex-agent send $jobC "/quit"
```

### Sequential Implementation

```bash
# Phase 1
codex-agent start "Implement Phase 1 of PRD" --map       # -> job1
codex-agent await-turn $job1                              # blocks until done
codex-agent status $job1                                  # review result
codex-agent send $job1 "/quit"

# Phase 2 (after Phase 1 verified)
codex-agent start "Implement Phase 2 of PRD" --map       # -> job2
codex-agent await-turn $job2
codex-agent status $job2
codex-agent send $job2 "/quit"
```

## Quality Gates

Before marking any stage complete:

| Stage | Gate |
|-------|------|
| Research | Findings documented in agents.log |
| Synthesis | Clear understanding, contradictions resolved |
| PRD | User reviewed and approved |
| Implementation | Typecheck passes, no new errors |
| Review | Security + quality checks pass |
| Testing | Tests written and passing |

## Error Recovery

### Agent Stuck

```bash
codex-agent jobs --json           # check status
codex-agent capture <jobId> 100   # see what's happening
codex-agent send <jobId> "Status update - what's blocking you?"
codex-agent kill <jobId>          # only if truly stuck
```

### Agent Didn't Get Message

If `codex-agent send` doesn't seem to work:
1. Check agent is still running: `codex-agent jobs --json`
2. Agent might be "thinking" - wait a moment
3. Try sending again with clearer instruction
4. Attach directly: `tmux attach -t codex-agent-<jobId>`

### Implementation Failed

1. Check the error in output
2. Don't retry with the same prompt
3. Mutate the approach - add context about what failed
4. Consider splitting into smaller tasks

## Post-Compaction Recovery

After Claude's context compacts, immediately:

```bash
# Check agents.log for state
# (Read agents.log in project root)

# Check running agents
codex-agent jobs --json
```

Read the log. Understand current stage. Resume from where you left off.

## When NOT to Use This Pipeline

Basically never. Codex agents are the default for all execution work.

**The ONLY exceptions:**
- The user explicitly says "you do it" or "don't use Codex"
- Pure conversation/discussion (no code, no files)
- You need to read a single file to understand context for the conversation

**Everything else goes to Codex agents**, including:
- "Simple" single file changes
- "Quick" bug fixes
- Tasks you think you could handle yourself

Why? Because:
1. Your job is orchestration, not implementation
2. Codex agents are specialized for coding work
3. This frees you to continue strategic discussion with the user
4. It's more efficient - agents work while you talk
