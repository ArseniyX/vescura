import * as vscode from 'vscode';
import { StorageKeys } from '../constants/storage';

export interface VarState {
  enabled: boolean;
  isSecret: boolean;
}

const DEFAULT_STATE: VarState = { enabled: true, isSecret: true };

export class VarStateService {
  constructor(private readonly state: vscode.Memento) {}

  getState(relPath: string, key: string): VarState {
    const all = this.state.get<Record<string, VarState>>(StorageKeys.varState(relPath), {});
    return all[key] ?? DEFAULT_STATE;
  }

  async toggleEnabled(relPath: string, key: string): Promise<VarState> {
    const current = this.getState(relPath, key);
    const next = { ...current, enabled: !current.enabled };
    await this._save(relPath, key, next);
    return next;
  }

  async toggleType(relPath: string, key: string): Promise<VarState> {
    const current = this.getState(relPath, key);
    const next = { ...current, isSecret: !current.isSecret };
    await this._save(relPath, key, next);
    return next;
  }

  async seedFromPull(relPath: string, entries: Array<{ key: string; isSecret: boolean }>): Promise<void> {
    const all = this.state.get<Record<string, VarState>>(StorageKeys.varState(relPath), {});
    for (const { key, isSecret } of entries) {
      if (!all[key]) {
        all[key] = { enabled: true, isSecret };
      }
    }
    await this.state.update(StorageKeys.varState(relPath), all);
  }

  private async _save(relPath: string, key: string, state: VarState): Promise<void> {
    const all = this.state.get<Record<string, VarState>>(StorageKeys.varState(relPath), {});
    all[key] = state;
    await this.state.update(StorageKeys.varState(relPath), all);
  }
}
