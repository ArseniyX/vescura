import * as vscode from 'vscode';
import { PlatformKind } from '../domain/types';
import { SecretStorageService } from './SecretStorageService';

const GITHUB_SCOPES = ['repo', 'read:org'];

export class TokenService {
  constructor(private readonly secrets: SecretStorageService) {}

  /**
   * Get a token silently (no UI). Returns undefined if not authenticated.
   * GitHub: reads from VS Code's built-in auth session.
   * GitLab: reads from SecretStorage.
   */
  async getToken(platform: PlatformKind): Promise<string | undefined> {
    if (platform === 'github') {
      const session = await vscode.authentication.getSession('github', GITHUB_SCOPES, { silent: true });
      return session?.accessToken;
    }
    return this.secrets.getToken(platform);
  }

  async hasToken(platform: PlatformKind): Promise<boolean> {
    return (await this.getToken(platform)) !== undefined;
  }

  /**
   * GitHub: triggers VS Code OAuth flow (opens browser, user clicks Allow).
   * Returns the access token.
   */
  async signInGitHub(): Promise<string> {
    const session = await vscode.authentication.getSession('github', GITHUB_SCOPES, { createIfNone: true });
    return session.accessToken;
  }

  /**
   * GitHub: signs out by forgetting the cached session reference.
   * (VS Code owns the session — we just stop using it.)
   */
  signOutGitHub(): void {
    // VS Code manages GitHub sessions globally; we cannot programmatically revoke.
    // Show guidance instead (handled by callers).
  }

  /** GitLab: store a validated PAT. */
  async setGitLabToken(token: string): Promise<void> {
    await this.secrets.setToken('gitlab', token);
  }

  async deleteToken(platform: PlatformKind): Promise<void> {
    if (platform === 'gitlab') {
      await this.secrets.deleteToken(platform);
    }
    // GitHub sessions are managed by VS Code — direct users to Accounts menu
  }
}
