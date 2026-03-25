// Job management for async codex agent execution with tmux

import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, statSync, renameSync } from "fs";
import { join } from "path";
import { config, ReasoningEffort, SandboxMode } from "./config.ts";
import { randomBytes } from "crypto";
import { extractSessionId, findSessionFile, parseSessionFile, type ParsedSessionData } from "./session-parser.ts";
import {
  createSession,
  cleanupCompletedSessions,
  cleanupOrphanedSessions,
  killSession,
  sessionExists,
  capturePane,
  captureFullHistory,
  isSessionActive,
  sendMessage,
  sendControl,
} from "./tmux.ts";
import { clearSignalFile, signalFileExists, readSignalFile, type TurnEvent } from "./watcher.ts";

export interface Job {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  prompt: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  sandbox: SandboxMode;
  parentSessionId?: string;
  cwd: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  tmuxSession?: string;
  result?: string;
  error?: string;
  // Turn tracking
  turnCount?: number;
  lastTurnCompletedAt?: string;
  lastAgentMessage?: string;
  turnState?: "working" | "idle" | "context_limit";
}

interface JobIndexEntry {
  status: "pending" | "running";
}

interface JobIndex {
  updatedAt: string;
  jobs: Record<string, JobIndexEntry>;
}

export interface ListJobsOptions {
  all?: boolean;
  limit?: number | null;
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

function createEmptyJobIndex(): JobIndex {
  return {
    updatedAt: new Date().toISOString(),
    jobs: {},
  };
}

function isActiveJobStatus(status: Job["status"]): status is "pending" | "running" {
  return status === "pending" || status === "running";
}

function isJobJsonFile(fileName: string): boolean {
  return fileName.endsWith(".json") && fileName !== "index.json";
}

function loadJobFromPath(jobPath: string): Job | null {
  try {
    const content = readFileSync(jobPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function listAllJobsFromDirectory(): Job[] {
  const files = readdirSync(config.jobsDir).filter(isJobJsonFile);
  return files
    .map((fileName) => loadJobFromPath(join(config.jobsDir, fileName)))
    .filter((job): job is Job => job !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function readJobIndex(): JobIndex | null {
  try {
    const content = readFileSync(config.jobsIndexFile, "utf-8");
    const parsed = JSON.parse(content) as Partial<JobIndex>;
    const jobs = parsed.jobs && typeof parsed.jobs === "object" ? parsed.jobs : {};

    return {
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      jobs: Object.fromEntries(
        Object.entries(jobs).filter(
          ([jobId, entry]) =>
            typeof jobId === "string" &&
            !!entry &&
            typeof entry === "object" &&
            (((entry as JobIndexEntry).status === "pending") ||
              (entry as JobIndexEntry).status === "running")
        )
      ) as JobIndex["jobs"],
    };
  } catch {
    return null;
  }
}

function writeJobIndex(index: JobIndex): void {
  ensureJobsDir();
  index.updatedAt = new Date().toISOString();
  // Atomic write: temp file + rename to avoid partial reads from concurrent processes
  const tmpFile = `${config.jobsIndexFile}.${process.pid}.tmp`;
  writeFileSync(tmpFile, JSON.stringify(index, null, 2));
  renameSync(tmpFile, config.jobsIndexFile);
}

function rebuildJobIndex(): JobIndex {
  const index = createEmptyJobIndex();

  for (const job of listAllJobsFromDirectory()) {
    if (isActiveJobStatus(job.status)) {
      index.jobs[job.id] = { status: job.status };
    }
  }

  writeJobIndex(index);
  return index;
}

function getOrRebuildJobIndex(): JobIndex {
  const index = readJobIndex();
  if (index) return index;
  return rebuildJobIndex();
}

function syncJobIndex(job: Job): void {
  const index = readJobIndex() ?? createEmptyJobIndex();

  if (isActiveJobStatus(job.status)) {
    index.jobs[job.id] = { status: job.status };
  } else {
    delete index.jobs[job.id];
  }

  writeJobIndex(index);
}

function removeJobFromIndex(jobId: string): void {
  const index = readJobIndex();
  if (!index || !index.jobs[jobId]) return;

  delete index.jobs[jobId];
  writeJobIndex(index);
}

function loadIndexedActiveJobs(index: JobIndex): Job[] {
  const jobs: Job[] = [];
  let isDirty = false;

  for (const jobId of Object.keys(index.jobs)) {
    const job = loadJob(jobId);
    if (!job || !isActiveJobStatus(job.status)) {
      delete index.jobs[jobId];
      isDirty = true;
      continue;
    }

    jobs.push(job);
  }

  if (isDirty) {
    writeJobIndex(index);
  }

  return jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function listRecentJobFilesByMtime(activeJobIds: Set<string>, limit: number): string[] {
  if (limit <= 0) return [];

  return readdirSync(config.jobsDir)
    .filter(isJobJsonFile)
    .filter((fileName) => !activeJobIds.has(fileName.slice(0, -".json".length)))
    .map((fileName) => {
      try {
        return {
          fileName,
          mtimeMs: statSync(join(config.jobsDir, fileName)).mtimeMs,
        };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { fileName: string; mtimeMs: number } => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((entry) => entry.fileName);
}

export function saveJob(job: Job): void {
  ensureJobsDir();
  writeFileSync(getJobPath(job.id), JSON.stringify(job, null, 2));
  syncJobIndex(job);
}

export function loadJob(jobId: string): Job | null {
  return loadJobFromPath(getJobPath(jobId));
}

export function listJobs(options: ListJobsOptions = {}): Job[] {
  ensureJobsDir();
  if (options.all) {
    return listAllJobsFromDirectory();
  }

  const limit = options.limit ?? config.jobsListLimit;
  const index = getOrRebuildJobIndex();
  const activeJobs = loadIndexedActiveJobs(index);
  const activeJobIds = new Set(activeJobs.map((job) => job.id));
  const recentLimit = Math.max(limit - activeJobs.length, 0);
  const recentJobs = listRecentJobFilesByMtime(activeJobIds, recentLimit)
    .map((fileName) => loadJobFromPath(join(config.jobsDir, fileName)))
    .filter((job): job is Job => job !== null);

  return [...activeJobs, ...recentJobs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

function computeElapsedMs(job: Job): number {
  const start = job.startedAt ?? job.createdAt;
  const startMs = Date.parse(start);
  const endMs = job.completedAt ? Date.parse(job.completedAt) : Date.now();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, endMs - startMs);
}

function getLogMtimeMs(jobId: string): number | null {
  const logFile = join(config.jobsDir, `${jobId}.log`);
  try {
    return statSync(logFile).mtimeMs;
  } catch {
    return null;
  }
}

function getLastActivityMs(job: Job): number | null {
  const logMtime = getLogMtimeMs(job.id);
  if (logMtime !== null) return logMtime;

  const fallback = job.startedAt ?? job.createdAt;
  const fallbackMs = Date.parse(fallback);
  if (!Number.isFinite(fallbackMs)) return null;
  return fallbackMs;
}

function isInactiveTimedOut(job: Job): boolean {
  const timeoutMinutes = config.defaultTimeout;
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) return false;

  const lastActivityMs = getLastActivityMs(job);
  if (!lastActivityMs) return false;

  return Date.now() - lastActivityMs > timeoutMinutes * 60 * 1000;
}

function loadSessionData(jobId: string): ParsedSessionData | null {
  const logFile = join(config.jobsDir, `${jobId}.log`);
  let logContent: string;

  try {
    logContent = readFileSync(logFile, "utf-8");
  } catch {
    return null;
  }

  const sessionId = extractSessionId(logContent);
  if (!sessionId) return null;

  const sessionFile = findSessionFile(sessionId);
  if (!sessionFile) return null;

  return parseSessionFile(sessionFile);
}

export type JobsJsonEntry = {
  id: string;
  status: Job["status"];
  prompt: string;
  model: string;
  reasoning: ReasoningEffort;
  cwd: string;
  elapsed_ms: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  tokens: ParsedSessionData["tokens"] | null;
  files_modified: ParsedSessionData["files_modified"] | null;
  summary: string | null;
};

export type JobsJsonOutput = {
  generated_at: string;
  jobs: JobsJsonEntry[];
};

export function getJobsJson(options: ListJobsOptions = {}): JobsJsonOutput {
  const jobs = listJobs(options);
  const enriched = jobs.map((job) => {
    const refreshed = (job.status === "running" || job.status === "pending") ? refreshJobStatus(job.id) : null;
    const effective = refreshed ?? job;
    const elapsedMs = computeElapsedMs(effective);

    let tokens: ParsedSessionData["tokens"] | null = null;
    let filesModified: ParsedSessionData["files_modified"] | null = null;
    let summary: string | null = null;

    if (effective.status === "completed") {
      const sessionData = loadSessionData(effective.id);
      if (sessionData) {
        tokens = sessionData.tokens;
        filesModified = sessionData.files_modified;
        summary = sessionData.summary ? truncateText(sessionData.summary, 500) : null;
      }
    }

    return {
      id: effective.id,
      status: effective.status,
      prompt: truncateText(effective.prompt, 100),
      model: effective.model,
      reasoning: effective.reasoningEffort,
      cwd: effective.cwd,
      elapsed_ms: elapsedMs,
      created_at: effective.createdAt,
      started_at: effective.startedAt ?? null,
      completed_at: effective.completedAt ?? null,
      tokens,
      files_modified: filesModified,
      summary,
    };
  });

  return {
    generated_at: new Date().toISOString(),
    jobs: enriched,
  };
}

export function deleteJob(jobId: string): boolean {
  const job = loadJob(jobId);

  // Kill tmux session if running
  if (job?.tmuxSession && sessionExists(job.tmuxSession)) {
    killSession(job.tmuxSession);
  }

  try {
    unlinkSync(getJobPath(jobId));
    // Clean up auxiliary files
    const auxiliaryExtensions = [".prompt", ".log", ".turn-complete"];
    for (const ext of auxiliaryExtensions) {
      try {
        unlinkSync(join(config.jobsDir, `${jobId}${ext}`));
      } catch {
        // File may not exist
      }
    }
    removeJobFromIndex(jobId);
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
  parentSessionId?: string;
  cwd?: string;
}

export function startJob(options: StartJobOptions): Job {
  ensureJobsDir();
  cleanupCompletedSessions();

  const jobId = generateJobId();
  const cwd = options.cwd || process.cwd();

  const job: Job = {
    id: jobId,
    status: "pending",
    prompt: options.prompt,
    model: options.model || config.model,
    reasoningEffort: options.reasoningEffort || config.defaultReasoningEffort,
    sandbox: options.sandbox || config.defaultSandbox,
    parentSessionId: options.parentSessionId,
    cwd,
    createdAt: new Date().toISOString(),
  };

  // Record the session name BEFORE creating it so orphan cleanup
  // never sees a live session without a matching job entry.
  const expectedSessionName = `${config.tmuxPrefix}-${jobId}`;
  job.tmuxSession = expectedSessionName;
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
    job.turnState = "working";
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

  clearSignalFile(jobId);
  job.status = "failed";
  job.error = "Killed by user";
  job.completedAt = new Date().toISOString();
  saveJob(job);
  return true;
}

export function sendToJob(jobId: string, message: string): boolean {
  const job = loadJob(jobId);
  if (!job || !job.tmuxSession) return false;

  const sent = sendMessage(job.tmuxSession, message);
  if (!sent) return false;

  // Clear turn-complete signal - agent will be working again
  clearSignalFile(jobId);
  job.turnState = "working";
  saveJob(job);

  return true;
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

export type CleanupResult = {
  jobsDeleted: number;
  orphanedSessionsKilled: number;
};

export function cleanupOldJobs(maxAgeDays: number = 7): CleanupResult {
  const jobs = listJobs({ all: true });
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let jobsDeleted = 0;

  const activeSessionNames = new Set(
    jobs
      .filter((job) => isActiveJobStatus(job.status) && job.tmuxSession)
      .map((job) => job.tmuxSession as string)
  );
  const orphanedSessionsKilled = cleanupOrphanedSessions(activeSessionNames).length;

  for (const job of jobs) {
    const jobTime = new Date(job.completedAt || job.createdAt).getTime();
    if (jobTime < cutoff && (job.status === "completed" || job.status === "failed")) {
      if (deleteJob(job.id)) jobsDeleted++;
    }
  }

  rebuildJobIndex();
  return {
    jobsDeleted,
    orphanedSessionsKilled,
  };
}

export function isJobRunning(jobId: string): boolean {
  const job = loadJob(jobId);
  if (!job || !job.tmuxSession) return false;

  return isSessionActive(job.tmuxSession);
}

export function refreshJobStatus(jobId: string): Job | null {
  const job = loadJob(jobId);
  if (!job) return null;

  // Repair pending jobs that got stuck
  if (job.status === "pending" && job.tmuxSession) {
    if (sessionExists(job.tmuxSession)) {
      const output = capturePane(job.tmuxSession, { lines: 20 });
      if (output && output.includes("[codex-agent: Session complete")) {
        job.status = "completed";
        job.completedAt = new Date().toISOString();
        saveJob(job);
      } else {
        // Session is alive - promote to running
        job.status = "running";
        job.startedAt = job.startedAt || new Date().toISOString();
        job.turnState = "working";
        saveJob(job);
      }
    } else {
      // No session and pending for >5 min = orphaned
      const ageMs = Date.now() - new Date(job.createdAt).getTime();
      if (ageMs > 5 * 60 * 1000) {
        job.status = "failed";
        job.error = "Orphaned pending job - no tmux session found";
        job.completedAt = new Date().toISOString();
        saveJob(job);
      }
    }
    return loadJob(jobId);
  }

  if (job.status === "pending" && !job.tmuxSession) {
    // No session name recorded and pending for >5 min = failed
    const ageMs = Date.now() - new Date(job.createdAt).getTime();
    if (ageMs > 5 * 60 * 1000) {
      job.status = "failed";
      job.error = "Orphaned pending job - session never created";
      job.completedAt = new Date().toISOString();
      saveJob(job);
    }
    return loadJob(jobId);
  }

  if (job.status === "running" && job.tmuxSession) {
    // Check if tmux session still exists
    if (!sessionExists(job.tmuxSession)) {
      // Session ended completely
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      const logFile = join(config.jobsDir, `${jobId}.log`);
      try {
        job.result = readFileSync(logFile, "utf-8");
      } catch {
        // No log file
      }
      saveJob(job);
    } else {
      const latestJob = loadJob(jobId);
      if (latestJob && latestJob.status !== "running") {
        return latestJob;
      }

      // Backward-compatible fallback for older leaked sessions that are still
      // waiting on the legacy completion prompt.
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
      } else if (isInactiveTimedOut(job)) {
        killSession(job.tmuxSession);
        job.status = "failed";
        job.error = `Timed out after ${config.defaultTimeout} minutes of inactivity`;
        job.completedAt = new Date().toISOString();
        saveJob(job);
      }
    }
  }

  return loadJob(jobId);
}

export function isJobIdle(jobId: string): boolean {
  return signalFileExists(jobId);
}

export function getTurnSignal(jobId: string): TurnEvent | null {
  return readSignalFile(jobId);
}

export function getAttachCommand(jobId: string): string | null {
  const job = loadJob(jobId);
  if (!job || !job.tmuxSession) return null;

  return `tmux attach -t "${job.tmuxSession}"`;
}
