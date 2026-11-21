import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const baseline = resolve(root, 'artifacts/integrity/frontend.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sri = bytes => 'sha384-' + createHash('sha384').update(bytes).digest('base64');

export function verifyFile(path, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected ?? '') || sha(readFileSync(path)) !== expected) {
    throw new Error('Resource integrity check failed: ' + path);
  }
}

function files(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = resolve(directory, name);
    if (lstatSync(path).isSymbolicLink()) throw new Error('Resource symlinks are not allowed');
    return lstatSync(path).isDirectory() ? files(path) : [path];
  });
}

export function sealBuild(directory, record = baseline) {
  const hashes = Object.fromEntries(files(directory).map(path => [relative(directory, path).replaceAll('\\', '/'), sha(readFileSync(path))]));
  if (!hashes['index.html']) throw new Error('Build has no index.html');
  mkdirSync(dirname(record), { recursive: true });
  const map = readFileSync(resolve(directory, 'index.html'), 'utf8').match(/<script type="importmap">(.*?)<\/script>/s)?.[1];
  const import_map_csp = map ? "'sha256-" + createHash('sha256').update(map).digest('base64') + "'" : null;
  writeFileSync(record + '.tmp', JSON.stringify({ version: 1, files: hashes, import_map_csp }, null, 2) + '\n');
  renameSync(record + '.tmp', record);
}

export function importMapCsp() {
  const value = JSON.parse(readFileSync(baseline, 'utf8')).import_map_csp;
  if (!/^'sha256-[A-Za-z0-9+/]{43}='$/.test(value ?? '')) throw new Error('Missing import-map CSP hash');
  return value;
}

export function verifyBuild(directory, record = baseline) {
  const manifest = JSON.parse(readFileSync(record, 'utf8'));
  if (manifest.version !== 1 || !manifest.files?.['index.html']) throw new Error('Build integrity manifest is invalid');
  const actual = files(directory).map(path => relative(directory, path).replaceAll('\\', '/')).sort();
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error('Build file list changed');
  for (const name of actual) verifyFile(resolve(directory, name), manifest.files[name]);
  return manifest.files;
}

export function resourceIntegrity() {
  let directory;
  const verifyFont = () => {
    const manifest = JSON.parse(readFileSync(resolve(root, process.env.BOILER_INTEGRITY_MANIFEST ?? 'infra/resource-integrity.json'), 'utf8'));
    verifyFile(resolve(root, 'docs/fonts/PretendardVariable.woff2'), manifest.files?.font?.sha256);
  };
  return {
    name: 'resource-integrity',
    enforce: 'post',
    configResolved(config) { directory = resolve(config.root, config.build.outDir); },
    buildStart: verifyFont,
    writeBundle() {
      const path = resolve(directory, 'index.html');
      const assets = files(directory).map(path => relative(directory, path).replaceAll('\\', '/'));
      const integrity = name => sri(readFileSync(resolve(directory, name)));
      let html = readFileSync(path, 'utf8').replace(/<(script|link)\b[^>]*(?:src|href)="\/([^"?#]+)"[^>]*>/g, (tag, _kind, name) => {
        return assets.includes(name) ? tag.replace(/\s+integrity="[^"]*"/g, '').replace(/>$/, ` integrity="${integrity(name)}">`) : tag;
      });
      const integrityMap = Object.fromEntries(assets.filter(name => name.endsWith('.js')).map(name => ['/' + name, integrity(name)]));
      html = html.replace('<head>', '<head><script type="importmap">' + JSON.stringify({ integrity: integrityMap }) + '</script>');
      writeFileSync(path, html);
      sealBuild(directory);
    },
    configureServer(server) {
      verifyFont();
      server.middlewares.use((request, response, next) => {
        try { if (request.url?.includes('PretendardVariable.woff2')) verifyFont(); next(); }
        catch { response.statusCode = 503; response.end('Resource integrity check failed'); }
      });
    },
    configurePreviewServer(server) {
      const hashes = verifyBuild(directory);
      server.middlewares.use((request, response, next) => {
        try {
          const pathname = new URL(request.url, 'http://localhost').pathname;
          if (pathname === '/api' || pathname.startsWith('/api/')) return next();
          const name = decodeURIComponent(pathname).replace(/^\/+/, '');
          const path = resolve(directory, name || 'index.html');
          const key = relative(directory, path).replaceAll('\\', '/');
          if (Object.hasOwn(hashes, key) || (existsSync(path) && lstatSync(path).isFile())) verifyFile(path, hashes[key]);
          else verifyFile(resolve(directory, 'index.html'), hashes['index.html']);
          next();
        } catch { response.statusCode = 503; response.end('Resource integrity check failed'); }
      });
    },
  };
}
