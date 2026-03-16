import sodium from "libsodium-wrappers";
import { GitHubTarget, PlatformKind, SyncResult, SyncTarget } from "../types";
import { IPlatformAdapter, PushEntry, RemoteEntry, RemoteTarget } from "./IPlatformAdapter";

const BASE = "https://api.github.com";

interface GitHubPublicKey {
    key_id: string;
    key: string; // base64
}

export class GitHubAdapter implements IPlatformAdapter {
    readonly platform: PlatformKind = "github";

    private headers(token: string): Record<string, string> {
        return {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        };
    }

    async validateToken(token: string): Promise<void> {
        const res = await fetch(`${BASE}/user`, {
            headers: this.headers(token),
        });
        if (!res.ok) {
            throw new Error(
                `GitHub token validation failed: ${res.status} ${res.statusText}`,
            );
        }
    }

    async listTargets(token: string): Promise<RemoteTarget[]> {
        const repos: Array<{ full_name: string; description: string | null; visibility: string }> = [];
        let page = 1;
        while (true) {
            const res = await fetch(
                `${BASE}/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
                { headers: this.headers(token) },
            );
            if (!res.ok) {
                throw new Error(`GitHub list repos failed: ${res.status} ${res.statusText}`);
            }
            const batch = await res.json() as typeof repos;
            repos.push(...batch);
            if (batch.length < 100) { break; }
            page++;
        }
        return repos.map(r => ({
            label: r.full_name,
            description: r.description ?? r.visibility,
            target: { platform: 'github' as const, repo: r.full_name },
        }));
    }

    async listEnvironments(token: string, repo: string): Promise<string[]> {
        const res = await fetch(`${BASE}/repos/${repo}/environments`, {
            headers: this.headers(token),
        });
        if (!res.ok) { return []; }
        const data = await res.json() as { environments: Array<{ name: string }> };
        return data.environments.map(e => e.name);
    }

    async fetchRemote(token: string, target: SyncTarget): Promise<RemoteEntry[]> {
        const t = target as GitHubTarget;
        const results: RemoteEntry[] = [];

        // Secrets — API returns keys only, values are never exposed
        const secretsUrl = t.environment
            ? `${BASE}/repos/${t.repo}/environments/${t.environment}/secrets`
            : `${BASE}/repos/${t.repo}/actions/secrets`;
        const secretsRes = await fetch(secretsUrl, { headers: this.headers(token) });
        if (secretsRes.ok) {
            const data = await secretsRes.json() as { secrets: Array<{ name: string }> };
            for (const s of data.secrets) {
                results.push({ key: s.name, value: null });
            }
        }

        // Variables — API returns keys + values
        const varsUrl = t.environment
            ? `${BASE}/repos/${t.repo}/environments/${t.environment}/variables`
            : `${BASE}/repos/${t.repo}/actions/variables`;
        const varsRes = await fetch(varsUrl, { headers: this.headers(token) });
        if (varsRes.ok) {
            const data = await varsRes.json() as { variables: Array<{ name: string; value: string }> };
            for (const v of data.variables) {
                results.push({ key: v.name, value: v.value });
            }
        }

        return results;
    }

    async push(
        token: string,
        target: SyncTarget,
        entries: PushEntry[],
    ): Promise<SyncResult> {
        const t = target as GitHubTarget;
        await sodium.ready;

        // ── Fetch remote key sets to detect type conflicts ────────────────────
        const [remoteSecretKeys, remoteVariableKeys] = await Promise.all([
            this.listSecretKeys(token, t),
            this.listVariableKeys(token, t),
        ]);

        const secrets = entries.filter(e => e.isSecret);
        const variables = entries.filter(e => !e.isSecret);
        let pushed = 0;

        // ── Secrets ───────────────────────────────────────────────────────────
        if (secrets.length > 0) {
            const pubKey = await this.getPublicKey(token, t);
            for (const entry of secrets) {
                // If this key currently exists as a variable, delete it first
                if (remoteVariableKeys.has(entry.key)) {
                    await this.deleteVariable(token, t, entry.key);
                }

                const encrypted = this.encryptSecret(pubKey.key, entry.value);
                const url = t.environment
                    ? `${BASE}/repos/${t.repo}/environments/${t.environment}/secrets/${entry.key}`
                    : `${BASE}/repos/${t.repo}/actions/secrets/${entry.key}`;

                const res = await fetch(url, {
                    method: "PUT",
                    headers: this.headers(token),
                    body: JSON.stringify({ encrypted_value: encrypted, key_id: pubKey.key_id }),
                });
                if (!res.ok) {
                    throw new Error(`Failed to push secret "${entry.key}": ${res.status} ${res.statusText}`);
                }
                pushed++;
            }
        }

        // ── Variables ─────────────────────────────────────────────────────────
        for (const entry of variables) {
            // If this key currently exists as a secret, delete it first
            if (remoteSecretKeys.has(entry.key)) {
                await this.deleteSecret(token, t, entry.key);
            }

            const baseUrl = t.environment
                ? `${BASE}/repos/${t.repo}/environments/${t.environment}/variables`
                : `${BASE}/repos/${t.repo}/actions/variables`;

            const body = JSON.stringify({ name: entry.key, value: entry.value });
            const exists = remoteVariableKeys.has(entry.key);

            const res = await fetch(exists ? `${baseUrl}/${entry.key}` : baseUrl, {
                method: exists ? "PATCH" : "POST",
                headers: this.headers(token),
                body,
            });
            if (!res.ok) {
                throw new Error(`Failed to push variable "${entry.key}": ${res.status} ${res.statusText}`);
            }
            pushed++;
        }

        return { target, success: true, pushed };
    }

    private async listSecretKeys(token: string, t: GitHubTarget): Promise<Set<string>> {
        const url = t.environment
            ? `${BASE}/repos/${t.repo}/environments/${t.environment}/secrets`
            : `${BASE}/repos/${t.repo}/actions/secrets`;
        const res = await fetch(url, { headers: this.headers(token) });
        if (!res.ok) { return new Set(); }
        const data = await res.json() as { secrets: Array<{ name: string }> };
        return new Set(data.secrets.map(s => s.name));
    }

    private async listVariableKeys(token: string, t: GitHubTarget): Promise<Set<string>> {
        const url = t.environment
            ? `${BASE}/repos/${t.repo}/environments/${t.environment}/variables`
            : `${BASE}/repos/${t.repo}/actions/variables`;
        const res = await fetch(url, { headers: this.headers(token) });
        if (!res.ok) { return new Set(); }
        const data = await res.json() as { variables: Array<{ name: string }> };
        return new Set(data.variables.map(v => v.name));
    }

    private async deleteSecret(token: string, t: GitHubTarget, key: string): Promise<void> {
        const url = t.environment
            ? `${BASE}/repos/${t.repo}/environments/${t.environment}/secrets/${key}`
            : `${BASE}/repos/${t.repo}/actions/secrets/${key}`;
        const res = await fetch(url, { method: "DELETE", headers: this.headers(token) });
        if (!res.ok) {
            throw new Error(`Failed to delete secret "${key}" before type change: ${res.status} ${res.statusText}`);
        }
    }

    private async deleteVariable(token: string, t: GitHubTarget, key: string): Promise<void> {
        const url = t.environment
            ? `${BASE}/repos/${t.repo}/environments/${t.environment}/variables/${key}`
            : `${BASE}/repos/${t.repo}/actions/variables/${key}`;
        const res = await fetch(url, { method: "DELETE", headers: this.headers(token) });
        if (!res.ok) {
            throw new Error(`Failed to delete variable "${key}" before type change: ${res.status} ${res.statusText}`);
        }
    }

    private async getPublicKey(
        token: string,
        target: GitHubTarget,
    ): Promise<GitHubPublicKey> {
        const url = target.environment
            ? `${BASE}/repos/${target.repo}/environments/${target.environment}/secrets/public-key`
            : `${BASE}/repos/${target.repo}/actions/secrets/public-key`;

        const res = await fetch(url, { headers: this.headers(token) });
        if (!res.ok) {
            throw new Error(
                `Failed to get GitHub public key: ${res.status} ${res.statusText}`,
            );
        }
        return res.json() as Promise<GitHubPublicKey>;
    }

    private encryptSecret(
        base64PublicKey: string,
        secretValue: string,
    ): string {
        const publicKeyBytes = Buffer.from(base64PublicKey, "base64");
        const messageBytes = Buffer.from(secretValue, "utf8");
        const encrypted = sodium.crypto_box_seal(messageBytes, publicKeyBytes);
        return Buffer.from(encrypted).toString("base64");
    }
}
