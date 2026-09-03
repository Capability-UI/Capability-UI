import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMCPServer,
  canonicalInputHash,
  type AuthorizedView,
  type MCPRequest,
  type Subject,
} from '@capability-ui/core';
import { runMcpStdio, subjectFromRequest } from './mcp-stdio.ts';
import type { ExampleApp, ExamplePrincipal } from './types.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const SHARED_PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', chunk => {
      size += (chunk as Buffer).length;
      if (size > 1_000_000) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk as Buffer);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function principalMap(principals: ExamplePrincipal[]): Map<string, Subject> {
  return new Map(principals.map(item => [item.id, item.subject]));
}

function resolveSubject(app: ExampleApp, request: MCPRequest): Subject {
  const fallback = app.principals.find(item => item.id === app.defaultSubjectId)?.subject
    ?? app.principals[0]?.subject;
  if (!fallback) throw new Error('NO_PRINCIPALS');
  return subjectFromRequest(request, fallback, principalMap(app.principals));
}

function subjectById(app: ExampleApp, id: string | null): Subject {
  const found = app.principals.find(item => item.id === id);
  if (found) return found.subject;
  const fallback = app.principals.find(item => item.id === app.defaultSubjectId) ?? app.principals[0];
  if (!fallback) throw new Error('NO_PRINCIPALS');
  return fallback.subject;
}

function contextFrom(query: URLSearchParams, extra: Record<string, unknown> = {}) {
  const purpose = query.get('purpose') ?? (typeof extra.purpose === 'string' ? extra.purpose : 'example');
  const channel = query.get('channel') ?? 'web';
  return { purpose, channel, ...extra };
}

function safeFile(root: string, pathname: string): string | undefined {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const resolved = resolve(root, relative);
  const normalizedRoot = resolve(root) + sep;
  if (!resolved.startsWith(normalizedRoot) && resolved !== resolve(root)) return undefined;
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return undefined;
  return resolved;
}

function normalizeBasePath(basePath?: string): string {
  if (!basePath || basePath === '/') return '';
  return `/${basePath.replace(/^\/+|\/+$/g, '')}`;
}

function innerPath(pathname: string, basePath: string): string | undefined {
  if (!basePath) return pathname === '' ? '/' : pathname;
  if (pathname === basePath) return '/';
  if (pathname.startsWith(`${basePath}/`)) {
    const rest = pathname.slice(basePath.length);
    return rest.length === 0 ? '/' : rest;
  }
  return undefined;
}

function serveFile(res: ServerResponse, file: string, basePath = ''): void {
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  if (extname(file) === '.html') {
    const href = basePath ? `${basePath}/` : '/';
    const html = readFileSync(file, 'utf8')
      .replace('<head>', `<head>\n    <base href="${href}" />\n    <meta name="cup-base" content="${basePath}" />`);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(html);
    return;
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}

export interface ExampleHostOptions {
  port?: number;
  host?: string;
  publicDir?: string;
  stdio?: boolean;
  basePath?: string;
  publicOrigin?: string;
}

class AgentBridge {
  private child: ChildProcess | undefined;
  private buffer = '';
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private nextId = 1;

  constructor(
    private readonly script: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly pythonBin: string,
  ) {}

  start(): void {
    if (this.child) return;
    this.child = spawn(this.pythonBin, ['-u', this.script], {
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout?.setEncoding('utf8');
    this.child.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf('\n');
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) this.onLine(line);
        newline = this.buffer.indexOf('\n');
      }
    });
    this.child.stderr?.setEncoding('utf8');
    this.child.stderr?.on('data', (chunk: string) => {
      process.stderr.write(chunk);
    });
    this.child.on('exit', code => {
      const error = new Error(`Agent process exited (${code ?? 'unknown'})`);
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
      this.child = undefined;
    });
  }

  private onLine(line: string): void {
    const message = JSON.parse(line) as { id?: number; error?: string; result?: unknown };
    if (typeof message.id !== 'number') return;
    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error));
    else waiter.resolve(message.result);
  }

  async ask(payload: Record<string, unknown>): Promise<unknown> {
    this.start();
    if (!this.child?.stdin) throw new Error('Agent stdin is not available');
    const id = this.nextId++;
    const line = JSON.stringify({ id, ...payload }) + '\n';
    return new Promise((resolveAsk, reject) => {
      this.pending.set(id, { resolve: resolveAsk, reject });
      this.child?.stdin?.write(line, error => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }
}

export function createExampleDispatcher(
  app: ExampleApp,
  options: ExampleHostOptions = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const mcp = createMCPServer({
    cup: app.cup,
    name: app.name,
    authenticate: request => resolveSubject(app, request),
  });
  const basePath = normalizeBasePath(options.basePath);
  const port = options.port ?? Number(process.env.PORT ?? 8780);
  const publicDir = options.publicDir ?? SHARED_PUBLIC;
  const origin = options.publicOrigin ?? `http://127.0.0.1:${port}`;
  const pythonBin = app.pythonAgent?.pythonBin
    ?? process.env.PYTHON
    ?? (process.platform === 'win32' ? 'python' : 'python3');
  const agent = app.pythonAgent
    ? new AgentBridge(app.pythonAgent.script, {
      ...process.env,
      CUP_MCP_URL: `${origin}${basePath}/mcp`,
      CUP_EXAMPLE: app.name,
    }, pythonBin)
    : undefined;

  return async (req, res) => {
    if (!req.url) {
      json(res, 400, { error: 'Missing URL' });
      return true;
    }
    const url = new URL(req.url, origin);
    const pathname = innerPath(url.pathname, basePath);
    if (pathname === undefined) return false;
    if (basePath && url.pathname === basePath) {
      res.writeHead(308, { location: `${basePath}/` });
      res.end();
      return true;
    }
    url.pathname = pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return true;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(res, 200, {
          ok: true,
          name: app.name,
          title: app.title,
          mcp: `${origin}${basePath}/mcp`,
          stdio: 'pass --stdio to this process',
          policyVersion: app.cup.policy.version(),
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/meta') {
        json(res, 200, {
          name: app.name,
          title: app.title,
          subtitle: app.subtitle,
          product: app.product,
          layout: app.pythonAgent ? 'ops-copilot' : 'console',
          explorerPath: '/explorer.html',
          eventResources: app.eventResources ?? [],
          principals: app.principals.map(item => ({
            id: item.id,
            label: item.label,
            role: item.role,
          })),
          defaultSubjectId: app.defaultSubjectId,
          mcpPath: `${basePath}/mcp`,
          model: {
            hasServerKey: Boolean(process.env.OPENAI_API_KEY),
            baseUrl: process.env.OPENAI_BASE_URL ?? '',
            model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
          },
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/view') {
        const subject = subjectById(app, url.searchParams.get('subject'));
        const view = await app.cup.project({
          subject,
          goal: url.searchParams.get('goal') ?? app.title,
          context: contextFrom(url.searchParams),
        });
        json(res, 200, view);
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/read') {
        const subject = subjectById(app, url.searchParams.get('subject'));
        const resource = url.searchParams.get('resource');
        if (!resource) {
          json(res, 400, { error: 'resource is required' });
          return true;
        }
        const result = await app.cup.read({
          subject,
          resource,
          purpose: url.searchParams.get('purpose') ?? 'example',
          context: contextFrom(url.searchParams),
        });
        json(res, 200, result);
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/receipts') {
        json(res, 200, { receipts: app.cup.receipts.all().slice(-40).reverse() });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/events') {
        const resource = url.searchParams.get('resource') ?? app.eventResources?.[0];
        if (!resource) {
          json(res, 400, { error: 'No event resource' });
          return true;
        }
        const subject = subjectById(app, url.searchParams.get('subject'));
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'access-control-allow-origin': '*',
        });
        const subscription = await app.cup.subscribe({
          subject,
          resource,
          events: ['updated'],
          context: contextFrom(url.searchParams),
        });
        const send = (event: unknown) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        subscription.on('event', send);
        req.on('close', () => subscription.close());
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/mcp') {
        const raw = await readBody(req);
        const request = JSON.parse(raw || '{}') as MCPRequest;
        if (!request.jsonrpc) request.jsonrpc = '2.0';
        const params = request.params ?? {};
        const confirmation = params.confirmation as { confirmedBy?: string; inputHash?: string } | undefined;
        if (request.method === 'tools/call' && confirmation?.confirmedBy && !confirmation.inputHash) {
          params.confirmation = {
            confirmedBy: confirmation.confirmedBy,
            inputHash: canonicalInputHash(params.arguments ?? {}),
          };
          request.params = params;
        }
        const response = await mcp.handle(request);
        json(res, 200, response);
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/prepare') {
        const body = JSON.parse(await readBody(req)) as {
          subjectId?: string;
          capability?: string;
          input?: unknown;
          purpose?: string;
        };
        const subject = subjectById(app, body.subjectId ?? null);
        const prepared = await app.cup.prepare({
          subject,
          capability: String(body.capability ?? ''),
          input: body.input,
          purpose: body.purpose ?? 'example',
          context: { purpose: body.purpose ?? 'example', channel: 'web' },
        });
        json(res, 200, prepared);
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/execute') {
        const body = JSON.parse(await readBody(req)) as {
          subjectId?: string;
          capability?: string;
          input?: unknown;
          actionToken?: string;
          purpose?: string;
          confirm?: boolean;
          idempotencyKey?: string;
        };
        const subject = subjectById(app, body.subjectId ?? null);
        const capability = String(body.capability ?? '');
        const prepared = await app.cup.prepare({
          subject,
          capability,
          input: body.input,
          purpose: body.purpose ?? 'example',
          context: { purpose: body.purpose ?? 'example', channel: 'web' },
        });
        const receipt = await app.cup.execute({
          ...prepared.request,
          actionToken: body.actionToken,
          confirmation: body.confirm === false
            ? undefined
            : { inputHash: prepared.inputHash, confirmedBy: subject.id },
          idempotencyKey: body.idempotencyKey,
        });
        json(res, 200, { receipt, inputHash: prepared.inputHash, canonicalHash: canonicalInputHash(body.input) });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/db/schema') {
        if (!app.database) {
          json(res, 404, { error: 'No database on this example' });
          return true;
        }
        json(res, 200, { engine: 'sqlite', product: app.product, tables: app.database.schema() });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/db/model') {
        if (!app.database) {
          json(res, 404, { error: 'No database on this example' });
          return true;
        }
        json(res, 200, {
          engine: 'sqlite',
          product: app.product,
          summary: app.catalog?.summary ?? '',
          principals: app.principals.map(item => ({ id: item.id, label: item.label, role: item.role })),
          tables: app.database.schema(),
          resources: app.catalog?.resources ?? [],
          grants: app.catalog?.grants ?? [],
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/db/table') {
        if (!app.database) {
          json(res, 404, { error: 'No database on this example' });
          return true;
        }
        const name = url.searchParams.get('name');
        if (!name) {
          json(res, 400, { error: 'name is required' });
          return true;
        }
        json(res, 200, app.database.tablePreview(name, Number(url.searchParams.get('limit') ?? 200)));
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/db/query') {
        if (!app.database) {
          json(res, 404, { error: 'No database on this example' });
          return true;
        }
        const body = JSON.parse(await readBody(req)) as { sql?: string };
        json(res, 200, app.database.query(String(body.sql ?? '')));
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/chat') {
        if (!agent) {
          json(res, 404, { error: 'This example does not include a chat agent' });
          return true;
        }
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        const openai = (body.openai ?? {}) as { apiKey?: string; baseUrl?: string; model?: string };
        const apiKey = openai.apiKey || process.env.OPENAI_API_KEY;
        if (!apiKey) {
          json(res, 200, {
            text: 'No model key yet. You can still use the warehouse screens. Add OPENAI_API_KEY, OPENAI_BASE_URL, and OPENAI_MODEL, or fill the copilot fields, to enable chat.',
          });
          return true;
        }
        try {
          const result = await agent.ask({
            subjectId: body.subjectId ?? app.defaultSubjectId,
            message: body.message,
            history: body.history ?? [],
            openai,
          });
          json(res, 200, result);
        } catch (error) {
          json(res, 200, {
            text: `${error instanceof Error ? error.message : 'Agent failed'}. Install Python deps with: pip install -r agent-studio/python/requirements.txt`,
          });
        }
        return true;
      }

      if (req.method === 'GET') {
        const override = safeFile(publicDir, url.pathname);
        if (override) {
          serveFile(res, override, basePath);
          return true;
        }
        const shared = safeFile(SHARED_PUBLIC, url.pathname);
        if (shared) {
          serveFile(res, shared, basePath);
          return true;
        }
        const fallback = join(SHARED_PUBLIC, 'index.html');
        if (existsSync(fallback) && !url.pathname.startsWith('/api')) {
          serveFile(res, fallback, basePath);
          return true;
        }
      }

      json(res, 404, { error: 'Not found' });
      return true;
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : 'Request failed' });
      return true;
    }
  };
}

export async function startExampleHost(
  app: ExampleApp,
  options: ExampleHostOptions = {},
): Promise<{ port: number; close: () => Promise<void> }> {
  if (options.stdio || process.argv.includes('--stdio')) {
    runMcpStdio({
      cup: app.cup,
      name: app.name,
      resolveSubject: request => resolveSubject(app, request),
    });
    return { port: 0, close: async () => undefined };
  }

  const port = options.port ?? Number(process.env.PORT ?? 8780);
  const host = options.host ?? '127.0.0.1';
  const dispatch = createExampleDispatcher(app, { ...options, port });
  const server = createServer(async (req, res) => {
    const handled = await dispatch(req, res);
    if (!handled) json(res, 404, { error: 'Not found' });
  });

  await new Promise<void>(resolveListen => {
    server.listen(port, host, () => resolveListen());
  });

  const close = async () => {
    await new Promise<void>((resolveClose, reject) => {
      server.close(error => error ? reject(error) : resolveClose());
    });
  };

  return { port, close };
}

export function viewCapabilityIds(view: AuthorizedView): string[] {
  return view.capabilities.map(item => item.id);
}
