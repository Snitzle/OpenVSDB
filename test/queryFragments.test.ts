import { strict as assert } from 'assert';
import { buildFilterClause, buildOrderByClause, buildWhereClause } from '../src/sql/queryFragments';

describe('query fragments', () => {
  it('builds where clause for contains operator', () => {
    const result = buildWhereClause(
      'mysql',
      {
        column: 'name',
        operator: 'contains',
        value: 'ali',
      },
      new Set(['name']),
    );

    assert.equal(result.sql, 'WHERE `name` LIKE ?');
    assert.deepEqual(result.params, ['%ali%']);
  });

  it('builds where clause for null checks', () => {
    const result = buildWhereClause(
      'sqlite',
      {
        column: 'deleted_at',
        operator: 'isNull',
      },
      new Set(['deleted_at']),
    );

    assert.equal(result.sql, 'WHERE "deleted_at" IS NULL');
    assert.deepEqual(result.params, []);
  });

  it('builds order by clause', () => {
    const result = buildOrderByClause(
      'sqlite',
      [{ column: 'created_at', direction: 'desc' }],
      new Set(['created_at']),
    );

    assert.equal(result, 'ORDER BY "created_at" DESC');
  });

  it('builds a multi-column order by clause', () => {
    const result = buildOrderByClause(
      'mysql',
      [
        { column: 'name', direction: 'asc' },
        { column: 'created_at', direction: 'desc' },
      ],
      new Set(['name', 'created_at']),
    );

    assert.equal(result, 'ORDER BY `name` ASC, `created_at` DESC');
  });

  it('uses a raw where clause verbatim', () => {
    const result = buildFilterClause('mysql', { where: "status = 'active'" }, new Set(['status']));

    assert.equal(result.sql, "WHERE status = 'active'");
    assert.deepEqual(result.params, []);
  });

  it('falls back to the structured filter when no raw where is given', () => {
    const result = buildFilterClause(
      'sqlite',
      { filter: { column: 'name', operator: 'eq', value: 'x' } },
      new Set(['name']),
    );

    assert.equal(result.sql, 'WHERE "name" = ?');
    assert.deepEqual(result.params, ['x']);
  });

  it('rejects unknown columns', () => {
    assert.throws(() => {
      buildWhereClause(
        'mysql',
        {
          column: 'unsafe',
          operator: 'eq',
          value: 'x',
        },
        new Set(['safe']),
      );
    });
  });
});
