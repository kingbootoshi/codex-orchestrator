// File utilities for codebase map injection

import { readFileSync } from "fs";
import { resolve } from "path";

export function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

export async function loadCodebaseMap(cwd: string): Promise<string | null> {
  const mapPaths = [
    resolve(cwd, "docs/CODEBASE_MAP.md"),
    resolve(cwd, "CODEBASE_MAP.md"),
    resolve(cwd, "docs/ARCHITECTURE.md"),
  ];

  for (const mapPath of mapPaths) {
    try {
      const content = readFileSync(mapPath, "utf-8");
      return content;
    } catch {
      // Try next path
    }
  }

  return null;
}
