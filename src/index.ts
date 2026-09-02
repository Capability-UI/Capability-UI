import { createHash, randomUUID } from 'node:crypto';

export type Operation = 'discover' | 'inspect' | 'read' | 'create' | 'update' | 'delete' | 'execute' | 'share' | 'delegate';
export type ResourceType = 'data' | 'capability' | 'workflow' | 'view' | 'agent';
export type Risk = 'low' | 'medium' | 'high' | 'critical';
export type Effect = 'allow' | 'deny';
export type Visibility = 'hidden' | 'listed' | 'inspectable' | 'readable' | 'usable';
export type JsonSchema = Record<string, unknown>;
export type ResourceRef = { id: string; version?: string };
export type Scope = Record<string, unknown>;
export type RequestContext = Scope & { purpose?: string; channel?: string; now?: Date };

export interface Subject { id: string; type: 'user' | 'agent' | 'service' | 'group'; authenticated: boolean; attributes: Record<string, unknown>; }
export type PrincipalSelector = { id: string } | { role: string } | { type: Subject['type'] } | { any: true };
export type Condition = (request: AuthorizationRequest) => boolean;
export type Obligation = { type: 'redact'; fields: string[] } | { type: 'require_confirmation'; mode: ConfirmationMode } | { type: 'preview_changes' } | { type: 'write_receipt' } | { type: 'human_review' };
export type ConfirmationMode = 'none' | 'preview' | 'explicit' | 'human_review';

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
  handler: (input: unknown, context: ExecutionContext) => Promise<unknown>;
}
export interface Policy {
  id: string; effect: Effect; principal: PrincipalSelector; operation: Operation | Operation[]; resource: ResourceRef;
  scope?: Scope; conditions?: Condition[]; obligations?: Obligation[]; priority: number; expiresAt?: string;
}
export type PolicyInput = Omit<Policy, 'effect'>;
export interface AuthorizationRequest { requestId?: string; subject: Subject; operation: Operation; resource: ResourceRef; scope?: Scope; proposedInput?: unknown; purpose?: string; context: RequestContext; }
export interface Decision { requestId: string; effect: Effect; reasonCode: string; matchedPolicies: string[]; obligations: Obligation[]; policyVersion: string; expiresAt?: string; }
export interface AuthorizedCapability { id: string; operation: Operation; inputSchema: JsonSchema; outputSchema: JsonSchema; risk: Risk; sideEffects: string[]; confirmation: ConfirmationMode; obligations: Obligation[]; }
export interface AuthorizedResource { ref: ResourceRef; visibility: Visibility; schema?: JsonSchema; data?: unknown; capabilities: AuthorizedCapability[]; }
export interface AuthorizedView { viewId: string; subjectId: string; goal?: string; generatedAt: string; policyVersion: string; resources: AuthorizedResource[]; capabilities: AuthorizedCapability[]; globalObligations: Obligation[]; }
export interface Confirmation { inputHash: string; confirmedBy: string; }
export interface ExecutionContext extends RequestContext { requestId: string; idempotencyKey?: string; }
export interface ExecutionRequest extends Omit<AuthorizationRequest, 'operation' | 'resource'> { operation?: Operation; resource?: ResourceRef; capability: string; input: unknown; confirmation?: Confirmation; idempotencyKey?: string; delegation?: DelegationGrant; }
export interface Receipt { id: string; status: 'succeeded' | 'failed' | 'denied'; actor: { id: string; type: Subject['type'] }; capability: string; inputHash: string; decision: Decision; resultSummary?: unknown; createdAt: string; }
export interface DelegationGrant { id: string; from: Subject; to: Subject; capability: string; operations: Operation[]; scope?: Scope; purpose?: string; expiresAt: string; }
export interface ExecutionAdapter { capabilityId: string; invoke(input: unknown, context: ExecutionContext): Promise<unknown>; }
export interface ResourceAdapter { resourceId: string; read(request: { subject: Subject; query?: Record<string, unknown>; fields?: string[]; scope?: Scope; context: RequestContext }): Promise<unknown[]>; }
export interface ReceiptSink { append(receipt: Receipt): Promise<void>; all(): Receipt[]; }

export class MemoryReceiptSink implements ReceiptSink { private readonly entries: Receipt[] = []; async append(receipt: Receipt) { this.entries.push(receipt); } all() { return [...this.entries]; } }

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
function redact(value: unknown, paths: string[]): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => redact(item, paths));
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

class PolicyStore {
  private readonly rules: Policy[] = []; private revision = 0;
  allow(input: PolicyInput): void { this.rules.push({ ...input, effect: 'allow' }); this.revision++; }
  deny(input: PolicyInput): void { this.rules.push({ ...input, effect: 'deny' }); this.revision++; }
  version(): string { return `policy-${this.revision}`; }
  matching(request: AuthorizationRequest): Policy[] {
    const now = request.context.now ?? new Date();
    return this.rules.filter(rule => {
      const ops = Array.isArray(rule.operation) ? rule.operation : [rule.operation];
      return ops.includes(request.operation) && rule.resource.id === request.resource.id && matchesPrincipal(rule.principal, request.subject) && matchesScope(rule.scope, request.scope) && (!rule.expiresAt || new Date(rule.expiresAt) > now) && (!rule.conditions || rule.conditions.every(condition => condition(request)));
    }).sort((a, b) => b.priority - a.priority);
  }
}

export class CapabilityUI {
  readonly policy = new PolicyStore(); readonly receipts: ReceiptSink;
  private readonly resources = new Map<string, Resource>(); private readonly capabilities = new Map<string, Capability>();
  private readonly delegations = new Map<string, DelegationGrant>(); private readonly prepared = new Map<string, Decision>();
  private readonly listeners = new Map<string, Set<(event: ResourceEvent) => void>>();
  constructor(receipts: ReceiptSink = new MemoryReceiptSink()) { this.receipts = receipts; }
  register(resource: Resource | Capability): void { this.resources.set(resource.id, resource); if (resource.type === 'capability' && 'handler' in resource) this.capabilities.set(resource.id, resource); }
  registerAdapter(adapter: ResourceAdapter | ExecutionAdapter): void {
    const id = 'resourceId' in adapter ? adapter.resourceId : adapter.capabilityId;
    const resource = this.resources.get(id); if (!resource) throw new Error('CUP_RESOURCE_NOT_FOUND');
    if ('read' in adapter) resource.read = adapter.read.bind(adapter);
    else if ('invoke' in adapter && resource.type === 'capability' && 'handler' in resource) resource.handler = adapter.invoke.bind(adapter);
  }
  async authorize(request: AuthorizationRequest): Promise<Decision> {
    const requestId = request.requestId ?? randomUUID();
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
      const read = await this.authorize({ subject: request.subject, operation: 'read', resource, purpose: request.context.purpose, context: request.context }); if (read.effect === 'allow') { visibility = 'readable'; schema = resource.schema; }
      resources.push({ ref: { id: resource.id, version: resource.version }, visibility, schema, capabilities: [] });
    }
    for (const capability of this.capabilities.values()) { const d = await this.authorize({ subject: request.subject, operation: 'execute', resource: capability, purpose: request.context.purpose, context: request.context }); if (d.effect === 'allow') capabilities.push({ id: capability.id, operation: capability.operation, inputSchema: capability.inputSchema, outputSchema: capability.outputSchema, risk: capability.risk, sideEffects: capability.sideEffects, confirmation: capability.confirmation, obligations: d.obligations }); }
    return { viewId: randomUUID(), subjectId: request.subject.id, goal: request.goal, generatedAt: new Date().toISOString(), policyVersion: this.policy.version(), resources, capabilities, globalObligations: [] };
  }
  async read(request: { subject: Subject; resource: string; query?: Record<string, unknown>; fields?: string[]; scope?: Scope; purpose?: string; context: RequestContext }): Promise<{ items: unknown[]; receiptId: string }> {
    const resource = this.resources.get(request.resource); if (!resource?.read) throw new Error('CUP_RESOURCE_NOT_READABLE');
    const decision = await this.authorize({ subject: request.subject, operation: 'read', resource, scope: request.scope, purpose: request.purpose, context: request.context }); if (decision.effect !== 'allow') throw new Error(`CUP_NOT_AUTHORIZED:${decision.reasonCode}`);
    const raw = await resource.read({ subject: request.subject, query: request.query, fields: request.fields, scope: request.scope, context: request.context });
    const fields = decision.obligations.filter(o => o.type === 'redact').flatMap(o => o.fields); const items = raw.map(item => redact(item, fields));
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
    const delegated = !!request.delegation;
    if (delegated && !this.validDelegation(request.delegation!, request)) return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision: this.denial(request, 'INVALID_DELEGATION') });
    if (request.requestId && this.prepared.has(request.requestId) && this.prepared.get(request.requestId)?.policyVersion !== this.policy.version()) return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision: this.denial(request, 'PREPARED_DECISION_STALE') });
    const errors = validateSchema(request.input, capability.inputSchema); if (errors.length) return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision: this.denial(request, 'INVALID_INPUT') });
    let decision = await this.authorize({ ...request, operation: 'execute', resource: capability, proposedInput: request.input });
    if (decision.effect !== 'allow' && delegated && decision.reasonCode === 'NO_MATCHING_ALLOW') decision = { ...decision, effect: 'allow', reasonCode: 'DELEGATED_ALLOW', matchedPolicies: [`delegation:${request.delegation!.id}`] };
    if (decision.effect !== 'allow') return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision });
    if (capability.confirmation !== 'none' && (!request.confirmation || request.confirmation.inputHash !== inputHash || request.confirmation.confirmedBy !== request.subject.id)) return this.record({ status: 'denied', actor: request.subject, capability: capability.id, inputHash, decision: { ...decision, effect: 'deny', reasonCode: 'CONFIRMATION_REQUIRED' } });
    try { const result = await capability.handler(request.input, { ...request.context, requestId: decision.requestId, idempotencyKey: request.idempotencyKey }); return this.record({ status: 'succeeded', actor: request.subject, capability: capability.id, inputHash, decision, resultSummary: result }); }
    catch (error) { return this.record({ status: 'failed', actor: request.subject, capability: capability.id, inputHash, decision: { ...decision, reasonCode: 'HANDLER_FAILED' }, resultSummary: { error: error instanceof Error ? error.message : 'unknown error' } }); }
  }
  async delegate(request: { from: Subject; to: Subject; capability: string; operations: Operation[]; scope?: Scope; purpose?: string; expiresInMs: number }): Promise<DelegationGrant> {
    const resource = this.resources.get(request.capability); if (!resource) throw new Error('CUP_RESOURCE_NOT_FOUND'); const d = await this.authorize({ subject: request.from, operation: 'delegate', resource, purpose: request.purpose, scope: request.scope, context: { purpose: request.purpose } }); if (d.effect !== 'allow') throw new Error(`CUP_NOT_AUTHORIZED:${d.reasonCode}`);
    const grant: DelegationGrant = { id: randomUUID(), from: request.from, to: request.to, capability: request.capability, operations: request.operations, scope: request.scope, purpose: request.purpose, expiresAt: new Date(Date.now() + request.expiresInMs).toISOString() }; this.delegations.set(grant.id, grant); return grant;
  }
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
  private validDelegation(grant: DelegationGrant, request: ExecutionRequest): boolean { return this.delegations.get(grant.id) === grant && grant.to.id === request.subject.id && grant.capability === request.capability && grant.operations.includes('execute') && new Date(grant.expiresAt) > new Date() && (!grant.purpose || grant.purpose === request.purpose) && matchesScope(grant.scope, request.scope); }
  private denial(request: ExecutionRequest, reasonCode: string): Decision { return { requestId: request.requestId ?? randomUUID(), effect: 'deny', reasonCode, matchedPolicies: [], obligations: [], policyVersion: this.policy.version() }; }
  private async record(input: Omit<Receipt, 'id' | 'createdAt'>): Promise<Receipt> { const receipt = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }; await this.receipts.append(receipt); return receipt; }
}

export interface ResourceEvent { resource: ResourceRef; type: string; data?: unknown; }
export interface Subscription { on(event: 'event' | 'access_removed', callback: (event: ResourceEvent) => void): void; close(): void; }
export function subject(id: string, attributes: Record<string, unknown> = {}, authenticated = true): Subject { return { id, type: id.startsWith('agent:') ? 'agent' : 'user', authenticated, attributes }; }
export function resource(id: string, version = '1.0'): ResourceRef { return { id, version }; }
export function capability(id: string): ResourceRef { return { id }; }
export function defineCapability(config: Omit<Capability, 'type'>): Capability { return { ...config, type: 'capability' }; }
export function inMemoryReceipts(): MemoryReceiptSink { return new MemoryReceiptSink(); }
export const conditions = {
  purposeIs: (purpose: string): Condition => request => request.purpose === purpose,
  recipientCountAtMost: (max: number): Condition => request => Array.isArray((request.proposedInput as Record<string, unknown> | undefined)?.recipients) && ((request.proposedInput as Record<string, unknown>).recipients as unknown[]).length <= max,
  inputFieldEquals: (field: string, expected: unknown): Condition => request => (request.proposedInput as Record<string, unknown> | undefined)?.[field] === expected
};

export interface MCPRequest { jsonrpc: '2.0'; id?: string | number; method: string; params?: Record<string, unknown>; }
export interface MCPResponse { jsonrpc: '2.0'; id?: string | number; result?: unknown; error?: { code: number; message: string }; }
export function createMCPServer(options: { cup: CapabilityUI; name: string; authenticate?: (request: MCPRequest) => Promise<Subject> | Subject }) {
  const { cup } = options;
  return { async handle(request: MCPRequest): Promise<MCPResponse> {
    try {
      const params = request.params ?? {}; const subjectValue = options.authenticate ? await options.authenticate(request) : subject('service:mcp'); const context = (params.context as RequestContext | undefined) ?? {};
      if (request.method === 'initialize') return { jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: options.name, version: '0.1.0' }, capabilities: { resources: { subscribe: true }, tools: {}, prompts: {} } } };
      if (request.method === 'resources/list') return { jsonrpc: '2.0', id: request.id, result: { resources: await cup.discover({ subject: subjectValue, purpose: context.purpose, context }) } };
      if (request.method === 'resources/read') { const uri = String(params.uri ?? ''); const id = uri.replace(/^cup:\/\//, ''); return { jsonrpc: '2.0', id: request.id, result: await cup.read({ subject: subjectValue, resource: id, purpose: context.purpose, context }) }; }
      if (request.method === 'tools/list') { const view = await cup.project({ subject: subjectValue, goal: String(params.goal ?? ''), context }); return { jsonrpc: '2.0', id: request.id, result: { tools: view.capabilities.map(c => ({ name: c.id, description: `${c.id} (${c.risk} risk)`, inputSchema: c.inputSchema, _cup: c })) } }; }
      if (request.method === 'tools/call') { const name = String(params.name ?? ''); const args = params.arguments ?? {}; const receipt = await cup.execute({ subject: subjectValue, capability: name, input: args, purpose: context.purpose, context }); return { jsonrpc: '2.0', id: request.id, result: { isError: receipt.status !== 'succeeded', content: [{ type: 'text', text: JSON.stringify(receipt) }] } }; }
      return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } };
    } catch (error) { return { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : 'Request failed' } }; }
  } };
}
