import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from '../frontend/node_modules/playwright/index.mjs';
import { inspect } from './review-ui.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'frontend/dist');
const brandReview = process.argv.includes('--brand');
const out = resolve(root, 'artifacts/e2e', brandReview ? 'brand-theme' : 'bundle-performance');
mkdirSync(out, { recursive: true });
const result = { passed: false, fixture: 'Isolated synthetic API and telemetry; no backend or database', checks: [] };
const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
const entry = html.match(/<script[^>]+src="([^"]+\.js)"/)[1];
const entryCode = readFileSync(resolve(dist, '.' + entry));
result.entry = { file: entry, bytes: entryCode.length, gzipBytes: gzipSync(entryCode).length };
result.chunks = readdirSync(resolve(dist, 'assets')).filter(name => name.endsWith('.js')).map(file => ({ file, bytes: statSync(resolve(dist, 'assets', file)).size }));

const ids = ['feeders', 'furnace', 'superheater', 'reheater', 'economizer', 'scr', 'stack'];
const names = ['급탄기', '화로', '과열기', '재열기', '절탄기', '탈질 설비', '굴뚝'];
const equipment = ids.map((id, index) => ({ id, label: names[index], name: names[index], description: '격리 브라우저 검증용 논리 설비', primary_tag: `fixture-${id}`, position: [index * 3 - 9, 0, index % 2 ? 1.5 : -1.5], size: [1.6, 2.2, 1.6] }));
const registry = {
  equipment, position_basis: 'Synthetic test coordinates',
  sensors: Object.fromEntries(equipment.map(item => [item.primary_tag, { tag: item.primary_tag, label: item.name + ' 시험 센서', equipment: item.id, section: 'fixture', measurement_type: 'temperature', unit: '°C', unit_basis: 'Synthetic fixture', source_tag: null, description: null, mapping_confidence: 'logical-group', scene_position: [item.position[0], 2.7, item.position[2]], mapping_basis: 'Synthetic fixture', representative: true, related_tags: [] }])),
  flows: [{ id: 'fixture-flow', label: '검증용 흐름', equipment: ids }],
};
const snapshot = sequence => ({ type: 'telemetry', status: 'LIVE', stale: false, kafka: 'CONNECTED', error: null, rejected_events: 0, replay_interval_ms: 1000, stale_after_ms: 60000,
  current: { run_id: 'isolated-bundle-check', sequence, source_time: `2026-01-01T00:00:${String(sequence).padStart(2, '0')}`, emitted_at: new Date().toISOString(), kafka_offset: sequence,
    sensors: Object.fromEntries(equipment.map((item, index) => [item.primary_tag, { value: 100 + index + sequence, raw: String(100 + index + sequence), quality: 'valid', error: null }])) } });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
  try { response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(readFileSync(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const poll = async (check, label) => {
  const until = Date.now() + 15000;
  while (Date.now() < until) { if (await check()) return; await new Promise(resolvePoll => setTimeout(resolvePoll, 50)); }
  throw new Error('Timeout: ' + label);
};
try {
  assert.ok(entryCode.length < 300000, `Initial JS exceeds 300 kB: ${entryCode.length}`);
  result.checks.push('Initial JavaScript is below 300 kB');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  await context.addInitScript(() => {
    window.__sceneCommits = 0;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(), inject() { return 1; }, onCommitFiberUnmount() {},
      onCommitFiberRoot(_renderer, rootFiber) {
        function visit(fiber) {
          if (!fiber) return;
          if (fiber.elementType?.displayName === 'SceneCanvas' && (fiber.flags & 1)) window.__sceneCommits++;
          visit(fiber.child); visit(fiber.sibling);
        }
        visit(rootFiber.current);
      },
    };
  });
  let authenticated = false;
  const sockets = new Set();
  const apiRequests = [];
  await context.routeWebSocket('**/api/ws', socket => { sockets.add(socket); socket.send(JSON.stringify(snapshot(1))); socket.onClose(() => sockets.delete(socket)); });
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    apiRequests.push(url.pathname);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/session') return json(authenticated ? { user_id: 'fixture-viewer', role: 'viewer' } : { detail: 'Login required' }, authenticated ? 200 : 401);
    if (url.pathname === '/api/registry') return json(registry);
    if (url.pathname === '/api/forecast') return brandReview ? json({ target: '재열기 시험 센서', unit: '°C', input_value: 114, prediction: 114.2,
      selected_model: 'linear_ar', horizon_minutes: 5, forecast_time: '2026-01-01T00:05:11', advisory: '격리 UI 검증용 값입니다.', status: 'LIVE',
      beats_naive_on_test: false, test: { naive: { mae: .03, rmse: .08, samples: 10 }, linear_ar: { mae: .1, rmse: .11, samples: 10 } } })
      : json({ detail: '격리 검증에서는 예측 모델을 실행하지 않습니다.' }, 409);
    if (url.pathname === '/api/history/metadata') return json({ first_time: '2026-01-01T00:00:00', last_time: '2026-01-02T00:00:00', row_count: 86401, time_basis: 'Synthetic fixture', timezone_offset: null });
    if (url.pathname === '/api/simulator') return json({ value: 0, revision: 0, enabled: false, proposals: [] });
    if (url.pathname === '/api/simulator/audit') return json([]);
    if (url.pathname === '/api/sensors/history') return json({ tag: url.searchParams.get('tag'), unit: '°C', points: [] });
    if (brandReview && url.pathname === '/api/history/range') {
      const start = url.searchParams.get('start'), end = url.searchParams.get('end'), tag = url.searchParams.get('tag');
      const baseValue = tag.includes('feeders') ? 100 : 110;
      const startTime = Date.parse(start + 'Z'), duration = Date.parse(end + 'Z') - startTime;
      const points = [0, 1, 2, 3].map(index => ({ source_row: index + 2,
        source_time: new Date(startTime + duration * index / 3).toISOString().slice(0, 19),
        raw: String(baseValue + index), value: baseValue + index, quality: 'valid', gap_before: false }));
      return json({ tag, unit: '°C', start, end, points, original_count: 4, sample_count: 4,
        valid_count: 4, missing_count: 0, parse_error_count: 0, min: baseValue, max: baseValue + 3, downsampled: false });
    }
    throw new Error('Unexpected API request: ' + url.pathname);
  });
  const page = await context.newPage();
  const errors = [];
  const loadedScripts = new Set();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { const pathname = new URL(request.url()).pathname; if (pathname.endsWith('.js')) loadedScripts.add(pathname); });
  await page.goto(base);
  await page.getByRole('heading', { name: '운영 화면 로그인' }).waitFor();
  if (brandReview) {
    const colors = await page.evaluate(() => ({ background: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.body).color, scheme: getComputedStyle(document.documentElement).colorScheme }));
    assert.deepEqual(colors, { background: 'rgb(9, 25, 35)', text: 'rgb(223, 234, 240)', scheme: 'dark' }, 'Brand tint reaches login, text and native controls');
    await inspect(page, 'brand-login', out);
    await page.screenshot({ path: resolve(out, 'login.png'), fullPage: true });
  }
  assert.deepEqual([...loadedScripts], [entry]);
  result.checks.push('Login downloads only the entry script; 3D and optional panels stay deferred');

  authenticated = true;
  await page.reload();
  await poll(async () => await page.locator('.scene-marker').count() === 7, 'Scene projection and seven markers');
  assert.equal(await page.locator('canvas').count(), 1);
  assert.ok([...loadedScripts].some(path => path.includes('BoilerScene-')));
  for (const name of ['OperationsAnalysis-', 'WorkspacePanel-', 'SimulatorPanel-', 'RecordsPanel-']) assert.ok(![...loadedScripts].some(path => path.includes(name)), `${name} loaded too early`);
  assert.ok(!apiRequests.includes('/api/history/metadata') && !apiRequests.includes('/api/simulator'));
  result.checks.push('Authenticated monitoring loads 3D; unvisited views make no requests and download no panel chunks');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await poll(async () => await page.locator('.game-viewport').getAttribute('data-animation') === 'paused', 'Reduced motion');
  const sceneCommitsBefore = await page.evaluate(() => window.__sceneCommits);
  assert.ok(sceneCommitsBefore > 0, 'Scene render instrumentation attached');
  for (let sequence = 2; sequence <= 11; sequence++) {
    for (const socket of sockets) socket.send(JSON.stringify(snapshot(sequence)));
    await poll(async () => await page.getByTestId('sequence').textContent() === String(sequence), `Telemetry ${sequence}`);
  }
  const sceneCommitsAfter = await page.evaluate(() => window.__sceneCommits);
  result.sceneRendersForTenTelemetryUpdates = sceneCommitsAfter - sceneCommitsBefore;
  assert.equal(result.sceneRendersForTenTelemetryUpdates, 0);
  result.checks.push('Ten new telemetry observations update HTML values without rendering SceneCanvas');

  const scene = page.getByLabel('계통도 화면', { exact: true });
  const target = equipment[3];
  const marker = page.getByTestId('marker-' + target.primary_tag);
  const bounds = await scene.boundingBox();
  await page.mouse.click(bounds.x + Number(await marker.getAttribute('data-equipment-x')), bounds.y + Number(await marker.getAttribute('data-equipment-y')));
  await poll(async () => (await page.getByTestId('scene-selected').textContent()).includes(target.name + ' 시험 센서'), 'Real WebGL mesh selection');
  const originalCanvas = await page.locator('canvas').evaluateHandle(node => node);
  await page.getByRole('button', { name: '확대', exact: true }).click();
  assert.equal(await page.getByLabel('계통도 확대 비율').textContent(), '110%');
  await page.getByRole('button', { name: '보기 초기화' }).click();
  result.checks.push('Actual WebGL mesh selection and camera zoom/reset remain usable with reduced motion');

  const navigate = name => page.getByRole('navigation', { name: '페이지 메뉴' }).getByRole('link', { name, exact: true }).click();
  await navigate('기간 조회');
  await page.getByLabel('시작 시각', { exact: true }).waitFor();
  assert.equal(await page.locator('#analysis').evaluate(node => node === document.activeElement), true);
  await page.getByLabel('시작 시각', { exact: true }).fill('2026-01-01T00:03');
  assert.ok([...loadedScripts].some(path => path.includes('OperationsAnalysis-')));
  await navigate('공장 모니터링');
  assert.equal(await page.locator('canvas').evaluate((node, original) => node === original, originalCanvas), true);
  await navigate('기간 조회');
  assert.equal(await page.getByLabel('시작 시각', { exact: true }).inputValue(), '2026-01-01T00:03');
  await navigate('승인 연습');
  await page.getByLabel('Simulator 요청', { exact: true }).waitFor();
  await page.getByLabel('Simulator 요청', { exact: true }).fill('작성 상태 유지');
  await navigate('변경 기록');
  await page.getByRole('heading', { name: '내 승인·변경 기록' }).waitFor();
  await navigate('승인 연습');
  assert.equal(await page.getByLabel('Simulator 요청', { exact: true }).inputValue(), '작성 상태 유지');
  result.checks.push('Each view loads on demand; navigation focus, history inputs, Simulator draft and Canvas identity are preserved');

  await navigate('공장 모니터링');
  await page.getByRole('button', { name: 'AI 도우미 열기' }).click();
  await page.getByRole('tab', { name: 'AI 질문' }).waitFor();
  await page.locator('#agent-question').fill('보관할 질문');
  page.once('dialog', dialog => dialog.accept());
  await page.keyboard.press('Escape');
  await poll(async () => await page.locator('#open-agent').evaluate(node => node === document.activeElement), 'Drawer return focus');
  await page.getByRole('button', { name: 'AI 도우미 열기' }).click();
  assert.equal(await page.locator('#agent-question').inputValue(), '보관할 질문');
  await page.locator('#agent-question').fill('');
  await page.keyboard.press('Escape');
  assert.ok([...loadedScripts].some(path => path.includes('WorkspacePanel-')));
  result.checks.push('Lazy drawer keeps an unsent question after closing and restores launcher focus');

  if (brandReview) {
    const acceptClose = dialog => dialog.accept();
    page.on('dialog', acceptClose);
    await page.keyboard.press('Escape');
    await page.locator('#workspace-panel').waitFor({ state: 'hidden' });
    page.off('dialog', acceptClose);
    for (const name of ['공장 모니터링', '기간 조회', '승인 연습', '변경 기록']) {
      await navigate(name);
      const label = { '공장 모니터링': 'monitoring', '기간 조회': 'history', '승인 연습': 'simulator', '변경 기록': 'audit' }[name];
      if (name === '기간 조회') {
        await page.locator('.history-sensor-controls select').first().selectOption('feeders');
        await page.getByRole('button', { name: '센서 추가', exact: false }).click();
        await page.getByRole('button', { name: '기간 조회', exact: true }).click();
        await page.getByTestId('history-chart').waitFor();
        await page.getByTestId('history-chart').focus();
        await page.keyboard.press('Home');
        await page.getByTestId('history-tooltip').waitFor();
        assert.equal(await page.locator('.history-series').count(), 2);
      }
      await inspect(page, 'brand-' + label, out);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: resolve(out, label + '.png'), fullPage: true });
    }
    await navigate('공장 모니터링');
    await page.getByRole('button', { name: 'AI 도우미 열기' }).click();
    await page.getByRole('tab', { name: '센서 상세', exact: true }).click();
    await inspect(page, 'brand-sensor', out);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: resolve(out, 'sensor.png'), fullPage: true });
    await page.getByRole('tab', { name: 'AI 질문', exact: true }).click();
    await inspect(page, 'brand-chat', out);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: resolve(out, 'chat.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 375, height: 900 });
    await inspect(page, 'brand-mobile', out);
    await page.screenshot({ path: resolve(out, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1800, height: 1100 });
    result.checks.push('Blue-tinted login, main views, chat and mobile preserve text contrast and reflow');
  }

  await page.locator('canvas').evaluate(node => node.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await page.getByText('3D 화면을 표시할 수 없습니다', { exact: true }).waitFor();
  await page.getByRole('button', { name: '01 급탄기', exact: true }).click();
  await poll(async () => (await page.getByTestId('scene-selected').textContent()).includes('급탄기 시험 센서'), 'HTML selection after context loss');
  assert.equal(await page.getByTestId('ws-status').textContent(), 'CONNECTED');
  result.checks.push('WebGL context loss keeps HTML equipment selection and telemetry status available');

  const fallbackPage = await context.newPage();
  await fallbackPage.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return String(type).includes('webgl') ? null : original.call(this, type, ...args); };
  });
  await fallbackPage.goto(base);
  await fallbackPage.getByText('3D 화면을 표시할 수 없습니다', { exact: true }).waitFor();
  await fallbackPage.getByRole('button', { name: '04 재열기', exact: true }).click();
  assert.ok((await fallbackPage.getByTestId('scene-selected').textContent()).includes('재열기 시험 센서'));
  result.checks.push('Missing WebGL also retains the keyboard accessible HTML equipment controls');
  assert.deepEqual(errors, []);
  result.loadedScripts = [...loadedScripts];
  result.passed = true;
} catch (error) {
  result.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
  writeFileSync(resolve(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
