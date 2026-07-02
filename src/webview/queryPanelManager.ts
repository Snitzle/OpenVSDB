import * as vscode from 'vscode';
import { DbClientManager } from '../db/clientManager';
import { ConnectionStore } from '../state/connectionStore';
import { QueryPanelEvent, QueryPanelRequest } from './protocol';
import { TablePanelManager } from './tablePanelManager';
import { renderWebviewHtml, toUserError } from './utils';

/**
 * Editor-tab SQL consoles, each bound to one connection. Several panels may
 * target the same connection; each "New query" opens a fresh tab.
 */
export class QueryPanelManager implements vscode.Disposable {
  private readonly panels = new Set<QueryPanelInstance>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connectionStore: ConnectionStore,
    private readonly clientManager: DbClientManager,
    private readonly tablePanels: TablePanelManager,
  ) {}

  async openQueryPanel(connectionId: string): Promise<void> {
    const connection = await this.connectionStore.getConnection(connectionId);
    if (!connection) {
      throw new Error('Connection not found.');
    }

    const panel = new QueryPanelInstance(
      this.context,
      this.clientManager,
      this.tablePanels,
      connectionId,
      connection.name,
      () => this.panels.delete(panel),
    );
    this.panels.add(panel);
  }

  /** Dev-only: re-render all open panels so rebuilt bundles are picked up. */
  reloadWebviews(): void {
    for (const panel of this.panels) {
      panel.reloadWebview();
    }
  }

  closeConnectionPanels(connectionId: string): void {
    for (const panel of [...this.panels]) {
      if (panel.connectionId === connectionId) {
        panel.dispose();
      }
    }
  }

  dispose(): void {
    for (const panel of [...this.panels]) {
      panel.dispose();
    }
    this.panels.clear();
  }
}

class QueryPanelInstance implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly clientManager: DbClientManager,
    private readonly tablePanels: TablePanelManager,
    readonly connectionId: string,
    private readonly connectionName: string,
    private readonly onDispose: () => void,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'dbExplorer.queryPanel',
      `Query: ${connectionName}`,
      { preserveFocus: false, viewColumn: vscode.ViewColumn.Active },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'media'),
          vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        ],
      },
    );

    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'database.svg');
    this.panel.webview.html = this.buildHtml();

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage(async (message: QueryPanelRequest) => {
        await this.handleMessage(message);
      }),
      this.panel.onDidDispose(() => {
        this.disposed = true;
        vscode.Disposable.from(...this.disposables).dispose();
        this.onDispose();
      }),
    );
  }

  reloadWebview(): void {
    if (!this.disposed) {
      this.panel.webview.html = this.buildHtml();
    }
  }

  dispose(): void {
    if (!this.disposed) {
      this.panel.dispose();
    }
  }

  private buildHtml(): string {
    return renderWebviewHtml(this.context, this.panel.webview, {
      scriptFile: 'dist/queryPanel.js',
      styleFiles: ['media/main.css', 'dist/queryPanel.css'],
      title: `Query: ${this.connectionName}`,
      surface: 'panel',
    });
  }

  private async handleMessage(message: QueryPanelRequest): Promise<void> {
    try {
      switch (message.kind) {
        case 'ready': {
          const client = await this.clientManager.getClient(this.connectionId);
          this.postEvent(
            { kind: 'queryConfig', connectionName: this.connectionName, dialect: client.dialect },
            message.requestId,
          );
          return;
        }

        case 'runQuery': {
          const client = await this.clientManager.getClient(this.connectionId);
          const results = await client.executeRaw(message.sql);
          this.postEvent({ kind: 'queryResults', results }, message.requestId);

          // DML/DDL may have changed data that open grids are showing.
          if (results.some((result) => result.affectedRows !== undefined)) {
            await this.tablePanels.refreshConnection(this.connectionId);
          }
          return;
        }

        default:
          this.assertNever(message);
      }
    } catch (error) {
      const { message: text, details } = toUserError(error);
      this.postEvent({ kind: 'error', message: text, details }, message.requestId);
    }
  }

  private postEvent(event: QueryPanelEvent, requestId?: string): void {
    if (this.disposed) {
      return;
    }

    void this.panel.webview.postMessage({
      ...event,
      requestId,
    });
  }

  private assertNever(_message: never): never {
    throw new Error('Unhandled query panel request.');
  }
}
