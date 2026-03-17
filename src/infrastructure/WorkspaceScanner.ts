import * as vscode from 'vscode';
import { parse } from '../domain/parser/EnvParser';
import { EnvFile } from '../domain/types';

export class WorkspaceScanner {
  async scanEnvFiles(): Promise<EnvFile[]> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) { return []; }

    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, '.env*'),
      '{**/node_modules/**,**/.git/**}',
    );

    const results: EnvFile[] = [];
    for (const uri of uris) {
      // Only files directly in the root (not in subdirectories)
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      if (relativePath.includes('/')) { continue; }

      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const content = new TextDecoder().decode(bytes);
        const { entries } = parse(content);
        results.push({
          uri: uri.fsPath,
          name: relativePath,
          environment: inferEnvironment(relativePath),
          entries,
        });
      } catch {
        // skip unreadable files
      }
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  async readEnvFile(fsPath: string): Promise<EnvFile> {
    const uri = vscode.Uri.file(fsPath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const content = new TextDecoder().decode(bytes);
    const { entries, warnings } = parse(content);

    if (warnings.length > 0) {
      const msgs = warnings.map(w => `Line ${w.line}: ${w.message}`).join('\n');
      vscode.window.showWarningMessage(`Vescura: parse warnings in ${fsPath}:\n${msgs}`);
    }

    const name = uri.path.split('/').pop() ?? fsPath;
    return { uri: fsPath, name, environment: inferEnvironment(name), entries };
  }
}

function inferEnvironment(filename: string): string {
  // .env → development, .env.local → local, .env.production → production
  const match = /^\.env\.?(.*)$/.exec(filename);
  if (!match) { return 'development'; }
  const suffix = match[1];
  return suffix === '' ? 'development' : suffix;
}
