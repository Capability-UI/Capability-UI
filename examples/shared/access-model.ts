import type { ExampleSqlite } from './sqlite.ts';
import type { DataModelCatalog, ExamplePrincipal } from './types.ts';

export const ACCESS_TABLES = `
CREATE TABLE IF NOT EXISTS access_principals (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  role TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS access_resources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  description TEXT NOT NULL,
  table_name TEXT,
  writes_table TEXT
);
CREATE TABLE IF NOT EXISTS access_grants (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES access_principals(id),
  resource_id TEXT NOT NULL REFERENCES access_resources(id),
  record_scope TEXT NOT NULL,
  maps_to_table TEXT
);
CREATE TABLE IF NOT EXISTS access_grant_operations (
  grant_id TEXT NOT NULL REFERENCES access_grants(id),
  operation TEXT NOT NULL,
  PRIMARY KEY (grant_id, operation)
);
CREATE TABLE IF NOT EXISTS access_hidden_fields (
  grant_id TEXT NOT NULL REFERENCES access_grants(id),
  field TEXT NOT NULL,
  PRIMARY KEY (grant_id, field)
);
`;

export function seedAccessModel(
  database: ExampleSqlite,
  catalog: DataModelCatalog,
  principals: ExamplePrincipal[],
): void {
  for (const statement of ACCESS_TABLES.split(';').map((item) => item.trim()).filter(Boolean)) {
    database.run(statement);
  }
  database.run('DELETE FROM access_hidden_fields');
  database.run('DELETE FROM access_grant_operations');
  database.run('DELETE FROM access_grants');
  database.run('DELETE FROM access_resources');
  database.run('DELETE FROM access_principals');
  for (const principal of principals) {
    database.run('INSERT INTO access_principals (id, label, role) VALUES (?, ?, ?)', [
      principal.id,
      principal.label,
      principal.role,
    ]);
  }
  for (const resource of catalog.resources) {
    database.run(
      'INSERT INTO access_resources (id, kind, description, table_name, writes_table) VALUES (?, ?, ?, ?, ?)',
      [resource.id, resource.kind, resource.description, resource.table ?? null, resource.writesTable ?? null],
    );
  }
  for (const grant of catalog.grants) {
    const id = `${grant.principalId}:${grant.resourceId}`;
    database.run(
      'INSERT INTO access_grants (id, principal_id, resource_id, record_scope, maps_to_table) VALUES (?, ?, ?, ?, ?)',
      [id, grant.principalId, grant.resourceId, grant.recordScope, grant.mapsToTable ?? null],
    );
    for (const operation of grant.operations) {
      database.run('INSERT INTO access_grant_operations (grant_id, operation) VALUES (?, ?)', [id, operation]);
    }
    for (const field of grant.hiddenFields) {
      database.run('INSERT INTO access_hidden_fields (grant_id, field) VALUES (?, ?)', [id, field]);
    }
  }
}
