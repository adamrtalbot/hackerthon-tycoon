import { mkdir, rm, copyFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const name of ['index.html', 'cloud.js', 'replay.js']) {
  await copyFile(name, `dist/${name}`);
}
