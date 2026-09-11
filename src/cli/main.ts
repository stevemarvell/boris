import { LinkService } from '../service.js';
import { FileStore } from '../store/file-store.js';

const usage = `linkjar — bookmark shelf

  add <url> [--title T] [--tag T]...    save a link
  list [--q TEXT] [--tag T] [--unread]  list links
  read <id>                             mark a link read
  rm <id>                               delete a link
  tags                                  tag counts
`;

function flagValues(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === flag && next !== undefined) values.push(next);
  }
  return values;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const service = new LinkService(new FileStore(process.env['LINKJAR_DB'] ?? 'data/links.json'));

  switch (command) {
    case 'add': {
      const url = rest[0];
      if (url === undefined) throw new Error('add requires a url');
      const title = flagValues(rest, '--title')[0];
      const link = await service.add({
        url,
        ...(title !== undefined ? { title } : {}),
        tags: flagValues(rest, '--tag'),
      });
      console.log(`${link.id}  ${link.title}`);
      return 0;
    }
    case 'list': {
      const text = flagValues(rest, '--q')[0];
      const tag = flagValues(rest, '--tag')[0];
      const links = await service.list({
        ...(text !== undefined ? { text } : {}),
        ...(tag !== undefined ? { tag } : {}),
        unreadOnly: rest.includes('--unread'),
      });
      for (const link of links) {
        console.log(`${link.read ? ' ' : '*'} ${link.id}  ${link.title}  ${link.url}`);
      }
      return 0;
    }
    case 'read': {
      const id = rest[0];
      if (id === undefined) throw new Error('read requires an id');
      await service.markRead(id, true);
      return 0;
    }
    case 'rm': {
      const id = rest[0];
      if (id === undefined) throw new Error('rm requires an id');
      await service.remove(id);
      return 0;
    }
    case 'tags': {
      for (const { tag, count } of await service.tags()) console.log(`${count}\t${tag}`);
      return 0;
    }
    default:
      console.log(usage);
      return command === undefined || command === '--help' ? 0 : 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exit(code);
  })
  .catch((err: Error) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
