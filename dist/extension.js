"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode7 = __toESM(require("vscode"));

// src/domain/adapters/GitHubAdapter.ts
var import_libsodium_wrappers = __toESM(require("libsodium-wrappers"));
var BASE = "https://api.github.com";
var GitHubAdapter = class {
  platform = "github";
  headers(token) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    };
  }
  async validateToken(token) {
    const res = await fetch(`${BASE}/user`, {
      headers: this.headers(token)
    });
    if (!res.ok) {
      throw new Error(
        `GitHub token validation failed: ${res.status} ${res.statusText}`
      );
    }
  }
  async listTargets(token) {
    const repos = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `${BASE}/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
        { headers: this.headers(token) }
      );
      if (!res.ok) {
        throw new Error(`GitHub list repos failed: ${res.status} ${res.statusText}`);
      }
      const batch = await res.json();
      repos.push(...batch);
      if (batch.length < 100) {
        break;
      }
      page++;
    }
    return repos.map((r) => ({
      label: r.full_name,
      description: r.description ?? r.visibility,
      target: { platform: "github", repo: r.full_name }
    }));
  }
  async listEnvironments(token, repo) {
    const res = await fetch(`${BASE}/repos/${repo}/environments`, {
      headers: this.headers(token)
    });
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    return data.environments.map((e) => e.name);
  }
  async fetchRemote(token, target) {
    const t = target;
    const results = [];
    const secretsUrl = t.environment ? `${BASE}/repos/${t.repo}/environments/${t.environment}/secrets` : `${BASE}/repos/${t.repo}/actions/secrets`;
    const secretsRes = await fetch(secretsUrl, { headers: this.headers(token) });
    if (secretsRes.ok) {
      const data = await secretsRes.json();
      for (const s of data.secrets) {
        results.push({ key: s.name, value: null });
      }
    }
    const varsUrl = t.environment ? `${BASE}/repos/${t.repo}/environments/${t.environment}/variables` : `${BASE}/repos/${t.repo}/actions/variables`;
    const varsRes = await fetch(varsUrl, { headers: this.headers(token) });
    if (varsRes.ok) {
      const data = await varsRes.json();
      for (const v of data.variables) {
        results.push({ key: v.name, value: v.value });
      }
    }
    return results;
  }
  async push(token, target, entries) {
    const t = target;
    await import_libsodium_wrappers.default.ready;
    const [remoteSecretKeys, remoteVariableKeys] = await Promise.all([
      this.listSecretKeys(token, t),
      this.listVariableKeys(token, t)
    ]);
    const secrets = entries.filter((e) => e.isSecret);
    const variables = entries.filter((e) => !e.isSecret);
    let pushed = 0;
    if (secrets.length > 0) {
      const pubKey = await this.getPublicKey(token, t);
      for (const entry of secrets) {
        if (remoteVariableKeys.has(entry.key)) {
          await this.deleteVariable(token, t, entry.key);
        }
        const encrypted = this.encryptSecret(pubKey.key, entry.value);
        const url = t.environment ? `${BASE}/repos/${t.repo}/environments/${t.environment}/secrets/${entry.key}` : `${BASE}/repos/${t.repo}/actions/secrets/${entry.key}`;
        const res = await fetch(url, {
          method: "PUT",
          headers: this.headers(token),
          body: JSON.stringify({ encrypted_value: encrypted, key_id: pubKey.key_id })
        });
        if (!res.ok) {
          throw new Error(`Failed to push secret "${entry.key}": ${res.status} ${res.statusText}`);
        }
        pushed++;
      }
    }
    for (const entry of variables) {
      if (remoteSecretKeys.has(entry.key)) {
        await this.deleteSecret(token, t, entry.key);
      }
      const baseUrl = t.environment ? `${BASE}/repos/${t.repo}/environments/${t.environment}/variables` : `${BASE}/repos/${t.repo}/actions/variables`;
      const body = JSON.stringify({ name: entry.key, value: entry.value });
      const exists = remoteVariableKeys.has(entry.key);
      const res = await fetch(exists ? `${baseUrl}/${entry.key}` : baseUrl, {
        method: exists ? "PATCH" : "POST",
        headers: this.headers(token),
        body
      });
      if (!res.ok) {
        throw new Error(`Failed to push variable "${entry.key}": ${res.status} ${res.statusText}`);
      }
      pushed++;
    }
    return { target, success: true, pushed };
  }
  async listSecretKeys(token, t) {
    const url = t.environment ? `${BASE}/repos/${t.repo}/environments/${t.environment}/secrets` : `${BASE}/repos/${t.repo}/actions/secrets`;
    const res = await fetch(url, { headers: this.headers(token) });
    if (!res.ok) {
      return /* @__PURE__ */ new Set();
    }
    const data = await res.json();
    return new Set(data.secrets.map((s) => s.name));
  }
  async listVariableKeys(token, t) {
    const url = t.environment ? `${BASE}/repos/${t.repo}/environments/${t.environment}/variables` : `${BASE}/repos/${t.repo}/actions/variables`;
    const res = await fetch(url, { headers: this.headers(token) });
    if (!res.ok) {
      return /* @__PURE__ */ new Set();
    }
    const data = await res.json();
    return new Set(data.variables.map((v) => v.name));
  }
  async deleteSecret(token, t, key) {
    const url = t.environment ? `${BASE}/repos/${t.repo}/environments/${t.environment}/secrets/${key}` : `${BASE}/repos/${t.repo}/actions/secrets/${key}`;
    const res = await fetch(url, { method: "DELETE", headers: this.headers(token) });
    if (!res.ok) {
      throw new Error(`Failed to delete secret "${key}" before type change: ${res.status} ${res.statusText}`);
    }
  }
  async deleteVariable(token, t, key) {
    const url = t.environment ? `${BASE}/repos/${t.repo}/environments/${t.environment}/variables/${key}` : `${BASE}/repos/${t.repo}/actions/variables/${key}`;
    const res = await fetch(url, { method: "DELETE", headers: this.headers(token) });
    if (!res.ok) {
      throw new Error(`Failed to delete variable "${key}" before type change: ${res.status} ${res.statusText}`);
    }
  }
  async getPublicKey(token, target) {
    const url = target.environment ? `${BASE}/repos/${target.repo}/environments/${target.environment}/secrets/public-key` : `${BASE}/repos/${target.repo}/actions/secrets/public-key`;
    const res = await fetch(url, { headers: this.headers(token) });
    if (!res.ok) {
      throw new Error(
        `Failed to get GitHub public key: ${res.status} ${res.statusText}`
      );
    }
    return res.json();
  }
  encryptSecret(base64PublicKey, secretValue) {
    const publicKeyBytes = Buffer.from(base64PublicKey, "base64");
    const messageBytes = Buffer.from(secretValue, "utf8");
    const encrypted = import_libsodium_wrappers.default.crypto_box_seal(messageBytes, publicKeyBytes);
    return Buffer.from(encrypted).toString("base64");
  }
};

// src/domain/adapters/GitLabAdapter.ts
var BASE2 = "https://gitlab.com/api/v4";
var GitLabAdapter = class {
  platform = "gitlab";
  headers(token) {
    return {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json"
    };
  }
  async validateToken(token) {
    const res = await fetch(`${BASE2}/user`, { headers: this.headers(token) });
    if (!res.ok) {
      throw new Error(`GitLab token validation failed: ${res.status} ${res.statusText}`);
    }
  }
  async listTargets(token) {
    const projects = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `${BASE2}/projects?membership=true&per_page=100&page=${page}&order_by=last_activity_at`,
        { headers: this.headers(token) }
      );
      if (!res.ok) {
        throw new Error(`GitLab list projects failed: ${res.status} ${res.statusText}`);
      }
      const batch = await res.json();
      projects.push(...batch);
      if (batch.length < 100) {
        break;
      }
      page++;
    }
    return projects.map((p) => ({
      label: p.path_with_namespace,
      description: p.description ?? void 0,
      target: { platform: "gitlab", projectId: String(p.id), scope: "*" }
    }));
  }
  async listEnvironments(token, projectId) {
    const res = await fetch(
      `${BASE2}/projects/${encodeURIComponent(projectId)}/environments?states=available&per_page=100`,
      { headers: this.headers(token) }
    );
    if (!res.ok) {
      return [];
    }
    const envs = await res.json();
    return envs.map((e) => e.name);
  }
  async fetchRemote(token, target) {
    const t = target;
    const scope = t.scope ?? "*";
    const res = await fetch(
      `${BASE2}/projects/${encodeURIComponent(t.projectId)}/variables?per_page=100`,
      { headers: this.headers(token) }
    );
    if (!res.ok) {
      throw new Error(`GitLab fetch variables failed: ${res.status} ${res.statusText}`);
    }
    const vars = await res.json();
    return vars.filter((v) => v.environment_scope === scope || v.environment_scope === "*").map((v) => ({ key: v.key, value: v.value }));
  }
  async push(token, target, entries) {
    const t = target;
    const scope = t.scope ?? "*";
    const baseUrl = `${BASE2}/projects/${encodeURIComponent(t.projectId)}/variables`;
    let pushed = 0;
    for (const entry of entries) {
      const body = JSON.stringify({
        key: entry.key,
        value: entry.value,
        environment_scope: scope,
        masked: entry.isSecret,
        protected: false,
        variable_type: "env_var"
      });
      const createRes = await fetch(baseUrl, {
        method: "POST",
        headers: this.headers(token),
        body
      });
      if (!createRes.ok) {
        if (createRes.status === 400) {
          const updateRes = await fetch(
            `${baseUrl}/${encodeURIComponent(entry.key)}?filter[environment_scope]=${encodeURIComponent(scope)}`,
            { method: "PUT", headers: this.headers(token), body }
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
};

// src/application/SyncService.ts
var vscode = __toESM(require("vscode"));
var LAST_SYNC_KEY = "envsync.lastSync";
var SyncService = class {
  constructor(scanner, config, tokens, varState, adapters, state) {
    this.scanner = scanner;
    this.config = config;
    this.tokens = tokens;
    this.varState = varState;
    this.adapters = adapters;
    this.state = state;
  }
  async validateAndSaveGitLabToken(token) {
    const adapter = this.requireAdapter("gitlab");
    await adapter.validateToken(token);
    await this.tokens.setGitLabToken(token);
  }
  async pushMapping(mapping) {
    const envFile = await this.scanner.readEnvFile(this.resolveFilePath(mapping.file));
    const entries = envFile.entries.filter((e) => this.varState.getState(mapping.file, e.key).enabled).map((e) => {
      const s = this.varState.getState(mapping.file, e.key);
      return { key: e.key, value: e.value, isSecret: s.isSecret };
    });
    if (entries.length === 0) {
      throw new Error("All variables are set to skip. Use the CodeLens buttons to mark at least one for push.");
    }
    const { target } = mapping;
    const token = await this.requireToken(target.platform);
    const adapter = this.requireAdapter(target.platform);
    const result = await adapter.push(token, target, entries);
    await this.state.update(`${LAST_SYNC_KEY}.${mapping.file}`, (/* @__PURE__ */ new Date()).toISOString());
    return result;
  }
  async fetchRemote(target) {
    const token = await this.requireToken(target.platform);
    const adapter = this.requireAdapter(target.platform);
    return adapter.fetchRemote(token, target);
  }
  getLastSync(mapping) {
    return this.state.get(`${LAST_SYNC_KEY}.${mapping.file}`);
  }
  resolveFilePath(relPath) {
    if (!relPath) {
      throw new Error("Mapping is missing a file path.");
    }
    const root = this.config.workspaceRoot;
    if (!root) {
      throw new Error("No workspace folder open");
    }
    return vscode.Uri.joinPath(root, relPath).fsPath;
  }
  requireAdapter(platform) {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(`No adapter registered for platform: ${platform}`);
    }
    return adapter;
  }
  async requireToken(platform) {
    const token = await this.tokens.getToken(platform);
    if (!token) {
      throw new Error(`No token configured for ${platform}. Run "EnvSync: Manage Tokens".`);
    }
    return token;
  }
};

// src/infrastructure/ConfigManager.ts
var vscode2 = __toESM(require("vscode"));
var STATE_KEY = "envsync.config";
var DEFAULT_CONFIG = { mappings: [] };
var ConfigManager = class {
  constructor(context, state) {
    this.context = context;
    this.state = state;
    context.subscriptions.push(this._onDidChange);
  }
  _onDidChange = new vscode2.EventEmitter();
  onDidChange = this._onDidChange.event;
  get workspaceRoot() {
    return vscode2.workspace.workspaceFolders?.[0]?.uri;
  }
  read() {
    const raw = this.state.get(STATE_KEY);
    if (!raw || typeof raw !== "object") {
      return DEFAULT_CONFIG;
    }
    const config = raw;
    config.mappings = (config.mappings ?? []).filter(
      (m) => typeof m.file === "string" && m.file.length > 0 && typeof m.target === "object" && m.target !== null
    );
    return config;
  }
  async write(config) {
    await this.state.update(STATE_KEY, config);
    this._onDidChange.fire(config);
  }
  async addMapping(mapping) {
    const config = this.read();
    const idx = config.mappings.findIndex((m) => m.file === mapping.file);
    if (idx >= 0) {
      config.mappings[idx] = mapping;
    } else {
      config.mappings.push(mapping);
    }
    await this.write(config);
  }
  startWatching() {
  }
};

// src/infrastructure/SecretStorageService.ts
var SecretStorageService = class {
  constructor(secrets) {
    this.secrets = secrets;
  }
  async getToken(platform) {
    return this.secrets.get(`envsync.token.${platform}`);
  }
  async setToken(platform, token) {
    await this.secrets.store(`envsync.token.${platform}`, token);
  }
  async deleteToken(platform) {
    await this.secrets.delete(`envsync.token.${platform}`);
  }
  async hasToken(platform) {
    return await this.getToken(platform) !== void 0;
  }
};

// src/infrastructure/TokenService.ts
var vscode3 = __toESM(require("vscode"));
var GITHUB_SCOPES = ["repo", "read:org"];
var TokenService = class {
  constructor(secrets) {
    this.secrets = secrets;
  }
  /**
   * Get a token silently (no UI). Returns undefined if not authenticated.
   * GitHub: reads from VS Code's built-in auth session.
   * GitLab: reads from SecretStorage.
   */
  async getToken(platform) {
    if (platform === "github") {
      const session = await vscode3.authentication.getSession("github", GITHUB_SCOPES, { silent: true });
      return session?.accessToken;
    }
    return this.secrets.getToken(platform);
  }
  async hasToken(platform) {
    return await this.getToken(platform) !== void 0;
  }
  /**
   * GitHub: triggers VS Code OAuth flow (opens browser, user clicks Allow).
   * Returns the access token.
   */
  async signInGitHub() {
    const session = await vscode3.authentication.getSession("github", GITHUB_SCOPES, { createIfNone: true });
    return session.accessToken;
  }
  /**
   * GitHub: signs out by forgetting the cached session reference.
   * (VS Code owns the session — we just stop using it.)
   */
  signOutGitHub() {
  }
  /** GitLab: store a validated PAT. */
  async setGitLabToken(token) {
    await this.secrets.setToken("gitlab", token);
  }
  async deleteToken(platform) {
    if (platform === "gitlab") {
      await this.secrets.deleteToken(platform);
    }
  }
};

// src/infrastructure/VarStateService.ts
var DEFAULT_STATE = { enabled: true, isSecret: true };
var KEY_PREFIX = "envsync.varState.";
var VarStateService = class {
  constructor(state) {
    this.state = state;
  }
  getState(relPath, key) {
    const all = this.state.get(KEY_PREFIX + relPath, {});
    return all[key] ?? DEFAULT_STATE;
  }
  async toggleEnabled(relPath, key) {
    const current = this.getState(relPath, key);
    const next = { ...current, enabled: !current.enabled };
    await this._save(relPath, key, next);
    return next;
  }
  async toggleType(relPath, key) {
    const current = this.getState(relPath, key);
    const next = { ...current, isSecret: !current.isSecret };
    await this._save(relPath, key, next);
    return next;
  }
  async _save(relPath, key, state) {
    const all = this.state.get(KEY_PREFIX + relPath, {});
    all[key] = state;
    await this.state.update(KEY_PREFIX + relPath, all);
  }
};

// src/infrastructure/WorkspaceScanner.ts
var vscode4 = __toESM(require("vscode"));

// src/domain/parser/EnvParser.ts
var LINE_RE = /^(?:export\s+)?([\w.]+)\s*=\s*(.*)/;
function parse(content) {
  const entries = [];
  const warnings = [];
  const seen = /* @__PURE__ */ new Map();
  let i = 0;
  const lines = content.split("\n");
  while (i < lines.length) {
    const lineNum = i + 1;
    let raw = lines[i];
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) {
      i++;
      continue;
    }
    while (raw.endsWith("\\") && i + 1 < lines.length) {
      raw = raw.slice(0, -1) + "\n" + lines[++i];
    }
    const match = LINE_RE.exec(raw);
    if (!match) {
      warnings.push({ line: lineNum, message: `Could not parse line: ${raw.trimEnd()}` });
      i++;
      continue;
    }
    const key = match[1];
    const rawValue = match[2].trim();
    const value = unquote(rawValue);
    if (seen.has(key)) {
      warnings.push({ line: lineNum, message: `Duplicate key "${key}" (first seen on line ${seen.get(key)})` });
    } else {
      seen.set(key, lineNum);
    }
    entries.push({ key, value });
    i++;
  }
  return { entries, warnings };
}
function unquote(value) {
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    const inner = value.slice(1, -1);
    return value.startsWith('"') ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "	").replace(/\\\\/g, "\\") : inner;
  }
  const commentIdx = value.indexOf(" #");
  return commentIdx >= 0 ? value.slice(0, commentIdx).trim() : value;
}

// src/infrastructure/WorkspaceScanner.ts
var WorkspaceScanner = class {
  async scanEnvFiles() {
    const root = vscode4.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      return [];
    }
    const uris = await vscode4.workspace.findFiles(
      new vscode4.RelativePattern(root, ".env*"),
      "{**/node_modules/**,**/.git/**}"
    );
    const results = [];
    for (const uri of uris) {
      const relativePath = vscode4.workspace.asRelativePath(uri, false);
      if (relativePath.includes("/")) {
        continue;
      }
      try {
        const bytes = await vscode4.workspace.fs.readFile(uri);
        const content = new TextDecoder().decode(bytes);
        const { entries } = parse(content);
        results.push({
          uri: uri.fsPath,
          name: relativePath,
          environment: inferEnvironment(relativePath),
          entries
        });
      } catch {
      }
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }
  async readEnvFile(fsPath) {
    const uri = vscode4.Uri.file(fsPath);
    const bytes = await vscode4.workspace.fs.readFile(uri);
    const content = new TextDecoder().decode(bytes);
    const { entries, warnings } = parse(content);
    if (warnings.length > 0) {
      const msgs = warnings.map((w) => `Line ${w.line}: ${w.message}`).join("\n");
      vscode4.window.showWarningMessage(`EnvSync: parse warnings in ${fsPath}:
${msgs}`);
    }
    const name = uri.path.split("/").pop() ?? fsPath;
    return { uri: fsPath, name, environment: inferEnvironment(name), entries };
  }
};
function inferEnvironment(filename) {
  const match = /^\.env\.?(.*)$/.exec(filename);
  if (!match) {
    return "development";
  }
  const suffix = match[1];
  return suffix === "" ? "development" : suffix;
}

// src/ui/EnvSyncCodeLensProvider.ts
var vscode5 = __toESM(require("vscode"));
var LINE_RE2 = /^(?:export\s+)?([\w.]+)\s*=/;
var EnvSyncCodeLensProvider = class {
  constructor(varState) {
    this.varState = varState;
  }
  _onDidChangeCodeLenses = new vscode5.EventEmitter();
  onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
  refresh() {
    this._onDidChangeCodeLenses.fire();
  }
  provideCodeLenses(document) {
    const lenses = [];
    const relPath = vscode5.workspace.asRelativePath(document.uri, false);
    const text = document.getText();
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = LINE_RE2.exec(lines[i]);
      if (!match) {
        continue;
      }
      const key = match[1];
      const state = this.varState.getState(relPath, key);
      const range = new vscode5.Range(i, 0, i, 0);
      lenses.push(
        new vscode5.CodeLens(range, {
          title: state.enabled ? "$(cloud-upload)\xA0push" : "$(debug-step-over)\xA0skip",
          tooltip: "Toggle whether this variable is pushed",
          command: "envsync.toggleEnabled",
          arguments: [relPath, key]
        })
      );
      lenses.push(
        new vscode5.CodeLens(range, {
          title: state.isSecret ? "$(lock)\xA0secret" : "$(eye)\xA0plain",
          tooltip: "Toggle between encrypted secret and plain variable",
          command: "envsync.toggleType",
          arguments: [relPath, key]
        })
      );
    }
    return lenses;
  }
};

// src/ui/EnvSyncTreeProvider.ts
var vscode6 = __toESM(require("vscode"));
var MappingNode = class extends vscode6.TreeItem {
  constructor(mapping, hasToken, lastSync) {
    super(mapping.file, vscode6.TreeItemCollapsibleState.None);
    this.mapping = mapping;
    this.description = [
      targetLabel(mapping.target),
      lastSync ? `\xB7 ${formatRelative(lastSync)}` : ""
    ].filter(Boolean).join("  ");
    this.iconPath = new vscode6.ThemeIcon(
      hasToken ? "file-code" : "warning"
    );
    this.contextValue = "mapping";
    this.tooltip = hasToken ? `${mapping.file} \u2192 ${targetLabel(mapping.target)}` : `No token for ${mapping.target.platform} \u2014 run "EnvSync: Manage Tokens"`;
    this.command = {
      command: "vscode.open",
      title: "Open file",
      arguments: [fileUri(mapping.file)]
    };
  }
  type = "mapping";
};
var AddMappingNode = class extends vscode6.TreeItem {
  type = "add-mapping";
  constructor() {
    super("New mapping", vscode6.TreeItemCollapsibleState.None);
    this.iconPath = new vscode6.ThemeIcon("add");
    this.command = { command: "envsync.addMapping", title: "New Mapping" };
    this.contextValue = "add-mapping";
  }
};
var PullNode = class extends vscode6.TreeItem {
  type = "pull";
  constructor() {
    super("Pull from remote", vscode6.TreeItemCollapsibleState.None);
    this.iconPath = new vscode6.ThemeIcon("cloud-download");
    this.command = { command: "envsync.pull", title: "Pull from Remote" };
    this.contextValue = "pull";
    this.tooltip = "Fetch variables from GitHub or GitLab and create a local .env file";
  }
};
var EnvSyncTreeProvider = class {
  constructor(configManager, tokenService, syncService) {
    this.configManager = configManager;
    this.tokenService = tokenService;
    this.syncService = syncService;
    configManager.onDidChange((cfg) => {
      this.config = cfg;
      this.refresh();
    });
  }
  _onDidChangeTreeData = new vscode6.EventEmitter();
  onDidChangeTreeData = this._onDidChangeTreeData.event;
  config = { mappings: [] };
  initialize() {
    this.config = this.configManager.read();
    this.refresh();
  }
  refresh() {
    this._onDidChangeTreeData.fire(void 0);
  }
  getTreeItem(element) {
    return element;
  }
  async getChildren(element) {
    if (element) {
      return [];
    }
    const nodes = await Promise.all(
      this.config.mappings.map(async (m) => {
        const hasToken = await this.tokenService.hasToken(
          m.target.platform
        );
        const lastSync = this.syncService.getLastSync(m);
        return new MappingNode(m, hasToken, lastSync);
      })
    );
    nodes.push(new AddMappingNode());
    nodes.push(new PullNode());
    return nodes;
  }
};
function fileUri(relPath) {
  const root = vscode6.workspace.workspaceFolders?.[0]?.uri;
  return root ? vscode6.Uri.joinPath(root, relPath) : void 0;
}
function targetLabel(target) {
  if (target.platform === "github") {
    return target.environment ? `GitHub: ${target.repo} (${target.environment})` : `GitHub: ${target.repo}`;
  }
  return target.scope && target.scope !== "*" ? `GitLab: ${target.projectId} (${target.scope})` : `GitLab: ${target.projectId}`;
}
function formatRelative(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 6e4);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

// src/extension.ts
function activate(context) {
  try {
    _activate(context);
  } catch (err) {
    vscode7.window.showErrorMessage(`EnvSync failed to activate: ${err}`);
    throw err;
  }
}
function _activate(context) {
  const secretStorage = new SecretStorageService(context.secrets);
  const tokenService = new TokenService(secretStorage);
  const configManager = new ConfigManager(context, context.workspaceState);
  const scanner = new WorkspaceScanner();
  const varState = new VarStateService(context.workspaceState);
  const githubAdapter = new GitHubAdapter();
  const gitlabAdapter = new GitLabAdapter();
  const adapters = /* @__PURE__ */ new Map([
    ["github", githubAdapter],
    ["gitlab", gitlabAdapter]
  ]);
  const syncService = new SyncService(
    scanner,
    configManager,
    tokenService,
    varState,
    adapters,
    context.workspaceState
  );
  const codeLensProvider = new EnvSyncCodeLensProvider(varState);
  const treeProvider = new EnvSyncTreeProvider(
    configManager,
    tokenService,
    syncService
  );
  context.subscriptions.push(
    vscode7.languages.registerCodeLensProvider(
      { scheme: "file", pattern: "**/.env*" },
      codeLensProvider
    )
  );
  const treeView = vscode7.window.createTreeView("envsync.panel", {
    treeDataProvider: treeProvider,
    showCollapseAll: false
  });
  context.subscriptions.push(treeView);
  context.subscriptions.push(
    vscode7.commands.registerCommand(
      "envsync.toggleEnabled",
      async (relPath, key) => {
        await varState.toggleEnabled(relPath, key);
        codeLensProvider.refresh();
      }
    )
  );
  context.subscriptions.push(
    vscode7.commands.registerCommand(
      "envsync.toggleType",
      async (relPath, key) => {
        await varState.toggleType(relPath, key);
        codeLensProvider.refresh();
      }
    )
  );
  context.subscriptions.push(
    vscode7.commands.registerCommand("envsync.push", async () => {
      const editor = vscode7.window.activeTextEditor;
      if (!editor) {
        vscode7.window.showWarningMessage(
          "EnvSync: Open a .env file first."
        );
        return;
      }
      const config = configManager.read();
      const root = configManager.workspaceRoot;
      if (!root) {
        return;
      }
      const relPath = vscode7.workspace.asRelativePath(
        editor.document.uri,
        false
      );
      const mapping = config.mappings.find((m) => m.file === relPath);
      if (!mapping) {
        const add = await vscode7.window.showWarningMessage(
          `EnvSync: No mapping configured for "${relPath}".`,
          "New Mapping"
        );
        if (add) {
          vscode7.commands.executeCommand("envsync.addMapping");
        }
        return;
      }
      await executePush(mapping, syncService, treeProvider);
    })
  );
  context.subscriptions.push(
    vscode7.commands.registerCommand(
      "envsync.pushMapping",
      async (mapping) => {
        await executePush(mapping, syncService, treeProvider);
      }
    )
  );
  context.subscriptions.push(
    vscode7.commands.registerCommand("envsync.manageTokens", async () => {
      const platform = await vscode7.window.showQuickPick(
        [
          {
            label: "$(mark-github) GitHub",
            value: "github"
          },
          {
            label: "$(gitlab) GitLab",
            value: "gitlab"
          }
        ],
        {
          title: "EnvSync: Manage Tokens",
          placeHolder: "Select platform"
        }
      );
      if (!platform) {
        return;
      }
      await manageToken(platform.value, tokenService, syncService);
      treeProvider.refresh();
    })
  );
  context.subscriptions.push(
    vscode7.commands.registerCommand("envsync.addMapping", async () => {
      await addMappingWizard(
        configManager,
        scanner,
        tokenService,
        syncService,
        githubAdapter,
        gitlabAdapter
      );
      treeProvider.refresh();
    })
  );
  context.subscriptions.push(
    vscode7.commands.registerCommand(
      "envsync.deleteMapping",
      async (node) => {
        if (!node?.mapping) {
          return;
        }
        const mapping = node.mapping;
        const confirm = await vscode7.window.showWarningMessage(
          `Remove mapping for "${mapping.file}"?`,
          { modal: true },
          "Remove"
        );
        if (confirm !== "Remove") {
          return;
        }
        const config = configManager.read();
        config.mappings = config.mappings.filter(
          (m) => m.file !== mapping.file
        );
        await configManager.write(config);
        treeProvider.refresh();
      }
    )
  );
  context.subscriptions.push(
    vscode7.commands.registerCommand("envsync.pull", async () => {
      await pullWizard(
        configManager,
        syncService,
        tokenService,
        githubAdapter,
        gitlabAdapter
      );
      treeProvider.refresh();
    })
  );
  configManager.startWatching();
  treeProvider.initialize();
}
function deactivate() {
}
async function executePush(mapping, syncService, treeProvider) {
  let result;
  try {
    result = await vscode7.window.withProgress(
      {
        location: vscode7.ProgressLocation.Notification,
        title: `EnvSync: Pushing "${mapping.file}"\u2026`
      },
      () => syncService.pushMapping(mapping)
    );
  } catch (err) {
    vscode7.window.showErrorMessage(`EnvSync: ${err}`);
    return;
  }
  const t = result.target;
  const targetName = t.platform === "github" ? t.repo : t.projectId;
  vscode7.window.showInformationMessage(
    `EnvSync: Pushed ${result.pushed} variable${result.pushed !== 1 ? "s" : ""} to ${targetName}.`
  );
  treeProvider.refresh();
}
async function manageToken(platform, tokenService, syncService) {
  if (platform === "github") {
    const hasToken2 = await tokenService.hasToken("github");
    const action2 = await vscode7.window.showQuickPick(
      [
        {
          label: hasToken2 ? "$(check) Connected \u2014 re-authenticate" : "$(mark-github) Sign in with GitHub",
          value: "signin"
        },
        ...hasToken2 ? [
          {
            label: "$(account) Manage via VS Code Accounts menu",
            value: "accounts"
          }
        ] : []
      ],
      { title: "EnvSync: GitHub Authentication" }
    );
    if (!action2) {
      return;
    }
    if (action2.value === "accounts") {
      vscode7.commands.executeCommand(
        "workbench.action.openSettings",
        "github.authentication"
      );
      return;
    }
    await vscode7.window.withProgress(
      {
        location: vscode7.ProgressLocation.Notification,
        title: "Signing in to GitHub\u2026"
      },
      () => tokenService.signInGitHub()
    );
    vscode7.window.showInformationMessage("EnvSync: GitHub connected.");
    return;
  }
  const hasToken = await tokenService.hasToken("gitlab");
  const action = await vscode7.window.showQuickPick(
    [
      {
        label: hasToken ? "$(edit) Update token" : "$(key) Add Personal Access Token",
        value: "set"
      },
      {
        label: "$(link-external) Open GitLab token creation page",
        value: "open"
      },
      ...hasToken ? [{ label: "$(trash) Remove token", value: "delete" }] : []
    ],
    { title: "EnvSync: GitLab Authentication" }
  );
  if (!action) {
    return;
  }
  if (action.value === "open") {
    vscode7.env.openExternal(
      vscode7.Uri.parse(
        "https://gitlab.com/-/user_settings/personal_access_tokens?name=EnvSync&scopes=api"
      )
    );
  }
  if (action.value === "delete") {
    await tokenService.deleteToken("gitlab");
    vscode7.window.showInformationMessage("EnvSync: GitLab token removed.");
    return;
  }
  const token = await vscode7.window.showInputBox({
    title: "EnvSync: GitLab Personal Access Token",
    prompt: "Requires api scope.",
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => v.trim() === "" ? "Token cannot be empty" : void 0
  });
  if (!token) {
    return;
  }
  await vscode7.window.withProgress(
    {
      location: vscode7.ProgressLocation.Notification,
      title: "Validating GitLab token\u2026"
    },
    () => syncService.validateAndSaveGitLabToken(token.trim())
  );
  vscode7.window.showInformationMessage(
    "EnvSync: GitLab token saved and validated."
  );
}
async function addMappingWizard(configManager, scanner, tokenService, syncService, githubAdapter, gitlabAdapter) {
  const envFiles = await scanner.scanEnvFiles();
  if (envFiles.length === 0) {
    vscode7.window.showWarningMessage(
      "EnvSync: No .env files found in workspace root."
    );
    return;
  }
  const fileChoice = await vscode7.window.showQuickPick(
    envFiles.map((f) => ({
      label: f.name,
      description: f.environment,
      value: f.name
    })),
    {
      title: "EnvSync: Select .env file to map (1/3)",
      placeHolder: ".env file"
    }
  );
  if (!fileChoice) {
    return;
  }
  const platformChoice = await vscode7.window.showQuickPick(
    [
      {
        label: "$(mark-github) GitHub Secrets & Variables",
        value: "github"
      },
      {
        label: "$(mark-gitlab) GitLab CI/CD Variables",
        value: "gitlab"
      }
    ],
    { title: "EnvSync: Select platform (2/3)" }
  );
  if (!platformChoice) {
    return;
  }
  let target;
  if (platformChoice.value === "github") {
    target = await pickGitHubTarget(tokenService, githubAdapter);
  } else {
    target = await pickGitLabTarget(
      tokenService,
      gitlabAdapter,
      syncService
    );
  }
  if (!target) {
    return;
  }
  await configManager.addMapping({ file: fileChoice.value, target });
  vscode7.window.showInformationMessage(
    `EnvSync: Mapping added for "${fileChoice.value}". Open the file to configure variables with CodeLens.`
  );
}
async function pullWizard(configManager, syncService, tokenService, githubAdapter, gitlabAdapter) {
  const platformChoice = await vscode7.window.showQuickPick(
    [
      { label: "$(mark-github) GitHub", value: "github" },
      { label: "$(gitlab) GitLab", value: "gitlab" }
    ],
    { title: "EnvSync: Pull \u2014 Select platform (1/3)" }
  );
  if (!platformChoice) {
    return;
  }
  let target;
  if (platformChoice.value === "github") {
    target = await pickGitHubTarget(tokenService, githubAdapter);
  } else {
    target = await pickGitLabTarget(
      tokenService,
      gitlabAdapter,
      syncService
    );
  }
  if (!target) {
    return;
  }
  const envName = target.platform === "github" ? target.environment : target.scope?.replace("*", "");
  const DEV_ENVS = /* @__PURE__ */ new Set(["development", "dev", "local", ""]);
  const suggestedFile = !envName || DEV_ENVS.has(envName.toLowerCase()) ? ".env" : `.env.${envName}`;
  const fileInput = await vscode7.window.showInputBox({
    title: "EnvSync: Pull \u2014 Choose local file name (3/3)",
    value: suggestedFile,
    prompt: "File will be created in your workspace root",
    validateInput: (v) => v.trim() === "" ? "File name cannot be empty" : void 0
  });
  if (!fileInput) {
    return;
  }
  const root = configManager.workspaceRoot;
  if (!root) {
    vscode7.window.showErrorMessage("EnvSync: No workspace folder open.");
    return;
  }
  const fileUri2 = vscode7.Uri.joinPath(root, fileInput.trim());
  try {
    await vscode7.workspace.fs.stat(fileUri2);
    const overwrite = await vscode7.window.showWarningMessage(
      `"${fileInput.trim()}" already exists and will be overwritten. This cannot be undone.`,
      { modal: true },
      "Overwrite",
      "Cancel"
    );
    if (overwrite !== "Overwrite") {
      return;
    }
  } catch {
  }
  let entries;
  try {
    entries = await vscode7.window.withProgress(
      {
        location: vscode7.ProgressLocation.Notification,
        title: "EnvSync: Fetching from remote\u2026"
      },
      () => syncService.fetchRemote(target)
    );
  } catch (err) {
    vscode7.window.showErrorMessage(`EnvSync: ${err}`);
    return;
  }
  if (entries.length === 0) {
    vscode7.window.showWarningMessage(
      "EnvSync: No variables or secrets found on remote."
    );
    return;
  }
  const lines = [];
  let empty = 0;
  for (const entry of entries) {
    if (entry.value === null) {
      lines.push(`${entry.key}=`);
      empty++;
    } else {
      const needsQuotes = entry.value.includes(" ") || entry.value.includes("\n") || entry.value === "";
      lines.push(
        `${entry.key}=${needsQuotes ? `"${entry.value}"` : entry.value}`
      );
    }
  }
  await vscode7.workspace.fs.writeFile(
    fileUri2,
    new TextEncoder().encode(lines.join("\n"))
  );
  await configManager.addMapping({ file: fileInput.trim(), target });
  await vscode7.window.showTextDocument(fileUri2);
  const msg = empty > 0 ? `EnvSync: Pulled ${entries.length} entries (${empty} secret${empty !== 1 ? "s" : ""} need manual values).` : `EnvSync: Pulled ${entries.length} entries successfully.`;
  vscode7.window.showInformationMessage(msg);
}
async function pickGitHubTarget(tokenService, adapter) {
  let token = await tokenService.getToken("github");
  if (!token) {
    const signIn = await vscode7.window.showInformationMessage(
      "EnvSync: Sign in to GitHub to browse your repositories.",
      "Sign in"
    );
    if (!signIn) {
      return void 0;
    }
    token = await vscode7.window.withProgress(
      {
        location: vscode7.ProgressLocation.Notification,
        title: "Signing in to GitHub\u2026"
      },
      () => tokenService.signInGitHub()
    );
  }
  const repos = await vscode7.window.withProgress(
    {
      location: vscode7.ProgressLocation.Notification,
      title: "Loading repositories\u2026"
    },
    () => adapter.listTargets(token)
  );
  if (repos.length === 0) {
    vscode7.window.showWarningMessage("EnvSync: No repositories found.");
    return void 0;
  }
  const repoChoice = await vscode7.window.showQuickPick(
    repos.map((r) => ({
      label: r.label,
      description: r.description,
      target: r.target
    })),
    { title: "EnvSync: Select repository (3/3)", matchOnDescription: true }
  );
  if (!repoChoice) {
    return void 0;
  }
  const repo = repoChoice.target.repo;
  const envs = await vscode7.window.withProgress(
    {
      location: vscode7.ProgressLocation.Notification,
      title: "Loading environments\u2026"
    },
    () => adapter.listEnvironments(token, repo)
  );
  if (envs.length === 0) {
    return { platform: "github", repo };
  }
  const envChoice = await vscode7.window.showQuickPick(
    [
      {
        label: "$(repo) Repository-level",
        description: "No environment",
        value: ""
      },
      ...envs.map((e) => ({
        label: `$(layers) ${e}`,
        description: "environment",
        value: e
      }))
    ],
    { title: `EnvSync: Select environment for ${repo} (optional)` }
  );
  if (!envChoice) {
    return void 0;
  }
  return {
    platform: "github",
    repo,
    environment: envChoice.value || void 0
  };
}
async function pickGitLabTarget(tokenService, adapter, syncService) {
  let token = await tokenService.getToken("gitlab");
  if (!token) {
    const open = await vscode7.window.showInformationMessage(
      "EnvSync: A GitLab Personal Access Token (api scope) is required.",
      "Open token page",
      "I have a token"
    );
    if (!open) {
      return void 0;
    }
    if (open === "Open token page") {
      vscode7.env.openExternal(
        vscode7.Uri.parse(
          "https://gitlab.com/-/user_settings/personal_access_tokens?name=EnvSync&scopes=api"
        )
      );
    }
    const pat = await vscode7.window.showInputBox({
      title: "EnvSync: GitLab Personal Access Token",
      prompt: "Requires api scope.",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => v.trim() === "" ? "Token cannot be empty" : void 0
    });
    if (!pat) {
      return void 0;
    }
    await vscode7.window.withProgress(
      {
        location: vscode7.ProgressLocation.Notification,
        title: "Validating GitLab token\u2026"
      },
      () => syncService.validateAndSaveGitLabToken(pat.trim())
    );
    token = pat.trim();
  }
  const projects = await vscode7.window.withProgress(
    {
      location: vscode7.ProgressLocation.Notification,
      title: "Loading GitLab projects\u2026"
    },
    () => adapter.listTargets(token)
  );
  if (projects.length === 0) {
    vscode7.window.showWarningMessage("EnvSync: No projects found.");
    return void 0;
  }
  const projectChoice = await vscode7.window.showQuickPick(
    projects.map((p) => ({
      label: p.label,
      description: p.description,
      target: p.target
    })),
    { title: "EnvSync: Select project (3/3)", matchOnDescription: true }
  );
  if (!projectChoice) {
    return void 0;
  }
  const t = projectChoice.target;
  const envs = await vscode7.window.withProgress(
    {
      location: vscode7.ProgressLocation.Notification,
      title: "Loading environments\u2026"
    },
    () => adapter.listEnvironments(token, t.projectId)
  );
  if (envs.length === 0) {
    return { platform: "gitlab", projectId: t.projectId, scope: "*" };
  }
  const envChoice = await vscode7.window.showQuickPick(
    [
      { label: "$(globe) All environments (*)", value: "*" },
      ...envs.map((e) => ({ label: `$(layers) ${e}`, value: e }))
    ],
    { title: "EnvSync: Select environment scope (optional)" }
  );
  if (!envChoice) {
    return void 0;
  }
  return {
    platform: "gitlab",
    projectId: t.projectId,
    scope: envChoice.value
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
