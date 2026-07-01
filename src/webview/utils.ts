import * as vscode from 'vscode';

export function renderWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  options: {
    /** Path to the script, relative to the extension root (e.g. 'dist/tablePanel.js'). */
    scriptFile: string;
    /** Stylesheet paths, relative to the extension root (e.g. 'media/main.css'). */
    styleFiles: string[];
    title: string;
    surface: 'sidebar' | 'panel';
  },
): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, options.scriptFile));
  const styleLinks = options.styleFiles
    .map((file) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, file));
      return `<link rel="stylesheet" href="${uri}">`;
    })
    .join('\n  ');
  const nonce = createNonce();

  // 'unsafe-inline' for style-src is required because the grid library (Tabulator)
  // injects a small amount of inline styling; img/font 'data:' covers its embedded icons.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
  ${styleLinks}
  <title>${escapeHtml(options.title)}</title>
</head>
<body data-surface="${options.surface}">
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export async function openTextInEditor(language: string, content: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language,
    content,
  });

  await vscode.window.showTextDocument(document, {
    preview: false,
    viewColumn: vscode.ViewColumn.Active,
  });
}

export function toUserError(error: unknown): { message: string; details?: string } {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;

    if (code === 'ER_ACCESS_DENIED_ERROR') {
      return { message: 'MySQL access denied. Check username/password and privileges.', details: error.message };
    }

    if (code === 'ECONNREFUSED') {
      return { message: 'MySQL connection refused. Check host, port, and network access.', details: error.message };
    }

    if (code === 'SQLITE_CANTOPEN') {
      return { message: 'Unable to open SQLite file. Verify path and file permissions.', details: error.message };
    }

    if (error.message.toLowerCase().includes('database is locked')) {
      return {
        message: 'SQLite database is locked by another process. Retry after concurrent writes finish.',
        details: error.message,
      };
    }

    return { message: error.message, details: error.stack };
  }

  return { message: 'Unknown error.' };
}

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
