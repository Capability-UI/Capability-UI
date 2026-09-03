import type {
  Capability,
  Resource,
} from './runtime.js';

/** Minimal registry contract used by hosts that load definitions from SQL or config. */
export interface ResourceRegistry {
  register(resource: Resource | Capability): void;
  get(id: string): Resource | undefined;
  list(): Resource[];
}

/** Adapter bundle for constructing a runtime without coupling CUP to a framework. */
export interface RuntimeAdapters {
  identity?: unknown;
  policy?: unknown;
  capabilities?: unknown[];
}

/** A small registry implementation useful for bootstrapping SQL-backed snapshots. */
export class MemoryResourceRegistry implements ResourceRegistry {
  private readonly resources = new Map<string, Resource>();

  register(resource: Resource | Capability): void {
    this.resources.set(resource.id, resource);
  }

  get(id: string): Resource | undefined {
    return this.resources.get(id);
  }

  list(): Resource[] {
    return [...this.resources.values()];
  }
}
