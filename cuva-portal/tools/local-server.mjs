/* =====================================================================
 * Local preview server — try the site on your own computer before
 * deploying. Runs the same API function and the official Netlify Blobs
 * local server (data saved in .netlify/local-blobs).
 *
 *   npm run local            → http://localhost:8888
 *   (Windows PowerShell)     $env:SUPER_ADMIN_PASSWORD="your-password"; npm run local
 *   (macOS / Linux)          SUPER_ADMIN_PASSWORD=your-password npm run local
 *
 * Not used on Netlify itself.
 * ===================================================================== */
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobsServer } from '@netlify/blobs/server';
import { setEnvironmentContext } from '@netlify/blobs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(root, 'public');
const PORT = Number(process.env.PORT) || 8888;

// 1. Local Blobs storage
// The emulator's read endpoint omits the ETag that Netlify's real service returns,
// which conditional (safe) writes need. Add it back.
class LocalBlobsServer extends BlobsServer {
  async get(req) {
    const res = await super.get(req);
    if (res.status !== 200 || res.headers.get('etag')) return res;
    try {
      const apiMatch = this.parseAPIRequest(req);
      const url = apiMatch?.url ?? new URL(req.url ?? '', this.address);
      const { dataPath, key } = this.getLocalPaths(url);
      if (!key || !dataPath) return res;
      const headers = new Headers(res.headers);
      headers.set('etag', await BlobsServer.generateETag(dataPath));
      return new Response(await res.arrayBuffer(), { status: 200, headers });
    } catch {
      return res;
    }
  }
}
const blobs = new LocalBlobsServer({ directory: join(root, '.netlify', 'local-blobs'), token: 'local-token' });
const { port: blobsPort } = await blobs.start();

// The local Blobs emulator is not atomic: it checks ETags and writes in separate steps,
// and it reads data and computes the ETag separately. Netlify's real service treats
// conditional writes atomically. This small proxy runs storage requests one at a time
// (writes ≥2 ms apart, because the emulator's ETags have millisecond resolution) so
// local behaviour matches production.
let queue = Promise.resolve();
const proxy = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const forward = () => new Promise(resolve => {
    const upstream = http.request(
      { host: '127.0.0.1', port: blobsPort, path: req.url, method: req.method, headers: req.headers },
      up => {
        const body = [];
        up.on('data', d => body.push(d));
        up.on('end', () => {
          res.writeHead(up.statusCode, up.headers);
          res.end(Buffer.concat(body));
          resolve();
        });
      });
    upstream.on('error', () => { res.writeHead(502); res.end(); resolve(); });
    upstream.end(Buffer.concat(chunks));
  });
  const isWrite = req.method === 'PUT' || req.method === 'DELETE';
  const done = queue.then(forward).then(() => (isWrite ? new Promise(r => setTimeout(r, 2)) : null));
  queue = done.catch(() => {});
  await done;
});
await new Promise(r => proxy.listen(0, '127.0.0.1', r));
const blobsURL = `http://127.0.0.1:${proxy.address().port}`;
setEnvironmentContext({ edgeURL: blobsURL, uncachedEdgeURL: blobsURL, siteID: 'local-site', token: 'local-token' });

// 2. The same API function Netlify runs
process.env.CUVA_LOCAL_PREVIEW = '1';   // without Gmail settings, reset codes are printed here
const { default: api } = await import('../netlify/functions/api.mjs');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, x]) : [[k, v]])),
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
    });
    const response = await api(request, { ip: req.socket.remoteAddress });
    const headers = {};
    response.headers.forEach((value, key) => { if (key !== 'set-cookie') headers[key] = value; });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }

  // Static files with Netlify-style pretty URLs (/passes → passes.html)
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  if (!extname(pathname)) pathname += '.html';
  const file = normalize(join(PUBLIC_DIR, pathname));
  try {
    if (!file.startsWith(PUBLIC_DIR + sep) || !statSync(file).isFile()) throw new Error('not found');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`CUVA Portal (local preview) → http://localhost:${PORT}`);
  if (!process.env.SUPER_ADMIN_PASSWORD) {
    console.log('Tip: set SUPER_ADMIN_PASSWORD to be able to sign in as the Super Admin (see README).');
  }
});
