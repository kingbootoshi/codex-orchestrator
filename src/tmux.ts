// tmux helper functions for codex-agent

import { execSync, spawnSync } from "child_process";
import { config } from "./config.ts";

export interface TmuxSession {
  name: string;
  attached: boolean;
  windows: number;
  created: string;
}

const SESSION_COMPLETE_MARKER = "[codex-agent: Session complete";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function listManagedSessionNames(): string[] {
  const prefixPattern = `${config.tmuxPrefix}-*`;

  try {
    const output = execSync(
      `tmux list-sessions -F "#{session_name}" -f "#{m:${prefixPattern},#{session_name}}" 2>/dev/null`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    return output ? output.split("\n").filter(Boolean) : [];
  } catch {
    try {
      const output = execSync(
        `tmux list-sessions -F "#{session_name}" 2>/dev/null`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      );

      return output
        .trim()
        .split("\n")
        .filter((line) => line.startsWith(`${config.tmuxPrefix}-`));
    } catch {
      return [];
    }
  }
}

/**
 * Get tmux session name for a job
 */
export function getSessionName(jobId: string): string {
  return `${config.tmuxPrefix}-${jobId}`;
}

/**
 * Check if tmux is available
 */
export function isTmuxAvailable(): boolean {
  try {
    execSync("which tmux", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a tmux session exists
 */
export function sessionExists(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new tmux session running codex (interactive mode)
 */
export function createSession(options: {
  jobId: string;
  prompt: string;
  model: string;
  reasoningEffort: string;
  sandbox: string;
  cwd: string;
}): { sessionName: string; success: boolean; error?: string } {
  const sessionName = getSessionName(options.jobId);
  const logFile = `${config.jobsDir}/${options.jobId}.log`;
  const jobFile = `${config.jobsDir}/${options.jobId}.json`;
  const notifyHook = `${import.meta.dir}/notify-hook.ts`;

  // Create prompt file to avoid shell escaping issues
  const promptFile = `${config.jobsDir}/${options.jobId}.prompt`;
  const fs = require("fs");
  fs.writeFileSync(promptFile, options.prompt);

  try {
    // Build the codex command (interactive mode)
    // We use the interactive TUI so we can send messages later
    const codexArgs = [
      `-c`, `model="${options.model}"`,
      `-c`, `model_reasoning_effort="${options.reasoningEffort}"`,
      `-c`, `skip_update_check=true`,
      `-c`, shellQuote(`notify=["bun","run","${notifyHook}","${options.jobId}"]`),
      `-a`, `never`,
      `-s`, options.sandbox,
    ].join(" ");

    const indexFile = `${config.jobsDir}/index.json`;
    const completionScript = [
      `import { readFileSync, writeFileSync, renameSync } from "fs";`,
      `const jobPath = process.argv[1];`,
      `const exitCode = Number(process.argv[2] ?? "0");`,
      `const indexPath = process.argv[3];`,
      `try {`,
      `  const job = JSON.parse(readFileSync(jobPath, "utf-8"));`,
      `  if (job.status === "running" || job.status === "pending") {`,
      `    job.status = exitCode === 0 ? "completed" : "failed";`,
      `    job.completedAt = new Date().toISOString();`,
      `    job.turnState = "idle";`,
      `    if (exitCode !== 0 && !job.error) {`,
      `      job.error = \`Codex exited with code \${exitCode}\`;`,
      `    }`,
      `    writeFileSync(jobPath, JSON.stringify(job, null, 2));`,
      `  }`,
      `  try {`,
      `    const idx = JSON.parse(readFileSync(indexPath, "utf-8"));`,
      `    if (idx.jobs && idx.jobs[job.id]) {`,
      `      delete idx.jobs[job.id];`,
      `      idx.updatedAt = new Date().toISOString();`,
      `      const tmp = indexPath + "." + process.pid + ".tmp";`,
      `      writeFileSync(tmp, JSON.stringify(idx, null, 2));`,
      `      renameSync(tmp, indexPath);`,
      `    }`,
      `  } catch {}`,
      `} catch {`,
      `  process.exit(0);`,
      `}`,
    ].join(" ");

    const completionHook = [
      `exit_code=$?`,
      `bun -e ${shellQuote(completionScript)} ${shellQuote(jobFile)} "$exit_code" ${shellQuote(indexFile)}`,
      `echo "\\n\\n[codex-agent: Session complete. Closing in 5s.]"`,
      `sleep 5`,
      `tmux kill-session -t ${shellQuote(sessionName)}`,
    ].join("; ");

    // Create tmux session with codex running
    // Use script to capture all output, then update job state and let the
    // session terminate itself after a short delay so logs can flush cleanly.
    // AI-DEVNOTE (2026-02-14): Platform-aware script command.
    // macOS: script -q <file> <command>
    // Linux: script -q -c "<command>" <file>
    const isLinux = process.platform === "linux";
    const shellCmd = isLinux
      ? `script -q -e -c "codex ${codexArgs}" "${logFile}"; ${completionHook}`
      : `script -q "${logFile}" codex ${codexArgs}; ${completionHook}`;

    const tmuxResult = spawnSync(
      "tmux",
      ["new-session", "-d", "-s", sessionName, "-c", options.cwd, shellCmd],
      { stdio: "pipe", cwd: options.cwd }
    );
    if (tmuxResult.status !== 0) {
      throw new Error((tmuxResult.stderr || tmuxResult.stdout).toString() || "tmux new-session failed");
    }

    // Give codex a moment to initialize and show update prompt if any
    spawnSync("sleep", ["1"]);

    // Skip update prompt if it appears by sending "3" (skip until next version)
    // Then Enter to dismiss any remaining prompts
    execSync(`tmux send-keys -t "${sessionName}" "3"`, { stdio: "pipe" });
    spawnSync("sleep", ["0.5"]);
    execSync(`tmux send-keys -t "${sessionName}" Enter`, { stdio: "pipe" });
    spawnSync("sleep", ["1"]);

    // Send the prompt (read from file to handle complex prompts)
    // Using send-keys with the prompt content
    const promptContent = options.prompt.replace(/'/g, "'\\''"); // Escape single quotes

    // For very long prompts, we'll type it in chunks or use a different approach
    if (options.prompt.length < 5000) {
      // Send prompt directly for shorter prompts
      // Use separate send-keys calls for text and Enter to ensure Enter is processed
      execSync(
        `tmux send-keys -t "${sessionName}" '${promptContent}'`,
        { stdio: "pipe" }
      );
      // Small delay to let TUI process the text before Enter
      spawnSync("sleep", ["0.3"]);
      execSync(
        `tmux send-keys -t "${sessionName}" Enter`,
        { stdio: "pipe" }
      );
    } else {
      // For long prompts, use load-buffer approach
      execSync(`tmux load-buffer "${promptFile}"`, { stdio: "pipe" });
      execSync(`tmux paste-buffer -t "${sessionName}"`, { stdio: "pipe" });
      spawnSync("sleep", ["0.3"]);
      execSync(`tmux send-keys -t "${sessionName}" Enter`, { stdio: "pipe" });
    }

    return { sessionName, success: true };
  } catch (err) {
    return {
      sessionName,
      success: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Send a message to a running codex session
 */
export function sendMessage(sessionName: string, message: string): boolean {
  if (!sessionExists(sessionName)) {
    return false;
  }

  try {
    const escapedMessage = message.replace(/'/g, "'\\''");
    execSync(`tmux send-keys -t "${sessionName}" '${escapedMessage}'`, {
      stdio: "pipe",
    });
    // Small delay before Enter for TUI to process
    spawnSync("sleep", ["0.3"]);
    execSync(`tmux send-keys -t "${sessionName}" Enter`, {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a control key to a session (like Ctrl+C)
 */
export function sendControl(sessionName: string, key: string): boolean {
  if (!sessionExists(sessionName)) {
    return false;
  }

  try {
    execSync(`tmux send-keys -t "${sessionName}" ${key}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture the current pane content
 */
export function capturePane(
  sessionName: string,
  options: { lines?: number; start?: number } = {}
): string | null {
  if (!sessionExists(sessionName)) {
    return null;
  }

  try {
    let cmd = `tmux capture-pane -t "${sessionName}" -p`;

    if (options.start !== undefined) {
      cmd += ` -S ${options.start}`;
    }

    const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });

    if (options.lines) {
      const allLines = output.split("\n");
      return allLines.slice(-options.lines).join("\n");
    }

    return output;
  } catch {
    return null;
  }
}

/**
 * Get the full scrollback buffer
 */
export function captureFullHistory(sessionName: string): string | null {
  if (!sessionExists(sessionName)) {
    return null;
  }

  try {
    // Capture from start of history (-S -) to end
    const output = execSync(
      `tmux capture-pane -t "${sessionName}" -p -S -`,
      { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }
    );
    return output;
  } catch {
    return null;
  }
}

/**
 * Kill a tmux session
 */
export function killSession(sessionName: string): boolean {
  if (!sessionExists(sessionName)) {
    return false;
  }

  try {
    execSync(`tmux kill-session -t "${sessionName}"`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * List all codex-agent sessions
 */
export function listSessions(): TmuxSession[] {
  try {
    const output = execSync(
      `tmux list-sessions -F "#{session_name}|#{session_attached}|#{session_windows}|#{session_created}" 2>/dev/null`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );

    return output
      .trim()
      .split("\n")
      .filter((line) => line.startsWith(config.tmuxPrefix))
      .map((line) => {
        const [name, attached, windows, created] = line.split("|");
        return {
          name,
          attached: attached === "1",
          windows: parseInt(windows, 10),
          created: new Date(parseInt(created, 10) * 1000).toISOString(),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Kill codex-agent sessions already sitting on the completion banner
 */
export function cleanupCompletedSessions(): string[] {
  const killed: string[] = [];

  for (const sessionName of listManagedSessionNames()) {
    const output = capturePane(sessionName, { lines: 20 });
    if (!output || !output.includes(SESSION_COMPLETE_MARKER)) {
      continue;
    }

    if (killSession(sessionName)) {
      killed.push(sessionName);
    }
  }

  return killed;
}

/**
 * Kill codex-agent tmux sessions that do not belong to active jobs.
 * Sessions younger than 30s are skipped to avoid racing with startJob().
 */
export function cleanupOrphanedSessions(activeSessionNames: Iterable<string>): string[] {
  const active = new Set(activeSessionNames);
  const killed: string[] = [];
  const now = Date.now();

  for (const sessionName of listManagedSessionNames()) {
    if (active.has(sessionName)) {
      continue;
    }

    // Skip young sessions - they may still be in the startup window
    // where the job JSON hasn't recorded tmuxSession yet.
    try {
      const created = execSync(
        `tmux display-message -t "${sessionName}" -p "#{session_created}"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
      const ageMs = now - parseInt(created, 10) * 1000;
      if (ageMs < 30_000) continue;
    } catch {
      // If we can't read session age, skip it to be safe
      continue;
    }

    if (killSession(sessionName)) {
      killed.push(sessionName);
    }
  }

  return killed;
}

/**
 * Get the command to attach to a session (for display to user)
 */
export function getAttachCommand(sessionName: string): string {
  return `tmux attach -t "${sessionName}"`;
}

/**
 * Check if the session's codex process is still running
 */
export function isSessionActive(sessionName: string): boolean {
  if (!sessionExists(sessionName)) {
    return false;
  }

  try {
    // Check if the pane has a running process
    const pid = execSync(
      `tmux list-panes -t "${sessionName}" -F "#{pane_pid}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    if (!pid) return false;

    // Check if that process is still running
    process.kill(parseInt(pid, 10), 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Watch a session's output (returns a stream of updates)
 * This is for programmatic watching - for interactive use, just attach
 */
export function watchSession(
  sessionName: string,
  callback: (content: string) => void,
  intervalMs: number = 1000
): { stop: () => void } {
  let lastContent = "";
  let running = true;

  const interval = setInterval(() => {
    if (!running) return;

    const content = capturePane(sessionName, { lines: 100 });
    if (content && content !== lastContent) {
      // Only send the new lines
      const newContent = content.replace(lastContent, "").trim();
      if (newContent) {
        callback(newContent);
      }
      lastContent = content;
    }

    // Check if session still exists
    if (!sessionExists(sessionName)) {
      running = false;
      clearInterval(interval);
    }
  }, intervalMs);

  return {
    stop: () => {
      running = false;
      clearInterval(interval);
    },
  };
}
