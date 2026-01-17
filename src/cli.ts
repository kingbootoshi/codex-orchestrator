#!/usr/bin/env bun

// Codex Agent CLI - Delegate tasks to GPT Codex agents with tmux integration
// Designed for Claude Code orchestration with bidirectional communication

import { config, ReasoningEffort, SandboxMode } from "./config.ts";
import {
  startJob,
  loadJob,
  listJobs,
  killJob,
  refreshJobStatus,
  cleanupOldJobs,
  deleteJob,
  sendToJob,
  sendControlToJob,
  getJobOutput,
  getJobFullOutput,
  getAttachCommand,
  Job,
} from "./jobs.ts";
import { loadFiles, formatPromptWithFiles, estimateTokens, loadCodebaseMap } from "./files.ts";
import { isTmuxAvailable, listSessions } from "./tmux.ts";

const HELP = `
Codex Agent - Delegate tasks to GPT Codex agents (tmux-based)

Usage:
  codex-agent start "prompt" [options]   Start agent in tmux session
  codex-agent status <jobId>             Check job status
  codex-agent send <jobId> "message"     Send message to running agent
  codex-agent capture <jobId> [lines]    Capture recent output (default: 50 lines)
  codex-agent output <jobId>             Get full session output
  codex-agent attach <jobId>             Get tmux attach command
  codex-agent watch <jobId>              Stream output updates
  codex-agent jobs                       List all jobs
  codex-agent sessions                   List active tmux sessions
  codex-agent kill <jobId>               Kill running job
  codex-agent clean                      Clean old completed jobs
  codex-agent health                     Check tmux and codex availability

Options:
  -r, --reasoning <level>    Reasoning effort: low, medium, high, xhigh (default: medium)
  -m, --model <model>        Model name (default: gpt-5.2-codex)
  -s, --sandbox <mode>       Sandbox: read-only, workspace-write, danger-full-access
  -f, --file <glob>          Include files matching glob (can repeat)
  -d, --dir <path>           Working directory (default: cwd)
  --map                      Include codebase map if available
  --dry-run                  Show prompt without executing
  --strip-ansi               Remove ANSI escape codes from output (for capture/output)
  -h, --help                 Show this help

Examples:
  # Start an agent
  codex-agent start "Review this code for security issues" -f "src/**/*.ts"

  # Check on it
  codex-agent capture abc123

  # Send additional context
  codex-agent send abc123 "Also check the auth module"

  # Attach to watch interactively
  tmux attach -t codex-agent-abc123

  # Or use the attach command
  codex-agent attach abc123

Bidirectional Communication:
  - Use 'send' to give agents additional instructions mid-task
  - Use 'capture' to see recent output programmatically
  - Use 'attach' to interact directly in tmux
  - Press Ctrl+C in tmux to interrupt, type to continue conversation
`;

interface Options {
  reasoning: ReasoningEffort;
  model: string;
  sandbox: SandboxMode;
  files: string[];
  dir: string;
  includeMap: boolean;
  dryRun: boolean;
  stripAnsi: boolean;
}

function stripAnsiCodes(text: string): string {
  return text
    // Remove ANSI escape sequences (colors, cursor movements, etc)
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // Remove other escape sequences (OSC, etc)
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // Remove carriage returns (used for spinner overwrites)
    .replace(/\r/g, '')
    // Remove other control characters except newline and tab
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function parseArgs(args: string[]): {
  command: string;
  positional: string[];
  options: Options;
} {
  const options: Options = {
    reasoning: config.defaultReasoningEffort,
    model: config.model,
    sandbox: config.defaultSandbox,
    files: [],
    dir: process.cwd(),
    includeMap: false,
    dryRun: false,
    stripAnsi: false,
  };

  const positional: string[] = [];
  let command = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "-r" || arg === "--reasoning") {
      const level = args[++i] as ReasoningEffort;
      if (config.reasoningEfforts.includes(level)) {
        options.reasoning = level;
      } else {
        console.error(`Invalid reasoning level: ${level}`);
        console.error(`Valid options: ${config.reasoningEfforts.join(", ")}`);
        process.exit(1);
      }
    } else if (arg === "-m" || arg === "--model") {
      options.model = args[++i];
    } else if (arg === "-s" || arg === "--sandbox") {
      const mode = args[++i] as SandboxMode;
      if (config.sandboxModes.includes(mode)) {
        options.sandbox = mode;
      } else {
        console.error(`Invalid sandbox mode: ${mode}`);
        console.error(`Valid options: ${config.sandboxModes.join(", ")}`);
        process.exit(1);
      }
    } else if (arg === "-f" || arg === "--file") {
      options.files.push(args[++i]);
    } else if (arg === "-d" || arg === "--dir") {
      options.dir = args[++i];
    } else if (arg === "--map") {
      options.includeMap = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--strip-ansi") {
      options.stripAnsi = true;
    } else if (!arg.startsWith("-")) {
      if (!command) {
        command = arg;
      } else {
        positional.push(arg);
      }
    }
  }

  return { command, positional, options };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function formatJobStatus(job: Job): string {
  const elapsed = job.startedAt
    ? formatDuration(
        (job.completedAt ? new Date(job.completedAt).getTime() : Date.now()) -
          new Date(job.startedAt).getTime()
      )
    : "-";

  const status = job.status.toUpperCase().padEnd(10);
  const promptPreview = job.prompt.slice(0, 50) + (job.prompt.length > 50 ? "..." : "");

  return `${job.id}  ${status}  ${elapsed.padEnd(8)}  ${job.reasoningEffort.padEnd(6)}  ${promptPreview}`;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const { command, positional, options } = parseArgs(args);

  try {
    switch (command) {
      case "health": {
        // Check tmux
        if (!isTmuxAvailable()) {
          console.error("tmux not found");
          console.error("Install with: brew install tmux");
          process.exit(1);
        }
        console.log("tmux: OK");

        // Check codex
        const { execSync } = await import("child_process");
        try {
          const version = execSync("codex --version", { encoding: "utf-8" }).trim();
          console.log(`codex: ${version}`);
        } catch {
          console.error("codex CLI not found");
          console.error("Install with: npm install -g @openai/codex");
          process.exit(1);
        }

        console.log("Status: Ready");
        break;
      }

      case "start": {
        if (positional.length === 0) {
          console.error("Error: No prompt provided");
          process.exit(1);
        }

        // Check tmux first
        if (!isTmuxAvailable()) {
          console.error("Error: tmux is required but not installed");
          console.error("Install with: brew install tmux");
          process.exit(1);
        }

        let prompt = positional.join(" ");

        // Load file context if specified
        if (options.files.length > 0) {
          const files = await loadFiles(options.files, options.dir);
          prompt = formatPromptWithFiles(prompt, files);
          console.error(`Included ${files.length} files`);
        }

        // Include codebase map if requested
        if (options.includeMap) {
          const map = await loadCodebaseMap(options.dir);
          if (map) {
            prompt = `## Codebase Map\n\n${map}\n\n---\n\n${prompt}`;
            console.error("Included codebase map");
          } else {
            console.error("No codebase map found");
          }
        }

        if (options.dryRun) {
          const tokens = estimateTokens(prompt);
          console.log(`Would send ~${tokens.toLocaleString()} tokens`);
          console.log(`Model: ${options.model}`);
          console.log(`Reasoning: ${options.reasoning}`);
          console.log(`Sandbox: ${options.sandbox}`);
          console.log("\n--- Prompt Preview ---\n");
          console.log(prompt.slice(0, 3000));
          if (prompt.length > 3000) {
            console.log(`\n... (${prompt.length - 3000} more characters)`);
          }
          process.exit(0);
        }

        const job = startJob({
          prompt,
          model: options.model,
          reasoningEffort: options.reasoning,
          sandbox: options.sandbox,
          cwd: options.dir,
        });

        console.log(`Job started: ${job.id}`);
        console.log(`Model: ${job.model} (${job.reasoningEffort})`);
        console.log(`Working dir: ${job.cwd}`);
        console.log(`tmux session: ${job.tmuxSession}`);
        console.log("");
        console.log("Commands:");
        console.log(`  Capture output:  codex-agent capture ${job.id}`);
        console.log(`  Send message:    codex-agent send ${job.id} "message"`);
        console.log(`  Attach session:  tmux attach -t ${job.tmuxSession}`);
        break;
      }

      case "status": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        const job = refreshJobStatus(positional[0]);
        if (!job) {
          console.error(`Job ${positional[0]} not found`);
          process.exit(1);
        }

        console.log(`Job: ${job.id}`);
        console.log(`Status: ${job.status}`);
        console.log(`Model: ${job.model} (${job.reasoningEffort})`);
        console.log(`Sandbox: ${job.sandbox}`);
        console.log(`Created: ${job.createdAt}`);
        if (job.startedAt) {
          console.log(`Started: ${job.startedAt}`);
        }
        if (job.completedAt) {
          console.log(`Completed: ${job.completedAt}`);
        }
        if (job.tmuxSession) {
          console.log(`tmux session: ${job.tmuxSession}`);
        }
        if (job.error) {
          console.log(`Error: ${job.error}`);
        }
        break;
      }

      case "send": {
        if (positional.length < 2) {
          console.error("Error: Usage: codex-agent send <jobId> \"message\"");
          process.exit(1);
        }

        const jobId = positional[0];
        const message = positional.slice(1).join(" ");

        if (sendToJob(jobId, message)) {
          console.log(`Sent to ${jobId}: ${message}`);
        } else {
          console.error(`Could not send to job ${jobId}`);
          console.error("Job may not be running or tmux session not found");
          process.exit(1);
        }
        break;
      }

      case "capture": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        const lines = positional[1] ? parseInt(positional[1], 10) : 50;
        let output = getJobOutput(positional[0], lines);

        if (output) {
          if (options.stripAnsi) {
            output = stripAnsiCodes(output);
          }
          console.log(output);
        } else {
          console.error(`Could not capture output for job ${positional[0]}`);
          process.exit(1);
        }
        break;
      }

      case "output": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        let output = getJobFullOutput(positional[0]);
        if (output) {
          if (options.stripAnsi) {
            output = stripAnsiCodes(output);
          }
          console.log(output);
        } else {
          console.error(`Could not get output for job ${positional[0]}`);
          process.exit(1);
        }
        break;
      }

      case "attach": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        const attachCmd = getAttachCommand(positional[0]);
        if (attachCmd) {
          console.log(attachCmd);
        } else {
          console.error(`Job ${positional[0]} not found or no tmux session`);
          process.exit(1);
        }
        break;
      }

      case "watch": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        const job = loadJob(positional[0]);
        if (!job || !job.tmuxSession) {
          console.error(`Job ${positional[0]} not found or no tmux session`);
          process.exit(1);
        }

        console.error(`Watching ${job.tmuxSession}... (Ctrl+C to stop)`);
        console.error("For interactive mode, use: tmux attach -t " + job.tmuxSession);
        console.error("");

        // Simple polling-based watch
        let lastOutput = "";
        const pollInterval = setInterval(() => {
          const output = getJobOutput(positional[0], 100);
          if (output && output !== lastOutput) {
            // Print only new content
            if (lastOutput) {
              const newPart = output.replace(lastOutput, "");
              if (newPart.trim()) {
                process.stdout.write(newPart);
              }
            } else {
              console.log(output);
            }
            lastOutput = output;
          }

          // Check if job is still running
          const refreshed = refreshJobStatus(positional[0]);
          if (refreshed && refreshed.status !== "running") {
            console.error(`\nJob ${refreshed.status}`);
            clearInterval(pollInterval);
            process.exit(0);
          }
        }, 1000);

        // Handle Ctrl+C
        process.on("SIGINT", () => {
          clearInterval(pollInterval);
          console.error("\nStopped watching");
          process.exit(0);
        });
        break;
      }

      case "jobs": {
        const jobs = listJobs();
        if (jobs.length === 0) {
          console.log("No jobs");
        } else {
          console.log("ID        STATUS      ELAPSED   EFFORT  PROMPT");
          console.log("-".repeat(80));
          for (const job of jobs) {
            // Refresh running jobs
            if (job.status === "running") {
              refreshJobStatus(job.id);
            }
            console.log(formatJobStatus(job));
          }
        }
        break;
      }

      case "sessions": {
        const sessions = listSessions();
        if (sessions.length === 0) {
          console.log("No active codex-agent sessions");
        } else {
          console.log("SESSION NAME                    ATTACHED  CREATED");
          console.log("-".repeat(60));
          for (const session of sessions) {
            const attached = session.attached ? "yes" : "no";
            console.log(
              `${session.name.padEnd(30)}  ${attached.padEnd(8)}  ${session.created}`
            );
          }
        }
        break;
      }

      case "kill": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        if (killJob(positional[0])) {
          console.log(`Killed job: ${positional[0]}`);
        } else {
          console.error(`Could not kill job: ${positional[0]}`);
          process.exit(1);
        }
        break;
      }

      case "clean": {
        const cleaned = cleanupOldJobs(7);
        console.log(`Cleaned ${cleaned} old jobs`);
        break;
      }

      case "delete": {
        if (positional.length === 0) {
          console.error("Error: No job ID provided");
          process.exit(1);
        }

        if (deleteJob(positional[0])) {
          console.log(`Deleted job: ${positional[0]}`);
        } else {
          console.error(`Could not delete job: ${positional[0]}`);
          process.exit(1);
        }
        break;
      }

      default:
        // Treat as prompt for start command
        if (command) {
          // Check tmux first
          if (!isTmuxAvailable()) {
            console.error("Error: tmux is required but not installed");
            console.error("Install with: brew install tmux");
            process.exit(1);
          }

          const prompt = [command, ...positional].join(" ");

          if (options.dryRun) {
            const tokens = estimateTokens(prompt);
            console.log(`Would send ~${tokens.toLocaleString()} tokens`);
            process.exit(0);
          }

          const job = startJob({
            prompt,
            model: options.model,
            reasoningEffort: options.reasoning,
            sandbox: options.sandbox,
            cwd: options.dir,
          });

          console.log(`Job started: ${job.id}`);
          console.log(`tmux session: ${job.tmuxSession}`);
          console.log(`Attach: tmux attach -t ${job.tmuxSession}`);
        } else {
          console.log(HELP);
        }
    }
  } catch (err) {
    console.error("Error:", (err as Error).message);
    process.exit(1);
  }
}

main();
