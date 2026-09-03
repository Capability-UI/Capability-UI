import { startExampleHost } from '../../shared/host.ts';
import { createAgentStudio } from './domain.ts';

await startExampleHost(await createAgentStudio(), { stdio: true });
