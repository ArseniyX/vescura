import * as vscode from 'vscode';

export interface VarState {
  enabled: boolean;
  isSecret: boolean;
}

const DEFAULT_STATE: VarState = { enabled: true, isSecret: true };
const KEY_PREFIX = 'envsync.varState.';

export class VarStateService {
  constructor(private readonly state: vscode.Memento) {}

  getState(relPath: string, key: string): VarState {
    const all = this.state.get<Record<string, VarState>>(KEY_PREFIX + relPath, {});
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

  private async _save(relPath: string, key: string, state: VarState): Promise<void> {
    const all = this.state.get<Record<string, VarState>>(KEY_PREFIX + relPath, {});
    all[key] = state;
    await this.state.update(KEY_PREFIX + relPath, all);
  }
}
