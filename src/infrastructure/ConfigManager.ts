import * as vscode from 'vscode';
import { EnvSyncConfig, EnvSyncMapping } from '../domain/types';
import { StorageKeys } from '../constants/storage';
const DEFAULT_CONFIG: EnvSyncConfig = { mappings: [] };

export class ConfigManager {
  private readonly _onDidChange = new vscode.EventEmitter<EnvSyncConfig>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly state: vscode.Memento,
  ) {
    context.subscriptions.push(this._onDidChange);
  }

  get workspaceRoot(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  read(): EnvSyncConfig {
    const raw = this.state.get<unknown>(StorageKeys.config);
    if (!raw || typeof raw !== 'object') { return DEFAULT_CONFIG; }
    const config = raw as EnvSyncConfig;
    config.mappings = (config.mappings ?? []).filter(
      m => typeof m.file === 'string' && m.file.length > 0 && typeof m.target === 'object' && m.target !== null,
    );
    return config;
  }

  async write(config: EnvSyncConfig): Promise<void> {
    await this.state.update(StorageKeys.config, config);
    this._onDidChange.fire(config);
  }

  async addMapping(mapping: EnvSyncMapping): Promise<void> {
    const config = this.read();
    const idx = config.mappings.findIndex(m => m.file === mapping.file);
    if (idx >= 0) {
      config.mappings[idx] = mapping;
    } else {
      config.mappings.push(mapping);
    }
    await this.write(config);
  }

  startWatching(): void {
    // No-op: config is now in workspace state, changes fire via write()
  }
}
