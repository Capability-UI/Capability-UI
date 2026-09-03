import type { CapabilityUI, Subject } from '@capability-ui/core';
import type { ExampleSqlite } from './sqlite.ts';

export interface ExamplePrincipal {
  id: string;
  label: string;
  role: string;
  subject: Subject;
}

export interface DataModelEdge {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface AccessGrant {
  principalId: string;
  principalLabel: string;
  resourceId: string;
  mapsToTable?: string;
  operations: string[];
  recordScope: string;
  hiddenFields: string[];
}

export interface DataModelCatalog {
  summary: string;
  resources: Array<{ id: string; table?: string; kind: 'data' | 'action'; writesTable?: string; description: string }>;
  grants: AccessGrant[];
}

export interface ExampleApp {
  name: string;
  title: string;
  subtitle: string;
  product: string;
  cup: CapabilityUI;
  database?: ExampleSqlite;
  catalog?: DataModelCatalog;
  principals: ExamplePrincipal[];
  defaultSubjectId: string;
  eventResources?: string[];
  pythonAgent?: {
    script: string;
    pythonBin?: string;
  };
}
