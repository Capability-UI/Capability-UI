import { pathToFileURL } from 'node:url';
import { canonicalInputHash, createMCPServer, type CapabilityUI, type Confirmation, type MCPPrompt, type MCPRequest, type MCPResponse, type Subject } from './runtime.js';

export interface CupCliHost {
  cup: CapabilityUI;
  name?: string;
  authenticate?: (request: MCPRequest) => Promise<Subject> | Subject;
  prompts?: MCPPrompt[];
}

export interface CupCliOptions {
  argv: string[];
  cup?: CapabilityUI;
  name?: string;
  authenticate?: CupCliHost['authenticate'];
  prompts?: MCPPrompt[];
  write?: (text: string) => void;
}

export interface CupCliResult {
  exitCode: number;
  response?: MCPResponse;
}

const USAGE = `Usage: cup [flags] <command>

CUP CLI is an MCP-shaped client. Every command becomes one JSON-RPC method
against the same CUP server profile used by agents.

Commands:
  init                         initialize
  resources list               resources/list
  resources read <uri>         resources/read
  resources templates          resources/templates/list
  tools list                   tools/list
  tools call <name>            tools/call
  prompts list                 prompts/list
  prompts get <name>           prompts/get

Flags:
  --host <module>              ESM module exporting { cup }
  --subject <id>               principal for this call
  --purpose <text>             request purpose
  --context <json>             extra request context
  --goal <text>                goal for tools list
  --args <json>                tool or prompt arguments
  --confirm                    bind confirmation to the current subject and args
  --idempotency-key <key>      required when the capability says so
  --delegation <json>          DelegationGrant JSON for an attenuated call
  --help                       print this message
`;

interface ParsedCli {
  help: boolean;
  host?: string;
  subjectId?: string;
  purpose?: string;
  context: Record<string, unknown>;
  goal?: string;
  args: Record<string, unknown>;
  confirm: boolean;
  idempotencyKey?: string;
  delegation?: unknown;
  command: string[];
}

function parseJsonObject(raw: string, flag: string): Record<string, unknown> {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${flag} must be a JSON object`);
  return value as Record<string, unknown>;
}

function parseArgv(argv: string[]): ParsedCli {
  const parsed: ParsedCli = { help: false, context: {}, args: {}, confirm: false, command: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token) continue;
    if (token === '--help' || token === '-h') { parsed.help = true; continue; }
    if (token === '--confirm') { parsed.confirm = true; continue; }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for --${key}`);
      switch (key) {
        case 'host': parsed.host = value; break;
        case 'subject': parsed.subjectId = value; break;
        case 'purpose': parsed.purpose = value; break;
        case 'goal': parsed.goal = value; break;
        case 'idempotency-key': parsed.idempotencyKey = value; break;
        case 'context': parsed.context = parseJsonObject(value, '--context'); break;
        case 'args': parsed.args = parseJsonObject(value, '--args'); break;
        case 'delegation': parsed.delegation = JSON.parse(value); break;
        default: throw new Error(`Unknown flag --${key}`);
      }
      continue;
    }
    parsed.command.push(token);
  }
  return parsed;
}

function toMethod(command: string[]): { method: string; extra: Record<string, unknown> } {
  const [head, sub, ...rest] = command;
  if (head === 'init' || head === 'initialize') return { method: 'initialize', extra: {} };
  if (head === 'resources' && sub === 'list') return { method: 'resources/list', extra: {} };
  if (head === 'resources' && sub === 'read') return { method: 'resources/read', extra: { uri: rest[0] } };
  if (head === 'resources' && sub === 'templates') return { method: 'resources/templates/list', extra: {} };
  if (head === 'tools' && sub === 'list') return { method: 'tools/list', extra: {} };
  if (head === 'tools' && sub === 'call') return { method: 'tools/call', extra: { name: rest[0] } };
  if (head === 'prompts' && sub === 'list') return { method: 'prompts/list', extra: {} };
  if (head === 'prompts' && sub === 'get') return { method: 'prompts/get', extra: { name: rest[0] } };
  throw new Error(`Unknown command: ${command.join(' ') || '(empty)'}`);
}

export async function loadCupCliHost(modulePath: string): Promise<CupCliHost> {
  const url = modulePath.startsWith('file:') ? modulePath : pathToFileURL(modulePath).href;
  const loaded = await import(url) as CupCliHost & { default?: CupCliHost };
  const host = loaded.default ?? loaded;
  if (!host?.cup) throw new Error('Host module must export { cup }');
  return host;
}

export function createCupCli(host: CupCliHost) {
  const server = createMCPServer({
    cup: host.cup,
    name: host.name ?? 'cup-cli',
    authenticate: host.authenticate,
    prompts: host.prompts,
  });
  return {
    server,
    async run(argv: string[], write: (text: string) => void = text => process.stdout.write(text)): Promise<CupCliResult> {
      return runCupCli({ ...host, argv, write });
    },
  };
}

export async function runCupCli(options: CupCliOptions): Promise<CupCliResult> {
  const write = options.write ?? (text => process.stdout.write(text));
  try {
    const parsed = parseArgv(options.argv);
    if (parsed.help) {
      write(USAGE);
      return { exitCode: 0 };
    }
    if (parsed.command.length === 0) {
      write(USAGE);
      return { exitCode: 2 };
    }
    const host = options.cup ? options : parsed.host ? await loadCupCliHost(parsed.host) : options;
    if (!host.cup) throw new Error('Provide --host <module> or pass { cup } to runCupCli');
    const { method, extra } = toMethod(parsed.command);
    if ((method === 'resources/read' || method === 'tools/call' || method === 'prompts/get') && !extra.name && !extra.uri) {
      throw new Error(`${method} requires a name or uri argument`);
    }
    const context: Record<string, unknown> = {
      ...parsed.context,
      purpose: parsed.purpose ?? parsed.context.purpose,
      channel: parsed.context.channel ?? 'cli',
    };
    const confirmation: Confirmation | undefined = parsed.confirm && parsed.subjectId
      ? { inputHash: canonicalInputHash(parsed.args), confirmedBy: parsed.subjectId }
      : undefined;
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        subjectId: parsed.subjectId,
        context,
        goal: parsed.goal,
        arguments: parsed.args,
        confirmation,
        idempotencyKey: parsed.idempotencyKey,
        delegation: parsed.delegation,
        ...extra,
      },
    };
    const server = createMCPServer({
      cup: host.cup,
      name: host.name ?? options.name ?? 'cup-cli',
      authenticate: host.authenticate ?? options.authenticate ?? (incoming => {
        const id = String(incoming.params?.subjectId ?? 'user:anonymous');
        return { id, type: id.startsWith('agent:') ? 'agent' : 'user', authenticated: true, attributes: {} };
      }),
      prompts: host.prompts ?? options.prompts,
    });
    const response = await server.handle(request);
    write(`${JSON.stringify(response, null, 2)}\n`);
    if (response.error) return { exitCode: 1, response };
    const result = response.result as { isError?: boolean } | undefined;
    return { exitCode: result?.isError ? 1 : 0, response };
  } catch (error) {
    write(`${error instanceof Error ? error.message : 'CLI failed'}\n${USAGE}`);
    return { exitCode: 2 };
  }
}
