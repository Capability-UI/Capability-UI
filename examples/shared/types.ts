import type { AuthorizedView, CapabilityUI, Subject } from '@capability-ui/core';
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

export type SurfaceKind = 'table' | 'form' | 'stat' | 'cards' | 'notice';
export type SurfaceFilter = 'all' | 'belowReorder' | 'drafts';
export type SurfaceMetric = 'lowStockCount' | 'draftCount' | 'onHandTotal';

export interface UiSurface {
  id: string;
  title: string;
  kind: SurfaceKind;
  resourceId?: string;
  capabilityId?: string;
  filter?: SurfaceFilter;
  columns?: string[];
  metric?: SurfaceMetric;
  body?: string;
}

export interface ComposeUiInput {
  view: AuthorizedView;
  message: string;
  surfaces: UiSurface[];
}

export interface ComposeUiResult {
  text: string;
  surfaces: UiSurface[];
  suggestions: string[];
  prompts: string[];
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
  composeUi?: (input: ComposeUiInput) => ComposeUiResult;
}
