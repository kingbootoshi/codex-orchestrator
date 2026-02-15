import { readFileSync, writeFileSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { config } from "./config.ts";

export interface TurnEvent {
  turnId: string;
  lastAgentMessage: string | null;
  timestamp: string;
}

function getSignalPath(jobId: string): string {
  return join(config.jobsDir, `${jobId}.turn-complete`);
}

export function writeSignalFile(jobId: string, event: TurnEvent): void {
  writeFileSync(getSignalPath(jobId), JSON.stringify(event));
}

export function readSignalFile(jobId: string): TurnEvent | null {
  try {
    const content = readFileSync(getSignalPath(jobId), "utf-8");
    return JSON.parse(content) as TurnEvent;
  } catch {
    return null;
  }
}

export function clearSignalFile(jobId: string): void {
  try {
    unlinkSync(getSignalPath(jobId));
  } catch {
    // File may not exist
  }
}

export function signalFileExists(jobId: string): boolean {
  try {
    statSync(getSignalPath(jobId));
    return true;
  } catch {
    return false;
  }
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

export function updateJobTurn(jobId: string, event: TurnEvent): void {
  const jobPath = join(config.jobsDir, `${jobId}.json`);
  try {
    const job = JSON.parse(readFileSync(jobPath, "utf-8"));
    job.turnCount = (job.turnCount || 0) + 1;
    job.lastTurnCompletedAt = event.timestamp;
    job.lastAgentMessage = event.lastAgentMessage
      ? truncateText(event.lastAgentMessage, 500)
      : null;
    job.turnState = "idle";
    writeFileSync(jobPath, JSON.stringify(job, null, 2));
  } catch {
    // Job file may not exist or be corrupt - skip silently
  }
}

export function setJobTurnWorking(jobId: string): void {
  const jobPath = join(config.jobsDir, `${jobId}.json`);
  try {
    const job = JSON.parse(readFileSync(jobPath, "utf-8"));
    job.turnState = "working";
    writeFileSync(jobPath, JSON.stringify(job, null, 2));
  } catch {
    // Skip silently
  }
}
