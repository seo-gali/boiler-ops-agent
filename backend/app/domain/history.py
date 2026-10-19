import math
from bisect import bisect_left, bisect_right
from datetime import datetime
from functools import lru_cache

from backend.app.config import Settings
from backend.app.replay.csv_source import rows


@lru_cache(maxsize=2)
def _index(settings: Settings, modified: int, size: int):
    times = []
    first_time = last_time = None
    for _, source_time, _ in rows(settings):
        timestamp = datetime.fromisoformat(source_time)
        if times and timestamp.utcoffset() != times[0].utcoffset():
            raise ValueError("CSV history requires a consistent timezone offset")
        times.append(timestamp)
        if first_time is None:
            first_time = source_time
        last_time = source_time
    current = settings.dataset.stat()
    if current.st_mtime_ns != modified or current.st_size != size:
        raise ValueError("CSV changed during history indexing; retry the request")
    offset = times[0].strftime('%z') if times and times[0].utcoffset() is not None else None
    return {
        "times": times, "first_time": first_time, "last_time": last_time, "row_count": len(times),
        "timezone_offset": f"{offset[:3]}:{offset[3:]}" if offset else None,
        "time_basis": "CSV 원본 시각" if offset else "CSV 원본 시각 · 시간대 정보 없음",
    }


def _dataset_index(settings: Settings):
    stat = settings.dataset.stat()
    return _index(settings, stat.st_mtime_ns, stat.st_size)


def metadata(settings: Settings):
    return {key: value for key, value in _dataset_index(settings).items() if key != 'times'}


def query_range(settings: Settings, tag: str, unit: str | None, start: datetime, end: datetime, limit: int):
    stat = settings.dataset.stat()
    return _query_range(settings, stat.st_mtime_ns, stat.st_size, tag, unit, start, end, limit)


@lru_cache(maxsize=16)
def _query_range(settings: Settings, modified: int, size: int, tag: str, unit: str | None, start: datetime, end: datetime, limit: int):
    source = _index(settings, modified, size)
    times = source['times']
    if times and (start.utcoffset() is None) != (times[0].utcoffset() is None):
        raise ValueError("조회 시각의 시간대 형식이 CSV 원본과 다릅니다.")
    first = bisect_left(times, start)
    last = bisect_right(times, end)
    original_count = last - first
    sample_count = min(original_count, limit)
    selected = {round(index * (original_count - 1) / (sample_count - 1)) for index in range(sample_count)} if sample_count > 1 else {0} if sample_count else set()
    points = []
    valid_count = missing_count = parse_error_count = 0
    minimum = maximum = None
    gap = False
    for sequence, source_time, values in (rows(settings) if original_count else ()):
        index = sequence - 1
        if index < first:
            continue
        if index >= last:
            break
        raw = values[tag]
        value, quality = None, 'missing'
        if raw.strip():
            try:
                value = float(raw)
                if not math.isfinite(value):
                    raise ValueError('Non-finite value')
                quality = 'valid'
            except ValueError:
                value, quality = None, 'parse_error'
        if quality == 'valid':
            valid_count += 1
            minimum = value if minimum is None else min(minimum, value)
            maximum = value if maximum is None else max(maximum, value)
        elif quality == 'missing':
            missing_count += 1
        else:
            parse_error_count += 1
        if index - first in selected:
            points.append({"source_row": sequence + 1, "source_time": source_time, "raw": raw,
                           "value": value, "quality": quality, "gap_before": gap})
            gap = False
        if value is None:
            gap = True
    current = settings.dataset.stat()
    if current.st_mtime_ns != modified or current.st_size != size:
        raise ValueError("CSV changed during history query; retry the request")
    return {
        "tag": tag, "unit": unit, "start": start.isoformat(), "end": end.isoformat(),
        "original_count": original_count, "sample_count": len(points), "valid_count": valid_count,
        "missing_count": missing_count, "parse_error_count": parse_error_count,
        "min": minimum, "max": maximum, "downsampled": original_count > len(points),
        "sampling": "original-observations", "points": points,
    }
