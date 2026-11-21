"""리소스 변조·누락과 사용 전 차단 검증."""
import hashlib
import io
import json
import os
import socket
import subprocess
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.integrity import IntegrityError, record_forecast, verified_open, verify_ollama
from backend.app.replay.csv_source import columns
from backend.app.forecast.service import forecast
from backend.app import model_client


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    checks = []
    def denied(action):
        try:
            action()
        except IntegrityError:
            return
        raise AssertionError('Unverified resource was accepted')

    with TemporaryDirectory(prefix='boiler-integrity-') as directory:
        root = Path(directory)
        dataset = root / 'data.csv'
        original = b'time,sensor\n2025-01-01,10\n'
        dataset.write_bytes(original)
        blob = b'fixture-model'
        blob_hash = digest(blob)
        models = root / 'models'
        (models / 'blobs').mkdir(parents=True)
        (models / 'blobs' / ('sha256-' + blob_hash)).write_bytes(blob)
        model = {'schemaVersion': 2, 'config': {'digest': 'sha256:' + blob_hash, 'size': len(blob)}, 'layers': []}
        manifest_bytes = json.dumps(model).encode()
        model_path = models / 'manifests/registry.ollama.ai/library/fixture/latest'
        model_path.parent.mkdir(parents=True)
        model_path.write_bytes(manifest_bytes)
        manifest_path = root / 'integrity.json'
        manifest = {'version': 1, 'files': {'dataset': {'sha256': digest(original)}},
                    'ollama': {'fixture:latest': {'manifest': 'registry.ollama.ai/library/fixture/latest', 'sha256': digest(manifest_bytes)}}}
        manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
        with patch.dict(os.environ, {'BOILER_INTEGRITY_MANIFEST': str(manifest_path), 'OLLAMA_MODELS': str(models)}):
            with verified_open(dataset, 'dataset') as stream:
                assert stream.read() == original
            checks.append('Verified bytes remain readable from the checked handle')
            settings = SimpleNamespace(dataset=dataset, encoding='utf-8', time_column='time')
            assert columns(settings) == ['time', 'sensor']
            before = dataset.stat()
            dataset.write_bytes(original.replace(b'10', b'99'))
            os.utime(dataset, ns=(before.st_atime_ns, before.st_mtime_ns))
            denied(lambda: columns(settings))
            checks.append('CSV rejects equal-size tampering even with its timestamp restored')
            dataset.write_bytes(original)
            del manifest['files']['dataset']
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
            denied(lambda: columns(settings))
            checks.append('Missing expected hash blocks the real CSV reader')
            assert verify_ollama('fixture:latest') == digest(manifest_bytes)
            checks.append('Pinned model manifest and blob pass')
            (models / 'blobs' / ('sha256-' + blob_hash)).write_bytes(b'changed-model')
            denied(lambda: verify_ollama('fixture:latest'))
            checks.append('Modified model blob is rejected')
            model_path.write_bytes(manifest_bytes + b' ')
            denied(lambda: verify_ollama('fixture:latest'))
            denied(lambda: verify_ollama('unregistered:latest'))
            checks.append('Modified or unregistered model manifest is rejected')
            with patch.dict(os.environ, {'OLLAMA_BASE_URL': 'http://127.0.0.1:11434', 'OLLAMA_MODEL': 'fixture:latest'}), \
                    patch.object(model_client, 'build_opener') as network:
                denied(lambda: model_client.model_json([], {}))
                network.assert_not_called()
            checks.append('Real model client blocks damaged models before network I/O')
            model_path.write_bytes(manifest_bytes)
            (models / 'blobs' / ('sha256-' + blob_hash)).write_bytes(blob)
            calls = []
            def running_model(request, timeout):
                calls.append(request.full_url)
                return io.BytesIO(b'{"models":[{"name":"fixture:latest","digest":"wrong"}]}')
            with patch.dict(os.environ, {'OLLAMA_BASE_URL': 'http://127.0.0.1:11434', 'OLLAMA_MODEL': 'fixture:latest'}), \
                    patch.object(model_client, 'build_opener', return_value=SimpleNamespace(open=running_model)):
                try:
                    model_client.model_json([], {})
                    raise AssertionError('Running model mismatch accepted')
                except ValueError:
                    assert calls == ['http://127.0.0.1:11434/api/tags']
            checks.append('Running model digest mismatch prevents inference')
            forecast_path = root / 'forecast.json'
            forecast_model = {'target': 'sensor', 'horizon_minutes': 5, 'intercept': 0, 'slope': 1, 'selected': 'naive',
                              'train_end_time': '2024-01-01', 'validation_end_time': '2024-12-01', 'dataset_sha256': digest(original),
                              'limitations': [], 'validation': {}, 'test': {'naive': {'mae': 1}}}
            forecast_path.write_text(json.dumps(forecast_model), encoding='utf-8')
            record_forecast(forecast_path)
            state = SimpleNamespace(current={'source_time': '2025-01-01', 'sensors': {'sensor': {'value': 10}}},
                                    registry={'sensor': {'unit': 'fixture'}}, snapshot=lambda: {'status': 'LIVE'})
            with patch.dict(os.environ, {'FORECAST_MODEL_PATH': str(forecast_path)}):
                assert forecast(state)['prediction'] == 10
                forecast_path.write_text('{}', encoding='utf-8')
                denied(lambda: forecast(state))
                Path(str(forecast_path) + '.sha256').unlink()
                denied(lambda: forecast(state))
            checks.append('Actual forecast reader rejects tampering and missing generated hash records')
            manifest['files']['dataset'] = {'sha256': digest(original)}
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
            dataset.unlink()
            denied(lambda: columns(settings))
            manifest_path.write_text('{}', encoding='utf-8')
            denied(lambda: columns(settings))
            checks.append('Missing file and invalid manifest fail closed')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 8000))
        probe.listen()
        result = subprocess.run(['node', 'scripts/start.mjs', '--reset-key'], cwd=Path(__file__).resolve().parents[1],
                                capture_output=True, encoding='utf-8', timeout=10)
        assert result.returncode == 1 and '8000' in result.stderr
    checks.append('Bootstrap rejects occupied app ports before restoring packages or resetting credentials')
    result = {'passed': True, 'checks': checks}
    output = Path(__file__).resolve().parents[1] / 'artifacts/security/resource-integrity/check-result.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
