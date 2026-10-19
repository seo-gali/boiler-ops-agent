import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js';
import { chromium } from '../frontend/node_modules/playwright/index.mjs';

const baselineRef = process.argv.find(argument => argument.startsWith('--ref='))?.slice(6);
const baseline = Boolean(baselineRef);
const root = resolve(fileURLToPath(new URL('../frontend', import.meta.url)));
const out = resolve(root, '../artifacts/e2e/telemetry-performance');
const priorSources = new Map(baseline ? ['telemetry.ts', 'SensorTrend.tsx', 'ForecastPanel.tsx'].map(name => [
  resolve(root, 'src', name).replaceAll('\\', '/'),
  execFileSync('git', ['show', `${baselineRef}:frontend/src/${name}`], { cwd: root, encoding: 'utf8' }),
]) : []);
const entry = '/telemetry-performance-harness.mjs';
const harness = `
  import React, { Profiler, useEffect, useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { connectTelemetry, toggleUpdates, useTelemetry, useReading } from '/src/telemetry.ts';
  import { SensorTrend } from '/src/SensorTrend.tsx';
  import { ForecastPanel } from '/src/ForecastPanel.tsx';
  window.commits = { reading: 0, telemetry: 0 };
  function Reading() { const value = useReading('sensor'); return React.createElement('output', { id: 'reading' }, value?.value ?? 'empty'); }
  function Telemetry() { const value = useTelemetry(); return React.createElement('output', { id: 'sequence' }, value.current?.sequence ?? 0); }
  const measured = (id, component) => React.createElement(Profiler, { id, onRender: () => window.commits[id]++ }, React.createElement(component));
  function App() {
    const [active, setActive] = useState(true);
    const [tag, setTag] = useState('sensor');
    useEffect(() => connectTelemetry(), []);
    return React.createElement(React.Fragment, null,
      measured('reading', Reading), measured('telemetry', Telemetry),
      React.createElement('button', { onClick: () => setActive(value => !value) }, 'forecast'),
      React.createElement('button', { onClick: () => setTag(value => value === 'sensor' ? 'other' : 'sensor') }, 'sensor'),
      React.createElement('button', { onClick: toggleUpdates }, 'pause'),
      React.createElement(SensorTrend, { tag, unit: 'C' }),
      React.createElement(ForecastPanel, { active }));
  }
  createRoot(document.getElementById('root')).render(React.createElement(App));
`;
const server = await createServer({ root, configFile: false, optimizeDeps: { entries: [], include: ['react', 'react-dom/client'], esbuildOptions: { plugins: [{ name: 'read-dependencies', setup(build) {
  build.onLoad({ filter: /node_modules.*\.(?:js|mjs)$/ }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'js' }));
} }] } }, server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'telemetry-performance-harness',
  resolveId(id) { if (id === entry) return entry; },
  load(id) { if (id === entry) return harness; return priorSources.get(id.replaceAll('\\', '/')); },
}] });
let browser;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let socket;
  let sequence = 0;
  let run = 'run-a';
  const requests = { history: 0, forecast: 0 };
  const points = () => {
    const latest = sequence || 3;
    return Array.from({ length: Math.min(3, latest) }, (_, index) => latest - Math.min(3, latest) + index + 1)
      .map(value => ({ sequence: value, source_time: `2026-10-19T00:${String(value).padStart(2, '0')}:00`, value, raw: String(value), quality: 'valid', error: null }));
  };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/sensors/history') {
      requests.history++;
      await route.fulfill({ json: { tag: url.searchParams.get('tag'), unit: 'C', points: points() } });
    } else if (url.pathname === '/api/forecast') {
      requests.forecast++;
      await route.fulfill({ json: { target: 'sensor', unit: 'C', input_value: sequence, prediction: sequence + 1, selected_model: 'naive', horizon_minutes: 5,
        forecast_time: `2026-10-19T00:${String(sequence + 5).padStart(2, '0')}:00`, advisory: 'fixture', status: 'ok', beats_naive_on_test: false,
        test: { naive: { mae: 1, rmse: 1, samples: 5 } } } });
    } else await route.abort();
  });
  await page.routeWebSocket('**/api/ws', ws => { socket = ws; });
  await page.route('**/performance-check', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module" src="${entry}"></script>` }));
  await page.goto(new URL('/performance-check', base).href);
  await page.locator('#sequence').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="sensor-trend-source-row"]'));
  const beforeObservation = { ...requests };
  const reading = value => ({ value, raw: String(value), quality: 'valid', error: null });
  const send = async (next, status = 'LIVE', quality = 'valid') => {
    sequence = next;
    const snapshot = { type: 'telemetry', current: { run_id: run, sequence, source_time: `2026-10-19T00:${String(sequence).padStart(2, '0')}:00`,
      emitted_at: '2026-10-19T00:00:00', kafka_offset: sequence, sensors: { sensor: { ...reading(10), quality, value: quality === 'valid' ? 10 : null }, other: reading(20) } },
      status, stale: status !== 'LIVE', kafka: 'CONNECTED', error: null, rejected_events: 0, replay_interval_ms: 250, stale_after_ms: 60000 };
    socket.send(JSON.stringify(snapshot));
    await page.waitForFunction(expected => document.querySelector('#sequence')?.textContent === String(expected), sequence);
    await page.waitForTimeout(80);
  };
  await send(3);
  await page.waitForFunction(() => document.querySelector('[data-testid="forecast-value"]'));
  const afterFirst = { requests: { ...requests }, commits: await page.evaluate(() => ({ ...window.commits })) };
  for (const value of [4, 5, 6]) await send(value);
  const afterEvents = { requests: { ...requests }, commits: await page.evaluate(() => ({ ...window.commits })) };
  for (let index = 0; index < 3; index++) await send(6);
  const afterHeartbeat = { requests: { ...requests }, commits: await page.evaluate(() => ({ ...window.commits })) };
  await page.getByRole('button', { name: 'forecast', exact: true }).click();
  await page.getByRole('button', { name: 'forecast', exact: true }).click();
  await page.waitForTimeout(100);
  const afterReopen = { ...requests };
  if (!baseline) {
    assert.equal(beforeObservation.forecast, 0, 'No forecast before an observation');
    assert.equal(afterEvents.requests.history, afterFirst.requests.history, 'WebSocket observations reuse initial history');
    assert.equal(afterEvents.commits.reading, afterFirst.commits.reading, 'Unchanged readings preserve subscriptions');
    assert.deepEqual(afterHeartbeat, afterEvents, 'Repeated snapshots cause no requests or commits');
    assert.equal(afterReopen.forecast, afterHeartbeat.requests.forecast, 'Reopening the same observation reuses forecast');
    assert.equal(await page.getByTestId('sensor-trend-source-row').count(), 3, 'Source-time window retains its two-minute bounds');
    await send(7, 'LIVE', 'missing');
    assert.equal(await page.locator('#reading').textContent(), 'empty', 'Missing values stay missing');
    await page.getByRole('button', { name: 'pause', exact: true }).click();
    socket.send(JSON.stringify({ type: 'telemetry', current: { run_id: run, sequence: 8, source_time: '2026-10-19T00:08:00', emitted_at: '2026-10-19T00:00:00', kafka_offset: 8, sensors: { sensor: reading(30), other: reading(20) } }, status: 'LIVE', stale: false, kafka: 'CONNECTED', error: null, rejected_events: 0, replay_interval_ms: 250, stale_after_ms: 60000 }));
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#sequence').textContent(), '7', 'Paused observations stay frozen');
    await page.getByRole('button', { name: 'pause', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#sequence')?.textContent === '8');
    await page.getByRole('button', { name: 'sensor', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('caption')?.textContent?.startsWith('other'));
    run = 'run-b';
    await send(1);
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId('sensor-trend-source-row').count(), 1, 'Run change discards the previous run history');
    assert.equal(await page.locator('#reading').textContent(), '10');
  }
  assert.deepEqual(errors, [], 'No browser errors');
  const result = { mode: baseline ? 'baseline' : 'improved', source: baselineRef ?? 'working tree', beforeObservation, afterFirst, afterEvents, afterHeartbeat, afterReopen, checks: baseline ? 'measurement only' : 'passed' };
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, (baseline ? 'baseline' : 'improved') + '.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
