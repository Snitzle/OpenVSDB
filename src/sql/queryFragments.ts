import { FilterSpec, Scalar, SortSpec } from '../types';
import { SqlDialect, quoteIdentifier } from './identifier';

export interface ClauseBuildResult {
  sql: string;
  params: Scalar[];
}

function ensureAllowedColumn(column: string, allowedColumns: Set<string>): void {
  if (!allowedColumns.has(column)) {
    throw new Error(`Unknown column in filter/sort: ${column}`);
  }
}

export function buildWhereClause(
  dialect: SqlDialect,
  filter: FilterSpec | undefined,
  allowedColumns: Set<string>,
): ClauseBuildResult {
  if (!filter) {
    return { sql: '', params: [] };
  }

  ensureAllowedColumn(filter.column, allowedColumns);
  const columnSql = quoteIdentifier(dialect, filter.column);

  switch (filter.operator) {
    case 'eq':
      return { sql: `WHERE ${columnSql} = ?`, params: [filter.value ?? null] };
    case 'neq':
      return { sql: `WHERE ${columnSql} <> ?`, params: [filter.value ?? null] };
    case 'gt':
      return { sql: `WHERE ${columnSql} > ?`, params: [filter.value ?? null] };
    case 'gte':
      return { sql: `WHERE ${columnSql} >= ?`, params: [filter.value ?? null] };
    case 'lt':
      return { sql: `WHERE ${columnSql} < ?`, params: [filter.value ?? null] };
    case 'lte':
      return { sql: `WHERE ${columnSql} <= ?`, params: [filter.value ?? null] };
    case 'contains':
      return { sql: `WHERE ${columnSql} LIKE ?`, params: [`%${String(filter.value ?? '')}%`] };
    case 'startsWith':
      return { sql: `WHERE ${columnSql} LIKE ?`, params: [`${String(filter.value ?? '')}%`] };
    case 'endsWith':
      return { sql: `WHERE ${columnSql} LIKE ?`, params: [`%${String(filter.value ?? '')}`] };
    case 'isNull':
      return { sql: `WHERE ${columnSql} IS NULL`, params: [] };
    case 'isNotNull':
      return { sql: `WHERE ${columnSql} IS NOT NULL`, params: [] };
    default:
      throw new Error(`Unsupported filter operator: ${(filter as FilterSpec).operator}`);
  }
}

export function buildOrderByClause(
  dialect: SqlDialect,
  sort: SortSpec[] | undefined,
  allowedColumns: Set<string>,
): string {
  if (!sort || sort.length === 0) {
    return '';
  }

  const terms = sort.map((spec) => {
    ensureAllowedColumn(spec.column, allowedColumns);
    const direction = spec.direction === 'desc' ? 'DESC' : 'ASC';
    return `${quoteIdentifier(dialect, spec.column)} ${direction}`;
  });

  return `ORDER BY ${terms.join(', ')}`;
}

/**
 * Choose between a raw user-supplied WHERE clause and the structured filter.
 * A non-empty raw `where` (SQL without the WHERE keyword) takes precedence and
 * is passed through verbatim; otherwise the structured filter is used.
 */
export function buildFilterClause(
  dialect: SqlDialect,
  options: { where?: string; filter?: FilterSpec },
  allowedColumns: Set<string>,
): ClauseBuildResult {
  const raw = typeof options.where === 'string' ? options.where.trim() : '';
  if (raw) {
    return { sql: `WHERE ${raw}`, params: [] };
  }

  return buildWhereClause(dialect, options.filter, allowedColumns);
}
