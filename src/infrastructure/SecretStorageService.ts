import * as vscode from 'vscode';
import { PlatformKind } from '../domain/types';

export class SecretStorageService {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getToken(platform: PlatformKind): Promise<string | undefined> {
    return this.secrets.get(`envsync.token.${platform}`);
  }

  async setToken(platform: PlatformKind, token: string): Promise<void> {
    await this.secrets.store(`envsync.token.${platform}`, token);
  }

  async deleteToken(platform: PlatformKind): Promise<void> {
    await this.secrets.delete(`envsync.token.${platform}`);
  }

  async hasToken(platform: PlatformKind): Promise<boolean> {
    return (await this.getToken(platform)) !== undefined;
  }
}
