import { PlatformKind, SyncResult, SyncTarget } from '../types';

export interface RemoteTarget {
  label: string;
  description?: string;
  target: SyncTarget;
}

export interface PushEntry {
  key: string;
  value: string;
  isSecret: boolean; // true → encrypted secret, false → plain variable
}

export interface RemoteEntry {
  key: string;
  value: string | null; // null = secret whose value the API won't return
}

export interface IPlatformAdapter {
  readonly platform: PlatformKind;

  /** Validate the token with a cheap authenticated API call. Throws on failure. */
  validateToken(token: string): Promise<void>;

  /** List repos/projects the token has access to (used in add-mapping wizard). */
  listTargets(token: string): Promise<RemoteTarget[]>;

  /** List environments for a repo/project (used in add-mapping wizard). */
  listEnvironments(token: string, targetId: string): Promise<string[]>;

  /** Fetch all secrets + variables from remote (used for pull/onboarding). */
  fetchRemote(token: string, target: SyncTarget): Promise<RemoteEntry[]>;

  /** Push entries to the remote platform. Secrets are encrypted, variables are plain. */
  push(token: string, target: SyncTarget, entries: PushEntry[]): Promise<SyncResult>;
}
