import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DatabaseClient } from '../db/client';
import { SqlDialect } from '../sql/identifier';
import { RawQueryResult, RowData } from '../types';
import {
  EXPORT_FORMATS,
  ExportFormatSpec,
  rawResultToExportData,
  renderExport,
  sqlInsertStatements,
} from './extractors';
import {
  ExportScope,
  ExportTarget,
  collectTableData,
  describeActiveView,
  iterateDatabaseTables,
  tableCreateStatement,
} from './tableSource';

export type { ExportTarget } from './tableSource';

/**
 * Drive the export QuickPick flow (scope → format → destination) for a table
 * panel. Returns a status message for the webview, or undefined if the user
 * cancelled a step.
 */
export async function promptAndExportTable(
  client: DatabaseClient,
  target: ExportTarget,
  selection: RowData[],
): Promise<string | undefined> {
  const scope = await pickScope(selection.length, describeActiveView(target));
  if (!scope) {
    return undefined;
  }

  const format = await pickFormat();
  if (!format) {
    return undefined;
  }

  const destination = await pickDestination(format);
  if (!destination) {
    return undefined;
  }

  const data = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Exporting ${target.schema}.${target.table}…` },
    async () => {
      const collected = await collectTableData(client, target, scope, selection);
      if (format.format === 'sql' && target.objectType === 'table') {
        collected.ddl = await tableCreateStatement(client, target.schema, target.table);
      }
      return collected;
    },
  );

  const text = renderExport(format.format, data, client.dialect);
  const rowsLabel = `${data.rows.length} row${data.rows.length === 1 ? '' : 's'}`;

  if (destination === 'clipboard') {
    await vscode.env.clipboard.writeText(text);
    return `Copied ${rowsLabel} to the clipboard as ${format.label}.`;
  }

  const uri = await vscode.window.showSaveDialog({
    defaultUri: suggestedUri(`${target.schema}.${target.table}.${format.extension}`),
    saveLabel: 'Export',
  });
  if (!uri) {
    return undefined;
  }

  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
  return `Exported ${rowsLabel} to ${uri.fsPath}.`;
}

/**
 * Whole-database export: a single SQL dump file, or a folder of per-table CSV
 * files. Returns a status message, or undefined if the user cancelled.
 */
export async function promptAndExportDatabase(
  client: DatabaseClient,
  connectionName: string,
): Promise<string | undefined> {
  const layout = await vscode.window.showQuickPick(
    [
      {
        label: 'SQL dump',
        description: 'DDL + INSERTs in a single .sql file',
        layout: 'sql' as const,
      },
      {
        label: 'CSV',
        description: 'a folder with one .csv file per table',
        layout: 'csv' as const,
      },
    ],
    { placeHolder: `Export database "${connectionName}" as…` },
  );
  if (!layout) {
    return undefined;
  }

  if (layout.layout === 'sql') {
    return exportDatabaseAsSqlDump(client, connectionName);
  }

  return exportDatabaseAsCsvFolder(client, connectionName);
}

/**
 * Export one result set of a query panel run. Returns a status message, or
 * undefined if the user cancelled.
 */
export async function promptAndExportQueryResult(
  dialect: SqlDialect,
  result: RawQueryResult,
): Promise<string | undefined> {
  const format = await pickFormat('SQL INSERTs');
  if (!format) {
    return undefined;
  }

  let tableName = 'query_result';
  if (format.format === 'sql') {
    const input = await vscode.window.showInputBox({
      prompt: 'Table name for the INSERT statements',
      value: tableName,
    });
    if (input === undefined) {
      return undefined;
    }
    tableName = input.trim() || tableName;
  }

  const destination = await pickDestination(format);
  if (!destination) {
    return undefined;
  }

  const data = rawResultToExportData(result, tableName);
  const text = renderExport(format.format, data, dialect);
  const rowsLabel = `${data.rows.length} row${data.rows.length === 1 ? '' : 's'}`;

  if (destination === 'clipboard') {
    await vscode.env.clipboard.writeText(text);
    return `Copied ${rowsLabel} to the clipboard as ${format.label}.`;
  }

  const uri = await vscode.window.showSaveDialog({
    defaultUri: suggestedUri(`query-result.${format.extension}`),
    saveLabel: 'Export',
  });
  if (!uri) {
    return undefined;
  }

  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
  return `Exported ${rowsLabel} to ${uri.fsPath}.`;
}

async function exportDatabaseAsSqlDump(
  client: DatabaseClient,
  connectionName: string,
): Promise<string | undefined> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: suggestedUri(`${sanitizeFileName(connectionName)}.sql`),
    saveLabel: 'Export database',
    filters: { SQL: ['sql'] },
  });
  if (!uri) {
    return undefined;
  }

  const script = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Exporting database "${connectionName}"…` },
    (progress) => buildDatabaseDump(client, progress),
  );

  await vscode.workspace.fs.writeFile(uri, Buffer.from(script, 'utf8'));
  return `Database exported to ${uri.fsPath}.`;
}

async function exportDatabaseAsCsvFolder(
  client: DatabaseClient,
  connectionName: string,
): Promise<string | undefined> {
  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Export here',
    title: `Export "${connectionName}" tables as CSV`,
  });
  const folder = folders?.[0];
  if (!folder) {
    return undefined;
  }

  const count = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Exporting database "${connectionName}" as CSV…` },
    async (progress) => {
      let written = 0;
      for await (const job of iterateDatabaseTables(client, { includeDdl: false, includeViewData: true })) {
        progress.report({ message: `${job.schema}.${job.table}` });
        const text = renderExport('csv', job.data, client.dialect);
        const fileName = `${sanitizeFileName(`${job.schema}.${job.table}`)}.csv`;
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, fileName), Buffer.from(text, 'utf8'));
        written += 1;
      }
      return written;
    },
  );

  return `Exported ${count} table${count === 1 ? '' : 's'} as CSV to ${folder.fsPath}.`;
}

async function pickScope(
  selectionCount: number,
  viewDescription: string | undefined,
): Promise<ExportScope | undefined> {
  const items: Array<vscode.QuickPickItem & { scope: ExportScope }> = [];
  if (selectionCount > 0) {
    items.push({
      label: `Selection (${selectionCount} row${selectionCount === 1 ? '' : 's'})`,
      scope: 'selection',
    });
  }
  items.push(
    { label: 'Current page', description: viewDescription, scope: 'page' },
    {
      label: 'Entire table',
      description: viewDescription ? `${viewDescription} applied` : 'no filters active',
      scope: 'table',
    },
  );

  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'What should be exported?' });
  return picked?.scope;
}

async function pickFormat(sqlLabelOverride?: string): Promise<ExportFormatSpec | undefined> {
  const items = EXPORT_FORMATS.map((entry) => ({
    label: entry.format === 'sql' && sqlLabelOverride ? sqlLabelOverride : entry.label,
    entry,
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Export format' });
  return picked?.entry;
}

async function pickDestination(format: ExportFormatSpec): Promise<'file' | 'clipboard' | undefined> {
  const items: Array<vscode.QuickPickItem & { destination: 'file' | 'clipboard' }> = [
    { label: '$(save) Save to file', destination: 'file' },
  ];
  if (format.supportsClipboard) {
    items.push({ label: '$(clippy) Copy to clipboard', destination: 'clipboard' });
  }

  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Export destination' });
  return picked?.destination;
}

async function buildDatabaseDump(
  client: DatabaseClient,
  progress: vscode.Progress<{ message?: string }>,
): Promise<string> {
  const lines: string[] = [`-- Database dump generated by OpenVSDB`];
  if (client.dialect === 'mysql') {
    lines.push('SET FOREIGN_KEY_CHECKS=0;');
  } else {
    lines.push('PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;');
  }

  const viewSections: string[] = [];

  for await (const job of iterateDatabaseTables(client, { includeDdl: true, includeViewData: false })) {
    progress.report({ message: `${job.schema}.${job.table}` });

    if (job.objectType === 'view') {
      viewSections.push('', `-- View ${job.schema}.${job.table}`, job.data.ddl ?? '-- DDL unavailable');
      continue;
    }

    lines.push('', `-- Table ${job.schema}.${job.table}`);
    if (job.data.ddl) {
      lines.push(job.data.ddl);
    }
    lines.push(...sqlInsertStatements(job.data, client.dialect));
  }

  // Views come last: they may reference any table.
  lines.push(...viewSections);

  if (client.dialect === 'mysql') {
    lines.push('', 'SET FOREIGN_KEY_CHECKS=1;');
  } else {
    lines.push('', 'COMMIT;', 'PRAGMA foreign_keys=ON;');
  }

  return `${lines.join('\n')}\n`;
}

function suggestedUri(fileName: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  return folder
    ? vscode.Uri.joinPath(folder, fileName)
    : vscode.Uri.file(path.join(os.homedir(), fileName));
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-z0-9-_. ]/gi, '_').trim();
  return cleaned || 'database';
}
