import { startExampleHost } from '../../shared/host.ts';
import { createSupportDesk } from './domain.ts';

await startExampleHost(await createSupportDesk(), { stdio: true });
