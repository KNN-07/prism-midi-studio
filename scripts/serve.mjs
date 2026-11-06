import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.mid': 'audio/midi', '.midi': 'audio/midi', '.webm': 'video/webm',
};

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** A small loopback-only development server. Only application assets are exposed. */
export function createStaticServer(root = projectRoot) {
  root = path.resolve(root);
  return createServer(async (request, response) => {
    const reply = (status, message) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : message);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return reply(405, 'Method not allowed');
    }
    try {
      let pathname;
      try { pathname = decodeURIComponent((request.url || '/').split('?')[0]); }
      catch { return reply(400, 'Invalid URL'); }
      if (pathname.includes('\0') || pathname.includes('\\')) return reply(400, 'Invalid path');
      const segments = pathname.split('/');
      if (segments.includes('..')) return reply(403, 'Path is outside the application');
      if (segments.some(segment => segment.startsWith('.'))) return reply(403, 'Hidden files are not served');
      if (pathname === '/') pathname = '/index.html';
      const file = pathname.slice(1);
      const allowed = ['index.html', 'styles.css', 'favicon.svg', 'favicon.ico'].includes(file)
        || /^(src|public|assets)\//.test(file);
      if (!allowed || !mimeTypes[path.extname(file).toLowerCase()]) return reply(404, 'Not found');
      const target = path.resolve(root, file);
      if (!inside(root, target)) return reply(403, 'Path is outside the application');
      const [actualRoot, actualFile] = await Promise.all([realpath(root), realpath(target)]);
      if (!inside(actualRoot, actualFile)) return reply(403, 'Path is outside the application');
      if (!(await stat(actualFile)).isFile()) return reply(404, 'Not found');
      const contents = await readFile(actualFile);
      response.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(file).toLowerCase()],
        'Content-Length': contents.byteLength,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      response.end(request.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return reply(404, 'Not found');
      console.error('Request failed:', error.message);
      reply(500, 'Unable to read the requested file');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf('--port');
  const port = Number(portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('Provide a port between 1 and 65535: node scripts/serve.mjs --port 5173');
    process.exitCode = 1;
  } else {
    const root = args.includes('--dist') ? path.join(projectRoot, 'dist') : projectRoot;
    const server = createStaticServer(root);
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Choose another with --port 5174.` : error.message);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`PRISM MIDI Studio: http://127.0.0.1:${port}`);
      console.log(`Serving ${args.includes('--dist') ? 'production build' : 'source files'}. Press Ctrl+C to stop.`);
    });
  }
}
