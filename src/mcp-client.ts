import type { CapabilityUI, MCPRequest, MCPResponse, Subject } from './runtime.js';

export interface MCPTransport {
  send(request: MCPRequest): Promise<MCPResponse>;
}

export interface MCPRemote {
  initialize(): Promise<unknown>;
  listResources(context?: Record<string, unknown>): Promise<unknown>;
  readResource(uri: string, context?: Record<string, unknown>): Promise<unknown>;
  listTools(goal?: string, context?: Record<string, unknown>): Promise<unknown>;
  callTool(name: string, argumentsValue?: unknown, context?: Record<string, unknown>): Promise<unknown>;
}

export class MCPClient implements MCPRemote {
  private nextId = 1;
  constructor(private readonly transport: MCPTransport, readonly subject?: Subject) {}

  private async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const response = await this.transport.send({ jsonrpc: '2.0', id: this.nextId++, method, params });
    if (response.error) throw new Error(`MCP_${response.error.code}:${response.error.message}`);
    return response.result;
  }

  initialize(): Promise<unknown> { return this.request('initialize'); }
  listResources(context: Record<string, unknown> = {}): Promise<unknown> { return this.request('resources/list', { context }); }
  readResource(uri: string, context: Record<string, unknown> = {}): Promise<unknown> { return this.request('resources/read', { uri, context }); }
  listTools(goal = '', context: Record<string, unknown> = {}): Promise<unknown> { return this.request('tools/list', { goal, context }); }
  callTool(name: string, argumentsValue: unknown = {}, context: Record<string, unknown> = {}): Promise<unknown> { return this.request('tools/call', { name, arguments: argumentsValue, context }); }
}

export function connectMCP(transport: MCPTransport, subject?: Subject): MCPClient { return new MCPClient(transport, subject); }

export interface MountedRemote { namespace: string; remote: MCPRemote; }

export function mountMCP(_cup: CapabilityUI, remote: MCPRemote, options: { namespace: string }): MountedRemote {
  if (!options.namespace || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(options.namespace)) throw new Error('INVALID_MCP_NAMESPACE');
  return { namespace: options.namespace, remote };
}
