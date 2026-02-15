#!/usr/bin/env bun

import { updateJobTurn, writeSignalFile, type TurnEvent } from "./watcher.ts";

type NotifyPayload = {
  type?: string;
  [key: string]: unknown;
};

function parsePayload(raw: string): NotifyPayload | null {
  try {
    return JSON.parse(raw) as NotifyPayload;
  } catch {
    return null;
  }
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toStringOrFallback(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function main(): void {
  const jobId = process.argv[2];
  const rawPayload = process.argv[3];
  if (!jobId || !rawPayload) return;

  const payload = parsePayload(rawPayload);
  if (!payload || payload.type !== "agent-turn-complete") return;

  const event: TurnEvent = {
    turnId: toStringOrFallback(payload["turn-id"]),
    lastAgentMessage: toStringOrNull(payload["last-assistant-message"]),
    timestamp: new Date().toISOString(),
  };

  writeSignalFile(jobId, event);
  updateJobTurn(jobId, event);
}

main();
