import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CapabilityUI, defineCapability, runCupCli, type Subject } from '../src/index.js';

const john: Subject = {
  id: 'user:john', type: 'user', authenticated: true,
  attributes: { role: 'owner' },
};

test('CLI lists authorized tools for the subject', async () => {
  const cup = new CapabilityUI();
  cup.register(defineCapability({
    id: 'notes.summarize', version: '1.0', sensitivity: 'personal', schema: { type: 'object' },
    operation: 'execute', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    sideEffects: [], risk: 'low', confirmation: 'none', idempotency: 'none', reversibility: 'reversible',
    handler: async () => ({ summary: 'done' }),
  }));
  cup.policy.allow({ id: 'john-tool', principal: { id: john.id }, operation: 'execute', resource: { id: 'notes.summarize' }, priority: 10 });
  const output: string[] = [];
  const result = await runCupCli({
    cup,
    argv: ['--subject', john.id, 'tools', 'list'],
    write: text => { output.push(text); },
  });
  assert.equal(result.exitCode, 0);
  assert.match(output.join(''), /notes\.summarize/);
});

test('CLI denies an unauthorized tool call', async () => {
  const cup = new CapabilityUI();
  cup.register(defineCapability({
    id: 'workspace.addResource', version: '1.0', sensitivity: 'confidential', schema: { type: 'object' },
    operation: 'create', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    sideEffects: [], risk: 'medium', confirmation: 'none', idempotency: 'none', reversibility: 'reversible',
    handler: async () => ({ created: true }),
  }));
  const output: string[] = [];
  const result = await runCupCli({
    cup,
    argv: ['--subject', john.id, 'tools', 'call', 'workspace.addResource', '--args', '{}'],
    write: text => { output.push(text); },
  });
  assert.equal(result.exitCode, 1);
  assert.match(output.join(''), /NO_MATCHING_ALLOW/);
});

test('CLI confirms and executes an allowed tool', async () => {
  const cup = new CapabilityUI();
  cup.register(defineCapability({
    id: 'mail.send', version: '1.0', sensitivity: 'confidential', schema: { type: 'object' },
    operation: 'execute', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    sideEffects: ['external_message'], risk: 'high', confirmation: 'explicit', idempotency: 'required',
    reversibility: 'irreversible', handler: async () => ({ sent: true }),
  }));
  cup.policy.allow({ id: 'john-mail', principal: { id: john.id }, operation: 'execute', resource: { id: 'mail.send' }, priority: 10 });
  const denied = await runCupCli({
    cup,
    argv: ['--subject', john.id, 'tools', 'call', 'mail.send', '--args', '{"body":"Hi"}'],
    write: () => {},
  });
  assert.equal(denied.exitCode, 1);
  const allowed = await runCupCli({
    cup,
    argv: [
      '--subject', john.id, 'tools', 'call', 'mail.send',
      '--args', '{"body":"Hi"}', '--confirm', '--idempotency-key', 'mail-1',
    ],
    write: () => {},
  });
  assert.equal(allowed.exitCode, 0);
});

test('CLI prints usage for unknown commands', async () => {
  const output: string[] = [];
  const result = await runCupCli({
    cup: new CapabilityUI(),
    argv: ['not-a-command'],
    write: text => { output.push(text); },
  });
  assert.equal(result.exitCode, 2);
  assert.match(output.join(''), /Usage: cup/);
});
