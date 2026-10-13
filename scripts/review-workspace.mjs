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
  for (const [tag, definition] of Object.entries(definitions.sensors)) assert.equal(registry.sensors[tag].unit, definition.unit, tag);
  assert.equal(Object.keys(registry.sensors).length, 118);
  assert.deepEqual(await page.locator('.kpi small').allTextContents(), ['MW', 'MW', 'T/H', 'kg/cm2g', '°C', '%']);
  assert.equal(await page.getByTestId('kafka-status').evaluate(node => Boolean(node.closest('.topbar'))), true);
  assert.equal(await page.getByRole('button', { name: '화면 자동 갱신 일시정지', exact: true }).evaluate(node => Boolean(node.closest('.navigation-row'))), true);
  assert.equal(await page.locator('.feed').count(), 0);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('16px "Pretendard Variable"')), true);
  pass('All 118 workbook units match; connection status and pause control are in the header; repeated telemetry table is removed');

  const requests = [], downloads = [];
  page.on('request', request => { if (/\/api\/(agent\/query|simulator\/proposals)$/.test(new URL(request.url()).pathname)) requests.push(request.url()); });
  page.on('download', item => downloads.push(item.suggestedFilename()));
  const initialPages = context.pages().length;
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.getByRole('button', { name: '화면 자동 갱신 일시정지', exact: true }).click();
  const scene = page.getByLabel('계통도 화면', { exact: true });
  const drawer = page.getByRole('complementary', { name: '운전 도우미' });
  const tab = name => page.getByRole('tab', { name });
  const selected = () => page.getByTestId('inspector-tag').textContent();
  const marker = item => page.getByTestId(`marker-${item.primary_tag}`);
  const respondToDialog = async (action, accept, expected) => {
    const dialog = page.waitForEvent('dialog'); const operation = action();
    const prompt = await dialog;
    assert.equal(prompt.type(), 'confirm'); if (expected) assert.match(prompt.message(), expected);
    if (accept) await prompt.accept(); else await prompt.dismiss();
    await operation;
  };
  const close = async () => { if (await drawer.isVisible()) await page.getByRole('button', { name: '도우미 닫기' }).click(); };
  const choose = async tag => {
    if (!await drawer.isVisible()) await page.getByRole('button', { name: 'AI 도우미 열기' }).click();
    await tab('센서 상세').click();
    await page.locator('#sensor-group').selectOption(registry.sensors[tag].equipment);
    await page.locator('#sensor-select').selectOption(tag);
    assert.equal(await selected(), tag);
  };
  const checkChat = async () => {
    await poll(async () => await page.locator('.chat-history').evaluate(node => node.clientHeight > 40), 'Chat conversation has fixed room');
    const layout = await page.evaluate(() => {
      const conversation = document.querySelector('.chat-history'), composer = document.querySelector('.chat-composer');
      const a = conversation.getBoundingClientRect(), b = composer.getBoundingClientRect();
      return { conversationBottom: a.bottom, composerTop: b.top, composerBottom: b.bottom, viewport: innerHeight,
        overflow: getComputedStyle(conversation).overflowY, dockOutsideHistory: !conversation.contains(composer),
        suggestionsInside: Boolean(conversation.querySelector('.question-suggestions')) };
    });
    assert.ok(layout.conversationBottom <= layout.composerTop + 1);
    assert.ok(layout.composerBottom <= layout.viewport + 1);
    assert.equal(layout.dockOutsideHistory, true); assert.equal(layout.suggestionsInside, true);
    assert.ok(['auto', 'scroll'].includes(layout.overflow));
  };
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
    const inventory = page.getByTestId('equipment-sensors');
    await inventory.waitFor();
    const tags = Object.values(registry.sensors).filter(sensor => sensor.equipment === item.id).map(sensor => sensor.tag);
    assert.equal(await inventory.locator('.equipment-sensor-row').count(), tags.length);
    for (const tag of tags) assert.ok((await inventory.getByRole('button', { name: `설비 센서 ${tag}`, exact: true }).textContent()).includes(registry.sensors[tag].unit));
    assert.equal(await inventory.locator('input[type="search"], input[type="text"]').count(), 0);
    const subgroup = inventory.getByLabel(`${item.name} 세부 묶음 선택`);
    const area = await subgroup.locator('option').last().getAttribute('value');
    await subgroup.selectOption(area);
    const options = await inventory.getByTestId('equipment-sensor-select').locator('option').evaluateAll(nodes => nodes.map(node => node.value).filter(Boolean));
    assert.ok(options.length > 0 && options.every(tag => tags.includes(tag)));
    await inventory.getByTestId('equipment-sensor-select').selectOption(options.at(-1));
    assert.equal(await selected(), options.at(-1));
    await subgroup.selectOption('all');
    if (item.id === 'feeders') {
      assert.match(await inventory.getByTestId('feeder-zero-note').textContent(), /원본값이 모두 0/);
      assert.match(await inventory.getByTestId('equipment-sensor-quality').textContent(), /수신 13개 · 결측 0개 · 파싱 오류 0개/);
      assert.ok((await inventory.locator('small[data-quality]').evaluateAll(nodes => nodes.map(node => node.dataset.quality))).every(quality => quality === 'valid'));
      await inventory.screenshot({ path: resolve(out, 'feeder-zero.jpg'), type: 'jpeg', quality: 82 });
    }
    await inventory.getByRole('button', { name: `설비 센서 ${tags[tags.length - 1]}`, exact: true }).click();
    assert.equal(await selected(), tags[tags.length - 1]);
    await marker(item).click(); assert.equal(await selected(), item.primary_tag);
    await checkLabels(item.id);
  }
  assert.equal(await page.locator('.game-viewport').getAttribute('data-animation'), 'decorative');
  const superheater = registry.equipment.find(item => item.id === 'superheater');
  const valueBefore = await marker(superheater).locator('b').textContent();
  await page.getByTestId('kpi-터빈용 주증기 압력').click();
  assert.equal(registry.sensors['터빈용 주증기 압력'].equipment, 'main-steam');
  assert.equal(registry.sensors['터빈용 주증기 압력'].scene_position, null);
  assert.equal(await selected(), '터빈용 주증기 압력');
  assert.equal(await marker(superheater).locator('b').textContent(), valueBefore);
  assert.equal(await page.locator('.equipment-nav button[aria-pressed=true]').count(), 0);
  assert.equal(await page.getByTestId('equipment-sensors').count(), 0);
  assert.match(await page.getByTestId('scene-selected').textContent(), /터빈용 주증기 압력.*kg\/cm2g/);
  pass('Game map exposes all sensors of each equipment with values and quality; main-steam pressure selects its own reading without highlighting the superheater');

  const seen = new Set();
  for (const group of [...new Set(Object.values(registry.sensors).map(sensor => sensor.equipment))]) {
    await page.locator('#sensor-group').selectOption(group);
    const tags = await page.locator('#sensor-select option').evaluateAll(nodes => nodes.map(node => node.value).filter(Boolean));
    assert.ok(tags.length > 0 && tags.every(tag => registry.sensors[tag].equipment === group)); tags.forEach(tag => seen.add(tag));
    for (const button of await page.locator('.catalog-areas button').all()) {
      await button.click();
      const shown = await page.locator('#sensor-select option').evaluateAll(nodes => nodes.map(node => node.value).filter(Boolean));
      assert.ok(shown.length > 0 && shown.every(tag => tags.includes(tag)));
      if (!(await button.getAttribute('aria-label')).endsWith('모든 세부 묶음')) {
        const name = (await button.getAttribute('aria-label')).replace(/^세부 묶음 /, '').replace(/ · \d+개 센서$/, '');
        const optgroups = await page.locator('#sensor-select optgroup').evaluateAll(nodes => nodes.map(node => node.label));
        assert.deepEqual(optgroups, [name]);
      }
    }
  }
  assert.equal(seen.size, 118);
  assert.equal(await page.locator('.catalog-sensor, #sensor-kind').count(), 0);
  assert.equal(await page.getByLabel('센서 찾기', { exact: true }).count(), 0);
  assert.equal(await page.getByText('전체 118개에서 찾기', { exact: true }).count(), 0);
  assert.equal(await page.locator('[title], svg title').count(), 0);
  const reheater = registry.equipment.find(item => item.id === 'reheater');
  const feeders = registry.equipment.find(item => item.id === 'feeders');
  await choose(feeders.primary_tag);
  await page.getByText('추이 원본값 표로 보기', { exact: true }).click();
  await poll(async () => await page.getByTestId('sensor-trend-source-row').count() === 3, 'Two-minute source rows');
  const recentRows = await page.getByTestId('sensor-trend-source-row').evaluateAll(nodes => nodes.map(node => [...node.cells].map(cell => cell.textContent)));
  assert.equal(Date.parse(recentRows.at(-1)[0].replace(' ', 'T') + 'Z') - Date.parse(recentRows[0][0].replace(' ', 'T') + 'Z'), 120000);
  assert.ok(recentRows.every(row => Number(row[1]) === 0 && row[2] === '원본 수신'));
  assert.equal(await page.getByRole('button', { name: '이 센서에 질문', exact: true }).evaluate(node => Boolean(node.closest('.sensor-detail-heading'))), true);
  await inspect(page, 'catalog-desktop', out);
  await page.screenshot({ path: resolve(out, 'select-catalog.jpg'), type: 'jpeg', quality: 82 });
  assert.equal(requests.length, 0);
  pass('Native equipment/subgroup sensor selects cover all 118 tags; duplicated search and native hover tooltips are removed; trend/table keep only 120 source seconds and preserve valid zero');

  await close(); await page.getByRole('button', { name: '03 과열기', exact: true }).click();
  await page.getByRole('button', { name: '과열기 센서 목록 닫기', exact: true }).click();
  await scene.scrollIntoViewIfNeeded(); await scene.focus();
  const before = [Number(await marker(superheater).getAttribute('data-anchor-x')), Number(await marker(superheater).getAttribute('data-anchor-y'))], box = await scene.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 + 28, { steps: 8 }); await page.mouse.up();
  await poll(async () => Number(await marker(superheater).getAttribute('data-anchor-x')) > before[0] + 35 && Number(await marker(superheater).getAttribute('data-anchor-y')) > before[1] + 15, 'Space pan');
  const scrollBefore = await page.evaluate(() => scrollY); await page.mouse.wheel(0, -180);
  await poll(async () => parseInt(await page.getByLabel('계통도 확대 비율').textContent()) > 100, 'Space wheel zoom');
  assert.equal(await page.evaluate(() => scrollY), scrollBefore);
  await page.keyboard.up('Space'); await page.mouse.wheel(0, 180);
  await poll(async () => await page.evaluate(() => scrollY) > scrollBefore, 'Normal wheel scrolling');
  await page.getByRole('button', { name: '보기 초기화', exact: true }).click();
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: '확대', exact: true }).click();
  await checkLabels('170%'); await page.getByRole('button', { name: '보기 초기화', exact: true }).click();
  for (const item of registry.equipment) {
    await scene.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const bounds = await scene.boundingBox();
    await page.mouse.click(bounds.x + Number(await marker(item).getAttribute('data-equipment-x')), bounds.y + Number(await marker(item).getAttribute('data-equipment-y')));
    await poll(async () => await selected() === item.primary_tag, `${item.id} mesh hit`);
    await page.getByRole('button', { name: `${item.name} 센서 목록 닫기`, exact: true }).click();
  }
  await inspect(page, 'game-desktop', out);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await poll(async () => await page.locator('.game-viewport').getAttribute('data-animation') === 'paused', 'Reduced motion pauses decoration');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  pass('Colored meshes and fixed labels remain selectable; Space pan/zoom, 170% layout and reduced-motion animation stop work');

  await choose(reheater.primary_tag); await page.getByRole('button', { name: '이 센서에 질문', exact: true }).click();
  assert.equal(await page.getByLabel('질문', { exact: true }).inputValue(), '');
  assert.equal(await drawer.evaluate(node => getComputedStyle(node).animationName), 'workspace-enter');
  await page.getByLabel('질문', { exact: true }).fill('입력 검사');
  await page.getByLabel('질문', { exact: true }).press('Shift+Enter');
  assert.equal(await page.getByLabel('질문', { exact: true }).inputValue(), '입력 검사\n');
  assert.equal(requests.length, 0); await page.getByLabel('질문', { exact: true }).fill('');
  assert.equal(await page.getByRole('button', { name: '질문 보내기', exact: true }).isDisabled(), true);
  await page.getByText('질문 예시 더 보기', { exact: true }).click();
  assert.ok(await page.locator('.question-suggestions button:visible').count() >= 8);
  await page.getByLabel('질문', { exact: true }).fill('선택한 센서의 현재값은?');
  await respondToDialog(() => page.getByRole('button', { name: '도우미 닫기' }).click(), false, /작성 중/);
  assert.equal(await drawer.isVisible(), true);
  await respondToDialog(() => page.getByRole('button', { name: '도우미 닫기' }).click(), true, /작성 중/);
  await drawer.waitFor({ state: 'hidden' }); await page.getByRole('button', { name: 'AI 도우미 열기' }).click();
  assert.equal(await page.getByLabel('질문', { exact: true }).inputValue(), '선택한 센서의 현재값은?');
  const startedAt = Date.now();
  let release, arrived, fetched;
  const gate = new Promise(resolve => { release = resolve; }); const arrival = new Promise(resolve => { arrived = resolve; });
  const completed = new Promise((resolve, reject) => { fetched = { resolve, reject }; });
  let answer;
  const realRoute = async route => {
    arrived();
    try { const response = await route.fetch({ timeout: 380000 }); answer = await response.json(); assert.equal(response.status(), 200, JSON.stringify(answer)); fetched.resolve(); await gate; await route.fulfill({ response }); }
    catch (error) { fetched.reject(error); await route.abort().catch(() => {}); }
  };
  await page.route('**/api/agent/query', realRoute); await page.getByLabel('질문', { exact: true }).press('Enter'); await arrival;
  await page.getByTestId('agent-waiting').waitFor(); assert.equal(await page.getByLabel('질문', { exact: true }).inputValue(), '');
  await page.getByLabel('질문', { exact: true }).fill('다음 질문 초안');
  await page.getByTestId('kpi-터빈용 주증기 압력').click(); assert.match(await page.getByTestId('agent-target').textContent(), /최종재열기 입구/);
  await respondToDialog(() => page.getByRole('button', { name: '도우미 닫기' }).click(), false, /기다림/);
  await respondToDialog(() => tab('센서 상세').click(), false, /기다리는/);
  assert.equal(await tab('AI 질문').getAttribute('aria-selected'), 'true');
  assert.equal(await tab('AI 질문').evaluate(node => node === document.activeElement), true);
  await respondToDialog(() => page.keyboard.press('ArrowLeft'), false, /기다리는/);
  assert.equal(await tab('AI 질문').evaluate(node => node === document.activeElement), true);
  await respondToDialog(() => tab('센서 상세').click(), true, /기다리는/);
  assert.equal(await tab('센서 상세').getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByTestId('chat-turn').last().getAttribute('data-status'), 'pending');
  await tab('AI 질문').click();
  await completed; release(); await page.getByTestId('agent-answer').last().waitFor({ timeout: 10000 }); await page.unroute('**/api/agent/query', realRoute);
  assert.match(answer.answer, /°C/); assert.ok(answer.answer.includes(reheater.primary_tag));
  const trace = await json(`/api/agent/traces/${answer.trace_id}`), evidence = answer.evidence.find(item => item.field === '관측값');
  let source = trace.calls.find(call => call.id === evidence.tool_id).result; for (const part of evidence.path) source = source[part]; assert.equal(source, evidence.value);
  assert.equal(await page.getByLabel('질문', { exact: true }).inputValue(), '다음 질문 초안');
  await page.getByLabel('질문', { exact: true }).fill('');
  await page.getByTestId('agent-answer').last().getByText('조회 근거·도구 기록 보기', { exact: true }).click(); await page.getByText(`기록 ID ${answer.trace_id}`, { exact: true }).waitFor();
  writeFileSync(resolve(out, 'agent-answer.json'), JSON.stringify({ elapsed_ms: Date.now() - startedAt, answer, trace }, null, 2));
  await page.screenshot({ path: resolve(out, 'fixed-chat-evidence.jpg'), type: 'jpeg', quality: 82 });
  pass('Real Ollama answer matches source evidence; draft and pending close/tab confirmations work; new draft and pinned query survive other sensor selection');

  await page.getByRole('link', { name: '승인 연습', exact: true }).click();
  assert.equal(await page.locator('#simulator').evaluate(node => node === document.activeElement), true);
  assert.equal(await drawer.isVisible(), false);
  assert.equal(await page.getByLabel('Simulator 요청', { exact: true }).inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Agent Simulator 제안 생성', exact: true }).isDisabled(), true);
  await page.getByLabel('Simulator 요청', { exact: true }).fill('연습용 값을 한 단계 높여 주세요.');
  const proposalResponse = page.waitForResponse(response => response.url().endsWith('/api/simulator/proposals'), { timeout: 380000 });
  await page.getByRole('button', { name: 'Agent Simulator 제안 생성', exact: true }).click();
  const proposed = await proposalResponse, proposal = await proposed.json(); assert.equal(proposed.status(), 200, JSON.stringify(proposal));
  await poll(async () => await page.getByTestId('proposal-status').textContent() === 'pending', 'Proposal ready');
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: '승인 및 Simulator 실행', exact: true }).click();
  await poll(async () => await page.getByTestId('proposal-status').textContent() === 'executed', 'Confirmed execution');
  await page.screenshot({ path: resolve(out, 'approval-workspace.jpg'), type: 'jpeg', quality: 82 });
  await page.getByRole('button', { name: '승인·변경 기록 보기', exact: true }).click(); await page.getByRole('heading', { name: '변경 실행', exact: true }).waitFor();
  const audit = await json('/api/simulator/audit'); assert.ok(audit.some(row => row.event === 'executed' && row.proposal_id === proposal.id));
  writeFileSync(resolve(out, 'simulator-audit.json'), JSON.stringify(audit, null, 2)); await page.screenshot({ path: resolve(out, 'approval-audit.jpg'), type: 'jpeg', quality: 82 });
  pass('Chat evidence still supports a real Simulator proposal, explicit confirmation and same-page execution records');

  await page.getByRole('link', { name: '공장 모니터링', exact: true }).click();
  await page.getByRole('button', { name: 'AI 도우미 열기' }).click();
  await tab('AI 질문').click(); await page.getByRole('button', { name: '이 센서로 새 질문', exact: true }).click();
  assert.equal(await page.getByTestId('agent-answer').count(), 1);
  await page.getByLabel('질문', { exact: true }).fill('선택한 센서의 현재값은?');
  const pressureResponse = page.waitForResponse(response => response.url().endsWith('/api/agent/query'), { timeout: 380000 });
  await page.getByRole('button', { name: '질문 보내기', exact: true }).click(); const pressureHttp = await pressureResponse, pressureAnswer = await pressureHttp.json();
  assert.equal(pressureHttp.status(), 200, JSON.stringify(pressureAnswer)); assert.match(pressureAnswer.answer, /터빈용 주증기 압력.*kg\/cm2g/);
  await poll(async () => await page.getByTestId('agent-answer').count() === 2, 'Two answers in chat');
  assert.equal(await page.getByTestId('chat-turn').count(), 2);
  writeFileSync(resolve(out, 'chat-pressure-answer.json'), JSON.stringify(pressureAnswer, null, 2));
  await page.getByTestId('agent-answer').first().getByText('조회 근거·도구 기록 보기', { exact: true }).click();
  await page.locator('.workspace-scroll').evaluate(node => { node.scrollTop = 0; });
  await page.locator('.chat-history').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await checkChat();
  await page.screenshot({ path: resolve(out, 'fixed-chat.jpg'), type: 'jpeg', quality: 82 });
  await page.setViewportSize({ width: 375, height: 900 }); await checkChat();
  await page.screenshot({ path: resolve(out, 'fixed-chat-mobile.jpg'), type: 'jpeg', quality: 82 });
  await page.setViewportSize({ width: 1800, height: 1100 });
  let releaseLate;
  const lateGate = new Promise(resolve => { releaseLate = resolve; });
  const held = async route => { await lateGate; await route.fulfill({ json: answer }).catch(() => {}); };
  await page.route('**/api/agent/query', held); await page.getByLabel('질문', { exact: true }).fill('늦은 답변 취소 검사'); await page.getByRole('button', { name: '질문 보내기', exact: true }).click();
  await page.getByTestId('agent-waiting').waitFor(); await page.getByLabel('질문', { exact: true }).fill('보관할 초안');
  await respondToDialog(() => page.getByRole('button', { name: '도우미 닫기' }).click(), true, /기다림을 취소/);
  await drawer.waitFor({ state: 'hidden' }); releaseLate(); await page.unroute('**/api/agent/query', held);
  await page.getByRole('button', { name: 'AI 도우미 열기' }).click();
  await poll(async () => await page.getByTestId('chat-turn').last().getAttribute('data-status') === 'cancelled', 'Close cancels waiting');
  assert.equal(await page.getByTestId('agent-answer').count(), 2); assert.equal(await page.getByLabel('질문', { exact: true }).inputValue(), '보관할 초안');
  await page.getByLabel('질문', { exact: true }).fill('');
  const failRoute = route => route.abort('failed'); await page.route('**/api/agent/query', failRoute);
  await page.getByTestId('chat-turn').last().getByRole('button', { name: '다시 조회', exact: true }).click();
  await poll(async () => await page.getByTestId('chat-turn').last().getAttribute('data-status') === 'failed', 'Failed retry recorded'); await page.unroute('**/api/agent/query', failRoute);
  let releaseTimeout; const timeoutGate = new Promise(resolve => { releaseTimeout = resolve; });
  const timeoutRoute = async route => { await timeoutGate; await route.abort().catch(() => {}); };
  await page.route('**/api/agent/query', timeoutRoute); await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByTestId('chat-turn').last().getByRole('button', { name: '다시 조회', exact: true }).click(); await page.clock.fastForward(390001);
  await poll(async () => await page.getByTestId('chat-turn').last().getAttribute('data-status') === 'failed', 'Timeout recorded'); assert.match(await page.getByTestId('agent-error').last().textContent(), /6분 30초/);
  releaseTimeout(); await page.unroute('**/api/agent/query', timeoutRoute); await page.clock.resume();
  pass('Two real question/answer pairs remain across sensor targets; confirmed X close cancels waiting and preserves history/draft; late responses, network errors and timeout stay on their own turns');
  await close();

  const meta = await json('/api/history/metadata'); assert.equal(meta.row_count, profile.row_count); assert.equal(meta.first_time, profile.source_start); assert.equal(meta.last_time, profile.source_end);
  assert.equal((await fetch(base + '/api/history/metadata')).status, 401);
  const first = profile.first_rows[0], last = profile.first_rows[profile.first_rows.length - 1];
  const rangeQuery = new URLSearchParams({ tag: reheater.primary_tag, start: first.source_time, end: last.source_time });
  assert.equal((await fetch(base + '/api/history/range?' + rangeQuery)).status, 401);
  const range = await json('/api/history/range?' + rangeQuery);
  assert.equal(range.original_count, profile.first_rows.length); assert.equal(range.downsampled, false);
  for (const point of range.points) {
    const raw = profile.first_rows.find(row => row.source_row + 1 === point.source_row); assert.equal(point.source_time, raw.source_time); assert.equal(point.raw, raw.measurements[reheater.primary_tag]); assert.equal(point.value, Number(raw.measurements[reheater.primary_tag]));
  }
  assert.equal((await apiFetch(base + '/api/history/range?' + new URLSearchParams({ tag: '없는센서', start: first.source_time, end: last.source_time }))).status, 404);
  assert.equal((await apiFetch(base + '/api/history/range?' + new URLSearchParams({ tag: reheater.primary_tag, start: last.source_time, end: first.source_time }))).status, 422);
  assert.equal((await apiFetch(base + '/api/history/range?' + new URLSearchParams({ tag: reheater.primary_tag, start: first.source_time + '+09:00', end: last.source_time }))).status, 422);
  assert.equal((await apiFetch(base + '/api/history/range?' + new URLSearchParams({ tag: reheater.primary_tag, start: first.source_time + '+09:00', end: last.source_time + '+09:00' }))).status, 422);
  const full = await json('/api/history/range?' + new URLSearchParams({ tag: reheater.primary_tag, start: meta.first_time, end: meta.last_time, limit: '120' }));
  assert.equal(full.original_count, profile.row_count); assert.equal(full.sample_count, 120); assert.equal(full.sampling, 'original-observations'); assert.equal(full.points[0].source_row, 2); assert.equal(full.points.at(-1).source_row, profile.row_count + 1);
  writeFileSync(resolve(out, 'history-range.json'), JSON.stringify({ metadata: meta, short: range, full_sample: full }, null, 2));
  pass('Authenticated historical API matches raw CSV row/value/time; invalid tag and reversed range fail; full-period sampling preserves original endpoints and count');

  await page.getByRole('link', { name: '기간 조회', exact: true }).click(); assert.equal(await page.locator('#monitoring').isVisible(), false);
  assert.equal(await page.locator('.game-viewport').getAttribute('data-animation'), 'paused');
  await page.getByTestId('history-availability').waitFor();
  const queryHistory = async () => {
    await page.getByRole('button', { name: '기간 조회', exact: true }).click();
    await page.getByTestId('history-result').waitFor();
  };
  const clearSensors = async () => { const buttons = page.getByTestId('history-selected-sensors').getByRole('button'); while (await buttons.count()) await buttons.first().click(); };
  const addHistory = async tag => {
    await page.getByLabel('조회 설비', { exact: true }).selectOption(registry.sensors[tag].equipment);
    await page.getByLabel('조회 센서', { exact: true }).selectOption(tag);
    await page.getByRole('button', { name: '센서 추가', exact: false }).click();
  };
  await page.getByLabel('시작 시각', { exact: true }).fill(first.source_time.replace(' ', 'T'));
  await page.getByLabel('종료 시각', { exact: true }).fill(last.source_time.replace(' ', 'T'));
  await queryHistory();
  const historyChart = page.getByTestId('history-chart').first();
  await historyChart.waitFor(); assert.ok((await page.getByTestId('history-series').getAttribute('d')).includes('L'));
  const plot = await historyChart.boundingBox();
  await page.mouse.move(plot.x + plot.width * .52, plot.y + plot.height * .45);
  await page.getByTestId('history-tooltip').waitFor();
  const hoverReading = page.getByTestId('history-tooltip-value');
  const hoverRow = Number(await hoverReading.getAttribute('data-source-row'));
  const hoverSource = range.points.find(point => point.source_row === hoverRow);
  assert.ok(hoverSource); assert.equal(await hoverReading.getAttribute('data-quality'), hoverSource.quality);
  assert.ok((await hoverReading.textContent()).includes(hoverSource.raw));
  assert.ok((await page.getByTestId('history-tooltip').textContent()).includes(hoverSource.source_time));
  await historyChart.focus(); await page.keyboard.press('Home');
  assert.equal(Number(await hoverReading.getAttribute('data-source-row')), range.points[0].source_row);
  await page.keyboard.press('ArrowRight'); assert.equal(Number(await hoverReading.getAttribute('data-source-row')), range.points[1].source_row);
  await page.keyboard.press('Escape'); assert.equal(await page.getByTestId('history-tooltip').count(), 0);
  await addHistory(superheater.primary_tag);
  await addHistory('터빈용 주증기 압력');
  assert.equal(await page.getByTestId('history-selected-sensors').locator('li').count(), 3);
  await queryHistory();
  assert.equal(await page.getByTestId('history-series').count(), 3);
  assert.deepEqual((await page.getByTestId('history-chart').evaluateAll(nodes => nodes.map(node => node.dataset.unit))).sort(), ['kg/cm2g', '°C'].sort());
  assert.equal(await page.getByTestId('history-chart').locator('[data-testid="history-series"]').count(), 3);
  await page.getByTestId('history-chart').first().focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByTestId('history-tooltip-value').count(), 2);
  await inspect(page, 'history-desktop', out);
  await page.setViewportSize({ width: 1800, height: 2200 });
  await historyChart.evaluate(node => node.blur()); await page.evaluate(() => window.scrollTo(0, 0));
  const capturePlot = await historyChart.boundingBox();
  await page.mouse.move(capturePlot.x + capturePlot.width * .3, capturePlot.y + capturePlot.height * .4);
  await page.getByTestId('history-tooltip').waitFor();
  await page.screenshot({ path: resolve(out, 'compare-history.jpg'), type: 'jpeg', quality: 82, fullPage: true });
  await page.setViewportSize({ width: 1800, height: 1100 });
  const partialFailure = async route => {
    if (new URL(route.request().url()).searchParams.get('tag') === '터빈용 주증기 압력') await route.fulfill({ status: 503, json: { detail: '검증용 개별 센서 조회 실패' } });
    else await route.continue();
  };
  await page.route('**/api/history/range?*', partialFailure); await queryHistory();
  assert.equal(await page.getByTestId('history-series').count(), 2);
  assert.match(await page.locator('.history-error').textContent(), /터빈용 주증기 압력.*검증용/);
  await page.unroute('**/api/history/range?*', partialFailure);
  pass('Multiple sensors compare on matching unit axes; hover and keyboard details match original time/raw/CSV row; a failed sensor preserves other results');
  await clearSensors(); assert.equal(await page.getByRole('button', { name: '기간 조회', exact: true }).isDisabled(), true);
  await addHistory('목표 재열기 온도'); await queryHistory();
  assert.match(await page.getByTestId('history-result').textContent(), /결측/); assert.equal(await page.getByTestId('history-series').count(), 0);
  await page.getByLabel('시작 시각', { exact: true }).fill('2020-01-01T00:00'); await page.getByLabel('종료 시각', { exact: true }).fill('2020-01-02T00:00');
  await page.getByRole('button', { name: '기간 조회', exact: true }).click(); await page.getByTestId('history-empty').waitFor();
  await clearSensors(); await addHistory(feeders.primary_tag);
  await page.getByLabel('시작 시각', { exact: true }).fill(meta.first_time.replace(' ', 'T'));
  await page.getByLabel('종료 시각', { exact: true }).fill('2025-03-02T00:00'); await queryHistory();
  const feederHistory = await json('/api/history/range?' + new URLSearchParams({ tag: feeders.primary_tag, start: meta.first_time, end: '2025-03-02 00:00', limit: '1000' }));
  assert.ok(feederHistory.max > 0); assert.equal(feederHistory.missing_count, 0); assert.equal(feederHistory.parse_error_count, 0);
  writeFileSync(resolve(out, 'feeder-history.json'), JSON.stringify(feederHistory, null, 2));
  await page.getByRole('link', { name: '공장 모니터링', exact: true }).click(); assert.equal(await page.locator('#analysis').isVisible(), false);
  assert.equal(await page.getByRole('link', { name: '5분 예측', exact: true }).count(), 0);
  await page.getByTestId('forecast-value').waitFor(); await page.getByTestId('forecast-comparison').waitFor();
  assert.ok((await page.getByTestId('forecast-comparison').textContent()).includes('단순'));
  assert.equal(await page.getByTestId('forecast-value').evaluate(node => Boolean(node.closest('#monitoring'))), true);
  assert.equal(await page.locator('.page-unit-guide').evaluate(node => node === node.parentElement.lastElementChild), true);
  await page.getByTestId('forecast-value').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(out, 'forecast-below-factory.jpg'), type: 'jpeg', quality: 82 });
  pass('Empty and missing periods remain explicit; feeder historical values are present while replay zeros remain valid; forecast is below the factory and units guide is at page bottom');

  await page.getByRole('link', { name: '공장 모니터링', exact: true }).click(); await page.getByRole('button', { name: '04 재열기', exact: true }).click();
  await scene.scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(out, 'select-workspace.jpg'), type: 'jpeg', quality: 82 });
  await page.getByTestId('equipment-sensors').screenshot({ path: resolve(out, 'select-equipment-sensors.jpg'), type: 'jpeg', quality: 82 });
  await page.getByRole('button', { name: '선택 센서 자세히 보기 →', exact: true }).click();
  await inspect(page, 'workspace-desktop', out); await page.screenshot({ path: resolve(out, 'workspace-desktop.jpg'), type: 'jpeg', quality: 82 });
  for (const width of [1280, 900, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 }); await inspect(page, `workspace-${width}`, out); await checkLabels(`${width}px`);
    assert.equal(await drawer.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    await tab('AI 질문').click(); await checkChat(); await inspect(page, `chat-${width}`, out);
    assert.equal(await drawer.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    await tab('센서 상세').click();
  }
  await page.screenshot({ path: resolve(out, 'select-workspace-mobile.jpg'), type: 'jpeg', quality: 82 });
  for (const width of [1280, 900, 375, 320]) {
    await page.setViewportSize({ width, height: 400 }); await tab('AI 질문').click();
    await checkChat(); await inspect(page, `chat-short-${width}`, out);
    if (width === 375) await page.screenshot({ path: resolve(out, 'fixed-chat-landscape.jpg'), type: 'jpeg', quality: 82 });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await poll(async () => await drawer.evaluate(node => getComputedStyle(node).animationName) === 'none', 'Reduced motion stops panel animation');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 320, height: 900 });
  await close();
  await page.getByRole('button', { name: '메뉴', exact: true }).focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'true'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'AI 도우미 열기' }).focus(); await page.keyboard.press('Enter'); await drawer.waitFor(); await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'AI 도우미 열기' }).evaluate(node => node === document.activeElement), true);
  assert.equal(context.pages().length, initialPages); assert.deepEqual(downloads, []);
  pass('Game map, selects and fixed chat fit 1800/1280/900/768/375/320px and 400px-tall windows; opening animation respects reduced motion; keyboard and focus work without downloads');
  await page.locator('canvas').evaluate(node => node.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await page.getByText('3D 화면을 표시할 수 없습니다', { exact: true }).waitFor(); await page.getByRole('button', { name: '04 재열기', exact: true }).click();
  assert.equal(await selected(), reheater.primary_tag); await page.getByTestId('equipment-sensors').waitFor();
  pass('WebGL loss keeps equipment inventory and sensor exploration usable');
}
