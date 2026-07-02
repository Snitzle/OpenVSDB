import { SqlDialect, quoteIdentifier, quoteQualifiedIdentifier } from '../sql/identifier';
import { Scalar } from '../types';

export type ExportFormat = 'csv' | 'tsv' | 'json' | 'sql' | 'markdown';

export interface ExportTableData {
  /** Empty for datasets with no home table (query results). */
  schema: string;
  table: string;
  columns: string[];
  rows: Scalar[][];
  /** Terminated CREATE statement, emitted before INSERTs by the SQL format. */
  ddl?: string;
}

export interface ExportFormatSpec {
  format: ExportFormat;
  label: string;
  extension: string;
  /** Multi-table layout: one concatenated script, or one file per table. */
  container: 'single-file' | 'per-table';
  supportsClipboard: boolean;
}

export const EXPORT_FORMATS: ExportFormatSpec[] = [
  { format: 'csv', label: 'CSV', extension: 'csv', container: 'per-table', supportsClipboard: true },
  { format: 'tsv', label: 'TSV', extension: 'tsv', container: 'per-table', supportsClipboard: true },
  { format: 'json', label: 'JSON', extension: 'json', container: 'per-table', supportsClipboard: true },
  {
    format: 'sql',
    label: 'SQL dump (DDL + INSERTs)',
    extension: 'sql',
    container: 'single-file',
    supportsClipboard: true,
  },
  { format: 'markdown', label: 'Markdown table', extension: 'md', container: 'per-table', supportsClipboard: true },
];

export function renderExport(format: ExportFormat, data: ExportTableData, dialect: SqlDialect): string {
  switch (format) {
    case 'csv':
      return renderDelimited(data, ',');
    case 'tsv':
      return renderDelimited(data, '\t');
    case 'json':
      return renderJson(data);
    case 'sql': {
      const statements = sqlInsertStatements(data, dialect);
      return data.ddl ? [data.ddl.trim(), ...statements].join('\n') : statements.join('\n');
    }
    case 'markdown':
      return renderMarkdown(data);
    default:
      throw new Error(`Unsupported export format: ${format as string}`);
  }
}

/** One INSERT statement per row; also used by the whole-database dump. */
export function sqlInsertStatements(data: ExportTableData, dialect: SqlDialect): string[] {
  const tableSql = data.schema
    ? quoteQualifiedIdentifier(dialect, data.schema, data.table)
    : quoteIdentifier(dialect, data.table);
  const columnsSql = data.columns.map((column) => quoteIdentifier(dialect, column)).join(', ');

  return data.rows.map((row) => {
    const values = row.map((value) => sqlLiteral(value, dialect)).join(', ');
    return `INSERT INTO ${tableSql} (${columnsSql}) VALUES (${values});`;
  });
}

/**
 * Adapt a raw query result (columns + positional rows) into exportable table
 * data. Query results may repeat column names (joins, `count(*)` aliases);
 * duplicates are suffixed so JSON keys cannot collide.
 */
export function rawResultToExportData(
  result: { columns: string[]; rows: Scalar[][] },
  tableName: string,
): ExportTableData {
  const seen = new Map<string, number>();
  const columns = result.columns.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name}_${count}`;
  });

  return { schema: '', table: tableName, columns, rows: result.rows };
}

export function sqlLiteral(value: Scalar, dialect: SqlDialect): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  let text = String(value).replace(/'/g, "''");
  if (dialect === 'mysql') {
    // MySQL treats backslash as an escape character by default.
    text = text.replace(/\\/g, '\\\\');
  }
  return `'${text}'`;
}

function renderDelimited(data: ExportTableData, delimiter: string): string {
  const lines = [data.columns.map((column) => escapeDelimited(column, delimiter)).join(delimiter)];
  for (const row of data.rows) {
    lines.push(row.map((value) => escapeDelimited(value, delimiter)).join(delimiter));
  }
  return lines.join('\n');
}

function escapeDelimited(value: Scalar, delimiter: string): string {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);
  if (text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function renderJson(data: ExportTableData): string {
  const objects = data.rows.map((row) => {
    const item: Record<string, Scalar> = {};
    data.columns.forEach((column, index) => {
      item[column] = row[index] ?? null;
    });
    return item;
  });

  return JSON.stringify(objects, null, 2);
}

function renderMarkdown(data: ExportTableData): string {
  const escapeCell = (value: Scalar): string => {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  };

  const lines = [
    `| ${data.columns.map(escapeCell).join(' | ')} |`,
    `| ${data.columns.map(() => '---').join(' | ')} |`,
  ];
  for (const row of data.rows) {
    lines.push(`| ${row.map(escapeCell).join(' | ')} |`);
  }
  return lines.join('\n');
}
