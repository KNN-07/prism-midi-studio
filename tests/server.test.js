import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStaticServer } from '../scripts/serve.mjs';

test('static server serves application files and protects private paths', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'prism-server-test-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'index.html'), '<h1>PRISM</h1>');
  await writeFile(path.join(root, 'src', 'app.js'), 'export const ready = true;');
  await writeFile(path.join(root, '.env'), 'PRIVATE=value');
  await writeFile(path.join(root, 'README.md'), 'Source documentation');
  const server = createStaticServer(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const home = await fetch(`${origin}/`);
  assert.equal(home.status, 200);
  assert.equal(await home.text(), '<h1>PRISM</h1>');
  assert.match(home.headers.get('content-type'), /text\/html/);
  const script = await fetch(`${origin}/src/app.js?v=1`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  const head = await fetch(`${origin}/src/app.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(`${origin}/.env`)).status, 403);
  assert.equal((await fetch(`${origin}/README.md`)).status, 404);
  assert.equal((await fetch(`${origin}/src%2f..%2f..%2fsecret.js`)).status, 403);
  assert.equal((await fetch(`${origin}/src/%00.js`)).status, 400);
  assert.equal((await fetch(`${origin}/src/%ZZ.js`)).status, 400);
  assert.equal((await fetch(`${origin}/`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${origin}/src/missing.js`)).status, 404);
});
