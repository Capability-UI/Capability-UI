import { startExampleHost } from '../../shared/host.ts';
import { createCrmWorkspace } from './domain.ts';

await startExampleHost(await createCrmWorkspace(), { stdio: true });
