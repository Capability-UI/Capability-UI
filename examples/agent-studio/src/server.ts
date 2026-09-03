import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startExampleHost } from '../../shared/host.ts';
import { createAgentStudio, keelDatabaseFile } from './domain.ts';

function loadEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(join(dirname(fileURLToPath(import.meta.url)), '../.env'));

const app = await createAgentStudio({ databaseFile: keelDatabaseFile() });
export const { cup } = app;

const { port } = await startExampleHost(app, {
  port: Number(process.env.PORT ?? 8784),
  publicDir: fileURLToPath(new URL('../public/', import.meta.url)),
});
console.log(`${app.product}`);
console.log(`App  http://127.0.0.1:${port}`);
console.log(`Data explorer  http://127.0.0.1:${port}/explorer.html`);
console.log(`MCP POST http://127.0.0.1:${port}/mcp`);
