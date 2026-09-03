import { fileURLToPath } from 'node:url';
import { startExampleHost } from '../../shared/host.ts';
import { createSupportDesk, supportDatabaseFile } from './domain.ts';

const app = await createSupportDesk({ databaseFile: supportDatabaseFile() });
export const { cup } = app;

const { port } = await startExampleHost(app, {
  port: Number(process.env.PORT ?? 8783),
  publicDir: fileURLToPath(new URL('../public/', import.meta.url)),
});
console.log(`${app.product}`);
console.log(`App  http://127.0.0.1:${port}`);
console.log(`Data explorer  http://127.0.0.1:${port}/explorer.html`);
console.log(`MCP POST http://127.0.0.1:${port}/mcp`);
