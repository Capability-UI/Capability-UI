import { createHash, randomUUID } from 'node:crypto';

export type Operation =
  | 'discover' | 'inspect' | 'read' | 'create' | 'update'
  | 'delete' | 'execute' | 'share' | 'delegate';
export type ResourceType = 'data' | 'capability' | 'workflow' | 'view' | 'agent';
export type Risk = 'low' | 'medium' | 'high' | 'critical';
export type Effect = 'allow' | 'deny';
export type Visibility = 'hidden' | 'listed' | 'inspectable' | 'readable' | 'usable';
export type JsonSchema = Record<string, unknown>;
export type ResourceRef = { id: string; version?: string };

export interface Subject {
  id: string;
  type: 'user' | 'agent' | 'service' | 'group';
  authenticated: boolean;
  attributes: Record<string, unknown>;
}

export type PrincipalSelector =
  | { id: string }
  | { role: string }
  | { type: Subject['type'] }
  | { any: true };

export interface Scope {
  [key: string]: unknown;
}

export interface RequestContext {
  purpose?: string;
  channel?: string;
  [key: string]: unknown;
}

export interface Resource {
  id: string;
  type: ResourceType;
  version: string;
  sensitivity: 'public' | 'personal' | 'confidential' | 'restricted';
  schema: JsonSchema;
  owner?: string;
  metadata?: Record<string, unknown>;
  read?: (request: { subject: Subject; query?: Record<string, unknown>; fields?: string[]; scope?: Scope; context: RequestContext }) => Promise<unknown[]>;
}

export interface Capability extends Resource {
  type: 'capability';
  operation: Operation;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  sideEffects: string[];
  risk: Risk;
  confirmation: 'none' | 'preview' | 'explicit' | 'human_review';
  idempotency: 'none' | 'supported' | 'required';
  reversibility: 'reversible' | 'partially_reversible' | 'irreversible';
  handler: (input: unknown, context: ExecutionContext) => Promise<unknown>;
}

export interface Policy {
  id: string;
  effect: Effect;
  principal: PrincipalSelector;
  operation: Operation | Operation[];
  resource: ResourceRef;
  scope?: Scope;
  conditions?: Condition[];
  obligations?: Obligation[];
  priority: number;
}

export type PolicyInput = Omit<Policy, 'effect'> | Policy;

export type Condition = (request: AuthorizationRequest) => boolean;
export type Obligation =
  | { type: 'redact'; fields: string[] }
  | { type: 'require_confirmation'; mode: Capability['confirmation'] }
  | { type: 'write_receipt' };

export interface AuthorizationRequest {
  requestId?: string;
  subject: Subject;
  operation: Operation;
  resource: ResourceRef;
  scope?: Scope;
  proposedInput?: unknown;
  purpose?: string;
  context: RequestContext;
}

export interface Decision {
  requestId: string;
  effect: Effect;
  reasonCode: string;
  matchedPolicies: string[];
  obligations: Obligation[];
  fieldFilter?: { allow: string[]; deny: string[] };
  policyVersion: string;
}

export interface AuthorizedCapability {
  id: string;
  operation: Operation;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  risk: Risk;
  sideEffects: string[];
  obligations: Obligation[];
}

export interface AuthorizedResource {
  ref: ResourceRef;
  visibility: Visibility;
  schema?: JsonSchema;
  data?: unknown;
  capabilities: AuthorizedCapability[];
}

export interface AuthorizedView {
  viewId: string;
  subjectId: string;
  goal?: string;
  generatedAt: string;
  policyVersion: string;
  resources: AuthorizedResource[];
  globalObligations: Obligation[];
}

export interface Confirmation {
  inputHash: string;
  confirmedBy: string;
}

export interface ExecutionContext extends RequestContext {
  requestId: string;
  idempotencyKey?: string;
}

export interface ExecutionRequest extends Omit<AuthorizationRequest, 'operation' | 'resource'> {
  operation?: Operation;
  resource?: ResourceRef;
  capability: string;
  input: unknown;
  confirmation?: Confirmation;
  idempotencyKey?: string;
}

export interface Receipt {
  id: string;
  status: 'succeeded' | 'failed' | 'denied';
  actor: { id: string; type: Subject['type'] };
  capability: string;
  inputHash: string;
  decision: Decision;
  resultSummary?: unknown;
  createdAt: string;
}

export interface DelegationGrant {
  id: string;
  from: Subject;
  to: Subject;
  capability: string;
  operations: Operation[];
  scope?: Scope;
  purpose?: string;
  expiresAt: string;
}

export class MemoryReceiptSink {
  private readonly receipts: Receipt[] = [];
  async append(receipt: Receipt): Promise<void> { this.receipts.push(receipt); }
  all(): Receipt[] { return [...this.receipts]; }
}

class PolicyStore {
  private readonly rules: Policy[] = [];
  private revision = 0;
  allow(policy: PolicyInput): void { this.rules.push({ ...policy, effect: 'allow' }); this.revision++; }
  deny(policy: PolicyInput): void { this.rules.push({ ...policy, effect: 'deny' }); this.revision++; }
  version(): string { return `policy-${this.revision}`; }
  matching(request: AuthorizationRequest): Policy[] {
    return this.rules.filter(rule => {
      const operations = Array.isArray(rule.operation) ? rule.operation : [rule.operation];
      return operations.includes(request.operation)
        && rule.resource.id === request.resource.id
        && matchesPrincipal(rule.principal, request.subject)
        && matchesScope(rule.scope, request.scope)
        && (!rule.conditions || rule.conditions.every(condition => condition(request)));
    }).sort((a, b) => b.priority - a.priority);
  }
}

function matchesPrincipal(selector: PrincipalSelector, subject: Subject): boolean {
  if ('any' in selector) return selector.any;
  if ('id' in selector) return selector.id === subject.id;
  if ('type' in selector) return selector.type === subject.type;
  return selector.role === subject.attributes.role;
}

function matchesScope(required: Scope | undefined, actual: Scope | undefined): boolean {
  if (!required) return true;
  if (!actual) return false;
  return Object.entries(required).every(([key, value]) => actual[key] === value);
}

function redactValues(values: unknown[], obligations: Obligation[]): unknown[] {
  const denied = new Set(obligations.filter(o => o.type === 'redact').flatMap(o => o.fields));
  if (denied.size === 0) return values;
  return values.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !denied.has(key)));
  });
}

function hashInput(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input, Object.keys(input ?? {}).sort())).digest('hex');
}

function operationForVisibility(operation: Operation): Visibility {
  if (operation === 'execute') return 'usable';
  if (operation === 'read') return 'readable';
  if (operation === 'inspect') return 'inspectable';
  if (operation === 'discover') return 'listed';
  return 'usable';
}

export class CapabilityUI {
  readonly policy = new PolicyStore();
  readonly receipts: MemoryReceiptSink;
  private readonly resources = new Map<string, Resource>();
  private readonly capabilities = new Map<string, Capability>();

  constructor(receipts = new MemoryReceiptSink()) { this.receipts = receipts; }

  register(resource: Resource | Capability): void {
    this.resources.set(resource.id, resource);
    if (resource.type === 'capability' && 'handler' in resource) this.capabilities.set(resource.id, resource);
  }

  async authorize(request: AuthorizationRequest): Promise<Decision> {
    const requestId = request.requestId ?? randomUUID();
    const matched = this.policy.matching(request);
    const topPriority = matched[0]?.priority;
    const effective = topPriority === undefined ? [] : matched.filter(policy => policy.priority === topPriority);
    const denied = effective.some(policy => policy.effect === 'deny');
    const allowed = effective.some(policy => policy.effect === 'allow');
    const obligations = effective.flatMap(policy => policy.obligations ?? []);
    const effect: Effect = denied ? 'deny' : allowed ? 'allow' : 'deny';
    return {
      requestId, effect,
      reasonCode: denied ? 'EXPLICIT_DENY' : allowed ? 'ALLOWED' : 'NO_MATCHING_ALLOW',
      matchedPolicies: effective.map(policy => policy.id), obligations,
      policyVersion: this.policy.version()
    };
  }

  async discover(request: { subject: Subject; purpose?: string; context: RequestContext }): Promise<AuthorizedResource[]> {
    const result: AuthorizedResource[] = [];
    for (const resource of this.resources.values()) {
      const decision = await this.authorize({ subject: request.subject, operation: 'discover', resource, purpose: request.purpose, context: request.context });
      if (decision.effect === 'allow') result.push({ ref: { id: resource.id, version: resource.version }, visibility: 'listed', capabilities: [] });
    }
    return result;
  }

  async project(request: { subject: Subject; goal?: string; context: RequestContext }): Promise<AuthorizedView> {
    const projected: AuthorizedResource[] = [];
    for (const resource of this.resources.values()) {
      const discover = await this.authorize({ subject: request.subject, operation: 'discover', resource, purpose: request.context.purpose, context: request.context });
      if (discover.effect !== 'allow') continue;
      let visibility: Visibility = 'listed';
      let schema: JsonSchema | undefined;
      for (const operation of ['inspect', 'read'] as Operation[]) {
        const decision = await this.authorize({ subject: request.subject, operation, resource, purpose: request.context.purpose, context: request.context });
        if (decision.effect === 'allow') { visibility = operationForVisibility(operation); schema = resource.schema; }
      }
      const authorizedCapabilities: AuthorizedCapability[] = [];
      for (const capability of this.capabilities.values()) {
        const decision = await this.authorize({ subject: request.subject, operation: 'execute', resource: capability, purpose: request.context.purpose, context: request.context });
        if (decision.effect === 'allow') authorizedCapabilities.push({ id: capability.id, operation: capability.operation, inputSchema: capability.inputSchema, outputSchema: capability.outputSchema, risk: capability.risk, sideEffects: capability.sideEffects, obligations: [...(decision.obligations ?? [])] });
      }
      projected.push({ ref: { id: resource.id, version: resource.version }, visibility, schema, capabilities: authorizedCapabilities });
    }
    return { viewId: randomUUID(), subjectId: request.subject.id, goal: request.goal, generatedAt: new Date().toISOString(), policyVersion: this.policy.version(), resources: projected, globalObligations: [] };
  }

  async read(request: { subject: Subject; resource: string; query?: Record<string, unknown>; fields?: string[]; scope?: Scope; purpose?: string; context: RequestContext }): Promise<{ items: unknown[]; nextCursor?: string; receiptId: string }> {
    const resource = this.resources.get(request.resource);
    if (!resource || !resource.read) throw new Error('CUP_RESOURCE_NOT_READABLE');
    const decision = await this.authorize({ subject: request.subject, operation: 'read', resource, scope: request.scope, purpose: request.purpose, context: request.context });
    if (decision.effect !== 'allow') throw new Error(`CUP_NOT_AUTHORIZED:${decision.reasonCode}`);
    const rawValues = await resource.read({ subject: request.subject, query: request.query, fields: request.fields, scope: request.scope, context: request.context });
    const values = redactValues(rawValues, decision.obligations);
    const receipt = await this.record({ status: 'succeeded', actor: request.subject, capability: resource.id, inputHash: hashInput({ query: request.query, fields: request.fields, scope: request.scope }), decision });
    return { items: values, receiptId: receipt.id };
  }

  async prepare(request: { subject: Subject; capability: string; input: unknown; purpose?: string; context: RequestContext }): Promise<{ request: ExecutionRequest; inputHash: string; preview: { capability: string; input: unknown; sideEffects: string[] }; obligations: Obligation[] }> {
    const capability = this.capabilities.get(request.capability);
    if (!capability) throw new Error('CUP_CAPABILITY_NOT_FOUND');
    const inputHash = hashInput(request.input);
    const decision = await this.authorize({ subject: request.subject, operation: 'execute', resource: capability, proposedInput: request.input, purpose: request.purpose, context: request.context });
    if (decision.effect !== 'allow') throw new Error(`CUP_NOT_AUTHORIZED:${decision.reasonCode}`);
    return { request: { ...request, operation: 'execute', resource: capability, capability: capability.id, input: request.input }, inputHash, preview: { capability: capability.id, input: request.input, sideEffects: capability.sideEffects }, obligations: decision.obligations };
  }

  async execute(request: ExecutionRequest): Promise<Receipt> {
    const capability = this.capabilities.get(request.capability);
    const inputHash = hashInput(request.input);
    if (!capability) return this.record({ status: 'denied', actor: request.subject, capability: request.capability, inputHash, decision: await this.authorize({ ...request, operation: 'execute', resource: { id: request.capability } }) });
    const decision = await this.authorize({ ...request, operation: 'execute', resource: capability, proposedInput: request.input });
    if (decision.effect !== 'allow') return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision });
    if (capability.confirmation !== 'none' && (!request.confirmation || request.confirmation.inputHash !== inputHash || request.confirmation.confirmedBy !== request.subject.id)) {
      return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision: { ...decision, effect: 'deny', reasonCode: 'CONFIRMATION_REQUIRED' } });
    }
    try {
      const result = await capability.handler(request.input, { ...request.context, requestId: decision.requestId, idempotencyKey: request.idempotencyKey });
      return this.record({ status: 'succeeded', actor: request.subject, capability: capability.id, inputHash, decision, resultSummary: result });
    } catch (error) {
      return this.record({ status: 'failed', actor: request.subject, capability: capability.id, inputHash, decision: { ...decision, reasonCode: 'HANDLER_FAILED' }, resultSummary: { error: error instanceof Error ? error.message : 'unknown error' } });
    }
  }

  async delegate(request: { from: Subject; to: Subject; capability: string; operations: Operation[]; scope?: Scope; purpose?: string; expiresInMs: number }): Promise<DelegationGrant> {
    const capability = this.resources.get(request.capability);
    if (!capability) throw new Error('CUP_RESOURCE_NOT_FOUND');
    const decision = await this.authorize({ subject: request.from, operation: 'delegate', resource: capability, context: { purpose: request.purpose } });
    if (decision.effect !== 'allow') throw new Error(`CUP_NOT_AUTHORIZED:${decision.reasonCode}`);
    return { id: randomUUID(), from: request.from, to: request.to, capability: request.capability, operations: request.operations, scope: request.scope, purpose: request.purpose, expiresAt: new Date(Date.now() + request.expiresInMs).toISOString() };
  }

  private async record(input: Omit<Receipt, 'id' | 'createdAt'>): Promise<Receipt> {
    const receipt: Receipt = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.receipts.append(receipt);
    return receipt;
  }
}

export function subject(id: string, attributes: Record<string, unknown> = {}): Subject {
  return { id, type: id.startsWith('agent:') ? 'agent' : 'user', authenticated: true, attributes };
}

export function resource(id: string, version = '1.0'): ResourceRef { return { id, version }; }
export function defineCapability(config: Omit<Capability, 'type'>): Capability {
  return { ...config, type: 'capability' };
}

export function capability(id: string): ResourceRef { return { id }; }
export function inMemoryReceipts(): MemoryReceiptSink { return new MemoryReceiptSink(); }
