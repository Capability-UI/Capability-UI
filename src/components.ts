import type {
  AuthorizationRequest,
  AuthorizedView,
  Capability,
  Decision,
  ExecutionRequest,
  Policy,
  PolicyInput,
  Resource,
  ResourceRef,
  Subject,
} from './runtime.js';
import { CapabilityUI, PolicyStore } from './runtime.js';
import type { ResourceRegistry } from './adapters.js';

export class CapabilityRegistry implements ResourceRegistry {
  private readonly resources = new Map<string, Resource>();

  register(resource: Resource | Capability): void { this.resources.set(resource.id, resource); }
  get(id: string): Resource | undefined { return this.resources.get(id); }
  list(): Resource[] { return [...this.resources.values()]; }
  getVersion(id: string): string | undefined { return this.resources.get(id)?.version; }
  ref(id: string): ResourceRef { const resource = this.resources.get(id); return { id, version: resource?.version }; }
}

export class PolicyEngine {
  constructor(private readonly store = new PolicyStore()) {}
  allow(policy: PolicyInput): void { this.store.allow(policy); }
  deny(policy: PolicyInput): void { this.store.deny(policy); }
  authorize(request: AuthorizationRequest, evaluator: (request: AuthorizationRequest) => Promise<Decision> | Decision): Promise<Decision> | Decision { return evaluator(request); }
  policyVersion(): string { return this.store.version(); }
  matching(request: AuthorizationRequest): Policy[] { return this.store.matching(request); }
}

export class Projector {
  constructor(private readonly cup: CapabilityUI) {}
  project(request: { subject: Subject; goal?: string; context: Record<string, unknown> }): Promise<AuthorizedView> { return this.cup.project(request); }
}

export class Executor {
  constructor(private readonly cup: CapabilityUI) {}
  prepare(request: { subject: Subject; capability: string; input: unknown; scope?: Record<string, unknown>; purpose?: string; context: Record<string, unknown> }) { return this.cup.prepare(request); }
  execute(request: ExecutionRequest) { return this.cup.execute(request); }
  async executePrepared(prepared: Awaited<ReturnType<CapabilityUI['prepare']>>, confirmation?: { inputHash: string; confirmedBy: string }) {
    return this.cup.execute({ ...prepared.request, confirmation });
  }
}

export function createComponents(cup: CapabilityUI) {
  return { registry: new CapabilityRegistry(), policy: new PolicyEngine(cup.policy), projector: new Projector(cup), executor: new Executor(cup) };
}
