import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, statSync, copyFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from '../frontend/node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('--check');
const out = resolve(root, 'artifacts/user-guide', ...(quick ? ['preflight'] : []));
const work = resolve(out, 'editing');
const dist = resolve(root, 'frontend/dist');
mkdirSync(work, { recursive: true });
mkdirSync(resolve(work, 'fonts'), { recursive: true });
copyFileSync('C:/Windows/Fonts/malgun.ttf', resolve(work, 'fonts/malgun.ttf'));
execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true });
execFileSync('ffprobe', ['-version'], { stdio: 'ignore', windowsHide: true });
assert.ok(readFileSync(resolve(dist, 'index.html'), 'utf8').includes('<script'), 'Build the frontend first');

// 공개 CSV 읽기 전용 준비: 환경·인증 파일과 디스크 DB 접근 없음
const prepare = String.raw`
import json,sys
from pathlib import Path
from datetime import datetime,UTC
sys.path.insert(0,str(Path.cwd()/'scripts'))
from dataset_path import discover_dataset
from backend.app.config import Settings
from backend.app.domain.registry import make_registry,EQUIPMENT,PROCESS_FLOWS
from backend.app.domain.state import BoilerState
from backend.app.domain.history import metadata,query_range
from backend.app.replay.csv_source import rows,columns
p=discover_dataset(Path('data/raw'))
s=Settings(p,2000,'unused','unused','utf-8-sig','일자',10000,3600,1)
registry=make_registry([t for t in columns(s) if t!='일자'])
state=BoilerState(registry,s)
state.kafka='CONNECTED'
frames=[]
for source_row,source_time,measurements in rows(s):
    if datetime.fromisoformat(source_time)<datetime(2025,3,30,19): continue
    sequence=len(frames)+1
    state.apply({'run_id':'ea37b913-7355-4320-8a29-6e39fb26a638','sequence':sequence,
      'source_time':source_time,'source_row':source_row,'emitted_at':datetime.now(UTC).isoformat(),
      'measurements':measurements},sequence-1)
    frames.append(state.current)
    if len(frames)==240: break
assert len(frames)==240
tags=['최종재열기 입구 온도 평균값','재열증기 과열저감기 입구 온도 A']
ranges={t:query_range(s,t,registry[t]['unit'],datetime(2025,3,30),datetime(2025,3,31),1000) for t in tags}
model_path=Path('artifacts/models/reheater.json')
model=json.loads(model_path.read_text(encoding='utf-8')) if model_path.is_file() else None
print(json.dumps({'registry':{'sensors':registry,'equipment':EQUIPMENT,'flows':PROCESS_FLOWS,
  'position_basis':'Logical scene coordinates; not physical instrument positions'},
  'frames':frames,'metadata':metadata(s),'ranges':ranges,'model':model},ensure_ascii=False))
`;
const fixture = JSON.parse(execFileSync(resolve(root, '.venv/Scripts/python.exe'), ['-X', 'utf8', '-c', prepare], {
  cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
}));
assert.equal(Object.keys(fixture.registry.sensors).length, 118);
const target = '최종재열기 입구 온도 평균값';
const compare = '재열증기 과열저감기 입구 온도 A';
assert.ok(fixture.model, 'Prepare the existing forecast model before recording');
const cues = [], chapters = [], checks = [], requests = [], errors = [];
let frame = 0, authenticated = false, browser, context, page, recording, replay;
let value = 0, revision = 0;
const proposals = [], audit = [], traces = new Map();
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const snapshot = () => ({ type: 'telemetry', current: { ...fixture.frames[frame], emitted_at: new Date().toISOString() },
  status: 'LIVE', stale: false, kafka: 'CONNECTED', error: null, rejected_events: 0, replay_interval_ms: 2000, stale_after_ms: 10000 });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(dist + sep)) return response.writeHead(403).end();
  try { response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); response.end(readFileSync(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const base = `http://127.0.0.1:${server.address().port}`;
const sockets = new Set();
let captureStart = 0, contentStart = 0, contentEnd = 0;
const elapsed = () => (performance.now() - captureStart) / 1000;
const clock = seconds => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
async function point(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
  await page.evaluate(rect => { const focus = document.getElementById('guide-focus'); Object.assign(focus.style, {
    display: 'block', left: rect.x - 5 + 'px', top: rect.y - 5 + 'px', width: rect.width + 10 + 'px', height: rect.height + 10 + 'px',
  }); }, box);
  await sleep(quick ? 50 : 450);
}
async function click(locator) { await point(locator); await locator.click(); await sleep(500); }
async function select(locator, option) { await point(locator); await locator.selectOption(option); await sleep(700); }
async function type(locator, text) { await point(locator); await locator.fill(''); await locator.pressSequentially(text, { delay: quick ? 0 : 55 }); }
async function beat(text, action, hold = 4.5) {
  const start = elapsed();
  console.log('SCENE ' + text.replaceAll('\n', ' / '));
  if (action) await action();
  await sleep(quick ? 100 : hold * 1000);
  cues.push({ start, end: elapsed(), text });
}
async function chapter(title) {
  chapters.push({ start: elapsed(), title });
  await page.evaluate(() => { document.getElementById('guide-focus').style.display = 'none'; });
}
async function card(title, detail, visible = true) {
  await page.evaluate(({ title, detail, visible }) => {
    const card = document.getElementById('guide-card'); card.hidden = !visible;
    card.querySelector('h1').textContent = title; card.querySelector('p').textContent = detail;
    document.getElementById('guide-focus').style.display = 'none';
  }, { title, detail, visible });
}
const navigate = name => click(page.getByRole('navigation', { name: '페이지 메뉴' }).getByRole('link', { name, exact: true }));
const check = (name, passed) => { assert.ok(passed, name); checks.push(name); };

try {
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  context = await browser.newContext({ viewport: { width: 1600, height: 800 }, locale: 'ko-KR',
    recordVideo: { dir: work, size: { width: 1600, height: 800 } } });
  await context.routeWebSocket('**/api/ws', socket => { sockets.add(socket); socket.send(JSON.stringify(snapshot())); socket.onClose(() => sockets.delete(socket)); });
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    requests.push({ path: url.pathname, method });
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/api/session') {
      if (method === 'POST') authenticated = true;
      if (method === 'DELETE') { authenticated = false; return json({ status: 'logged_out' }); }
      return json(authenticated ? { user_id: 'operator', role: 'operator' } : { detail: 'Login required' }, authenticated ? 200 : 401);
    }
    if (url.pathname === '/api/registry') return json(fixture.registry);
    if (url.pathname === '/api/history/metadata') return json(fixture.metadata);
    if (url.pathname === '/api/history/range') {
      const tag = url.searchParams.get('tag');
      check('Period query keeps source Tag and selected dates', !!fixture.ranges[tag] && ['2025-03-30T00:00', '2025-03-30T00:00:00'].includes(url.searchParams.get('start')) && ['2025-03-31T00:00', '2025-03-31T00:00:00'].includes(url.searchParams.get('end')));
      return json(fixture.ranges[tag]);
    }
    if (url.pathname === '/api/sensors/history') {
      const tag = url.searchParams.get('tag');
      return json({ tag, unit: fixture.registry.sensors[tag].unit, points: fixture.frames.slice(Math.max(0, frame - 119), frame + 1).map(item => ({ sequence: item.sequence, source_time: item.source_time, ...item.sensors[tag] })) });
    }
    if (url.pathname === '/api/forecast') {
      const model = fixture.model, current = snapshot().current, input = current.sensors[model.target].value;
      const predictions = { naive: input, linear_ar: model.intercept + model.slope * input };
      return json({ target: model.target, unit: '°C', input_value: input, prediction: predictions[model.selected],
        selected_model: model.selected, horizon_minutes: model.horizon_minutes,
        forecast_time: new Date(Date.parse(current.source_time.replace(' ', 'T') + 'Z') + model.horizon_minutes * 60000).toISOString().slice(0, 19),
        test: model.test, beats_naive_on_test: model.test[model.selected].mae < model.test.naive.mae,
        advisory: '관측 추세의 참고 정보입니다. 목표 온도와 제어 효과를 확인하기 전 실제 운전 판단에 사용하지 않습니다.' });
    }
    if (url.pathname === '/api/agent/query') {
      const query = route.request().postDataJSON();
      check('AI request is pinned to the chosen reheater sensor', query.tag === target && query.equipment === 'reheater');
      const current = snapshot().current, sensor = fixture.registry.sensors[query.tag], reading = current.sensors[query.tag];
      const trend = /최근|변화|추이/.test(query.question), id = randomUUID();
      const previous = fixture.frames[Math.max(0, frame - 2)].sensors[query.tag].value;
      const answer = trend ? `${sensor.label}은 최근 2분 동안 ${previous} → ${reading.value} ${sensor.unit}로 변했습니다.`
        : `${sensor.label}의 현재값은 ${reading.raw} ${sensor.unit}입니다.`;
      const calls = [{ id: 'tool-1', tool: 'get_equipment_status', result: { tag: query.tag, source_time: current.source_time, reading } }];
      if (trend) calls.push({ id: 'tool-2', tool: 'get_sensor_history', result: { tag: query.tag, points: fixture.frames.slice(Math.max(0, frame - 2), frame + 1).map(item => ({ source_time: item.source_time, ...item.sensors[query.tag] })) } });
      traces.set(id, { trace_id: id, model: '사용법 시연 응답', elapsed_ms: 1800, request: query, calls });
      await sleep(1800);
      return json({ trace_id: id, model: '사용법 시연 응답', answer, explanation: `원본 시각 ${current.source_time}. 원본 CSV 값으로 구성한 시연 응답입니다. [e1]`,
        limitations: '실제 모델 추론 영상이 아닙니다. 관측값으로 제어 효과나 안전 여부를 판단할 수 없습니다.' });
    }
    if (url.pathname.startsWith('/api/agent/traces/')) return json(traces.get(url.pathname.split('/').at(-1)));
    if (url.pathname === '/api/simulator') return json({ value, revision, enabled: true, proposals: [...proposals].reverse() });
    if (url.pathname === '/api/simulator/audit') return json(audit);
    if (url.pathname === '/api/simulator/proposals') {
      const request = route.request().postDataJSON();
      check('Simulator starts from a successful demo trace', traces.has(request.source_trace_id));
      const proposal = { id: randomUUID(), old_value: value, requested_value: value + 1, expected_revision: revision,
        status: 'pending', source_trace_id: request.source_trace_id, expires_at: Date.now() / 1000 + 300 };
      proposals.push(proposal);
      audit.push({ id: 1, created_at: Date.now() / 1000, proposal_id: proposal.id, event: 'proposed', payload: { old_value: value, requested_value: value + 1 } });
      return json(proposal);
    }
    if (/^\/api\/simulator\/proposals\/.+\/decision$/.test(url.pathname)) {
      const decision = route.request().postDataJSON(), proposal = proposals.at(-1);
      check('Explicit confirmation and expected revision are sent', decision.confirm === true && decision.approve === true && decision.expected_revision === revision);
      value = proposal.requested_value; revision++; proposal.status = 'executed';
      audit.push({ id: 2, created_at: Date.now() / 1000, proposal_id: proposal.id, event: 'approved', payload: { old_value: proposal.old_value, requested_value: value } },
        { id: 3, created_at: Date.now() / 1000, proposal_id: proposal.id, event: 'executed', payload: { old_value: proposal.old_value, new_value: value, revision } });
      return json({ status: 'executed', value, revision });
    }
    errors.push('Unexpected demo API: ' + method + ' ' + url.pathname); return json({ detail: 'Unscripted demo request' }, 501);
  });
  page = await context.newPage(); captureStart = performance.now(); recording = page.video();
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(base);
  await page.getByRole('heading', { name: '운영 화면 로그인' }).waitFor();
  await page.evaluate(() => {
    const style = document.createElement('style'); style.textContent = `
      #guide-cursor{position:fixed;width:17px;height:17px;background:#c9efff;border:2px solid #4aa5cf;border-radius:50%;z-index:2147483646;pointer-events:none;box-shadow:0 0 0 5px #76c7e62b;transform:translate(-50%,-50%)}
      #guide-focus{position:fixed;border:2px solid #8cd8f4;border-radius:8px;box-shadow:0 0 0 3px #70b6d22a;z-index:2147483645;pointer-events:none;display:none}
      #guide-card{position:fixed;inset:0;background:radial-gradient(ellipse at 70% 30%,#1c3345,#091923 72%);z-index:2147483643;display:flex;flex-direction:column;justify-content:center;padding:100px 160px;color:#eaf3f7}
      #guide-card[hidden]{display:none!important}#guide-card h1{font-size:56px;letter-spacing:-2px;line-height:1.3;white-space:pre-line;margin:0 0 26px}#guide-card p{font-size:25px;line-height:1.8;white-space:pre-line;color:#a5bccb}#guide-card small{font-size:16px;letter-spacing:4px;color:#829cae;margin-bottom:30px}
    `; document.head.append(style);
    for (const [id, text] of [['guide-cursor', ''], ['guide-focus', '']]) {
      const element = document.createElement('div'); element.id = id; element.textContent = text; document.body.append(element);
    }
    const card = document.createElement('div'); card.id = 'guide-card'; card.hidden = true;
    card.innerHTML = '<small>BOILEROPS AGENT / USER GUIDE</small><h1></h1><p></p>'; document.body.append(card);
    document.addEventListener('mousemove', event => { const cursor = document.getElementById('guide-cursor'); cursor.style.left = event.clientX + 'px'; cursor.style.top = event.clientY + 'px'; });
  });
  await card('BoilerOps Agent\n사용 안내', '설비 탐색 → AI 드릴다운 → 기간 비교 → 승인 연습');
  await page.evaluate(() => {
    const sync = document.createElement('div'); sync.id = 'guide-sync';
    sync.style.cssText = 'position:fixed;inset:0;background:white;z-index:2147483647'; document.body.append(sync);
  });
  await sleep(600);
  await page.evaluate(() => document.getElementById('guide-sync').remove());
  contentStart = elapsed();
  await chapter('01  시작하기');
  await beat('과거 운전 데이터를 탐색하고, 근거와 함께 확인하는 방법을 살펴봅니다.', null, 5);
  await card('앱 실행과 로그인', '프로젝트 폴더에서 npm start\nDocker Desktop을 먼저 실행하고, 발급받은 개인 접근 키로 로그인합니다.');
  await beat('프로젝트 폴더에서 npm start를 실행합니다.\n접근 키는 최초 발급·재발급 시 터미널에 표시됩니다.', null, 6);
  await card('', '', false);
  await beat('사용자 ID와 개인 접근 키를 입력합니다.\n이 영상은 실제 키 대신 시연 계정을 사용합니다.', async () => {
    await type(page.getByLabel('사용자 ID', { exact: true }), 'operator');
    await page.getByLabel('개인 접근 키', { exact: true }).fill('video-demo-key-not-a-real-access-key');
    await click(page.getByRole('button', { name: '로그인', exact: true }));
    await page.getByTestId('sequence').waitFor();
  });
  replay = setInterval(() => { frame = Math.min(frame + 1, fixture.frames.length - 1); for (const socket of sockets) socket.send(JSON.stringify(snapshot())); }, 2000);
  await chapter('02  공장 모니터링');
  await beat('Kafka·WebSocket 연결과 원본 시각을 확인하세요.\nLIVE는 현재 시각의 발전소가 아니라, 과거 CSV의 수신 상태입니다.', async () => {
    await point(page.locator('.header-runtime'));
    check('Telemetry is connected', await page.getByTestId('ws-status').textContent() === 'CONNECTED');
  });
  await beat('지도에서 설비와 논리 흐름을 둘러보세요.\n확대 버튼과 보기 초기화로 원하는 화면을 맞출 수 있습니다.', async () => {
    await point(page.getByLabel('계통도 화면', { exact: true }).locator('canvas'));
    await click(page.getByRole('button', { name: '확대', exact: true }));
    await sleep(1000);
    await click(page.getByRole('button', { name: '보기 초기화', exact: true }));
    await page.screenshot({ path: resolve(out, 'monitoring.png') });
  });
  await beat('그림은 설비를 찾기 위한 논리 배치입니다.\n설비를 누르면 대표값 외의 센서 목록도 열립니다.', async () => {
    await click(page.getByRole('button', { name: '04 재열기', exact: true }));
    await page.getByTestId('equipment-sensors').waitFor();
  });
  await chapter('03  센서 상세와 원본');
  await beat('선택 센서 자세히 보기에서 현재값·단위·원본 시각을 확인합니다.', async () => {
    await click(page.getByRole('button', { name: '선택 센서 자세히 보기', exact: false }));
    await page.getByTestId('inspector-tag').waitFor();
    await point(page.getByTestId('inspector-value'));
  });
  await beat('최근 추이는 최신 원본 시각 기준 2분입니다.\n표를 펼치면 원본값과 결측 여부를 직접 확인할 수 있습니다.', async () => {
    await click(page.getByText('추이 원본값 표로 보기', { exact: true }));
    await point(page.getByTestId('sensor-trend-source-table'));
    await page.screenshot({ path: resolve(out, 'sensor.png') });
  });
  await click(page.getByRole('button', { name: '도우미 닫기', exact: true }));
  await chapter('04  대화 안 드릴다운');
  await beat('AI 버튼을 열고 전체 설비부터 범위를 좁혀 보겠습니다.', async () => {
    await click(page.getByRole('button', { name: 'AI 도우미 열기', exact: true }));
    await click(page.getByRole('region', { name: '대화 안 데이터 탐색' }).getByRole('button', { name: '전체 설비', exact: true }));
  });
  const explorer = page.getByRole('region', { name: '대화 안 데이터 탐색' });
  await beat('재열기 → 최종재열기 → 센서 순서로 들어갑니다.\n설비와 묶음을 둘러보는 것만으로 AI를 호출하지 않습니다.', async () => {
    await click(explorer.getByRole('button', { name: '재열기 · 16개 센서', exact: true }));
    await click(explorer.getByRole('button', { name: /^최종재열기 ·/ }));
    await click(explorer.getByRole('button', { name: target + ' 선택', exact: true }));
    check('Drilldown selects the source sensor', (await page.getByTestId('agent-target').textContent()).includes(target));
  });
  await beat('선택한 센서의 원본 근거와 최근 2분 그래프를 펼칠 수 있습니다.', async () => {
    await click(explorer.getByText('최근 2분 추이·원본값', { exact: true }));
    await explorer.getByTestId('sensor-trend').waitFor();
    await page.screenshot({ path: resolve(out, 'drilldown.png') });
  });
  await chapter('05  AI 설명과 조회 근거');
  await beat('현재값 설명을 요청합니다. 실제 모델의 대기 시간은 환경마다 다릅니다.\n영상의 AI 답변은 사용법을 보여 주기 위한 시연 응답입니다.', async () => {
    await click(explorer.getByRole('button', { name: 'AI로 현재값 설명', exact: true }));
    await page.getByTestId('agent-answer').waitFor();
    await point(page.getByTestId('agent-answer').first());
  });
  await beat('답변에서 원본 시각과 조회 근거·도구 기록을 확인하세요.', async () => {
    await click(page.getByText('조회 근거·도구 기록 보기', { exact: true }).first());
    await click(page.getByText('tool-1 · get_equipment_status', { exact: true }));
    await page.screenshot({ path: resolve(out, 'ai-answer.png') });
  });
  await beat('추이 이어 묻기로 같은 센서에 후속 질문을 보냅니다.\n지난 답변은 남고, 각 질문은 독립된 조회로 처리됩니다.', async () => {
    await click(page.getByRole('button', { name: '추이 이어 묻기', exact: true }).first());
    await page.getByTestId('agent-answer').nth(1).waitFor();
    await point(page.getByTestId('agent-answer').nth(1));
  });
  await click(page.getByRole('button', { name: '도우미 닫기', exact: true }));
  await chapter('06  원하는 기간 비교');
  await beat('기간 조회에서 비교할 센서를 추가합니다.\n같은 단위의 센서는 한 그래프에서 비교할 수 있습니다.', async () => {
    await navigate('기간 조회');
    const remove = page.getByTestId('history-selected-sensors').getByRole('button');
    while (await remove.count()) await click(remove.first());
    await select(page.getByLabel('조회 설비', { exact: true }), 'reheater');
    await select(page.getByLabel('조회 센서', { exact: true }), target);
    await click(page.getByRole('button', { name: '센서 추가', exact: false }));
    await select(page.getByLabel('조회 센서', { exact: true }), compare);
    await click(page.getByRole('button', { name: '센서 추가', exact: false }));
  });
  await beat('시작·종료 시각을 정하고 기간 조회를 누르세요.', async () => {
    await page.getByLabel('시작 시각', { exact: true }).fill('2025-03-30T00:00');
    await page.getByLabel('종료 시각', { exact: true }).fill('2025-03-31T00:00');
    await click(page.getByRole('button', { name: '기간 조회', exact: true }));
    await page.getByTestId('history-chart').waitFor();
    check('Two same-unit source series are shown', await page.locator('.history-series').count() === 2);
  });
  await beat('그래프 위에 마우스를 올리면 시각별 원본값이 보입니다.\n키보드 화살표로도 관측점을 이동할 수 있습니다.', async () => {
    await point(page.getByTestId('history-chart'));
    await page.getByTestId('history-chart').focus();
    await page.keyboard.press('Home'); await sleep(800); await page.keyboard.press('ArrowRight');
    await page.getByTestId('history-tooltip').waitFor();
    await page.screenshot({ path: resolve(out, 'history.png') });
  });
  await chapter('07  5분 예측 읽기');
  await beat('공장 모니터링 아래에서 재열기의 5분 뒤 예측을 확인합니다.\n예측 시각과 시험 오차를 함께 읽으세요.', async () => {
    await navigate('공장 모니터링');
    await point(page.getByRole('region', { name: '온도 예측', exact: true }));
  });
  await beat('현재 모델은 시험에서 단순 기준 모델보다 오차가 컸습니다.\n예측을 실제 설비 제어의 근거로 단정하지 않습니다.', async () => {
    await click(page.getByText('모델별 시험 성능 자세히 보기', { exact: true }));
    await point(page.getByTestId('forecast-comparison'));
    await page.screenshot({ path: resolve(out, 'forecast.png') });
  });
  await chapter('08  변경 승인 연습');
  await beat('승인 연습은 성공한 재열기 AI 조회 근거를 사용합니다.\n연습용 값을 한 단계 높이는 제안을 만들어 보겠습니다.', async () => {
    await navigate('승인 연습');
    await type(page.getByLabel('Simulator 요청', { exact: true }), '연습용 값을 한 단계 높여 주세요.');
    await click(page.getByRole('button', { name: 'Agent Simulator 제안 생성', exact: true }));
    await page.getByTestId('proposal-status').waitFor();
    check('Proposal does not execute before approval', value === 0 && revision === 0);
  });
  await beat('기존값·요청값·Revision을 확인하고, 확인 체크 후 승인합니다.\n시연에서는 연습용 값만 0에서 1로 바뀝니다.', async () => {
    await point(page.locator('.proposal'));
    await click(page.getByRole('checkbox', { name: '위 Simulator 변경값과 데모 정책을 확인했습니다.' }));
    await click(page.getByRole('button', { name: '승인 및 Simulator 실행', exact: true }));
    await page.getByText('승인한 Simulator 변경이 실행되었습니다.', { exact: true }).waitFor();
    check('Explicit demo approval changes value once', value === 1 && revision === 1);
    await page.screenshot({ path: resolve(out, 'approval.png') });
  });
  await chapter('09  변경 기록과 마무리');
  await beat('변경 기록에서 제안·승인·실행 결과를 확인합니다.\n실제 발전설비에는 연결되지 않습니다.', async () => {
    await navigate('변경 기록');
    await page.getByRole('heading', { name: '변경 실행', exact: true }).waitFor();
    await point(page.locator('.audit-list'));
    check('Audit shows proposed, approved and executed events', audit.length === 3);
    await page.screenshot({ path: resolve(out, 'audit.png') });
  });
  await beat('작업을 마치면 로그아웃하고, 실행한 터미널에서 Enter로 앱을 종료합니다.', async () => {
    await click(page.getByRole('button', { name: 'operator · 로그아웃', exact: true }));
    await page.getByRole('heading', { name: '운영 화면 로그인' }).waitFor();
  });
  await card('관측 → 탐색 → 근거 확인', '센서의 원본값과 시각을 확인하고\nAI 답변·예측의 한계를 함께 읽어 주세요.');
  await beat('핵심은 원본값·시각·근거를 함께 확인하는 것입니다.\n이 영상은 공개 CSV와 격리된 시연 응답으로 제작했습니다.', null, 6);
  contentEnd = elapsed();
  check('No browser or unexpected API errors', errors.length === 0);
  clearInterval(replay);
  await page.close();
  await context.close();
  await recording.saveAs(resolve(work, 'screen.webm'));
  await browser.close(); browser = null;
  const duration = contentEnd - contentStart;
  // 종료 지연 대신 녹화 프레임의 흰색 프리롤 끝으로 자막 동기화
  const sync = spawnSync('ffmpeg', ['-hide_banner', '-i', resolve(work, 'screen.webm'), '-vf', 'crop=16:16:0:0,blackdetect=d=0.05:pix_th=0.2:pic_th=0.99', '-an', '-f', 'null', '-'],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(sync.status, 0);
  const trimStart = Number([...sync.stderr.matchAll(/black_start:([\d.]+)/g)].at(-1)?.[1]);
  assert.ok(Number.isFinite(trimStart) && trimStart < 10, 'Video frame sync marker is present');
  const timeline = { title: 'BoilerOps Agent 사용 안내', scope: 'Actual UI and public CSV; isolated login, AI and Simulator examples; no real DB or credentials',
    duration, video_trim_start: trimStart, width: 1920, height: 1080, fps: 25, audio: false,
    chapters: chapters.map((item, index) => ({ title: item.title, start: item.start - contentStart, end: (chapters[index + 1]?.start ?? contentEnd) - contentStart })),
    cues: cues.map(cue => ({ ...cue, start: cue.start - contentStart, end: cue.end - contentStart })), checks, requests, source_sensors: 118 };
  assert.ok(timeline.cues.every((cue, index) => cue.start >= 0 && cue.end > cue.start && (index === 0 || cue.start >= timeline.cues[index - 1].end)));
  writeFileSync(resolve(out, 'timeline.json'), JSON.stringify(timeline, null, 2) + '\n');
  writeFileSync(resolve(out, 'boilerops-user-guide.ko.srt'), timeline.cues.map((cue, index) => `${index + 1}\n${clock(cue.start)} --> ${clock(cue.end)}\n${cue.text}\n`).join('\n'), 'utf8');
  const assClock = seconds => clock(seconds).replace(/,(\d{2})\d$/, '.$1').replace(/^0/, '');
  const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Malgun Gothic,32,&H00F7F3EA,&H00F7F3EA,&H00231909,&H00231909,0,0,0,0,100,100,0,0,1,1,0,2,100,100,22,1\nStyle: Badge,Malgun Gothic,17,&H00CBBCA5,&H00CBBCA5,&H00231909,&H00231909,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const labels = `Dialogue: 1,0:00:00.00,${assClock(duration)},Badge,,0,0,0,,{\\pos(40,968)}사용법 시연 · 공개 CSV / AI·승인은 예시 응답\n`
    + timeline.chapters.map(item => `Dialogue: 1,${assClock(item.start)},${assClock(item.end)},Badge,,0,0,0,,{\\an9\\pos(1880,968)}${item.title}`).join('\n') + '\n';
  writeFileSync(resolve(work, 'captions.ass'), ass + labels + timeline.cues.map(cue => `Dialogue: 0,${assClock(cue.start)},${assClock(cue.end)},Default,,0,0,0,,${cue.text.replaceAll('\n', '\\N')}`).join('\n') + '\n', 'utf8');
  writeFileSync(resolve(work, 'chapters.ffmeta'), ';FFMETADATA1\ntitle=BoilerOps Agent 사용 안내\n' + timeline.chapters.map(item => `\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(item.start * 1000)}\nEND=${Math.round(item.end * 1000)}\ntitle=${item.title}\n`).join(''), 'utf8');
  console.log('ENCODING ' + duration.toFixed(1) + ' seconds');
  await new Promise((resolveEncode, reject) => {
    const encoder = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'warning', '-ss', String(trimStart), '-i', 'screen.webm', '-i', 'chapters.ffmeta',
      '-t', String(duration), '-map', '0:v:0', '-map_metadata', '1', '-map_chapters', '1',
      '-vf', 'scale=1920:960,pad=1920:1080:0:0:color=0x091923,drawbox=x=0:y=960:w=1920:h=2:color=0x446174:t=fill,ass=captions.ass:fontsdir=fonts',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '25', '-an', '-movflags', '+faststart', '../boilerops-user-guide.mp4'],
      { cwd: work, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let log = ''; encoder.stderr.on('data', data => { log += data; });
    encoder.on('error', reject); encoder.on('close', code => { writeFileSync(resolve(work, 'encode.log'), log); code === 0 ? resolveEncode() : reject(new Error('FFmpeg failed: ' + log.slice(-2500))); });
  });
  const output = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', resolve(out, 'boilerops-user-guide.mp4')], { encoding: 'utf8', windowsHide: true }));
  const video = output.streams.find(stream => stream.codec_type === 'video');
  assert.equal(video.width, 1920); assert.equal(video.height, 1080); assert.equal(video.codec_name, 'h264');
  assert.ok(Math.abs(Number(output.format.duration) - duration) < 1); assert.equal(output.chapters.length, chapters.length);
  assert.ok(statSync(resolve(out, 'boilerops-user-guide.mp4')).size > 1000000);
  writeFileSync(resolve(out, 'verification.json'), JSON.stringify({ passed: true, codec: video.codec_name, width: video.width, height: video.height,
    duration: Number(output.format.duration), subtitles: timeline.cues.length, chapters: chapters.length, checks, scope: timeline.scope }, null, 2) + '\n');
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '2', '-i', resolve(out, 'boilerops-user-guide.mp4'), '-frames:v', '1', resolve(out, 'poster.png')], { windowsHide: true });
  console.log(JSON.stringify({ passed: true, output: resolve(out, 'boilerops-user-guide.mp4'), seconds: duration, subtitles: cues.length, checks: checks.length }));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(out, 'recording-failure.png') }).catch(() => {});
  writeFileSync(resolve(out, 'failure.json'), JSON.stringify({ error: String(error.stack ?? error), errors, chapters, checks }, null, 2));
  throw error;
} finally {
  clearInterval(replay);
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
