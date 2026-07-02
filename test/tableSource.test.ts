import { strict as assert } from 'assert';
import { DatabaseClient } from '../src/db/client';
import {
  DUMP_PAGE_SIZE,
  collectTableData,
  describeActiveView,
  iterateDatabaseTables,
} from '../src/export/tableSource';
import { RowData, TableInfo, TableQuery } from '../src/types';

function tableInfo(schema: string, name: string, objectType: 'table' | 'view' = 'table'): TableInfo {
  return {
    schema,
    name,
    objectType,
    columns: [
      { name: 'id', dataType: 'INTEGER', nullable: false, isPrimaryKey: true, isUniqueKey: true, isAutoIncrement: true },
      { name: 'name', dataType: 'TEXT', nullable: true, isPrimaryKey: false, isUniqueKey: false, isAutoIncrement: false },
    ],
    writableKey: { kind: 'none', columns: [] },
    readOnly: true,
  };
}

function makeRows(count: number, offset = 0): RowData[] {
  return Array.from({ length: count }, (_, index) => ({
    key: null,
    values: { id: offset + index + 1, name: `row ${offset + index + 1}` },
  }));
}

/** Fake client: one schema with a small table, a large table, and a view. */
function fakeClient(rowTotals: Record<string, number>): DatabaseClient & { queryLog: TableQuery[] } {
  const queryLog: TableQuery[] = [];

  return {
    dialect: 'sqlite',
    queryLog,
    async listSchemas() {
      return ['main'];
    },
    async listObjects(schema: string) {
      return Object.keys(rowTotals)
        .map((name) => ({ schema, name, type: name.startsWith('v_') ? ('view' as const) : ('table' as const) }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type.localeCompare(b.type)));
    },
    async getTableInfo(schema: string, name: string, objectType: 'table' | 'view') {
      return tableInfo(schema, name, objectType);
    },
    async queryTableRows(query: TableQuery, objectType: 'table' | 'view') {
      queryLog.push(query);
      const total = rowTotals[query.table] ?? 0;
      const start = query.page * query.pageSize;
      const count = Math.max(0, Math.min(query.pageSize, total - start));
      return {
        info: tableInfo(query.schema, query.table, objectType),
        rows: makeRows(count, start),
        page: query.page,
        pageSize: query.pageSize,
      };
    },
    async getDdl(schema: string, objectName: string, objectType: 'table' | 'view') {
      if (objectType === 'view') {
        return `CREATE VIEW "${objectName}" AS SELECT 1`;
      }
      return `CREATE TABLE "${objectName}" ("id" INTEGER)\n\n-- PRAGMA table_info\n-- 0: id INTEGER`;
    },
    async insertRow() {},
    async updateRows() {},
    async deleteRows() {},
    async executeRaw() {
      return [];
    },
    async dispose() {},
  };
}

describe('table source', () => {
  it('pages through an entire table until the last short page', async () => {
    const client = fakeClient({ big: DUMP_PAGE_SIZE + 2 });

    const data = await collectTableData(
      client,
      { schema: 'main', table: 'big', objectType: 'table', page: 0, pageSize: 50 },
      'table',
      [],
    );

    assert.equal(data.rows.length, DUMP_PAGE_SIZE + 2);
    assert.equal(client.queryLog.length, 2);
    assert.deepEqual(
      client.queryLog.map((query) => query.page),
      [0, 1],
    );
    // Full-table collection ignores the panel's page/pageSize and uses dump paging.
    assert.ok(client.queryLog.every((query) => query.pageSize === DUMP_PAGE_SIZE));
  });

  it('keeps filters, where, and sort when collecting the entire table', async () => {
    const client = fakeClient({ users: 3 });

    await collectTableData(
      client,
      {
        schema: 'main',
        table: 'users',
        objectType: 'table',
        page: 4,
        pageSize: 50,
        filters: [{ column: 'name', operator: 'contains', value: 'a' }],
        where: 'id > 1',
        sort: [{ column: 'id', direction: 'desc' }],
      },
      'table',
      [],
    );

    const query = client.queryLog[0];
    assert.equal(query.filters?.length, 1);
    assert.equal(query.where, 'id > 1');
    assert.deepEqual(query.sort, [{ column: 'id', direction: 'desc' }]);
  });

  it('iterates a database for a SQL dump: table DDL inline, views DDL-only', async () => {
    const client = fakeClient({ users: 2, v_active: 5 });

    const jobs = [];
    for await (const job of iterateDatabaseTables(client, { includeDdl: true, includeViewData: false })) {
      jobs.push(job);
    }

    assert.deepEqual(
      jobs.map((job) => [job.table, job.objectType]),
      [
        ['users', 'table'],
        ['v_active', 'view'],
      ],
    );

    const table = jobs[0];
    assert.equal(table.data.rows.length, 2);
    assert.equal(table.data.ddl, 'CREATE TABLE "users" ("id" INTEGER);');

    const view = jobs[1];
    assert.equal(view.data.rows.length, 0);
    assert.equal(view.data.ddl, 'CREATE VIEW "v_active" AS SELECT 1;');
  });

  it('iterates a database for CSV: view rows included, no DDL fetched', async () => {
    const client = fakeClient({ users: 2, v_active: 5 });

    const jobs = [];
    for await (const job of iterateDatabaseTables(client, { includeDdl: false, includeViewData: true })) {
      jobs.push(job);
    }

    assert.equal(jobs[0].data.ddl, undefined);
    assert.equal(jobs[1].data.rows.length, 5);
    assert.equal(jobs[1].data.ddl, undefined);
  });

  it('describes the active view for export prompts', () => {
    assert.equal(
      describeActiveView({ schema: 's', table: 't', objectType: 'table', page: 0, pageSize: 50 }),
      undefined,
    );
    assert.equal(
      describeActiveView({
        schema: 's',
        table: 't',
        objectType: 'table',
        page: 0,
        pageSize: 50,
        filters: [
          { column: 'a', operator: 'eq', value: 1 },
          { column: 'b', operator: 'isNull' },
        ],
        where: 'c = 2',
        sort: [{ column: 'a', direction: 'asc' }],
      }),
      '2 filters · raw WHERE · sorted by a',
    );
  });
});
