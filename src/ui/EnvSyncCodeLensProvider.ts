import * as vscode from "vscode";
import { VarStateService } from "../infrastructure/VarStateService";
import { Commands } from "../constants/commands";
import { LINE_RE } from "../domain/parser/EnvParser";

export class EnvSyncCodeLensProvider implements vscode.CodeLensProvider {
    private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    constructor(private readonly varState: VarStateService) {}

    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const relPath = vscode.workspace.asRelativePath(document.uri, false);
        const text = document.getText();
        const lines = text.split("\n");

        for (let i = 0; i < lines.length; i++) {
            const match = LINE_RE.exec(lines[i]);
            if (!match) {
                continue;
            }

            const key = match[1];
            const state = this.varState.getState(relPath, key);
            const range = new vscode.Range(i, 0, i, 0);

            lenses.push(
                new vscode.CodeLens(range, {
                    title: state.enabled
                        ? "$(cloud-upload)\u00A0push"
                        : "$(debug-step-over)\u00A0skip",
                    tooltip: "Toggle whether this variable is pushed",
                    command: Commands.toggleEnabled,
                    arguments: [relPath, key],
                }),
            );

            lenses.push(
                new vscode.CodeLens(range, {
                    title: state.isSecret ? "$(lock)\u00A0secret" : "$(eye)\u00A0plain",
                    tooltip:
                        "Toggle between encrypted secret and plain variable",
                    command: Commands.toggleType,
                    arguments: [relPath, key],
                }),
            );
        }

        return lenses;
    }
}
