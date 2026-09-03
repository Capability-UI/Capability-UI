import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReadOnlySql } from './sql-guard.ts';

const require = createRequire(import.meta.url);

export interface SchemaTable {
  name: string;
  columns: Array<{ name: string; type: string; pk: boolean; notnull: boolean }>;
  rowCount: number;
  foreignKeys: Array<{ from: string; toTable: string; toColumn: string }>;
}

export class ExampleSqlite {
  private ctor!: new (data?: ArrayLike<number>) => SqlJsDatabase;
  private db!: SqlJsDatabase;
  private ready: Promise<void>;

  constructor(
    private readonly schemaSql: string,
    private readonly filePath?: string,
  ) {
    this.ready = this.open();
  }

  private async open(): Promise<void> {
    const initSqlJs = require('sql.js') as (config: { locateFile: (file: string) => string }) => Promise<{ Database: new (data?: ArrayLike<number>) => SqlJsDatabase }>;
    const dist = dirname(require.resolve('sql.js'));
    const SQL = await initSqlJs({ locateFile: (file: string) => join(dist, file) });
    this.ctor = SQL.Database;
    if (this.filePath && existsSync(this.filePath)) {
      this.db = new SQL.Database(readFileSync(this.filePath));
      this.db.run('PRAGMA foreign_keys = ON');
      return;
    }
    this.db = new SQL.Database();
    this.db.run('PRAGMA foreign_keys = ON');
    this.db.run(this.schemaSql);
    this.persist();
  }

  async init(): Promise<this> {
    await this.ready;
    return this;
  }

  persist(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, Buffer.from(this.db.export()));
  }

  run(sql: string, params: SqlParams = []): void {
    this.db.run(sql, params);
    this.persist();
  }

  all<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: SqlParams = []): T[] {
    const statement = this.db.prepare(sql);
    if (params.length) statement.bind(params);
    const rows: T[] = [];
    while (statement.step()) rows.push(statement.getAsObject() as T);
    statement.free();
    return rows;
  }

  get<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: SqlParams = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  schema(): SchemaTable[] {
    const tables = this.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    return tables.map(table => {
      const columns = this.all<{ name: string; type: string; pk: number; notnull: number }>(`PRAGMA table_info(${quoteIdent(table.name)})`);
      const foreignKeys = this.all<{ from: string; table: string; to: string }>(`PRAGMA foreign_key_list(${quoteIdent(table.name)})`);
      const count = this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quoteIdent(table.name)}`);
      return {
        name: table.name,
        rowCount: Number(count?.n ?? 0),
        columns: columns.map(column => ({
          name: column.name,
          type: column.type || 'ANY',
          pk: column.pk === 1,
          notnull: column.notnull === 1,
        })),
        foreignKeys: foreignKeys.map(key => ({ from: key.from, toTable: key.table, toColumn: key.to })),
      };
    });
  }

  tablePreview(name: string, limit = 200): { columns: string[]; rows: unknown[][] } {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid table name');
    const size = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 200;
    return this.query(`SELECT * FROM "${name}" LIMIT ${size}`);
  }

  query(sql: string): { columns: string[]; rows: unknown[][] } {
    const statementSql = assertReadOnlySql(sql);
    const result = this.db.exec(statementSql);
    const first = result[0];
    if (!first) return { columns: [], rows: [] };
    return { columns: first.columns, rows: first.values };
  }
}

type SqlParams = Array<string | number | null>;

interface SqlJsDatabase {
  run(sql: string, params?: SqlParams): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  prepare(sql: string): {
    bind(params: SqlParams): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  };
  export(): Uint8Array;
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid table name');
  return `"${name}"`;
}

export function sqliteFile(metaUrl: string, relative = '../data/workspace.sqlite'): string {
  return fileURLToPath(new URL(relative, metaUrl));
}
