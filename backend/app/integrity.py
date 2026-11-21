"""고정한 기대 해시와 실제 사용 파일의 무결성 대조."""
from contextlib import contextmanager
import hashlib
import json
import logging
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
LOG = logging.getLogger(__name__)


class IntegrityError(ValueError):
    pass


def manifest():
    try:
        value = json.loads(Path(os.getenv('BOILER_INTEGRITY_MANIFEST', ROOT / 'infra/resource-integrity.json')).read_text(encoding='utf-8'))
        if value['version'] != 1 or not isinstance(value['files'], dict):
            raise ValueError()
        return value
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise IntegrityError('Resource integrity manifest missing or invalid') from error


def check_hash(stream, expected, resource):
    if not isinstance(expected, str) or not re.fullmatch('[0-9a-f]{64}', expected):
        raise IntegrityError(f'Missing or invalid expected SHA-256: {resource}')
    actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual != expected:
        LOG.warning('resource_integrity_rejected resource=%s', resource)
        raise IntegrityError(f'Resource integrity mismatch: {resource}')
    stream.seek(0)
    LOG.info('resource_integrity_verified resource=%s sha256=%s', resource, actual)


@contextmanager
def verified_open(path, resource):
    try:
        if resource == 'forecast':
            expected = Path(str(path) + '.sha256').read_text(encoding='ascii').strip()
        else:
            expected = manifest()['files'].get(resource, {}).get('sha256')
        stream = Path(path).open('rb')
    except (OSError, ValueError, TypeError) as error:
        raise IntegrityError(f'Resource or expected hash unavailable: {resource}') from error
    with stream:
        check_hash(stream, expected, resource)
        yield stream


def verify_ollama(model):
    entry = manifest().get('ollama', {}).get(model)
    if not isinstance(entry, dict):
        raise IntegrityError('Ollama model has no trusted manifest')
    models = Path(os.getenv('OLLAMA_MODELS', Path.home() / '.ollama/models')).resolve()
    relative = Path(entry['manifest'])
    if relative.is_absolute() or '..' in relative.parts:
        raise IntegrityError('Invalid Ollama manifest path')
    try:
        with (models / 'manifests' / relative).open('rb') as stream:
            check_hash(stream, entry.get('sha256'), 'ollama-manifest')
            content = json.load(stream)
        for blob in [content['config'], *content['layers']]:
            digest = blob['digest']
            if not re.fullmatch('sha256:[0-9a-f]{64}', digest):
                raise IntegrityError('Invalid Ollama blob digest')
            with (models / 'blobs' / digest.replace(':', '-')).open('rb') as stream:
                if os.fstat(stream.fileno()).st_size != blob['size']:
                    raise IntegrityError('Ollama blob size mismatch')
                check_hash(stream, digest[7:], 'ollama-blob')
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise IntegrityError('Ollama model integrity verification failed') from error
    return entry['sha256']


def record_forecast(path):
    with Path(path).open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    target = Path(str(path) + '.sha256')
    temporary = target.with_suffix(target.suffix + '.tmp')
    temporary.write_text(digest + '\n', encoding='ascii')
    temporary.replace(target)
