import type {
  Capability,
  ExecutionContext,
  Resource,
  Subject,
} from './runtime.js';

/** Minimal registry contract used by hosts that load definitions from SQL or config. */
export interface ExternalAgentResource extends Resource {
  type: 'agent';
  endpoint: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  supportedTasks: string[];
}

export interface AgentRuntimeAdapter {
  invoke(agent: ExternalAgentResource, input: unknown, context: ExecutionContext): Promise<unknown>;
}

export interface AgentAction { kind: 'action'; capability: string; input: unknown; }

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

export function memoryRegistry(): MemoryResourceRegistry { return new MemoryResourceRegistry(); }
