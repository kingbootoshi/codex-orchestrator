// Configuration for codex-agent

export const config = {
  // Default model
  model: "gpt-5.2-codex",

  // Reasoning effort levels
  reasoningEfforts: ["low", "medium", "high", "xhigh"] as const,
  defaultReasoningEffort: "medium" as const,

  // Sandbox modes
  sandboxModes: ["read-only", "workspace-write", "danger-full-access"] as const,
  defaultSandbox: "workspace-write" as const,

  // Job storage directory
  jobsDir: `${process.env.HOME}/.codex-agent/jobs`,

  // Default timeout in minutes
  defaultTimeout: 60,

  // tmux session prefix
  tmuxPrefix: "codex-agent",
};

export type ReasoningEffort = typeof config.reasoningEfforts[number];
export type SandboxMode = typeof config.sandboxModes[number];
