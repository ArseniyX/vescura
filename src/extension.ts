import * as vscode from "vscode";
import { GitHubAdapter } from "./domain/adapters/GitHubAdapter";
import { GitLabAdapter } from "./domain/adapters/GitLabAdapter";
import { IPlatformAdapter } from "./domain/adapters/IPlatformAdapter";
import { EnvSyncMapping, PlatformKind, SyncTarget } from "./domain/types";
import { SyncService } from "./application/SyncService";
import { ConfigManager } from "./infrastructure/ConfigManager";
import { SecretStorageService } from "./infrastructure/SecretStorageService";
import { TokenService } from "./infrastructure/TokenService";
import { VarStateService } from "./infrastructure/VarStateService";
import { WorkspaceScanner } from "./infrastructure/WorkspaceScanner";
import { EnvSyncCodeLensProvider } from "./ui/EnvSyncCodeLensProvider";
import { EnvSyncTreeProvider } from "./ui/EnvSyncTreeProvider";
import { Commands, Views } from "./constants/commands";

export function activate(context: vscode.ExtensionContext): void {
    try {
        _activate(context);
    } catch (err) {
        vscode.window.showErrorMessage(`EnvSync failed to activate: ${err}`);
        throw err;
    }
}

function _activate(context: vscode.ExtensionContext): void {
    // ── Composition root ──────────────────────────────────────────────────────
    const secretStorage = new SecretStorageService(context.secrets);
    const tokenService = new TokenService(secretStorage);
    const configManager = new ConfigManager(context, context.workspaceState);
    const scanner = new WorkspaceScanner();
    const varState = new VarStateService(context.workspaceState);

    const githubAdapter = new GitHubAdapter();
    const gitlabAdapter = new GitLabAdapter();

    const adapters = new Map<PlatformKind, IPlatformAdapter>([
        ["github", githubAdapter],
        ["gitlab", gitlabAdapter],
    ]);

    const syncService = new SyncService(
        scanner,
        configManager,
        tokenService,
        varState,
        adapters,
        context.workspaceState,
    );

    const codeLensProvider = new EnvSyncCodeLensProvider(varState);
    const treeProvider = new EnvSyncTreeProvider(
        configManager,
        tokenService,
        syncService,
    );

    // ── Register providers ────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { scheme: "file", pattern: "**/.env*" },
            codeLensProvider,
        ),
    );

    const treeView = vscode.window.createTreeView(Views.panel, {
        treeDataProvider: treeProvider,
        showCollapseAll: false,
    });
    context.subscriptions.push(treeView);

    // ── CodeLens toggle commands ──────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand(
            Commands.toggleEnabled,
            async (relPath: string, key: string) => {
                await varState.toggleEnabled(relPath, key);
                codeLensProvider.refresh();
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            Commands.toggleType,
            async (relPath: string, key: string) => {
                await varState.toggleType(relPath, key);
                codeLensProvider.refresh();
            },
        ),
    );

    // ── Push commands ─────────────────────────────────────────────────────────

    // Push from editor title bar (active .env file)
    context.subscriptions.push(
        vscode.commands.registerCommand(Commands.push, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage(
                    "Vescura: Open a .env file first.",
                );
                return;
            }

            const config = configManager.read();
            const root = configManager.workspaceRoot;
            if (!root) {
                return;
            }

            const relPath = vscode.workspace.asRelativePath(
                editor.document.uri,
                false,
            );
            const mapping = config.mappings.find((m) => m.file === relPath);

            if (!mapping) {
                const add = await vscode.window.showWarningMessage(
                    `Vescura: No mapping configured for "${relPath}".`,
                    "New Mapping",
                );
                if (add) {
                    vscode.commands.executeCommand(Commands.addMapping);
                }
                return;
            }

            await executePush(mapping, syncService, treeProvider);
        }),
    );

    // Push from tree view (mapping node)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            Commands.pushMapping,
            async (mapping: EnvSyncMapping) => {
                await executePush(mapping, syncService, treeProvider);
            },
        ),
    );

    // ── Manage tokens ─────────────────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand(Commands.manageTokens, async () => {
            const platform = await vscode.window.showQuickPick(
                [
                    {
                        label: "$(mark-github) GitHub",
                        value: "github" as PlatformKind,
                    },
                    {
                        label: "$(gitlab) GitLab",
                        value: "gitlab" as PlatformKind,
                    },
                ],
                {
                    title: "Vescura: Manage Tokens",
                    placeHolder: "Select platform",
                },
            );
            if (!platform) {
                return;
            }
            await manageToken(platform.value, tokenService, syncService);
            treeProvider.refresh();
        }),
    );

    // ── Add / remove mappings ─────────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand(Commands.addMapping, async () => {
            await addMappingWizard(
                configManager,
                scanner,
                tokenService,
                syncService,
                githubAdapter,
                gitlabAdapter,
            );
            treeProvider.refresh();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            Commands.deleteMapping,
            async (node) => {
                if (!node?.mapping) {
                    return;
                }
                const mapping: EnvSyncMapping = node.mapping;
                const confirm = await vscode.window.showWarningMessage(
                    `Remove mapping for "${mapping.file}"?`,
                    { modal: true },
                    "Remove",
                );
                if (confirm !== "Remove") {
                    return;
                }
                const config = configManager.read();
                config.mappings = config.mappings.filter(
                    (m) => m.file !== mapping.file,
                );
                await configManager.write(config);
                treeProvider.refresh();
            },
        ),
    );

    // ── Pull command ──────────────────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand(Commands.pull, async () => {
            await pullWizard(
                configManager,
                syncService,
                tokenService,
                varState,
                githubAdapter,
                gitlabAdapter,
            );
            treeProvider.refresh();
        }),
    );

    // ── Startup ───────────────────────────────────────────────────────────────
    configManager.startWatching();
    treeProvider.initialize();
}

export function deactivate(): void {}

// ── Push helper ───────────────────────────────────────────────────────────────

async function executePush(
    mapping: EnvSyncMapping,
    syncService: SyncService,
    treeProvider: EnvSyncTreeProvider,
): Promise<void> {
    let result;
    try {
        result = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Vescura: Pushing "${mapping.file}"…`,
            },
            () => syncService.pushMapping(mapping),
        );
    } catch (err) {
        vscode.window.showErrorMessage(`Vescura: ${err}`);
        return;
    }

    const t = result.target;
    const targetName =
        t.platform === "github"
            ? (t as import("./domain/types").GitHubTarget).repo
            : (t as import("./domain/types").GitLabTarget).projectId;

    vscode.window.showInformationMessage(
        `Vescura: Pushed ${result.pushed} variable${result.pushed !== 1 ? "s" : ""} to ${targetName}.`,
    );
    treeProvider.refresh();
}

// ── Token management ──────────────────────────────────────────────────────────

async function manageToken(
    platform: PlatformKind,
    tokenService: TokenService,
    syncService: SyncService,
): Promise<void> {
    if (platform === "github") {
        const hasToken = await tokenService.hasToken("github");
        const action = await vscode.window.showQuickPick(
            [
                {
                    label: hasToken
                        ? "$(check) Connected — re-authenticate"
                        : "$(mark-github) Sign in with GitHub",
                    value: "signin",
                },
                ...(hasToken
                    ? [
                          {
                              label: "$(account) Manage via VS Code Accounts menu",
                              value: "accounts",
                          },
                      ]
                    : []),
            ],
            { title: "Vescura: GitHub Authentication" },
        );
        if (!action) {
            return;
        }
        if (action.value === "accounts") {
            vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "github.authentication",
            );
            return;
        }
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Signing in to GitHub…",
            },
            () => tokenService.signInGitHub(),
        );
        vscode.window.showInformationMessage("Vescura: GitHub connected.");
        return;
    }

    // GitLab — PAT flow
    const hasToken = await tokenService.hasToken("gitlab");
    const action = await vscode.window.showQuickPick(
        [
            {
                label: hasToken
                    ? "$(edit) Update token"
                    : "$(key) Add Personal Access Token",
                value: "set",
            },
            {
                label: "$(link-external) Open GitLab token creation page",
                value: "open",
            },
            ...(hasToken
                ? [{ label: "$(trash) Remove token", value: "delete" }]
                : []),
        ],
        { title: "Vescura: GitLab Authentication" },
    );
    if (!action) {
        return;
    }

    if (action.value === "open") {
        vscode.env.openExternal(
            vscode.Uri.parse(
                "https://gitlab.com/-/user_settings/personal_access_tokens?name=Vescura&scopes=api",
            ),
        );
    }

    if (action.value === "delete") {
        await tokenService.deleteToken("gitlab");
        vscode.window.showInformationMessage("Vescura: GitLab token removed.");
        return;
    }

    const token = await vscode.window.showInputBox({
        title: "Vescura: GitLab Personal Access Token",
        prompt: "Requires api scope.",
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) =>
            v.trim() === "" ? "Token cannot be empty" : undefined,
    });
    if (!token) {
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Validating GitLab token…",
        },
        () => syncService.validateAndSaveGitLabToken(token.trim()),
    );
    vscode.window.showInformationMessage(
        "Vescura: GitLab token saved and validated.",
    );
}

// ── Add-mapping wizard ────────────────────────────────────────────────────────

async function addMappingWizard(
    configManager: ConfigManager,
    scanner: WorkspaceScanner,
    tokenService: TokenService,
    syncService: SyncService,
    githubAdapter: GitHubAdapter,
    gitlabAdapter: GitLabAdapter,
): Promise<void> {
    const envFiles = await scanner.scanEnvFiles();
    if (envFiles.length === 0) {
        vscode.window.showWarningMessage(
            "Vescura: No .env files found in workspace root.",
        );
        return;
    }

    const fileChoice = await vscode.window.showQuickPick(
        envFiles.map((f) => ({
            label: f.name,
            description: f.environment,
            value: f.name,
        })),
        {
            title: "Vescura: Select .env file to map (1/3)",
            placeHolder: ".env file",
        },
    );
    if (!fileChoice) {
        return;
    }

    const platformChoice = await vscode.window.showQuickPick(
        [
            {
                label: "$(mark-github) GitHub Secrets & Variables",
                value: "github" as PlatformKind,
            },
            {
                label: "$(mark-gitlab) GitLab CI/CD Variables",
                value: "gitlab" as PlatformKind,
            },
        ],
        { title: "Vescura: Select platform (2/3)" },
    );
    if (!platformChoice) {
        return;
    }

    let target: SyncTarget | undefined;
    if (platformChoice.value === "github") {
        target = await pickGitHubTarget(tokenService, githubAdapter);
    } else {
        target = await pickGitLabTarget(
            tokenService,
            gitlabAdapter,
            syncService,
        );
    }
    if (!target) {
        return;
    }

    await configManager.addMapping({ file: fileChoice.value, target });
    vscode.window.showInformationMessage(
        `Vescura: Mapping added for "${fileChoice.value}". Open the file to configure variables with CodeLens.`,
    );
}

// ── Pull wizard ───────────────────────────────────────────────────────────────

async function pullWizard(
    configManager: ConfigManager,
    syncService: SyncService,
    tokenService: TokenService,
    varState: VarStateService,
    githubAdapter: GitHubAdapter,
    gitlabAdapter: GitLabAdapter,
): Promise<void> {
    const platformChoice = await vscode.window.showQuickPick(
        [
            { label: "$(mark-github) GitHub", value: "github" as PlatformKind },
            { label: "$(gitlab) GitLab", value: "gitlab" as PlatformKind },
        ],
        { title: "Vescura: Pull — Select platform (1/3)" },
    );
    if (!platformChoice) {
        return;
    }

    let target: SyncTarget | undefined;
    if (platformChoice.value === "github") {
        target = await pickGitHubTarget(tokenService, githubAdapter);
    } else {
        target = await pickGitLabTarget(
            tokenService,
            gitlabAdapter,
            syncService,
        );
    }
    if (!target) {
        return;
    }

    // Suggest a filename based on environment — dev envs default to plain .env
    const envName =
        target.platform === "github"
            ? (target as import("./domain/types").GitHubTarget).environment
            : (target as import("./domain/types").GitLabTarget).scope?.replace("*", "");
    const DEV_ENVS = new Set(["development", "dev", "local", ""]);
    const suggestedFile = !envName || DEV_ENVS.has(envName.toLowerCase()) ? ".env" : `.env.${envName}`;

    const fileInput = await vscode.window.showInputBox({
        title: "Vescura: Pull — Choose local file name (3/3)",
        value: suggestedFile,
        prompt: "File will be created in your workspace root",
        validateInput: (v) =>
            v.trim() === "" ? "File name cannot be empty" : undefined,
    });
    if (!fileInput) {
        return;
    }

    const root = configManager.workspaceRoot;
    if (!root) {
        vscode.window.showErrorMessage("Vescura: No workspace folder open.");
        return;
    }

    const fileUri = vscode.Uri.joinPath(root, fileInput.trim());

    // Warn if file already exists
    try {
        await vscode.workspace.fs.stat(fileUri);
        const overwrite = await vscode.window.showWarningMessage(
            `"${fileInput.trim()}" already exists and will be overwritten. This cannot be undone.`,
            { modal: true },
            "Overwrite",
            "Cancel",
        );
        if (overwrite !== "Overwrite") {
            return;
        }
    } catch {
        // File doesn't exist — good
    }

    // Fetch from remote
    let entries;
    try {
        entries = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Vescura: Fetching from remote…",
            },
            () => syncService.fetchRemote(target!),
        );
    } catch (err) {
        vscode.window.showErrorMessage(`Vescura: ${err}`);
        return;
    }

    if (entries.length === 0) {
        vscode.window.showWarningMessage(
            "Vescura: No variables or secrets found on remote.",
        );
        return;
    }

    // Write .env file
    const lines: string[] = [];
    let empty = 0;
    for (const entry of entries) {
        if (entry.value === null) {
            lines.push(`${entry.key}=`);
            empty++;
        } else {
            const needsQuotes =
                entry.value.includes(" ") ||
                entry.value.includes("\n") ||
                entry.value === "";
            lines.push(
                `${entry.key}=${needsQuotes ? `"${entry.value}"` : entry.value}`,
            );
        }
    }

    await vscode.workspace.fs.writeFile(
        fileUri,
        new TextEncoder().encode(lines.join("\n")),
    );

    // Save mapping automatically
    await configManager.addMapping({ file: fileInput.trim(), target });

    // Seed var state so secrets/variables reflect remote types instead of defaulting to secret
    await varState.seedFromPull(
        fileInput.trim(),
        entries.map(e => ({ key: e.key, isSecret: e.value === null })),
    );

    // Open the file
    await vscode.window.showTextDocument(fileUri);

    const msg =
        empty > 0
            ? `Vescura: Pulled ${entries.length} entries (${empty} secret${empty !== 1 ? "s" : ""} need manual values).`
            : `Vescura: Pulled ${entries.length} entries successfully.`;
    vscode.window.showInformationMessage(msg);
}

async function pickGitHubTarget(
    tokenService: TokenService,
    adapter: GitHubAdapter,
): Promise<SyncTarget | undefined> {
    let token = await tokenService.getToken("github");
    if (!token) {
        token = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Signing in to GitHub…",
            },
            () => tokenService.signInGitHub(),
        );
    }

    const repos = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Loading repositories…",
        },
        () => adapter.listTargets(token!),
    );
    if (repos.length === 0) {
        vscode.window.showWarningMessage("Vescura: No repositories found.");
        return undefined;
    }

    const repoChoice = await vscode.window.showQuickPick(
        repos.map((r) => ({
            label: r.label,
            description: r.description,
            target: r.target,
        })),
        { title: "Vescura: Select repository (3/3)", matchOnDescription: true },
    );
    if (!repoChoice) {
        return undefined;
    }

    const repo = (repoChoice.target as import("./domain/types").GitHubTarget)
        .repo;

    const envs = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Loading environments…",
        },
        () => adapter.listEnvironments(token!, repo),
    );
    if (envs.length === 0) {
        return { platform: "github", repo };
    }

    const envChoice = await vscode.window.showQuickPick(
        [
            {
                label: "$(repo) Repository-level",
                description: "No environment",
                value: "",
            },
            ...envs.map((e) => ({
                label: `$(layers) ${e}`,
                description: "environment",
                value: e,
            })),
        ],
        { title: `Vescura: Select environment for ${repo} (optional)` },
    );
    if (!envChoice) {
        return undefined;
    }

    return {
        platform: "github",
        repo,
        environment: envChoice.value || undefined,
    };
}

async function pickGitLabTarget(
    tokenService: TokenService,
    adapter: GitLabAdapter,
    syncService: SyncService,
): Promise<SyncTarget | undefined> {
    let token = await tokenService.getToken("gitlab");
    if (!token) {
        const open = await vscode.window.showInformationMessage(
            "Vescura: A GitLab Personal Access Token (api scope) is required.",
            "Open token page",
            "I have a token",
        );
        if (!open) {
            return undefined;
        }
        if (open === "Open token page") {
            vscode.env.openExternal(
                vscode.Uri.parse(
                    "https://gitlab.com/-/user_settings/personal_access_tokens?name=Vescura&scopes=api",
                ),
            );
        }
        const pat = await vscode.window.showInputBox({
            title: "Vescura: GitLab Personal Access Token",
            prompt: "Requires api scope.",
            password: true,
            ignoreFocusOut: true,
            validateInput: (v) =>
                v.trim() === "" ? "Token cannot be empty" : undefined,
        });
        if (!pat) {
            return undefined;
        }
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Validating GitLab token…",
            },
            () => syncService.validateAndSaveGitLabToken(pat.trim()),
        );
        token = pat.trim();
    }

    const projects = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Loading GitLab projects…",
        },
        () => adapter.listTargets(token!),
    );
    if (projects.length === 0) {
        vscode.window.showWarningMessage("Vescura: No projects found.");
        return undefined;
    }

    const projectChoice = await vscode.window.showQuickPick(
        projects.map((p) => ({
            label: p.label,
            description: p.description,
            target: p.target,
        })),
        { title: "Vescura: Select project (3/3)", matchOnDescription: true },
    );
    if (!projectChoice) {
        return undefined;
    }

    const t = projectChoice.target as import("./domain/types").GitLabTarget;

    const envs = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Loading environments…",
        },
        () => adapter.listEnvironments(token!, t.projectId),
    );
    if (envs.length === 0) {
        return { platform: "gitlab", projectId: t.projectId, scope: "*" };
    }

    const envChoice = await vscode.window.showQuickPick(
        [
            { label: "$(globe) All environments (*)", value: "*" },
            ...envs.map((e) => ({ label: `$(layers) ${e}`, value: e })),
        ],
        { title: "Vescura: Select environment scope (optional)" },
    );
    if (!envChoice) {
        return undefined;
    }

    return {
        platform: "gitlab",
        projectId: t.projectId,
        scope: envChoice.value,
    };
}
