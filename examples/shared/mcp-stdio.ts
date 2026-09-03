import { createMCPServer, subject, type CapabilityUI, type MCPRequest, type Subject } from '@capability-ui/core';
import { stdin, stdout } from 'node:process';

function parseMessages(buffer: Buffer): { messages: MCPRequest[]; rest: Buffer } {
  const messages: MCPRequest[] = [];
  let rest: Buffer = buffer;
  while (true) {
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = rest.subarray(0, headerEnd).toString('utf8');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match?.[1]) {
      rest = rest.subarray(headerEnd + 4) as Buffer;
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (rest.length < bodyStart + length) break;
    const body = rest.subarray(bodyStart, bodyStart + length).toString('utf8');
    messages.push(JSON.parse(body) as MCPRequest);
    rest = rest.subarray(bodyStart + length) as Buffer;
  }
  return { messages, rest };
}

function writeMessage(message: unknown): void {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  stdout.write(body);
}

export function runMcpStdio(options: {
  cup: CapabilityUI;
  name: string;
  resolveSubject: (request: MCPRequest) => Subject;
}): void {
  const server = createMCPServer({
    cup: options.cup,
    name: options.name,
    authenticate: request => options.resolveSubject(request),
  });
  let buffer: Buffer = Buffer.alloc(0);
  stdin.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk as Buffer]) as Buffer;
    const parsed = parseMessages(buffer);
    buffer = parsed.rest;
    for (const request of parsed.messages) {
      void server.handle(request).then(response => {
        if (request.id !== undefined) writeMessage(response);
      });
    }
  });
}

export function subjectFromRequest(request: MCPRequest, fallback: Subject, allowed: Map<string, Subject>): Subject {
  const params = request.params ?? {};
  const id = typeof params.subjectId === 'string' ? params.subjectId : fallback.id;
  return allowed.get(id) ?? subject(id, fallback.attributes, fallback.authenticated);
}
