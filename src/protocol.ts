import { randomUUID } from 'node:crypto';
import type { AuthorizedCapability, AuthorizedView, ExecutionRequest, Receipt, Subject } from './runtime.js';

export interface ActionTokenClaims {
  token: string;
  capabilityId: string;
  subjectId: string;
  policyVersion: string;
  issuedAt: string;
  expiresAt: string;
  audience: string;
}

export interface ActionTokenService {
  issue(input: Omit<ActionTokenClaims, 'token'>): string;
  verify(token: string, expected: { capabilityId: string; subjectId: string; audience: string; policyVersion: string }): ActionTokenClaims;
  revoke(token: string): void;
}

export class MemoryActionTokenService implements ActionTokenService {
  private readonly tokens = new Map<string, ActionTokenClaims>();
  issue(input: Omit<ActionTokenClaims, 'token'>): string {
    const token = `cup_at_${randomUUID().replaceAll('-', '')}`;
    this.tokens.set(token, { ...input, token });
    return token;
  }
  verify(token: string, expected: { capabilityId: string; subjectId: string; audience: string; policyVersion: string }): ActionTokenClaims {
    const claims = this.tokens.get(token);
    if (!claims || claims.expiresAt <= new Date().toISOString()) throw new Error('INVALID_ACTION_TOKEN');
    if (claims.capabilityId !== expected.capabilityId || claims.subjectId !== expected.subjectId || claims.audience !== expected.audience || claims.policyVersion !== expected.policyVersion) throw new Error('INVALID_ACTION_TOKEN');
    return claims;
  }
  revoke(token: string): void { this.tokens.delete(token); }
}

export interface MCPTransportProfile {
  protocolVersion: string;
  initialize(): Promise<unknown>;
  listResources(subject: Subject): Promise<unknown>;
  readResource(subject: Subject, uri: string): Promise<unknown>;
  listTools(subject: Subject, goal?: string): Promise<AuthorizedCapability[]>;
  callTool(subject: Subject, name: string, args: unknown): Promise<Receipt>;
}

export interface RenderResult { content: unknown; warnings?: string[]; actionTokens?: string[]; }

export function capabilityToTool(capability: AuthorizedCapability): Record<string, unknown> {
  return { name: capability.id, inputSchema: capability.inputSchema, outputSchema: capability.outputSchema, risk: capability.risk, sideEffects: capability.sideEffects, confirmation: capability.confirmation, actionToken: capability.actionToken };
}

export function buildExecutionRequest(subject: Subject, capability: AuthorizedCapability, input: unknown, context: ExecutionRequest['context']): ExecutionRequest {
  return { subject, capability: capability.id, actionToken: capability.actionToken, input, context };
}
