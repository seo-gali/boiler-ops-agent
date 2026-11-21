import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
try {
  for (const port of [8000, 5173]) await new Promise((ok, fail) => {
    const probe = createServer();
    probe.once('error', () => fail(new Error(`${port} 포트를 사용 중입니다. 앞서 실행한 본인 서버를 종료한 뒤 다시 실행하세요.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(ok));
  });
  const child = spawn('uv', ['run', '--frozen', '--reinstall', '--no-cache', '--no-build', 'python', 'scripts/start.py', ...process.argv.slice(2)],
    { cwd: root, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  process.on('SIGINT', () => {});
  child.once('error', () => { console.error('uv를 실행하지 못했습니다. 설치 상태를 확인하세요.'); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
