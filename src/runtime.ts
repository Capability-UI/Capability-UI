import { createHash, randomUUID } from 'node:crypto';

export type Operation = 'discover' | 'inspect' | 'read' | 'create' | 'update' | 'delete' | 'execute' | 'share' | 'delegate';
export type ResourceType = 'data' | 'capability' | 'workflow' | 'view' | 'agent';
export type Risk = 'low' | 'medium' | 'high' | 'critical';
export type Effect = 'allow' | 'deny';
export type Visibility = 'hidden' | 'listed' | 'inspectable' | 'readable' | 'usable';
export type JsonSchema = Record<string, unknown>;
export type SideEffect = string;
export type ResourceRef = { id: string; version?: string };
export type Scope = Record<string, unknown>;
export type RequestContext = Scope & { purpose?: string; channel?: string; now?: Date };

export interface Subject { id: string; type: 'user' | 'agent' | 'service' | 'group'; authenticated: boolean; attributes: Record<string, unknown>; }
export type PrincipalSelector = { id: string } | { role: string } | { type: Subject['type'] } | { any: true };
export type Condition = (request: AuthorizationRequest) => boolean;
export type TimeWindow = { startsAt?: string; endsAt?: string };
export type ResourceSelector = ResourceRef | { ids: string[] };
export type ScopeExpression = Scope;
export type FieldFilter = FieldPermission[];
export type Obligation = { type: 'redact'; fields: string[] } | { type: 'require_confirmation'; mode: ConfirmationMode } | { type: 'preview_changes' } | { type: 'write_receipt' } | { type: 'human_review' };
export type ConfirmationMode = 'none' | 'preview' | 'explicit' | 'human_review';
export type Clock = () => Date;
export type NonceProvider = () => string;

export interface Resource {
  id: string; type: ResourceType; version: string;
  sensitivity: 'public' | 'personal' | 'confidential' | 'restricted';
  schema: JsonSchema; owner?: string; metadata?: Record<string, unknown>;
  read?: (request: { subject: Subject; query?: Record<string, unknown>; fields?: string[]; scope?: Scope; context: RequestContext }) => Promise<unknown[]>;
}
export interface Capability extends Resource {
  type: 'capability'; operation: Operation; inputSchema: JsonSchema; outputSchema: JsonSchema;
  sideEffects: string[]; risk: Risk; confirmation: ConfirmationMode;
  idempotency: 'none' | 'supported' | 'required'; reversibility: 'reversible' | 'partially_reversible' | 'irreversible';
  reverseCapability?: string;
  handler: (input: unknown, context: ExecutionContext) => Promise<unknown>;
}
export interface Policy {
  id: string; effect: Effect; principal: PrincipalSelector; operation: Operation | Operation[]; resource: ResourceRef;
  scope?: Scope; conditions?: Condition[]; obligations?: Obligation[]; priority: number; expiresAt?: string; validDuring?: TimeWindow; version?: string;
}
export type PolicyInput = Omit<Policy, 'effect'>;
export interface AuthorizationRequest { requestId?: string; subject: Subject; operation: Operation; resource: ResourceRef; scope?: Scope; proposedInput?: unknown; purpose?: string; context: RequestContext; }
export interface Decision { requestId: string; effect: Effect; reasonCode: string; matchedPolicies: string[]; obligations: Obligation[]; policyVersion: string; expiresAt?: string; fieldFilter?: FieldFilter; }
export interface FieldPermission { path: string; readable: boolean; writable?: boolean; }
export interface AuthorizedCapability { id: string; operation: Operation; inputSchema: JsonSchema; outputSchema: JsonSchema; risk: Risk; sideEffects: string[]; confirmation: ConfirmationMode; reversibility?: Capability['reversibility']; obligations: Obligation[]; actionToken?: string; }
export interface AuthorizedResource { ref: ResourceRef; visibility: Visibility; schema?: JsonSchema; data?: unknown; fields?: FieldPermission[]; capabilities: AuthorizedCapability[]; }
export interface AuthorizedView { viewId: string; subjectId: string; goal?: string; purpose?: string; generatedAt: string; policyVersion: string; resources: AuthorizedResource[]; capabilities: AuthorizedCapability[]; globalObligations: Obligation[]; }
export interface Confirmation { inputHash: string; confirmedBy: string; }
export interface ExecutionContext extends RequestContext { requestId: string; idempotencyKey?: string; }
export interface ExecutionRequest extends Omit<AuthorizationRequest, 'operation' | 'resource'> { operation?: Operation; resource?: ResourceRef; capability: string; input: unknown; actionToken?: string; confirmation?: Confirmation; idempotencyKey?: string; delegation?: DelegationGrant; }
export interface Receipt { id: string; status: 'succeeded' | 'failed' | 'denied' | 'pending'; actor: { id: string; type: Subject['type'] }; capability: string; resourceRefs?: ResourceRef[]; inputHash: string; decision: Decision; confirmation?: Confirmation; resultSummary?: unknown; reversibleBy?: string; createdAt: string; }
export interface DelegationGrant { id: string; from: Subject; to: Subject; capability: string; operations: Operation[]; scope?: Scope; purpose?: string; expiresAt: string; }
export interface ExecutionAdapter { capabilityId: string; invoke(input: unknown, context: ExecutionContext): Promise<unknown>; }
export interface ResourceAdapter { resourceId: string; read(request: { subject: Subject; query?: Record<string, unknown>; fields?: string[]; scope?: Scope; context: RequestContext }): Promise<unknown[]>; }
export interface ReceiptQuery { requestId?: string; actorId?: string; capability?: string; status?: Receipt['status']; }
export interface ReceiptSink { append(receipt: Receipt): Promise<void>; all(): Receipt[]; find?(query: ReceiptQuery): Receipt[]; }

export class MemoryReceiptSink implements ReceiptSink { private readonly entries: Receipt[] = []; async append(receipt: Receipt) { this.entries.push(receipt); } all() { return [...this.entries]; } find(query: ReceiptQuery) { return this.entries.filter(r => (!query.requestId || r.decision.requestId === query.requestId) && (!query.actorId || r.actor.id === query.actorId) && (!query.capability || r.capability === query.capability) && (!query.status || r.status === query.status)); } }

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonicalize(v)]));
  if (typeof value === 'bigint') return `${value}n`;
  if (value === undefined) return '__undefined__';
  if (value instanceof Date) return value.toISOString();
  return value;
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex'); }
function matchesScope(required: Scope | undefined, actual: Scope | undefined): boolean { return !required || (!!actual && Object.entries(required).every(([key, value]) => actual[key] === value)); }
function matchesPrincipal(selector: PrincipalSelector, subject: Subject): boolean {
  if ('any' in selector) return selector.any;
  if ('id' in selector) return selector.id === subject.id;
  if ('type' in selector) return selector.type === subject.type;
  return selector.role === subject.attributes.role;
}
function redactValue(value: unknown, paths: string[]): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => redactValue(item, paths));
  const root = value as Record<string, unknown>;
  const output: Record<string, unknown> = { ...root };
  for (const path of paths) {
    const [head, ...tail] = path.split('.');
    if (!head) continue;
    if (tail.length === 0) delete output[head];
    else if (head in output) output[head] = redactPath(output[head], tail);
  }
  return output;
}
function redactPath(value: unknown, path: string[]): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => redactPath(item, path));
  const output: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  const [head, ...tail] = path;
  if (head && head in output) { if (!tail.length) delete output[head]; else output[head] = redactPath(output[head], tail); }
  return output;
}
function validateSchema(value: unknown, schema: JsonSchema, path = '$'): string[] {
  const errors: string[] = []; const type = schema.type as string | undefined;
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (type && type !== actual && !(type === 'integer' && actual === 'number' && Number.isInteger(value))) errors.push(`${path}: expected ${type}, got ${actual}`);
  if (Array.isArray(schema.required) && value && typeof value === 'object') for (const key of schema.required as string[]) if (!(key in (value as object))) errors.push(`${path}.${key}: required`);
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) for (const [key, child] of Object.entries(schema.properties as Record<string, JsonSchema>)) if (key in (value as object)) errors.push(...validateSchema((value as Record<string, unknown>)[key], child, `${path}.${key}`));
  if (schema.items && Array.isArray(value)) value.forEach((item, i) => errors.push(...validateSchema(item, schema.items as JsonSchema, `${path}[${i}]`)));
  return errors;
}
function obligationsOf(policies: Policy[]): Obligation[] { return policies.flatMap(policy => policy.obligations ?? []); }

export class PolicyStore {
  private readonly rules: Policy[] = []; private revision = 0;
  allow(input: PolicyInput): void { this.rules.push({ ...input, effect: 'allow' }); this.revision++; }
  deny(input: PolicyInput): void { this.rules.push({ ...input, effect: 'deny' }); this.revision++; }
  version(): string { return `policy-${this.revision}`; }
  matching(request: AuthorizationRequest): Policy[] {
    const now = request.context.now ?? new Date();
    return this.rules.filter(rule => {
      const ops = Array.isArray(rule.operation) ? rule.operation : [rule.operation];
      const windowOpen = !rule.validDuring || (!rule.validDuring.startsAt || new Date(rule.validDuring.startsAt) <= now) && (!rule.validDuring.endsAt || new Date(rule.validDuring.endsAt) > now);
      return ops.includes(request.operation) && rule.resource.id === request.resource.id && matchesPrincipal(rule.principal, request.subject) && matchesScope(rule.scope, request.scope) && (!rule.expiresAt || new Date(rule.expiresAt) > now) && windowOpen && (!rule.conditions || rule.conditions.every(condition => condition(request)));
    }).sort((a, b) => b.priority - a.priority);
  }
}

export class CapabilityUI {
  readonly policy = new PolicyStore(); readonly receipts: ReceiptSink;
  private readonly clock: Clock; private readonly nonce: NonceProvider;
  private readonly resources = new Map<string, Resource>(); private readonly capabilities = new Map<string, Capability>();
  private readonly delegations = new Map<string, DelegationGrant>(); private readonly prepared = new Map<string, Decision>();
  private readonly listeners = new Map<string, Set<(event: ResourceEvent) => void>>();
  private readonly actionTokens = new Map<string, { capability: string; subjectId: string; policyVersion: string; audience: string; expiresAt: number }>();
  private readonly idempotency = new Map<string, Receipt>();
  constructor(options: ReceiptSink | { receipts?: ReceiptSink; clock?: Clock; nonce?: NonceProvider } = {}) {
    if ('append' in options) { this.receipts = options; this.clock = () => new Date(); this.nonce = randomUUID; }
    else { this.receipts = options.receipts ?? new MemoryReceiptSink(); this.clock = options.clock ?? (() => new Date()); this.nonce = options.nonce ?? randomUUID; }
  }
  register(resource: Resource | Capability): void { this.resources.set(resource.id, resource); if (resource.type === 'capability' && 'handler' in resource) this.capabilities.set(resource.id, resource); }
  registerAdapter(adapter: ResourceAdapter | ExecutionAdapter): void {
    const id = 'resourceId' in adapter ? adapter.resourceId : adapter.capabilityId;
    const resource = this.resources.get(id); if (!resource) throw new Error('CUP_RESOURCE_NOT_FOUND');
    if ('read' in adapter) resource.read = adapter.read.bind(adapter);
    else if ('invoke' in adapter && resource.type === 'capability' && 'handler' in resource) resource.handler = adapter.invoke.bind(adapter);
  }
  async authorize(request: AuthorizationRequest): Promise<Decision> {
    const requestId = request.requestId ?? this.nonce();
    const validOperations: Operation[] = ['discover', 'inspect', 'read', 'create', 'update', 'delete', 'execute', 'share', 'delegate'];
    if (!validOperations.includes(request.operation)) return { requestId, effect: 'deny', reasonCode: 'UNKNOWN_OPERATION', matchedPolicies: [], obligations: [], policyVersion: this.policy.version() };
    if (!request.subject.authenticated && request.operation !== 'discover') return { requestId, effect: 'deny', reasonCode: 'SUBJECT_NOT_AUTHENTICATED', matchedPolicies: [], obligations: [], policyVersion: this.policy.version() };
    const matched = this.policy.matching(request); const priority = matched[0]?.priority;
    const effective = priority === undefined ? [] : matched.filter(rule => rule.priority === priority);
    const denied = effective.some(rule => rule.effect === 'deny'); const allowed = effective.some(rule => rule.effect === 'allow');
    return { requestId, effect: denied ? 'deny' : allowed ? 'allow' : 'deny', reasonCode: denied ? 'EXPLICIT_DENY' : allowed ? 'ALLOWED' : 'NO_MATCHING_ALLOW', matchedPolicies: effective.map(rule => rule.id), obligations: obligationsOf(effective), policyVersion: this.policy.version(), expiresAt: effective.find(rule => rule.expiresAt)?.expiresAt };
  }
  async discover(request: { subject: Subject; purpose?: string; context: RequestContext }): Promise<AuthorizedResource[]> {
    const output: AuthorizedResource[] = [];
    for (const resource of this.resources.values()) { const d = await this.authorize({ subject: request.subject, operation: 'discover', resource, purpose: request.purpose, context: request.context }); if (d.effect === 'allow') output.push({ ref: { id: resource.id, version: resource.version }, visibility: 'listed', capabilities: [] }); }
    return output;
  }
  async project(request: { subject: Subject; goal?: string; context: RequestContext }): Promise<AuthorizedView> {
    const resources: AuthorizedResource[] = []; const capabilities: AuthorizedCapability[] = [];
    for (const resource of this.resources.values()) {
      const discover = await this.authorize({ subject: request.subject, operation: 'discover', resource, purpose: request.context.purpose, context: request.context }); if (discover.effect !== 'allow') continue;
      let visibility: Visibility = 'listed'; let schema: JsonSchema | undefined;
      const inspect = await this.authorize({ subject: request.subject, operation: 'inspect', resource, purpose: request.context.purpose, context: request.context }); if (inspect.effect === 'allow') { visibility = 'inspectable'; schema = resource.schema; }
      const read = await this.authorize({ subject: request.subject, operation: 'read', resource, purpose: request.context.purpose, context: request.context }); const fields = read.effect === 'allow' ? read.obligations.filter(obligation => obligation.type === 'redact').flatMap(obligation => obligation.fields).map(path => ({ path, readable: false, writable: false })) : undefined; if (read.effect === 'allow') { visibility = 'readable'; schema = resource.schema; }
      resources.push({ ref: { id: resource.id, version: resource.version }, visibility, schema, fields, capabilities: [] });
    }
    for (const capability of this.capabilities.values()) { const d = await this.authorize({ subject: request.subject, operation: 'execute', resource: capability, purpose: request.context.purpose, context: request.context }); if (d.effect === 'allow') { const actionToken = this.nonce(); const audience = request.context.channel ?? 'default'; this.actionTokens.set(actionToken, { capability: capability.id, subjectId: request.subject.id, policyVersion: d.policyVersion, audience, expiresAt: this.clock().getTime() + 5 * 60_000 }); const authorized = { id: capability.id, operation: capability.operation, inputSchema: capability.inputSchema, outputSchema: capability.outputSchema, risk: capability.risk, sideEffects: capability.sideEffects, confirmation: capability.confirmation, reversibility: capability.reversibility, obligations: d.obligations, actionToken }; capabilities.push(authorized); const parent = resources.find(resource => resource.ref.id === capability.id); if (parent) parent.capabilities.push(authorized); } }
    return { viewId: this.nonce(), subjectId: request.subject.id, goal: request.goal, purpose: request.context.purpose, generatedAt: this.clock().toISOString(), policyVersion: this.policy.version(), resources, capabilities, globalObligations: [] };
  }
  async read(request: { subject: Subject; resource: string; query?: Record<string, unknown>; fields?: string[]; scope?: Scope; purpose?: string; context: RequestContext }): Promise<{ items: unknown[]; receiptId: string }> {
    const resource = this.resources.get(request.resource); if (!resource?.read) throw new Error('CUP_RESOURCE_NOT_READABLE');
    const decision = await this.authorize({ subject: request.subject, operation: 'read', resource, scope: request.scope, purpose: request.purpose, context: request.context }); if (decision.effect !== 'allow') throw new Error(`CUP_NOT_AUTHORIZED:${decision.reasonCode}`);
    const raw = await resource.read({ subject: request.subject, query: request.query, fields: request.fields, scope: request.scope, context: request.context });
    const fields = decision.obligations.filter(o => o.type === 'redact').flatMap(o => o.fields); const items = raw.map(item => redactValue(item, fields));
    const receipt = await this.record({ status: 'succeeded', actor: request.subject, capability: resource.id, inputHash: hash({ query: request.query, fields: request.fields, scope: request.scope }), decision }); return { items, receiptId: receipt.id };
  }
  async prepare(request: { subject: Subject; capability: string; input: unknown; scope?: Scope; purpose?: string; context: RequestContext }): Promise<{ request: ExecutionRequest; inputHash: string; preview: { capability: string; input: unknown; sideEffects: string[] }; obligations: Obligation[] }> {
    const capability = this.capabilities.get(request.capability); if (!capability) throw new Error('CUP_CAPABILITY_NOT_FOUND');
    const errors = validateSchema(request.input, capability.inputSchema); if (errors.length) throw new Error(`CUP_INVALID_INPUT:${errors.join(';')}`);
    const inputHash = hash(request.input); const decision = await this.authorize({ ...request, operation: 'execute', resource: capability, proposedInput: request.input }); if (decision.effect !== 'allow') throw new Error(`CUP_NOT_AUTHORIZED:${decision.reasonCode}`);
    this.prepared.set(decision.requestId, decision); return { request: { ...request, requestId: decision.requestId, operation: 'execute', resource: capability }, inputHash, preview: { capability: capability.id, input: request.input, sideEffects: capability.sideEffects }, obligations: decision.obligations };
  }
  async execute(request: ExecutionRequest): Promise<Receipt> {
    const capability = this.capabilities.get(request.capability); const inputHash = hash(request.input);
    if (!capability) return this.record({ status: 'denied', actor: request.subject, capability: request.capability, inputHash, decision: await this.authorize({ ...request, operation: 'execute', resource: { id: request.capability } }) });
    if (capability.idempotency === 'required' && !request.idempotencyKey) return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision: this.denial(request, 'IDEMPOTENCY_KEY_REQUIRED') });
    if (request.actionToken) { const token = this.actionTokens.get(request.actionToken); if (!token || token.capability !== capability.id || token.subjectId !== request.subject.id || token.audience !== (request.context.channel ?? 'default') || token.policyVersion !== this.policy.version() || token.expiresAt <= this.clock().getTime()) return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision: this.denial(request, 'INVALID_ACTION_TOKEN') }); }
    if (request.idempotencyKey) { const key = `${request.subject.id}:${capability.id}:${request.idempotencyKey}`; const prior = this.idempotency.get(key); if (prior) return prior; }
    const delegated = !!request.delegation;
    if (delegated && !this.validDelegation(request.delegation!, request)) return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision: this.denial(request, 'INVALID_DELEGATION') });
    if (request.requestId && this.prepared.has(request.requestId) && this.prepared.get(request.requestId)?.policyVersion !== this.policy.version()) return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision: this.denial(request, 'PREPARED_DECISION_STALE') });
    const errors = validateSchema(request.input, capability.inputSchema); if (errors.length) return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision: this.denial(request, 'INVALID_INPUT') });
    let decision = await this.authorize({ ...request, operation: 'execute', resource: capability, proposedInput: request.input });
    if (decision.effect !== 'allow' && delegated && decision.reasonCode === 'NO_MATCHING_ALLOW') decision = { ...decision, effect: 'allow', reasonCode: 'DELEGATED_ALLOW', matchedPolicies: [`delegation:${request.delegation!.id}`] };
    if (decision.effect !== 'allow') return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision });
    const requiresConfirmation = capability.confirmation !== 'none' || decision.obligations.some(obligation => obligation.type === 'preview_changes' || obligation.type === 'human_review' || obligation.type === 'require_confirmation');
    if (requiresConfirmation && (!request.confirmation || request.confirmation.inputHash !== inputHash || request.confirmation.confirmedBy !== request.subject.id)) return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision: { ...decision, effect: 'deny', reasonCode: 'CONFIRMATION_REQUIRED' }, confirmation: request.confirmation });
    try { const result = await capability.handler(request.input, { ...request.context, requestId: decision.requestId, idempotencyKey: request.idempotencyKey }); const receipt = await this.record({ status: 'succeeded', actor: request.subject, capability: capability.id, inputHash, decision, reversibleBy: capability.reversibility !== 'irreversible' ? capability.reverseCapability : undefined, resultSummary: result }); if (request.idempotencyKey) this.idempotency.set(`${request.subject.id}:${capability.id}:${request.idempotencyKey}`, receipt); return receipt; }
    catch (error) { return this.record({ status: 'failed', actor: request.subject, capability: capability.id, inputHash, decision: { ...decision, reasonCode: 'HANDLER_FAILED' }, resultSummary: { error: error instanceof Error ? error.message : 'unknown error' } }); }
  }
  async delegate(request: { from: Subject; to: Subject; capability: string; operations: Operation[]; scope?: Scope; purpose?: string; expiresInMs: number }): Promise<DelegationGrant> {
    const resource = this.resources.get(request.capability); if (!resource) throw new Error('CUP_RESOURCE_NOT_FOUND'); const d = await this.authorize({ subject: request.from, operation: 'delegate', resource, purpose: request.purpose, scope: request.scope, context: { purpose: request.purpose } }); if (d.effect !== 'allow') throw new Error(`CUP_NOT_AUTHORIZED:${d.reasonCode}`);
    const grant: DelegationGrant = { id: this.nonce(), from: request.from, to: request.to, capability: request.capability, operations: request.operations, scope: request.scope, purpose: request.purpose, expiresAt: new Date(this.clock().getTime() + request.expiresInMs).toISOString() }; this.delegations.set(grant.id, grant); return grant;
  }
  /** Revoke a delegation grant. Any subsequent execute() using the grant will be denied. */
  revokeGrant(grantId: string): void { this.delegations.delete(grantId); }
  async reverse(receiptId: string, request: Omit<ExecutionRequest, 'capability' | 'input'> & { capability?: string }): Promise<Receipt> {
    const original = this.receipts.all().find(receipt => receipt.id === receiptId);
    if (!original?.reversibleBy) return this.record({ status: 'denied', actor: request.subject, capability: request.capability ?? 'unknown', inputHash: hash({ receiptId }), decision: this.denial({ ...request, capability: request.capability ?? 'unknown', input: { receiptId } }, 'RECEIPT_NOT_REVERSIBLE') });
    return this.execute({ ...request, capability: request.capability ?? original.reversibleBy, input: { receiptId, original: original.resultSummary }, context: { ...request.context, purpose: request.purpose ?? 'reverse' } });
  }
  confirm(token: string, input: unknown, subjectId: string): Confirmation { const action = this.actionTokens.get(token); if (!action || action.subjectId !== subjectId || action.expiresAt <= this.clock().getTime()) throw new Error('INVALID_ACTION_TOKEN'); return { inputHash: hash(input), confirmedBy: subjectId }; }
  async subscribe(request: { subject: Subject; resource: string; events: string[]; context: RequestContext }): Promise<Subscription> {
    const resource = this.resources.get(request.resource); if (!resource) throw new Error('CUP_RESOURCE_NOT_FOUND');
    const decision = await this.authorize({ subject: request.subject, operation: 'read', resource, context: request.context });
    if (decision.effect !== 'allow') throw new Error(`CUP_NOT_AUTHORIZED:${decision.reasonCode}`);
    const set = this.listeners.get(request.resource) ?? new Set<(event: ResourceEvent) => void>(); this.listeners.set(request.resource, set);
    const callbacks = new Set<(event: ResourceEvent) => void>();
    return {
      on: (event, callback) => { if (event === 'event' || event === 'access_removed') { callbacks.add(callback); set.add(callback); } },
      close: () => { for (const callback of callbacks) set.delete(callback); if (set.size === 0) this.listeners.delete(request.resource); }
    };
  }
  publish(event: ResourceEvent): void { for (const listener of this.listeners.get(event.resource.id) ?? []) listener(event); }
  private validDelegation(grant: DelegationGrant, request: ExecutionRequest): boolean { return this.delegations.get(grant.id) === grant && grant.to.id === request.subject.id && grant.capability === request.capability && grant.operations.includes('execute') && new Date(grant.expiresAt) > this.clock() && (!grant.purpose || grant.purpose === request.purpose) && matchesScope(grant.scope, request.scope); }
  private denial(request: ExecutionRequest, reasonCode: string): Decision { return { requestId: request.requestId ?? this.nonce(), effect: 'deny', reasonCode, matchedPolicies: [], obligations: [], policyVersion: this.policy.version() }; }
  private async record(input: Omit<Receipt, 'id' | 'createdAt'>): Promise<Receipt> { const receipt = { ...input, id: this.nonce(), createdAt: this.clock().toISOString() }; await this.receipts.append(receipt); return receipt; }
}

export interface ResourceEvent { resource: ResourceRef; type: string; data?: unknown; }
export interface Subscription { on(event: 'event' | 'access_removed', callback: (event: ResourceEvent) => void): void; close(): void; }
export interface IdentityAdapter { resolve(request: unknown): Promise<Subject> | Subject; }
export interface PolicyAdapter { authorize(request: AuthorizationRequest): Promise<Decision> | Decision; policyVersion(): string; }
export interface CapabilityAdapter { capabilityId: string; invoke(input: unknown, context: ExecutionContext): Promise<unknown>; }
export interface RendererAdapter<T> { render(view: AuthorizedView, target: T): unknown; }
export interface CapabilityUIOptions { registry?: Array<Resource | Capability>; receipts?: ReceiptSink; clock?: Clock; nonce?: NonceProvider; }
export function createCapabilityUI(options: CapabilityUIOptions = {}): CapabilityUI { const cup = new CapabilityUI(options); for (const item of options.registry ?? []) cup.register(item); return cup; }
/** Convenience: creates a CapabilityUI and documents that the policy starts closed. Use this at the top of host setup to make the deny-by-default guarantee explicit. */
export function denyByDefault(options: CapabilityUIOptions = {}): CapabilityUI { return createCapabilityUI(options); }
export function verifyActionToken(view: AuthorizedView, token: string): AuthorizedCapability | undefined { return view.capabilities.find(capability => capability.actionToken === token); }
export function canonicalInputHash(input: unknown): string { return hash(input); }
export function subject(id: string, attributes: Record<string, unknown> = {}, authenticated = true): Subject { return { id, type: id.startsWith('agent:') ? 'agent' : 'user', authenticated, attributes }; }
export function resource(id: string, version = '1.0'): ResourceRef { return { id, version }; }
export function capability(id: string): ResourceRef { return { id }; }
export function defineCapability(config: Omit<Capability, 'type'>): Capability { return { ...config, type: 'capability' }; }
export function inMemoryReceipts(): MemoryReceiptSink { return new MemoryReceiptSink(); }
export const conditions = {
  subjectIs: (id: string): Condition => request => request.subject.id === id,
  roleIs: (role: string): Condition => request => request.subject.attributes.role === role,
  ownerIsSubject: (owner: string): Condition => request => owner === request.subject.id,
  resourceInWorkspace: (workspace: string): Condition => request => request.scope?.workspace === workspace || request.context.workspace === workspace || request.context.workspaceId === workspace,
  fieldsWithin: (fields: string[]): Condition => request => { const requested = (request.context.fields ?? request.scope?.fields) as unknown; return Array.isArray(requested) && requested.every(field => fields.includes(String(field))); },
  purposeIs: (purpose: string): Condition => request => request.purpose === purpose,
  approvalPresent: (approval: string): Condition => request => request.context.approval === approval || request.context.approvalId === approval,
  timeBetween: (startHour: number, endHour: number): Condition => request => { const hour = (request.context.now ?? new Date()).getUTCHours(); return hour >= startHour && hour < endHour; },
  deviceTrustAtLeast: (level: number): Condition => request => Number(request.context.deviceTrust ?? 0) >= level,
  mfaRecent: (maxAgeMs: number): Condition => request => Number(request.context.mfaAgeMs ?? Number.POSITIVE_INFINITY) <= maxAgeMs,
  recipientCountAtMost: (max: number): Condition => request => Array.isArray((request.proposedInput as Record<string, unknown> | undefined)?.recipients) && ((request.proposedInput as Record<string, unknown>).recipients as unknown[]).length <= max,
  amountAtMost: (max: number): Condition => request => Number((request.proposedInput as Record<string, unknown> | undefined)?.amount ?? Number.POSITIVE_INFINITY) <= max,
  domainIs: (domain: string): Condition => request => (request.proposedInput as Record<string, unknown> | undefined)?.domain === domain,
  queryContainsNoSecrets: (patterns: string[] = ['password', 'token', 'secret']): Condition => request => { const value = JSON.stringify(request.proposedInput ?? request.context).toLowerCase(); return patterns.every(pattern => !value.includes(pattern.toLowerCase())); },
  inputFieldEquals: (field: string, expected: unknown): Condition => request => (request.proposedInput as Record<string, unknown> | undefined)?.[field] === expected,
};

export const requireConfirmation = (mode: ConfirmationMode = 'explicit'): Obligation => ({ type: 'require_confirmation', mode });
export const writeReceipt = (): Obligation => ({ type: 'write_receipt' });
export const redact = (fields: string[]): Obligation => ({ type: 'redact', fields });
export const previewChanges = (): Obligation => ({ type: 'preview_changes' });
export const requireHumanReview = (): Obligation => ({ type: 'human_review' });

export interface MCPRequest { jsonrpc: '2.0'; id?: string | number; method: string; params?: Record<string, unknown>; }
export interface MCPResponse { jsonrpc: '2.0'; id?: string | number; result?: unknown; error?: { code: number; message: string }; }
export interface MCPPrompt { name: string; description?: string; arguments?: Array<{ name: string; required?: boolean }>; get: (args: Record<string, unknown>, subject: Subject) => Promise<unknown> | unknown; }
export interface MCPSession { id: string; subject: Subject; purpose?: string; transport: 'stdio' | 'streamable_http'; policyVersion: string; createdAt: string; expiresAt: string; }
export function createMCPServer(options: { cup: CapabilityUI; name: string; authenticate?: (request: MCPRequest) => Promise<Subject> | Subject; prompts?: MCPPrompt[] }) {
  const { cup } = options;
  return { async handle(request: MCPRequest): Promise<MCPResponse> {
    try {
      const params = request.params ?? {}; const subjectValue = options.authenticate ? await options.authenticate(request) : subject('service:mcp'); const context = (params.context as RequestContext | undefined) ?? {};
      const session: MCPSession = { id: randomUUID(), subject: subjectValue, purpose: context.purpose, transport: context.channel === 'stdio' ? 'stdio' : 'streamable_http', policyVersion: cup.policy.version(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() };
      if (request.method === 'initialize') return { jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: options.name, version: '0.2.0' }, capabilities: { resources: { subscribe: true }, tools: {}, prompts: { listChanged: false } }, _cup: { session } } };
      if (request.method === 'resources/list') return { jsonrpc: '2.0', id: request.id, result: { resources: await cup.discover({ subject: subjectValue, purpose: context.purpose, context }) } };
      if (request.method === 'resources/read') { const uri = String(params.uri ?? ''); const id = uri.replace(/^cup:\/\//, ''); return { jsonrpc: '2.0', id: request.id, result: await cup.read({ subject: subjectValue, resource: id, purpose: context.purpose, context }) }; }
      if (request.method === 'resources/templates/list') {
        // Returns inspectable resources as URI templates so clients can parameterize reads.
        const view = await cup.project({ subject: subjectValue, context });
        const templates = view.resources.filter(r => r.visibility === 'inspectable' || r.visibility === 'readable' || r.visibility === 'usable').map(r => ({ uriTemplate: `cup://${r.ref.id}`, name: r.ref.id, schema: r.schema }));
        return { jsonrpc: '2.0', id: request.id, result: { resourceTemplates: templates } };
      }
      if (request.method === 'tools/list') { const view = await cup.project({ subject: subjectValue, goal: String(params.goal ?? ''), context }); return { jsonrpc: '2.0', id: request.id, result: { tools: view.capabilities.map(c => ({ name: c.id, description: `${c.id} (${c.risk} risk)`, inputSchema: c.inputSchema, _cup: c })) } }; }
      if (request.method === 'tools/call') { const name = String(params.name ?? ''); const args = params.arguments ?? {}; const receipt = await cup.execute({ subject: subjectValue, capability: name, input: args, purpose: context.purpose, context }); return { jsonrpc: '2.0', id: request.id, result: { isError: receipt.status !== 'succeeded', content: [{ type: 'text', text: JSON.stringify(receipt) }] } }; }
      if (request.method === 'prompts/list') return { jsonrpc: '2.0', id: request.id, result: { prompts: (options.prompts ?? []).map(prompt => ({ name: prompt.name, description: prompt.description, arguments: prompt.arguments })) } };
      if (request.method === 'prompts/get') { const prompt = (options.prompts ?? []).find(item => item.name === String(params.name ?? '')); if (!prompt) return { jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'Prompt not found' } }; return { jsonrpc: '2.0', id: request.id, result: await prompt.get((params.arguments as Record<string, unknown>) ?? {}, subjectValue) }; }
      if (request.method === 'resources/subscribe') { const uri = String(params.uri ?? ''); const subscription = await cup.subscribe({ subject: subjectValue, resource: uri.replace(/^cup:\/\//, ''), events: (params.events as string[]) ?? ['updated'], context }); return { jsonrpc: '2.0', id: request.id, result: { subscribed: true, close: typeof subscription.close === 'function' } }; }
      return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } };
    } catch (error) { return { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : 'Request failed' } }; }
  } };
}
