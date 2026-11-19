import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../frontend/node_modules/playwright/index.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputRoot = resolve(root, 'artifacts/security/https-verification');
const out = resolve(outputRoot, `run-${Date.now()}`);
const caddy = resolve(root, 'artifacts/security/tools/caddy.exe');
const python = resolve(root, '.venv/Scripts/python.exe');
const httpPort = 18080, httpsPort = 18443, apiPort = 8000;
const base = `https://127.0.0.1:${httpsPort}`;
mkdirSync(out, { recursive: true });
const key = randomBytes(32).toString('base64url');
const accounts = JSON.stringify([{ user_id: 'tls-fixture', role: 'operator', key_hash: createHash('sha256').update(key).digest('hex') }]);
const env = { ...process.env, PYTHONUTF8: '1', APP_PUBLIC_ORIGIN: base, AUTH_SESSION_SECONDS: '60', AUTH_USERS_JSON: accounts,
  XDG_DATA_HOME: resolve(out, 'caddy-data'), XDG_CONFIG_HOME: resolve(out, 'caddy-config'),
  SIMULATOR_DB_PATH: resolve(out, 'fixture.sqlite'),
  AGENT_TRACE_DIR: resolve(out, 'traces'), FORECAST_MODEL_PATH: resolve(out, 'no-model.json') };
const fixture = `from datetime import datetime, UTC
from types import SimpleNamespace
from uuid import uuid4
from backend.app.main import create_app
from backend.app.security import Security
from backend.app.domain.registry import make_registry, REPRESENTATIVE
from backend.app.domain.state import BoilerState
from backend.app.websocket.hub import Hub
from backend.app.agent.traces import TraceStore
from backend.app.simulator.service import Simulator
app = create_app()
app.state.security = Security()
app.state.boiler = BoilerState(make_registry(list(REPRESENTATIVE)), SimpleNamespace(history_limit=120, stale_ms=3600000, interval_ms=1000))
app.state.boiler.apply({'run_id': str(uuid4()), 'sequence': 1, 'source_time': '2026-01-01T00:00:00',
    'emitted_at': datetime.now(UTC).isoformat(), 'measurements': {tag: '100.00' for tag in REPRESENTATIVE}}, 0)
app.state.boiler.kafka = 'CONNECTED'
app.state.hub = Hub()
app.state.traces = TraceStore()
app.state.simulator = Simulator(app.state.boiler, app.state.traces)
`;
writeFileSync(resolve(out, 'fixture_app.py'), fixture);
const config = `{
  admin off
  persist_config off
  local_certs
  skip_install_trust
  default_bind 127.0.0.1
  http_port ${httpPort}
  https_port ${httpsPort}
  storage file_system ${JSON.stringify(resolve(out, 'storage').replaceAll('\\', '/'))}
}
http:// {
}
${readFileSync(resolve(root, 'infra/Caddyfile'), 'utf8')}`;
const configPath = resolve(out, 'Caddyfile');
writeFileSync(configPath, config);
const children = [], logs = [], checks = [];
const result = { passed: false, run: out, scope: 'Real Caddy TLS, Uvicorn, browser and WebSocket; synthetic observations, ephemeral credentials and isolated SQLite; no public deployment or system trust changes', checks };
let browser, ca;
function start(command, args, name) {
  const stream = createWriteStream(resolve(out, name + '.log')); logs.push(stream);
  const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(stream); child.stderr.pipe(stream); children.push(child);
  return child;
}
const pass = name => checks.push(name);
async function poll(check, name) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    try { if (await check()) return; } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error('Timeout: ' + name);
}
function request(path, { url = base, method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolveResponse, reject) => {
    const target = new URL(path, url);
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      method, headers, ...(target.protocol === 'https:' ? { ca, rejectUnauthorized: true } : {}),
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolveResponse({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString() }));
    });
    request.setTimeout(5000, () => request.destroy(new Error('Request timeout')));
    request.on('error', reject);
    request.end(body);
  });
}
try {
  for (const port of [apiPort, httpPort, httpsPort]) await new Promise((resolvePort, reject) => {
    const probe = createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(resolvePort));
  });
  execFileSync(caddy, ['adapt', '--config', configPath, '--adapter', 'caddyfile', '--validate'], { cwd: root, env, stdio: 'pipe', windowsHide: true });
  pass('Production Caddyfile adapts and validates with isolated loopback TLS settings');
  start(python, ['-m', 'uvicorn', 'fixture_app:app', '--app-dir', out, '--lifespan', 'off', '--host', '127.0.0.1', '--port', String(apiPort),
    '--proxy-headers', '--forwarded-allow-ips', '127.0.0.1', '--no-access-log', '--ws-max-size', '1024', '--ws-max-queue', '8'], 'api');
  await poll(async () => (await request('/api/health', { url: `http://127.0.0.1:${apiPort}` })).status === 403, 'API rejects plain HTTP');
  pass('Real Uvicorn rejects direct HTTP when the application Origin requires HTTPS');
  start(caddy, ['run', '--config', configPath, '--adapter', 'caddyfile'], 'caddy');
  await poll(() => { ca = readFileSync(resolve(out, 'storage/pki/authorities/local/root.crt')); return true; }, 'Local test CA');
  await poll(async () => (await request('/api/health')).status === 200, 'HTTPS proxy');
  pass('HTTPS certificate validates against the test CA without disabling Node certificate verification');
  const redirect = await request('/api/health', { url: `http://127.0.0.1:${httpPort}` });
  assert.equal(redirect.status, 308); assert.equal(redirect.headers.location, 'https://127.0.0.1/api/health');
  pass('Automatic HTTP redirect preserves the path and points to the standard external HTTPS port');
  for (const path of ['/.env', '/.env.security', '/.git/config', '/src/App.tsx', '/data/raw/file.csv', '/artifacts/simulator.sqlite', '/docs/index.html', '/assets/source.js.map']) {
    assert.equal((await request(path)).status, 404, path);
  }
  pass('Environment, Git, source, raw data, artifacts, documentation and source map paths return 404');
  assert.equal((await request('/api/registry')).status, 401);
  const loginBody = JSON.stringify({ user_id: 'tls-fixture', access_key: key });
  const jsonHeaders = { Origin: base, 'Content-Type': 'application/json' };
  assert.equal((await request('/api/session', { method: 'POST', body: loginBody, headers: { ...jsonHeaders, Origin: 'https://attacker.invalid' } })).status, 403);
  const login = await request('/api/session', { method: 'POST', body: loginBody, headers: jsonHeaders });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'][0];
  assert.ok(['HttpOnly', 'Secure', 'SameSite=strict', 'Max-Age=60'].every(part => cookie.includes(part)));
  const authenticated = { Cookie: cookie.split(';')[0] };
  pass('Anonymous access and foreign-Origin login are blocked; HTTPS login creates a bounded Secure/HttpOnly/Strict cookie');
  const state = await request('/api/state', { headers: { ...authenticated, 'X-Forwarded-Proto': 'http', 'X-Forwarded-For': '198.51.100.99' } });
  assert.equal(state.status, 200);
  assert.equal(JSON.parse(state.text).status, 'LIVE');
  for (const [path, expected] of [['/', 200], ['/api/state', 401]]) {
    const response = await request(path);
    assert.equal(response.status, expected, `HTTP ${path}: ${response.text.slice(0, 80)}`);
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.ok(response.headers['strict-transport-security'].includes('max-age=31536000'));
    assert.ok(response.headers['content-security-policy']);
  }
  assert.equal(state.headers['access-control-allow-origin'], undefined);
  pass('Proxy replaces forged forwarding headers, and both frontend and rejected API responses retain security headers without CORS grants');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [], policyErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/violates.*Content Security Policy|Refused to.*Content Security Policy/i.test(message.text())) policyErrors.push(message.text()); });
  await page.goto(base);
  await page.getByLabel('사용자 ID', { exact: true }).fill('tls-fixture');
  await page.getByLabel('개인 접근 키', { exact: true }).fill(key);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await poll(async () => (await page.getByTestId('ws-status').textContent()) === 'CONNECTED', 'Browser WSS telemetry');
  await poll(async () => await page.locator('.scene-marker').count() === 7, 'Real registry and WebGL');
  assert.ok((await context.cookies()).some(item => item.name === 'boiler_session' && item.secure && item.httpOnly && item.sameSite === 'Strict'));
  assert.deepEqual(errors, []); assert.deepEqual(policyErrors, []);
  await page.screenshot({ path: resolve(out, 'https-dashboard.png'), fullPage: true });
  pass('The browser logs in over HTTPS, renders seven real registry groups and receives telemetry over WSS without CSP violations');
  assert.equal(await page.evaluate(() => new Promise(resolveFrame => {
    window.tlsProbeClose = null;
    const ws = window.tlsProbeSocket = new WebSocket(`wss://${location.host}/api/ws`);
    ws.onmessage = event => resolveFrame(JSON.parse(event.data).current.sequence);
    ws.onclose = event => { window.tlsProbeClose = event.code; };
    ws.onerror = () => resolveFrame('failed');
  })), 1);
  await page.getByRole('button', { name: 'tls-fixture · 로그아웃', exact: true }).click();
  await page.getByRole('heading', { name: '운영 화면 로그인' }).waitFor();
  await poll(() => page.evaluate(() => window.tlsProbeClose === 1008), 'Logout closes real WSS');
  pass('Logout revokes the real session and closes an already open WSS connection with code 1008');
  assert.deepEqual(errors, []);
  result.passed = true;
} catch (error) {
  result.error = String(error.stack ?? error).replaceAll(key, '[REDACTED]');
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children.reverse()) if (child.exitCode === null) {
    child.kill();
    await new Promise(resolveExit => { child.once('exit', resolveExit); setTimeout(resolveExit, 3000); });
  }
  for (const log of logs) log.end();
  writeFileSync(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
  writeFileSync(resolve(outputRoot, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
