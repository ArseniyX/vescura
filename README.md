# EnvBridge

**Push and pull `.env` files to GitHub Secrets and GitLab CI/CD Variables — without leaving VS Code.**

Stop copy-pasting secrets into browser dashboards. EnvBridge lets you map any `.env` file to a repository or project, mark each variable as a secret or plain value, and sync with one click. Pull remote secrets back into a local file just as easily.

---

## Features at a glance

- **Push** — upload selected variables from any `.env` file to GitHub Secrets or GitLab CI/CD Variables
- **Pull** — fetch remote secrets/variables and write them to a local `.env` file
- **Per-variable CodeLens** — inline buttons on every variable line to set `push` / `skip` and `secret` / `plain`
- **Environment scoping** — target repo-level or specific GitHub Environments; GitLab environment scopes
- **Sidebar panel** — see all configured mappings and their last-synced time at a glance
- **Secure credential storage** — tokens are stored in VS Code's encrypted secret store, never on disk in plain text

---

## How it works

### 1. Authenticate

Open the **EnvSync** panel in the Activity Bar (cloud icon) and click **Manage Tokens**.

- **GitHub** — uses VS Code's built-in OAuth flow. One click, no token copying.
- **GitLab** — paste a Personal Access Token with the `api` scope. EnvBridge validates it immediately and links to the GitLab token creation page for you.

<!-- SCREENSHOT: Manage Tokens quick-pick showing GitHub and GitLab options -->
![Manage Tokens](media/screenshots/manage-tokens.png)

---

### 2. Create a mapping

Click **+** in the Sync Panel (or run **EnvSync: New Mapping** from the Command Palette). A three-step wizard guides you:

| Step | What you pick |
|------|--------------|
| 1 / 3 | The `.env` file in your workspace (`.env`, `.env.production`, etc.) |
| 2 / 3 | Platform: **GitHub** or **GitLab** |
| 3 / 3 | Repository / Project, then optionally an **Environment** (GitHub Environments or GitLab environment scopes) |

The mapping is saved in `.envsync.json` at your workspace root. Add this file to version control — it contains no secrets, only file-to-target relationships.

<!-- GIF: add-mapping wizard walking through all three steps -->
![Add Mapping Wizard](media/screenshots/add-mapping.gif)

---

### 3. Configure variables with CodeLens

Open any mapped `.env` file. Every variable line gets two inline CodeLens buttons:

```
DATABASE_URL=postgres://...
☁ push   🔒 secret
```

| Button | Options | Effect |
|--------|---------|--------|
| **push / skip** | Toggle | Include or exclude this variable from the next push |
| **secret / plain** | Toggle | Push as an encrypted secret or a plain CI/CD variable |

By default every variable is set to **push** and **secret**. Changes are persisted per workspace — your teammates can have their own settings.

<!-- GIF: clicking CodeLens buttons to toggle push/skip and secret/plain -->
![CodeLens per variable](media/screenshots/codelens-toggle.gif)

---

### 4. Push

Push variables to the remote in any of three ways:

- Click the **cloud-upload button** in the editor title bar (appears when a `.env` file is open)
- Click the **push icon** next to a mapping in the Sync Panel
- Run **EnvSync: Push** from the Command Palette

Only variables marked **push** are sent. A progress notification appears, and you see a summary: _"Pushed 12 variables to owner/my-repo."_

<!-- GIF: clicking push button and seeing the progress notification + result -->
![Push flow](media/screenshots/push.gif)

---

### 5. Pull

Run **EnvSync: Pull from Remote** from the Command Palette or the Sync Panel.

1. Pick a platform (GitHub / GitLab)
2. Pick a repository / project and optional environment
3. Choose a local filename — EnvBridge suggests `.env` for dev environments and `.env.<name>` for others

The file is written to your workspace root, opened in the editor, and a mapping is saved automatically. If a secret's value is not readable by the API (GitHub secrets are write-only), the key is written with an empty value and the count is shown in the summary so you know to fill it in manually.

<!-- GIF: pull wizard → remote variables written to .env and file opens in editor -->
![Pull flow](media/screenshots/pull.gif)

---

## Sidebar panel

The **EnvSync** panel in the Activity Bar lists every configured mapping with:

- The `.env` filename and target platform icon
- Repository / project name and environment scope
- Last-synced timestamp
- Inline push button per mapping

<!-- SCREENSHOT: Sync Panel showing two mappings with last-synced times -->
![Sync Panel](media/screenshots/sync-panel.png)

---

## Authentication details

### GitHub

EnvBridge uses VS Code's built-in GitHub authentication session (`github` provider, `repo` scope). You are never asked to paste a token — the OAuth flow opens in your browser and the token is managed by VS Code. You can view or revoke access from **VS Code Accounts** in the bottom-left corner.

### GitLab

EnvBridge uses a Personal Access Token (PAT) with the `api` scope. The token is stored in VS Code's encrypted `SecretStorage` (OS keychain on desktop). EnvBridge validates the token against the GitLab API before saving it. To revoke access, use **EnvSync: Manage Tokens → Remove token**.

---

## Security

- **No telemetry.** EnvBridge makes no outbound requests except to the GitHub or GitLab APIs you explicitly configure.
- **Tokens are never written to disk in plain text.** They live exclusively in `vscode.SecretStorage`.
- **`.envsync.json` contains no secrets** — only file paths and target identifiers. It is safe to commit.
- **GitHub secret encryption** is performed client-side using libsodium (NaCl box encryption with the repository's public key) before the value leaves your machine, matching GitHub's own CLI behavior.

---

## Commands

| Command | Description |
|---------|-------------|
| `EnvSync: Push` | Push the currently open `.env` file |
| `EnvSync: Pull from Remote` | Fetch remote variables into a local `.env` file |
| `EnvSync: New Mapping` | Add a new file → platform mapping |
| `EnvSync: Remove Mapping` | Delete a mapping (right-click in Sync Panel) |
| `EnvSync: Manage Tokens` | Add, update, or remove GitHub / GitLab credentials |

---

## Requirements

- VS Code 1.110.0 or later
- A GitHub account (for GitHub Secrets sync) or a GitLab Personal Access Token with `api` scope (for GitLab CI/CD Variables sync)
- An internet connection to reach the GitHub or GitLab APIs

---

## Extension settings

EnvBridge does not add VS Code settings entries. All configuration is stored in `.envsync.json` in your workspace root (file-to-target mappings) and in VS Code workspace state (per-variable push/secret toggles).

---

## Known limitations

- GitHub secret values are **write-only** via the API. When pulling from GitHub, secret keys are written with empty values — you must fill them in manually.
- Only the workspace root folder is supported in multi-root workspaces (first folder is used).
- `.env` files must use the standard `KEY=value` format (with optional `export` prefix). Multi-line values and inline comments are supported by the parser.

---

## Release notes

### 0.0.1

Initial release — push/pull for GitHub Secrets and GitLab CI/CD Variables, per-variable CodeLens, sidebar Sync Panel, secure token storage.
