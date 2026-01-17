// Job management for async codex agent execution with tmux

import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { config, ReasoningEffort, SandboxMode } from "./config.ts";
import { randomBytes } from "crypto";
import {
  createSession,
  killSession,
  sessionExists,
  getSessionName,
  capturePane,
  captureFullHistory,
  isSessionActive,
  sendMessage,
  sendControl,
} from "./tmux.ts";

export interface Job {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  prompt: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  sandbox: SandboxMode;
  cwd: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  tmuxSession?: string;
  result?: string;
  error?: string;
}

function ensureJobsDir(): void {
  mkdirSync(config.jobsDir, { recursive: true });
}

function generateJobId(): string {
  return randomBytes(4).toString("hex");
}

function getJobPath(jobId: string): string {
  return join(config.jobsDir, `${jobId}.json`);
}

export function saveJob(job: Job): void {
  ensureJobsDir();
  writeFileSync(getJobPath(job.id), JSON.stringify(job, null, 2));
}

export function loadJob(jobId: string): Job | null {
  try {
    const content = readFileSync(getJobPath(jobId), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function listJobs(): Job[] {
  ensureJobsDir();
  const files = readdirSync(config.jobsDir).filter((f) => f.endsWith(".json"));
  return files
    .map((f) => {
      try {
        const content = readFileSync(join(config.jobsDir, f), "utf-8");
        return JSON.parse(content) as Job;
      } catch {
        return null;
      }
    })
    .filter((j): j is Job => j !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function deleteJob(jobId: string): boolean {
  const job = loadJob(jobId);

  // Kill tmux session if running
  if (job?.tmuxSession && sessionExists(job.tmuxSession)) {
    killSession(job.tmuxSession);
  }

  try {
    unlinkSync(getJobPath(jobId));
    // Clean up prompt file if exists
    try {
      unlinkSync(join(config.jobsDir, `${jobId}.prompt`));
    } catch {
      // Prompt file may not exist
    }
    return true;
  } catch {
    return false;
  }
}

export interface StartJobOptions {
  prompt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sandbox?: SandboxMode;
  cwd?: string;
}

export function startJob(options: StartJobOptions): Job {
  ensureJobsDir();

  const jobId = generateJobId();
  const cwd = options.cwd || process.cwd();

  const job: Job = {
    id: jobId,
    status: "pending",
    prompt: options.prompt,
    model: options.model || config.model,
    reasoningEffort: options.reasoningEffort || config.defaultReasoningEffort,
    sandbox: options.sandbox || config.defaultSandbox,
    cwd,
    createdAt: new Date().toISOString(),
  };

  saveJob(job);

  // Create tmux session with codex
  const result = createSession({
    jobId,
    prompt: options.prompt,
    model: job.model,
    reasoningEffort: job.reasoningEffort,
    sandbox: job.sandbox,
    cwd,
  });

  if (result.success) {
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.tmuxSession = result.sessionName;
  } else {
    job.status = "failed";
    job.error = result.error || "Failed to create tmux session";
    job.completedAt = new Date().toISOString();
  }

  saveJob(job);
  return job;
}

export function killJob(jobId: string): boolean {
  const job = loadJob(jobId);
  if (!job) return false;

  // Kill tmux session
  if (job.tmuxSession) {
    killSession(job.tmuxSession);
  }

  job.status = "failed";
  job.error = "Killed by user";
  job.completedAt = new Date().toISOString();
  saveJob(job);
  return true;
}

export function sendToJob(jobId: string, message: string): boolean {
  const job = loadJob(jobId);
  if (!job || !job.tmuxSession) return false;

  return sendMessage(job.tmuxSession, message);
}

export function sendControlToJob(jobId: string, key: string): boolean {
  const job = loadJob(jobId);
  if (!job || !job.tmuxSession) return false;

  return sendControl(job.tmuxSession, key);
}

export function getJobOutput(jobId: string, lines?: number): string | null {
  const job = loadJob(jobId);
  if (!job) return null;

  // First try tmux capture if session exists
  if (job.tmuxSession && sessionExists(job.tmuxSession)) {
    const output = capturePane(job.tmuxSession, { lines });
    if (output) return output;
  }

  // Fall back to log file
  const logFile = join(config.jobsDir, `${jobId}.log`);
  try {
    const content = readFileSync(logFile, "utf-8");
    if (lines) {
      const allLines = content.split("\n");
      return allLines.slice(-lines).join("\n");
    }
    return content;
  } catch {
    return null;
  }
}

export function getJobFullOutput(jobId: string): string | null {
  const job = loadJob(jobId);
  if (!job) return null;

  // First try tmux capture if session exists
  if (job.tmuxSession && sessionExists(job.tmuxSession)) {
    const output = captureFullHistory(job.tmuxSession);
    if (output) return output;
  }

  // Fall back to log file
  const logFile = join(config.jobsDir, `${jobId}.log`);
  try {
    return readFileSync(logFile, "utf-8");
  } catch {
    return null;
  }
}

export function cleanupOldJobs(maxAgeDays: number = 7): number {
  const jobs = listJobs();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let cleaned = 0;

  for (const job of jobs) {
    const jobTime = new Date(job.completedAt || job.createdAt).getTime();
    if (jobTime < cutoff && (job.status === "completed" || job.status === "failed")) {
      if (deleteJob(job.id)) cleaned++;
    }
  }

  return cleaned;
}

export function isJobRunning(jobId: string): boolean {
  const job = loadJob(jobId);
  if (!job || !job.tmuxSession) return false;

  return isSessionActive(job.tmuxSession);
}

export function refreshJobStatus(jobId: string): Job | null {
  const job = loadJob(jobId);
  if (!job) return null;

  if (job.status === "running" && job.tmuxSession) {
    // Check if tmux session still exists
    if (!sessionExists(job.tmuxSession)) {
      // Session ended completely
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      // Try to get output from log file
      const logFile = join(config.jobsDir, `${jobId}.log`);
      try {
        job.result = readFileSync(logFile, "utf-8");
      } catch {
        // No log file
      }
      saveJob(job);
    } else {
      // Session exists - check if codex is still running
      // Look for the "[codex-agent: Session complete" marker in output
      const output = capturePane(job.tmuxSession, { lines: 20 });
      if (output && output.includes("[codex-agent: Session complete")) {
        job.status = "completed";
        job.completedAt = new Date().toISOString();
        // Capture full output
        const fullOutput = captureFullHistory(job.tmuxSession);
        if (fullOutput) {
          job.result = fullOutput;
        }
        saveJob(job);
      }
    }
  }

  return loadJob(jobId);
}

export function getAttachCommand(jobId: string): string | null {
  const job = loadJob(jobId);
  if (!job || !job.tmuxSession) return null;

  return `tmux attach -t "${job.tmuxSession}"`;
}
