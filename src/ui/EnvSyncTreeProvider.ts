import * as vscode from "vscode";
import {
    EnvSyncConfig,
    EnvSyncMapping,
    PlatformKind,
    SyncTarget,
} from "../domain/types";
import { ConfigManager } from "../infrastructure/ConfigManager";
import { TokenService } from "../infrastructure/TokenService";
import { SyncService } from "../application/SyncService";
import { Commands } from "../constants/commands";

export type TreeNode = MappingNode | AddMappingNode | PullNode;

export class MappingNode extends vscode.TreeItem {
    readonly type = "mapping" as const;
    constructor(
        public readonly mapping: EnvSyncMapping,
        hasToken: boolean,
        lastSync?: string,
    ) {
        super(mapping.file, vscode.TreeItemCollapsibleState.None);
        this.description = [
            targetLabel(mapping.target),
            lastSync ? `· ${formatRelative(lastSync)}` : "",
        ]
            .filter(Boolean)
            .join("  ");
        this.iconPath = new vscode.ThemeIcon(
            hasToken ? "file-code" : "warning",
        );
        this.contextValue = "mapping";
        this.tooltip = hasToken
            ? `${mapping.file} → ${targetLabel(mapping.target)}`
            : `No token for ${mapping.target.platform} — run "Vescura: Manage Tokens"`;
        this.command = {
            command: "vscode.open",
            title: "Open file",
            arguments: [fileUri(mapping.file)],
        };
    }
}

export class AddMappingNode extends vscode.TreeItem {
    readonly type = "add-mapping" as const;
    constructor() {
        super("New mapping", vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon("add");
        this.command = { command: Commands.addMapping, title: "New Mapping" };
        this.contextValue = "add-mapping";
    }
}

export class PullNode extends vscode.TreeItem {
    readonly type = "pull" as const;
    constructor() {
        super("Pull from remote", vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon("cloud-download");
        this.command = { command: Commands.pull, title: "Pull from Remote" };
        this.contextValue = "pull";
        this.tooltip =
            "Fetch variables from GitHub or GitLab and create a local .env file";
    }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class EnvSyncTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<
        TreeNode | undefined
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private config: EnvSyncConfig = { mappings: [] };

    constructor(
        private readonly configManager: ConfigManager,
        private readonly tokenService: TokenService,
        private readonly syncService: SyncService,
    ) {
        configManager.onDidChange((cfg) => {
            this.config = cfg;
            this.refresh();
        });
    }

    initialize(): void {
        this.config = this.configManager.read();
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        if (element) {
            return [];
        }

        const nodes: TreeNode[] = await Promise.all(
            this.config.mappings.map(async (m) => {
                const hasToken = await this.tokenService.hasToken(
                    m.target.platform,
                );
                const lastSync = this.syncService.getLastSync(m);
                return new MappingNode(m, hasToken, lastSync);
            }),
        );
        nodes.push(new AddMappingNode());
        nodes.push(new PullNode());
        return nodes;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileUri(relPath: string): vscode.Uri | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    return root ? vscode.Uri.joinPath(root, relPath) : undefined;
}

export function targetLabel(target: SyncTarget): string {
    if (target.platform === "github") {
        return target.environment
            ? `GitHub: ${target.repo} (${target.environment})`
            : `GitHub: ${target.repo}`;
    }
    return target.scope && target.scope !== "*"
        ? `GitLab: ${target.projectId} (${target.scope})`
        : `GitLab: ${target.projectId}`;
}

function formatRelative(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
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
