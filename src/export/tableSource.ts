import { DatabaseClient } from '../db/client';
import { FilterSpec, RowData, SortSpec, TableInfo } from '../types';
import { ExportTableData } from './extractors';

/** The table view an export starts from — current page, sort, and filters. */
export interface ExportTarget {
  schema: string;
  table: string;
  objectType: 'table' | 'view';
  page: number;
  pageSize: number;
  sort?: SortSpec[];
  filters?: FilterSpec[];
  where?: string;
}

export type ExportScope = 'selection' | 'page' | 'table';

export const DUMP_PAGE_SIZE = 1000;

export interface TableExportJob {
  schema: string;
  table: string;
  objectType: 'table' | 'view';
  data: ExportTableData;
}

export interface DatabaseIterationOptions {
  /** Fetch CREATE statements into `data.ddl` (SQL dumps). */
  includeDdl: boolean;
  /** Collect view rows (data formats) instead of view DDL only (SQL dumps). */
  includeViewData: boolean;
}

/** Human summary of the filters/sort an export will honour, for QuickPicks. */
export function describeActiveView(target: ExportTarget): string | undefined {
  const parts: string[] = [];
  const filterCount = target.filters?.length ?? 0;
  if (filterCount > 0) {
    parts.push(`${filterCount} filter${filterCount === 1 ? '' : 's'}`);
  }
  if (target.where?.trim()) {
    parts.push('raw WHERE');
  }
  if (target.sort?.length) {
    parts.push(`sorted by ${target.sort.map((spec) => spec.column).join(', ')}`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export async function collectTableData(
  client: DatabaseClient,
  target: ExportTarget,
  scope: ExportScope,
  selection: RowData[],
): Promise<ExportTableData> {
  if (scope === 'selection') {
    const info = await client.getTableInfo(target.schema, target.table, target.objectType);
    return toExportData(info, selection);
  }

  if (scope === 'page') {
    const result = await client.queryTableRows(
      {
        schema: target.schema,
        table: target.table,
        page: target.page,
        pageSize: target.pageSize,
        sort: target.sort,
        filters: target.filters,
        where: target.where,
      },
      target.objectType,
    );
    return toExportData(result.info, result.rows);
  }

  const rows: RowData[] = [];
  let info: TableInfo | undefined;
  for (let page = 0; ; page += 1) {
    const result = await client.queryTableRows(
      {
        schema: target.schema,
        table: target.table,
        page,
        pageSize: DUMP_PAGE_SIZE,
        sort: target.sort,
        filters: target.filters,
        where: target.where,
      },
      target.objectType,
    );
    info = result.info;
    rows.push(...result.rows);
    if (result.rows.length < DUMP_PAGE_SIZE) {
      break;
    }
  }

  return toExportData(info as TableInfo, rows);
}

export function toExportData(info: TableInfo, rows: RowData[]): ExportTableData {
  const columns = info.columns.map((column) => column.name);
  return {
    schema: info.schema,
    table: info.name,
    columns,
    rows: rows.map((row) => columns.map((column) => row.values[column] ?? null)),
  };
}

/**
 * Every table and view of a connection as a lazy sequence, one dataset at a
 * time so whole-database exports stay bounded by the largest single table.
 */
export async function* iterateDatabaseTables(
  client: DatabaseClient,
  options: DatabaseIterationOptions,
): AsyncGenerator<TableExportJob> {
  const schemas = await client.listSchemas();

  for (const schema of schemas) {
    const objects = await client.listObjects(schema);

    for (const object of objects) {
      if (object.type === 'view' && !options.includeViewData) {
        const ddl = await client.getDdl(schema, object.name, 'view');
        yield {
          schema,
          table: object.name,
          objectType: 'view',
          data: {
            schema,
            table: object.name,
            columns: [],
            rows: [],
            ddl: ensureTerminated(ddl.trim()),
          },
        };
        continue;
      }

      const data = await collectTableData(
        client,
        { schema, table: object.name, objectType: object.type, page: 0, pageSize: DUMP_PAGE_SIZE },
        'table',
        [],
      );

      if (options.includeDdl && object.type === 'table') {
        data.ddl = await tableCreateStatement(client, schema, object.name);
      }

      yield { schema, table: object.name, objectType: object.type, data };
    }
  }
}

export async function tableCreateStatement(
  client: DatabaseClient,
  schema: string,
  table: string,
): Promise<string> {
  let ddl = await client.getDdl(schema, table, 'table');
  // The SQLite client appends PRAGMA info as trailing comment blocks; keep only
  // the CREATE statement so the output stays executable.
  ddl = ddl.split('\n\n-- PRAGMA table_info')[0].trim();
  return ensureTerminated(ddl);
}

export function ensureTerminated(sql: string): string {
  return sql.endsWith(';') ? sql : `${sql};`;
}
