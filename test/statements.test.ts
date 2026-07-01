import { strict as assert } from 'assert';
import { splitSqlStatements, statementReturnsRows } from '../src/sql/statements';

describe('splitSqlStatements', () => {
  it('splits multiple statements and trims them', () => {
    assert.deepEqual(splitSqlStatements('SELECT 1;  SELECT 2 ;'), ['SELECT 1', 'SELECT 2']);
  });

  it('returns a single statement without a trailing semicolon', () => {
    assert.deepEqual(splitSqlStatements('SELECT 1'), ['SELECT 1']);
  });

  it('ignores semicolons inside single-quoted strings', () => {
    assert.deepEqual(splitSqlStatements("SELECT ';' AS a; SELECT 2"), ["SELECT ';' AS a", 'SELECT 2']);
  });

  it('handles escaped quotes inside string literals', () => {
    assert.deepEqual(splitSqlStatements("SELECT 'a''; b' AS x; SELECT 2"), ["SELECT 'a''; b' AS x", 'SELECT 2']);
  });

  it('ignores semicolons inside line comments', () => {
    assert.deepEqual(splitSqlStatements('SELECT 1 -- a;b\n; SELECT 2'), ['SELECT 1 -- a;b', 'SELECT 2']);
  });

  it('ignores semicolons inside block comments', () => {
    assert.deepEqual(splitSqlStatements('SELECT 1 /* ; ; */; SELECT 2'), ['SELECT 1 /* ; ; */', 'SELECT 2']);
  });

  it('ignores semicolons inside quoted identifiers', () => {
    assert.deepEqual(splitSqlStatements('SELECT "a;b" FROM t; SELECT 2'), ['SELECT "a;b" FROM t', 'SELECT 2']);
  });

  it('drops empty statements', () => {
    assert.deepEqual(splitSqlStatements(';;\n;'), []);
  });
});

describe('statementReturnsRows', () => {
  it('detects row-producing statements', () => {
    assert.equal(statementReturnsRows('SELECT * FROM t'), true);
    assert.equal(statementReturnsRows('  with cte as (select 1) select * from cte'), true);
    assert.equal(statementReturnsRows('PRAGMA table_info(t)'), true);
    assert.equal(statementReturnsRows('(SELECT 1)'), true);
  });

  it('detects non-row statements', () => {
    assert.equal(statementReturnsRows('INSERT INTO t VALUES (1)'), false);
    assert.equal(statementReturnsRows('UPDATE t SET a = 1'), false);
    assert.equal(statementReturnsRows('CREATE TABLE t (a int)'), false);
  });
});
