import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { inspect } from './review-ui.mjs';

export async function reviewWorkspace({ page, context, apiFetch, base, out, root, profile, poll, pass }) {
  const json = async path => { const response = await apiFetch(base + path); assert.equal(response.status, 200); return response.json(); };
  const registry = await json('/api/registry');
  const definitions = JSON.parse(readFileSync(resolve(root, 'backend/app/domain/sensor_definitions.json'), 'utf8'));
  assert.equal(definitions.source_sha256, createHash('sha256').update(readFileSync(resolve(root, 'data/raw/CustomExcelView.xlsx'))).digest('hex'));
  assert.equal(definitions.dataset_sha256, profile.sha256);
  assert.equal(Object.keys(definitions.sensors).length, 118);
  for (const [tag, definition] of Object.entries(definitions.sensors)) {
    assert.equal(registry.sensors[tag].unit, definition.unit, tag);
    assert.ok(registry.sensors[tag].unit_basis.includes(String(definition.source_row)));
  }
  assert.deepEqual(await page.locator('.kpi small').allTextContents(), ['MW', 'MW', 'T/H', 'kg/cm2g', '°C', '%']);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('16px "Pretendard Variable"')), true);
  pass('118 source tags and workbook hash match registry units; KPI units and local Pretendard are visible');

  const requests = [], downloads = [];
  page.on('request', request => { if (/\/api\/(agent\/query|simulator\/proposals)$/.test(new URL(request.url()).pathname)) requests.push(request.url()); });
  page.on('download', item => downloads.push(item.suggestedFilename()));
  const initialPages = context.pages().length;
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.getByRole('button', { name: '화면 자동 갱신 일시정지', exact: true }).click();
  const scene = page.getByLabel('계통도 화면', { exact: true });
  const drawer = page.getByRole('complementary', { name: '운전 도우미' });
  const tab = name => page.getByRole('tab', { name, exact: true });
  const selected = () => page.getByLabel('선택 센서', { exact: true }).inputValue();
  const choose = async tag => {
    await tab('센서 상세').click();
    await page.getByLabel('설비 분류', { exact: true }).selectOption(registry.sensors[tag].equipment);
    await page.getByLabel('선택 센서', { exact: true }).selectOption(tag);
  };
  const close = async () => { if (await drawer.isVisible()) await page.getByRole('button', { name: '도우미 닫기' }).click(); };
  const marker = item => page.getByTestId(`marker-${item.primary_tag}`);
  const checkLabels = async label => {
    await poll(async () => await page.locator('.scene-marker').count() === 7, 'Seven scene labels');
    const boxes = await page.locator('.scene-marker').evaluateAll(nodes => nodes.map(node => {
      const a = node.getBoundingClientRect(), b = node.closest('.scene').getBoundingClientRect();
      return { x: a.x - b.x, y: a.y - b.y, w: a.width, h: a.height, sw: b.width, sh: b.height };
    }));
    for (const [i, a] of boxes.entries()) {
      assert.ok(a.x >= -1 && a.y >= -1 && a.x + a.w <= a.sw + 1 && a.y + a.h <= a.sh + 1, `${label}: label ${i} within scene`);
      for (const b of boxes.slice(i + 1)) assert.ok(a.x + a.w <= b.x + 1 || b.x + b.w <= a.x + 1 || a.y + a.h <= b.y + 1 || b.y + b.h <= a.y + 1, `${label}: labels do not overlap`);
    }
  };
  for (const [index, item] of registry.equipment.entries()) {
    await page.getByRole('button', { name: `${String(index + 1).padStart(2, '0')} ${item.name}`, exact: true }).click();
    assert.equal(await selected(), item.primary_tag);
    assert.equal(await page.getByTestId('inspector-tag').textContent(), item.primary_tag);
    await marker(item).click();
    assert.equal(await marker(item).getAttribute('aria-pressed'), 'true');
    assert.ok((await marker(item).textContent()).includes(await page.getByTestId('inspector-value').textContent()));
  }
  const superheater = registry.equipment.find(item => item.id === 'superheater');
  const temperatureBefore = await marker(superheater).locator('b').textContent();
  await page.getByTestId('kpi-터빈용 주증기 압력').click();
  assert.equal(await selected(), '터빈용 주증기 압력');
  assert.equal(await marker(superheater).locator('b').textContent(), temperatureBefore);
  assert.equal(await marker(superheater).getAttribute('aria-pressed'), 'false');
  assert.ok((await marker(superheater).getAttribute('class')).includes('equipment-selected'));
  assert.match(await marker(superheater).textContent(), /°C/);
  assert.ok((await page.locator('.equipment-nav').boundingBox()).y < (await scene.boundingBox()).y);
  assert.equal(await page.locator('.scene-flow-caption p').count(), 2);
  await checkLabels('drawer open');
  pass('Seven groups select primary sensors; pressure selection keeps the superheater temperature label; equipment list precedes scene');

  const seen = new Set();
  for (const group of [...new Set(Object.values(registry.sensors).map(sensor => sensor.equipment))]) {
    await page.getByLabel('설비 분류', { exact: true }).selectOption(group);
    const tags = await page.locator('#workspace-sensor-select option').evaluateAll(nodes => nodes.map(node => node.value));
    assert.ok(tags.length > 0 && tags.every(tag => registry.sensors[tag].equipment === group));
    tags.forEach(tag => seen.add(tag));
  }
  assert.equal(seen.size, 118);
  const reheater = registry.equipment.find(item => item.id === 'reheater');
  await choose(reheater.primary_tag);
  await page.getByLabel('이 분류에서 검색').fill(registry.sensors[reheater.primary_tag].source_tag);
  assert.equal(await page.locator('#workspace-sensor-select option:not(:disabled)').count(), 1);
  await page.getByLabel('이 분류에서 검색').fill('존재하지않는센서');
  await page.getByText('검색 결과가 없습니다. 검색어나 종류를 바꿔보세요.', { exact: true }).waitFor();
  assert.equal(await selected(), reheater.primary_tag);
  await page.getByLabel('이 분류에서 검색').fill('');
  await page.getByLabel('센서 종류', { exact: true }).selectOption('control');
  for (const tag of await page.locator('#workspace-sensor-select option:not(:disabled)').evaluateAll(nodes => nodes.map(node => node.value))) assert.equal(registry.sensors[tag].measurement_type, 'control');
  await page.getByLabel('센서 종류', { exact: true }).selectOption('all');
  assert.equal(requests.length, 0);
  await inspect(page, 'workspace-controls', out);
  pass('Category lists cover all 118 sensors without cross-group options; source-tag search, kind filter and empty results work without model calls');

  await close(); await scene.scrollIntoViewIfNeeded(); await scene.focus();
  const projected = async () => [Number(await marker(superheater).getAttribute('data-anchor-x')), Number(await marker(superheater).getAttribute('data-anchor-y'))];
  const before = await projected(), box = await scene.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Space'); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 + 28, { steps: 8 }); await page.mouse.up();
  await poll(async () => { const after = await projected(); return after[0] > before[0] + 35 && after[1] > before[1] + 15; }, 'Space drag pans projected equipment');
  const scrollBefore = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, -180);
  await poll(async () => parseInt(await page.getByLabel('계통도 확대 비율').textContent()) > 100, 'Space wheel zoom');
  assert.equal(await page.evaluate(() => scrollY), scrollBefore);
  await page.keyboard.up('Space'); await page.mouse.wheel(0, 180);
  await poll(async () => await page.evaluate(() => scrollY) > scrollBefore, 'Normal wheel scroll restored');
  await scene.focus(); await page.keyboard.down('Space');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.keyboard.up('Space');
  assert.equal(await page.locator('.scene-mode').textContent(), '');
  await page.getByRole('button', { name: '보기 초기화', exact: true }).click();
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: '확대', exact: true }).click();
  assert.equal(await page.getByLabel('계통도 확대 비율').textContent(), '170%');
  await checkLabels('170 percent');
  await page.getByRole('button', { name: '보기 초기화', exact: true }).click();
  for (const item of registry.equipment) {
    await scene.scrollIntoViewIfNeeded();
    await poll(async () => Number(await marker(item).getAttribute('data-equipment-x')) > 0, 'Projected mesh');
    const bounds = await scene.boundingBox();
    await page.mouse.click(bounds.x + Number(await marker(item).getAttribute('data-equipment-x')), bounds.y + Number(await marker(item).getAttribute('data-equipment-y')));
    await poll(async () => await selected() === item.primary_tag, `Mesh hit for ${item.id}`);
    await close();
  }
  pass('Space pan/zoom and ordinary scroll work; labels stay separate at 170%; all seven actual meshes select the matching sensor');

  await page.getByRole('button', { name: 'AI 도우미 열기' }).click();
  await tab('변경 기록').click(); await page.getByText('아직 승인·변경 기록이 없습니다.', { exact: false }).waitFor();
  await choose('목표 발전량'); await page.getByRole('button', { name: '이 센서에 질문', exact: true }).click();
  assert.equal(await page.getByLabel('질문', { exact: true }).inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Agent 조회', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('.question-suggestions button').count(), 2);
  await choose(reheater.primary_tag); await page.getByRole('button', { name: '이 센서에 질문', exact: true }).click();
  await page.getByLabel('질문', { exact: true }).fill('선택한 센서의 현재값은?');
  await page.getByLabel('질문', { exact: true }).press('End'); await page.keyboard.press('Space');
  assert.match(await page.getByLabel('질문', { exact: true }).inputValue(), / $/);
  const startedAt = Date.now();
  let release, arrived, fetched;
  const gate = new Promise(resolve => { release = resolve; });
  const arrival = new Promise(resolve => { arrived = resolve; });
  const completed = new Promise((resolve, reject) => { fetched = { resolve, reject }; });
  let answer;
  const realRoute = async route => {
    arrived();
    try { const response = await route.fetch({ timeout: 380000 }); answer = await response.json(); assert.equal(response.status(), 200, JSON.stringify(answer)); fetched.resolve(); await gate; await route.fulfill({ response }); }
    catch (error) { fetched.reject(error); await route.abort().catch(() => {}); }
  };
  await page.route('**/api/agent/query', realRoute);
  await page.getByRole('button', { name: 'Agent 조회', exact: true }).click(); await arrival;
  await page.getByTestId('agent-waiting').waitFor();
  await page.getByTestId('kpi-터빈용 주증기 압력').click();
  assert.ok((await page.getByTestId('agent-target').textContent()).includes(reheater.primary_tag));
  assert.equal(await page.getByRole('button', { name: '이 센서로 새 질문', exact: true }).isDisabled(), true);
  await close(); await page.getByRole('button', { name: 'AI 도우미 열기' }).click();
  assert.match(await page.getByLabel('질문', { exact: true }).inputValue(), /^선택한 센서의 현재값은\?/);
  await completed; release();
  await page.getByTestId('agent-answer').waitFor({ timeout: 10000 }); await page.unroute('**/api/agent/query', realRoute);
  assert.match(answer.answer, /°C/); assert.ok(answer.answer.includes(reheater.primary_tag));
  const evidence = answer.evidence.find(item => item.field === '관측값');
  const trace = await json(`/api/agent/traces/${answer.trace_id}`);
  let source = trace.calls.find(call => call.id === evidence.tool_id).result;
  for (const part of evidence.path) source = source[part];
  assert.equal(source, evidence.value); assert.equal(evidence.unit, '°C');
  assert.ok((await page.getByTestId('agent-target').textContent()).includes(reheater.primary_tag));
  await page.getByText('조회 근거·도구 기록 보기', { exact: true }).click(); await page.getByText(`기록 ID ${answer.trace_id}`, { exact: true }).waitFor();
  await page.getByText('조회 근거·도구 기록 보기', { exact: true }).click();
  writeFileSync(resolve(out, 'agent-answer.json'), JSON.stringify({ elapsed_ms: Date.now() - startedAt, answer, trace, transport: 'real backend/Ollama response held while selecting another sensor' }, null, 2));
  await page.locator('#monitoring').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(out, 'ai-drawer.jpg'), type: 'jpeg', quality: 82 });
  pass('Real Ollama answer matches trace value/unit; query target, draft, loading and answer survive other sensor selection and drawer close/reopen');

  await page.getByText('추가 기능 · 변경 승인 연습', { exact: true }).click();
  assert.equal(await page.getByLabel('Simulator 요청', { exact: true }).inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Agent Simulator 제안 생성', exact: true }).isDisabled(), true);
  await page.getByLabel('Simulator 요청', { exact: true }).fill('연습용 값을 한 단계 높여 주세요.');
  const proposedResponse = page.waitForResponse(response => response.url().endsWith('/api/simulator/proposals'), { timeout: 380000 });
  await page.getByRole('button', { name: 'Agent Simulator 제안 생성', exact: true }).click();
  const proposed = await proposedResponse, proposal = await proposed.json();
  assert.equal(proposed.status(), 200, JSON.stringify(proposal)); assert.equal(proposal.requested_value, 1);
  await poll(async () => await page.getByTestId('proposal-status').textContent() === 'pending', 'Proposal ready');
  assert.equal(await page.getByRole('button', { name: '승인 및 Simulator 실행', exact: true }).isDisabled(), true);
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: '승인 및 Simulator 실행', exact: true }).click();
  await poll(async () => await page.getByTestId('proposal-status').textContent() === 'executed', 'Explicit approval');
  assert.equal(await page.getByTestId('sim-value').textContent(), '1');
  await page.screenshot({ path: resolve(out, 'simulator-drawer.jpg'), type: 'jpeg', quality: 82 });
  await page.getByRole('button', { name: '승인·변경 기록 보기', exact: true }).click(); await page.getByRole('heading', { name: '변경 실행', exact: true }).waitFor();
  await page.route('**/api/simulator/audit?*', route => route.abort('failed'));
  await page.getByRole('button', { name: '기록 새로고침', exact: true }).click(); await drawer.getByRole('alert').waitFor();
  await page.unroute('**/api/simulator/audit?*'); await drawer.getByRole('button', { name: '다시 조회', exact: true }).click(); await drawer.getByRole('alert').waitFor({ state: 'hidden' });
  const audit = await json('/api/simulator/audit'); assert.ok(audit.some(row => row.event === 'executed' && row.proposal_id === proposal.id));
  writeFileSync(resolve(out, 'simulator-audit.json'), JSON.stringify(audit, null, 2));
  await page.screenshot({ path: resolve(out, 'audit-drawer.jpg'), type: 'jpeg', quality: 82 });
  assert.equal(context.pages().length, initialPages); assert.deepEqual(downloads, []);
  pass('Simulator starts empty; real model proposes and explicit confirmation executes once; same-page audit handles empty/failure/retry without downloads');

  await tab('AI 질문').click();
  await page.getByRole('button', { name: '이 센서로 새 질문', exact: true }).click();
  assert.equal(await page.getByTestId('agent-answer').count(), 0); assert.equal(await page.getByLabel('질문', { exact: true }).inputValue(), '');
  assert.ok((await page.getByTestId('agent-target').textContent()).includes('터빈용 주증기 압력'));
  await page.getByLabel('질문', { exact: true }).fill('선택한 센서의 현재값은?');
  let releaseLate;
  const lateGate = new Promise(resolve => { releaseLate = resolve; });
  const held = async route => { await lateGate; await route.fulfill({ json: answer }).catch(() => {}); };
  await page.route('**/api/agent/query', held);
  await page.getByRole('button', { name: 'Agent 조회', exact: true }).click();
  await page.getByRole('button', { name: '기다리기 취소', exact: true }).click();
  await poll(async () => (await page.getByTestId('agent-status').textContent()).includes('취소했습니다'), 'Cancel waiting');
  releaseLate(); await page.unroute('**/api/agent/query', held);
  assert.equal(await page.getByTestId('agent-answer').count(), 0);
  const failRoute = route => route.abort('failed');
  await page.route('**/api/agent/query', failRoute); await page.getByRole('button', { name: '다시 조회', exact: true }).click(); await page.getByTestId('agent-error').waitFor();
  await page.unroute('**/api/agent/query', failRoute);
  let releaseTimeout;
  const timeoutGate = new Promise(resolve => { releaseTimeout = resolve; });
  const timeoutRoute = async route => { await timeoutGate; await route.abort().catch(() => {}); };
  await page.route('**/api/agent/query', timeoutRoute);
  await page.clock.install(); await page.clock.pauseAt(new Date());
  await page.getByRole('button', { name: '다시 조회', exact: true }).click(); await page.clock.fastForward(390001);
  await page.getByTestId('agent-error').waitFor(); assert.match(await page.getByTestId('agent-error').textContent(), /6분 30초/);
  releaseTimeout(); await page.unroute('**/api/agent/query', timeoutRoute); await page.clock.resume();
  assert.equal(await page.getByLabel('질문', { exact: true }).inputValue(), '선택한 센서의 현재값은?');
  const retriedResponse = page.waitForResponse(response => response.url().endsWith('/api/agent/query'), { timeout: 380000 });
  await page.getByRole('button', { name: '다시 조회', exact: true }).click();
  const retried = await retriedResponse, retryAnswer = await retried.json();
  assert.equal(retried.status(), 200, JSON.stringify(retryAnswer));
  await page.getByTestId('agent-answer').waitFor(); assert.ok(retryAnswer.answer.includes('터빈용 주증기 압력')); assert.match(retryAnswer.answer, /kg\/cm2g/);
  writeFileSync(resolve(out, 'agent-retry.json'), JSON.stringify(retryAnswer, null, 2));
  pass('Explicit new question changes target; injected cancellation/late response/network failure/390-second timeout preserve draft; retry succeeds against real Ollama');

  await tab('AI 질문').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await tab('변경 기록').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Escape'); await drawer.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#open-agent').count(), 1);
  assert.equal(await page.locator('.page-nav button, footer button').count(), 0);
  await page.getByRole('link', { name: '운전 분석', exact: true }).click();
  await poll(async () => (await page.locator('.workspace-header').boundingBox()).y >= -1, 'Sticky header');
  assert.ok((await page.locator('#analysis').boundingBox()).y >= (await page.locator('.workspace-header').boundingBox()).height - 2);
  await page.getByRole('link', { name: '모니터링', exact: true }).click();
  await page.getByRole('button', { name: '04 재열기', exact: true }).click(); await tab('센서 상세').click();
  await inspect(page, 'workspace-desktop', out); await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(out, 'workspace-desktop.jpg'), type: 'jpeg', quality: 82 });
  for (const width of [1280, 900, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await inspect(page, `workspace-${width}`, out); await checkLabels(`${width}px`);
    assert.equal(await drawer.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
  }
  await page.screenshot({ path: resolve(out, 'workspace-mobile.jpg'), type: 'jpeg', quality: 82 });
  await close();
  await page.getByRole('button', { name: '메뉴', exact: true }).focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'true'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'AI 도우미 열기' }).focus(); await page.keyboard.press('Enter'); await drawer.waitFor(); await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'AI 도우미 열기' }).evaluate(node => node === document.activeElement), true);
  pass('Single global AI control, three tabs, sticky anchors and keyboard focus work; labels/drawer fit 1800/1280/900/768/375/320px with accessible controls');

  await page.locator('canvas').evaluate(node => node.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await page.getByText('3D 화면을 표시할 수 없습니다', { exact: true }).waitFor(); await page.getByRole('button', { name: '04 재열기', exact: true }).click();
  assert.equal(await selected(), reheater.primary_tag);
  pass('WebGL loss retains category and equipment sensor selection');
}
