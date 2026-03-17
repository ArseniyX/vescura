// ── Env parsing ──────────────────────────────────────────────────────────────

export interface EnvEntry {
  key: string;
  value: string;
}

export interface ParseWarning {
  line: number;
  message: string;
}

export interface ParseResult {
  entries: EnvEntry[];
  warnings: ParseWarning[];
}

export interface EnvFile {
  uri: string; // absolute fs path
  name: string; // e.g. ".env.production"
  environment: string; // inferred: "production", "staging", "development", …
  entries: EnvEntry[];
}

// ── Platforms ─────────────────────────────────────────────────────────────────

export type PlatformKind = 'github' | 'gitlab';

export interface GitHubTarget {
  platform: 'github';
  repo: string; // "owner/repo"
  environment?: string; // undefined = repo-level secrets
}

export interface GitLabTarget {
  platform: 'gitlab';
  projectId: string;
  scope?: string; // environment scope, default "*"
}

export type SyncTarget = GitHubTarget | GitLabTarget;

// ── Config ────────────────────────────────────────────────────────────────────

export interface EnvSyncMapping {
  file: string; // relative path from workspace root, e.g. ".env.production"
  target: SyncTarget;
}

export interface EnvSyncConfig {
  mappings: EnvSyncMapping[];
}

// ── Sync results ──────────────────────────────────────────────────────────────

export interface SyncResult {
  target: SyncTarget;
  success: boolean;
  pushed: number;
  error?: string;
}
