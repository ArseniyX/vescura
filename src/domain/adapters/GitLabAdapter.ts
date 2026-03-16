import { GitLabTarget, PlatformKind, SyncResult, SyncTarget } from '../types';
import { IPlatformAdapter, PushEntry, RemoteEntry, RemoteTarget } from './IPlatformAdapter';

const BASE = 'https://gitlab.com/api/v4';

export class GitLabAdapter implements IPlatformAdapter {
  readonly platform: PlatformKind = 'gitlab';

  private headers(token: string): Record<string, string> {
    return {
      'PRIVATE-TOKEN': token,
      'Content-Type': 'application/json',
    };
  }

  async validateToken(token: string): Promise<void> {
    const res = await fetch(`${BASE}/user`, { headers: this.headers(token) });
    if (!res.ok) {
      throw new Error(`GitLab token validation failed: ${res.status} ${res.statusText}`);
    }
  }

  async listTargets(token: string): Promise<RemoteTarget[]> {
    const projects: Array<{ id: number; path_with_namespace: string; description: string | null }> = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `${BASE}/projects?membership=true&per_page=100&page=${page}&order_by=last_activity_at`,
        { headers: this.headers(token) },
      );
      if (!res.ok) {
        throw new Error(`GitLab list projects failed: ${res.status} ${res.statusText}`);
      }
      const batch = await res.json() as typeof projects;
      projects.push(...batch);
      if (batch.length < 100) { break; }
      page++;
    }
    return projects.map(p => ({
      label: p.path_with_namespace,
      description: p.description ?? undefined,
      target: { platform: 'gitlab' as const, projectId: String(p.id), scope: '*' },
    }));
  }

  async listEnvironments(token: string, projectId: string): Promise<string[]> {
    const res = await fetch(
      `${BASE}/projects/${encodeURIComponent(projectId)}/environments?states=available&per_page=100`,
      { headers: this.headers(token) },
    );
    if (!res.ok) { return []; }
    const envs = await res.json() as Array<{ name: string }>;
    return envs.map(e => e.name);
  }

  async fetchRemote(token: string, target: SyncTarget): Promise<RemoteEntry[]> {
    const t = target as GitLabTarget;
    const scope = t.scope ?? '*';
    const res = await fetch(
      `${BASE}/projects/${encodeURIComponent(t.projectId)}/variables?per_page=100`,
      { headers: this.headers(token) },
    );
    if (!res.ok) {
      throw new Error(`GitLab fetch variables failed: ${res.status} ${res.statusText}`);
    }
    const vars = await res.json() as Array<{ key: string; value: string; environment_scope: string }>;
    return vars
      .filter(v => v.environment_scope === scope || v.environment_scope === '*')
      .map(v => ({ key: v.key, value: v.value }));
  }

  async push(
    token: string,
    target: SyncTarget,
    entries: PushEntry[],
  ): Promise<SyncResult> {
    const t = target as GitLabTarget;
    const scope = t.scope ?? '*';
    const baseUrl = `${BASE}/projects/${encodeURIComponent(t.projectId)}/variables`;
    let pushed = 0;

    for (const entry of entries) {
      const body = JSON.stringify({
        key: entry.key,
        value: entry.value,
        environment_scope: scope,
        masked: entry.isSecret,
        protected: false,
        variable_type: 'env_var',
      });

      // Try create; on 400 (variable name taken) fall back to update
      const createRes = await fetch(baseUrl, {
        method: 'POST',
        headers: this.headers(token),
        body,
      });

      if (!createRes.ok) {
        if (createRes.status === 400) {
          const updateRes = await fetch(
            `${baseUrl}/${encodeURIComponent(entry.key)}?filter[environment_scope]=${encodeURIComponent(scope)}`,
            { method: 'PUT', headers: this.headers(token), body },
          );
          if (!updateRes.ok) {
            throw new Error(`Failed to push variable "${entry.key}": ${updateRes.status} ${updateRes.statusText}`);
          }
        } else {
          throw new Error(`Failed to push variable "${entry.key}": ${createRes.status} ${createRes.statusText}`);
        }
      }
      pushed++;
    }

    return { target, success: true, pushed };
  }
}
