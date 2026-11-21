"""기준을 변경하지 않는 앱 리소스 무결성 사전 검사."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.integrity import IntegrityError, manifest, verified_open, verify_ollama


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', default=os.getenv('OLLAMA_MODEL', 'qwen2.5-coder:7b'))
    parser.add_argument('--tools', action='store_true', help='Caddy and Gitleaks verification')
    parser.add_argument('--frontend', action='store_true', help='Verify the complete sealed frontend build')
    parser.add_argument('--run', nargs=argparse.REMAINDER, help='Execute a registered tool after verification')
    args = parser.parse_args()
    config = manifest()
    checked = []
    if args.frontend or (args.run and args.run[0] == 'caddy'):
        subprocess.run(['node', '--input-type=module', '-e',
                        "import {verifyBuild} from './scripts/frontend-integrity.mjs'; verifyBuild('frontend/dist');"], cwd=ROOT, check=True)
        checked.append('frontend')
    names = [args.run[0]] if args.run else ['font', 'sensor-definitions', 'dataset', 'definitions-source']
    if args.tools and not args.run:
        names += ['caddy', 'gitleaks']
    for name in names:
        entry = config['files'].get(name)
        if not entry:
            raise IntegrityError('No expected hash registered for resource')
        path = Path(os.getenv('BOILER_DATASET_PATH', ROOT / entry['path'])) if name == 'dataset' else ROOT / entry['path']
        with verified_open(path, name):
            pass
        checked.append(name)
    if args.run:
        if args.run[0] not in ('caddy', 'gitleaks'):
            raise IntegrityError('Only registered executables can be launched')
        env = dict(os.environ)
        if args.run[0] == 'caddy':
            env['FRONTEND_IMPORT_MAP_CSP'] = json.loads((ROOT / 'artifacts/integrity/frontend.json').read_text())['import_map_csp']
        return subprocess.run([str(ROOT / config['files'][args.run[0]]['path']), *args.run[1:]], env=env, cwd=ROOT, check=False).returncode
    model = Path(os.getenv('FORECAST_MODEL_PATH', ROOT / 'artifacts/models/reheater.json'))
    if model.exists():
        with verified_open(model, 'forecast'):
            pass
        checked.append('forecast')
    verify_ollama(args.model)
    checked.append('ollama')
    print(json.dumps({'passed': True, 'checked': checked}))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (IntegrityError, OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'Resource verification failed: {error}', file=sys.stderr)
        raise SystemExit(1)
