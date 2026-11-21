import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sealBuild, verifyBuild, verifyFile } from './frontend-integrity.mjs';
import { chromium } from '../frontend/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'artifacts/security/frontend-integrity');
mkdirSync(output, { recursive: true });
const out = mkdtempSync(resolve(output, 'run-'));
const fixture = resolve(out, 'fixture');
mkdirSync(fixture);
writeFileSync(resolve(fixture, 'index.html'), '<html>fixture</html>');
const record = resolve(out, 'manifest.json');
sealBuild(fixture, record);
verifyBuild(fixture, record);
writeFileSync(resolve(fixture, 'index.html'), '<html>changed</html>');
assert.throws(() => verifyBuild(fixture, record));
assert.throws(() => verifyFile(resolve(fixture, 'index.html'), undefined));
const checks = ['Build tampering and missing expected hashes fail closed'];

const dist = resolve(out, 'dist');
cpSync(resolve(root, 'frontend/dist'), dist, { recursive: true });
verifyBuild(dist);
const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
const tags = [...html.matchAll(/<(script|link)\b[^>]*\bintegrity="(sha384-[^"]+)"[^>]*>/g)];
assert.ok(tags.length >= 2);
for (const [tag, , expected] of tags) {
  const name = tag.match(/(?:src|href)="\/([^"]+)"/)[1];
  assert.equal('sha384-' + createHash('sha384').update(readFileSync(resolve(dist, name))).digest('base64'), expected);
}
const importMap = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]);
for (const name of readdirSync(resolve(dist, 'assets')).filter(name => name.endsWith('.js'))) {
  assert.equal(importMap.integrity['/assets/' + name], 'sha384-' + createHash('sha384').update(readFileSync(resolve(dist, 'assets', name))).digest('base64'));
}
assert.equal(readdirSync(resolve(dist, 'assets')).filter(name => name.endsWith('.css')).length, 1);
checks.push('All JS chunks have import-map integrity; entry JS and the single CSS bundle have matching SRI');

const probe = createServer();
await new Promise(ok => probe.listen(0, '127.0.0.1', ok));
const port = probe.address().port;
await new Promise(ok => probe.close(ok));
const server = spawn(process.execPath, [resolve(root, 'frontend/node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--outDir', dist],
  { cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', data => { logs += data; });
server.stderr.on('data', data => { logs += data; });
const base = `http://127.0.0.1:${port}`;
let browser;
try {
  let ready = false;
  for (let index = 0; index < 100; index++) {
    try { ready = (await fetch(base)).status === 200; } catch {}
    if (ready) break;
    if (server.exitCode !== null) throw new Error(logs);
    await new Promise(ok => setTimeout(ok, 100));
  }
  assert.ok(ready, logs);
  const asset = '/assets/' + readdirSync(resolve(dist, 'assets')).find(name => name.endsWith('.js'));
  const path = resolve(dist, asset.slice(1));
  const original = readFileSync(path);
  assert.equal((await fetch(base + asset)).status, 200);
  writeFileSync(path, Buffer.concat([original, Buffer.from('\n// tampered')]));
  assert.equal((await fetch(base + asset)).status, 503);
  unlinkSync(path);
  assert.equal((await fetch(base + asset)).status, 503);
  writeFileSync(path, original);
  assert.equal((await fetch(base + asset)).status, 200);
  checks.push('Real preview serves verified bytes and rejects modified or missing assets with HTTP 503');
  writeFileSync(resolve(dist, 'unregistered.js'), 'globalThis.changed=true');
  assert.equal((await fetch(base + '/unregistered.js')).status, 503);
  assert.throws(() => verifyBuild(dist));
  checks.push('Unregistered output is blocked during serving and startup validation');
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const modulePath = '/assets/' + readdirSync(resolve(dist, 'assets')).find(name => name.startsWith('sensor-catalog-'));
  const page = await browser.newPage();
  await page.route('**/api/session', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.route('**' + modulePath, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + '\n// changed in transit' });
  });
  await page.goto(base);
  await page.getByRole('heading', { name: '운영 화면 로그인' }).waitFor();
  assert.equal(await page.evaluate(async path => { try { await import(path); return false; } catch { return true; } }, modulePath), true);
  const clean = await browser.newPage();
  await clean.route('**/api/session', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await clean.goto(base);
  await clean.getByRole('heading', { name: '운영 화면 로그인' }).waitFor();
  assert.equal(await clean.evaluate(async path => { try { await import(path); return true; } catch { return false; } }, modulePath), true);
  checks.push('Chrome blocks a changed lazy module in transit while the unchanged module still imports');
  const result = { passed: true, checks };
  writeFileSync(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  server.kill();
  await new Promise(ok => { if (server.exitCode !== null) ok(); else server.once('exit', ok); });
}
