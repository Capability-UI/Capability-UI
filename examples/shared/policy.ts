import type { CapabilityUI, Operation, Obligation, PrincipalSelector } from '@capability-ui/core';

const DATA_OPS: Operation[] = ['discover', 'inspect', 'read'];
const ACTION_OPS: Operation[] = ['execute'];

export function allowPrincipal(
  cup: CapabilityUI,
  options: {
    id: string;
    principal: PrincipalSelector;
    resourceId: string;
    operations: Operation[];
    priority?: number;
    obligations?: Obligation[];
    scope?: Record<string, unknown>;
  },
): void {
  for (const operation of options.operations) {
    cup.policy.allow({
      id: `${options.id}:${operation}`,
      principal: options.principal,
      operation,
      resource: { id: options.resourceId },
      priority: options.priority ?? 10,
      obligations: options.obligations,
      scope: options.scope,
    });
  }
}

export function allowDataRead(
  cup: CapabilityUI,
  options: {
    id: string;
    principal: PrincipalSelector;
    resourceId: string;
    priority?: number;
    obligations?: Obligation[];
  },
): void {
  allowPrincipal(cup, { ...options, operations: DATA_OPS });
}

export function allowExecute(
  cup: CapabilityUI,
  options: {
    id: string;
    principal: PrincipalSelector;
    resourceId: string;
    priority?: number;
    obligations?: Obligation[];
  },
): void {
  allowPrincipal(cup, { ...options, operations: ACTION_OPS });
}

export function allowDelegate(
  cup: CapabilityUI,
  options: { id: string; principal: PrincipalSelector; resourceId: string; priority?: number },
): void {
  allowPrincipal(cup, { ...options, operations: ['delegate'] });
}
