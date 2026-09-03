const READ_START = /^(SELECT|WITH|EXPLAIN|PRAGMA)\b/i;
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|VACUUM|REINDEX|INTO)\b/i;
const ALLOWED_PRAGMA = /^(PRAGMA)\s+(table_info|index_list|index_info|foreign_key_list|table_list)\s*\(/i;

export function assertReadOnlySql(sql: string): string {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();
  if (!stripped) throw new Error('SQL is empty');
  const statements = stripped.split(';').map(part => part.trim()).filter(Boolean);
  if (statements.length !== 1) throw new Error('Run one statement at a time');
  const statement = statements[0] ?? '';
  if (statement.toUpperCase().startsWith('PRAGMA')) {
    if (!ALLOWED_PRAGMA.test(statement) && !/^PRAGMA\s+table_list\b/i.test(statement)) {
      throw new Error('That PRAGMA is not allowed in the explorer');
    }
    return statement;
  }
  if (!READ_START.test(statement) || WRITE_WORD.test(statement.replace(/^EXPLAIN\s+(QUERY\s+PLAN\s+)?/i, ''))) {
    throw new Error('Explorer is read-only. Use SELECT, WITH, EXPLAIN, or table PRAGMA.');
  }
  return statement;
}
