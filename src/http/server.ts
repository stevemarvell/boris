import { createServer } from 'node:http';
import { LinkService } from '../service.js';
import { FileStore } from '../store/file-store.js';
import { MemoryStore } from '../store/memory-store.js';
import type { Store } from '../store/store.js';
import { createRouter } from './router.js';

const port = Number(process.env['PORT'] ?? 8787);
const store: Store = process.argv.includes('--ephemeral')
  ? new MemoryStore()
  : new FileStore(process.env['LINKJAR_DB'] ?? 'data/links.json');

const handle = createRouter(new LinkService(store));

const server = createServer((req, res) => {
  void handle(req, res);
});

server.listen(port, () => {
  console.log(`linkjar listening on http://localhost:${port}`);
});
