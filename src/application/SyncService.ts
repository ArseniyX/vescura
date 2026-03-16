import * as vscode from 'vscode';
import { EnvSyncMapping, PlatformKind, SyncResult, SyncTarget } from '../domain/types';
import { IPlatformAdapter, PushEntry, RemoteEntry } from '../domain/adapters/IPlatformAdapter';
import { ConfigManager } from '../infrastructure/ConfigManager';
import { TokenService } from '../infrastructure/TokenService';
import { VarStateService } from '../infrastructure/VarStateService';
import { WorkspaceScanner } from '../infrastructure/WorkspaceScanner';

const LAST_SYNC_KEY = 'envsync.lastSync';

export class SyncService {
  constructor(
    private readonly scanner: WorkspaceScanner,
    private readonly config: ConfigManager,
    private readonly tokens: TokenService,
    private readonly varState: VarStateService,
    private readonly adapters: Map<PlatformKind, IPlatformAdapter>,
    private readonly state: vscode.Memento,
  ) {}

  async validateAndSaveGitLabToken(token: string): Promise<void> {
    const adapter = this.requireAdapter('gitlab');
    await adapter.validateToken(token);
    await this.tokens.setGitLabToken(token);
  }

  async pushMapping(mapping: EnvSyncMapping): Promise<SyncResult> {
    const envFile = await this.scanner.readEnvFile(this.resolveFilePath(mapping.file));

    const entries: PushEntry[] = envFile.entries
      .filter(e => this.varState.getState(mapping.file, e.key).enabled)
      .map(e => {
        const s = this.varState.getState(mapping.file, e.key);
        return { key: e.key, value: e.value, isSecret: s.isSecret };
      });

    if (entries.length === 0) {
      throw new Error('All variables are set to skip. Use the CodeLens buttons to mark at least one for push.');
    }

    const { target } = mapping;
    const token = await this.requireToken(target.platform);
    const adapter = this.requireAdapter(target.platform);
    const result = await adapter.push(token, target, entries);

    await this.state.update(`${LAST_SYNC_KEY}.${mapping.file}`, new Date().toISOString());

    return result;
  }

  async fetchRemote(target: SyncTarget): Promise<RemoteEntry[]> {
    const token = await this.requireToken(target.platform);
    const adapter = this.requireAdapter(target.platform);
    return adapter.fetchRemote(token, target);
  }

  getLastSync(mapping: EnvSyncMapping): string | undefined {
    return this.state.get<string>(`${LAST_SYNC_KEY}.${mapping.file}`);
  }

  private resolveFilePath(relPath: string): string {
    if (!relPath) { throw new Error('Mapping is missing a file path.'); }
    const root = this.config.workspaceRoot;
    if (!root) { throw new Error('No workspace folder open'); }
    return vscode.Uri.joinPath(root, relPath).fsPath;
  }

  private requireAdapter(platform: PlatformKind): IPlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) { throw new Error(`No adapter registered for platform: ${platform}`); }
    return adapter;
  }

  private async requireToken(platform: PlatformKind): Promise<string> {
    const token = await this.tokens.getToken(platform);
    if (!token) {
      throw new Error(`No token configured for ${platform}. Run "EnvSync: Manage Tokens".`);
    }
    return token;
  }
}
