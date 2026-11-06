import { cp, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, 'dist');
const extensions = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff2', '.mp3', '.ogg', '.wav', '.mid', '.midi', '.webm']);

// This script may only replace this checkout's literal dist directory.
if (path.dirname(output) !== root || path.basename(output) !== 'dist') throw new Error('Unsafe build destination');
try {
  if ((await lstat(output)).isSymbolicLink()) throw new Error('Refusing to replace a linked dist directory');
} catch (error) { if (error.code !== 'ENOENT') throw error; }

// Validate the entry points before replacing the previous build.
for (const file of ['index.html', 'styles.css', 'src/app.js']) {
  if (!(await lstat(path.join(root, file))).isFile()) throw new Error(`Missing application entry point: ${file}`);
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
let files = 0;

async function copyAsset(relative) {
  const source = path.join(root, relative);
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Refusing linked source: ${relative}`);
  if (info.isDirectory()) {
    for (const item of await readdir(source)) {
      if (!item.startsWith('.')) await copyAsset(path.join(relative, item));
    }
  } else if (info.isFile() && extensions.has(path.extname(relative).toLowerCase())) {
    const destination = path.join(output, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination);
    files++;
  }
}

for (const file of ['index.html', 'styles.css', 'src']) await copyAsset(file);
for (const file of ['public', 'assets', 'favicon.svg', 'favicon.ico']) {
  try { await lstat(path.join(root, file)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  await copyAsset(file);
}
console.log(`Built ${files} application files into dist/. No dependencies or bundler required.`);
