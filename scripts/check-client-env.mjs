import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build, createServer } from '../frontend/node_modules/vite/dist/node/index.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = resolve(root, 'artifacts/security');
mkdirSync(out, { recursive: true });
const fixture = mkdtempSync(resolve(out, 'client-env-'));
const canaries = Object.fromEntries(['VITE_FROM_PROCESS', 'VITE_FROM_FILE', 'SERVER_ONLY_SECRET',
  'VITE_SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SECRET', 'EXPO_PUBLIC_SECRET'].map(name => [name, randomBytes(24).toString('hex')]));
const injected = { ...canaries, BOILER_API_PORT: '8345' };
delete injected.VITE_FROM_FILE;
const original = Object.fromEntries([...Object.keys(injected), 'NODE_ENV'].map(name => [name, process.env[name]]));
writeFileSync(resolve(fixture, '.env.production'), `VITE_FROM_FILE=${canaries.VITE_FROM_FILE}\n`);
writeFileSync(resolve(fixture, '.env.development'), `VITE_FROM_FILE=${canaries.VITE_FROM_FILE}\n`);
const entry = resolve(fixture, 'entry.js');
writeFileSync(entry, 'globalThis.envProbe = { env: import.meta.env, direct: import.meta.env.VITE_FROM_PROCESS, node: typeof process === "undefined" ? null : process.env };');
const options = { root: fixture, envDir: fixture, configFile: resolve(root, 'frontend/vite.config.ts'), logLevel: 'silent' };
const previousDirectory = process.cwd();
const checks = [];
const result = { passed: false, scope: 'Real Vite production output and development transform with synthetic values; no real secrets', checks };
let server;
function assertPrivate(code) {
  for (const [name, value] of Object.entries(canaries)) assert.ok(!code.includes(value), `Client output exposes ${name}`);
}
try {
  Object.assign(process.env, injected);
  process.chdir(fixture);
  process.env.NODE_ENV = 'production';
  const bundled = await build({ ...options, build: { write: false, rollupOptions: { input: entry } } });
  const code = bundled.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
  assertPrivate(code);
  checks.push('Production output excludes environment-file and externally injected canaries');
  const context = {};
  runInNewContext(code, context);
  assert.equal(context.envProbe.env.MODE, 'production');
  assert.equal(context.envProbe.env.PROD, true);
  assert.equal(context.envProbe.env.DEV, false);
  assert.equal(context.envProbe.direct, undefined);
  checks.push('Built-in Vite constants still work while custom environment values remain unavailable');
  process.env.NODE_ENV = 'development';
  server = await createServer(options);
  const transformed = await server.transformRequest('/entry.js');
  assert.ok(transformed);
  assertPrivate(transformed.code);
  checks.push('Development client module also excludes canaries');
  assert.equal(server.config.server.proxy['/api'].target, 'http://127.0.0.1:8345');
  checks.push('The server-only API proxy port remains configurable');
  result.passed = true;
} catch (error) {
  let message = String(error.stack ?? error);
  for (const value of Object.values(canaries)) message = message.replaceAll(value, '[REDACTED]');
  result.error = message;
  process.exitCode = 1;
} finally {
  await server?.close();
  process.chdir(previousDirectory);
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  writeFileSync(resolve(out, 'client-env-check.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
