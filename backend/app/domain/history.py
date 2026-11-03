import math
from array import array
from datetime import datetime

from backend.app.config import Settings
from backend.app.replay.csv_source import columns, records


class HistoryTimezoneMismatch(ValueError):
    pass


def metadata(settings: Settings):
    before = settings.dataset.stat()
    header = columns(settings)
    first_time = last_time = None
    first_instant = None
    count = 0
    for count, source_time, instant, _ in records(settings, header):
        if first_instant is None:
            first_instant, first_time = instant, source_time
        elif instant.utcoffset() != first_instant.utcoffset():
            raise ValueError("CSV history requires a consistent timezone offset")
        last_time = source_time
    after = settings.dataset.stat()
    if before.st_mtime_ns != after.st_mtime_ns or before.st_size != after.st_size:
        raise ValueError("CSV changed during history metadata read; retry the request")
    offset = first_instant.strftime('%z') if first_instant and first_instant.utcoffset() is not None else None
    return {"first_time": first_time, "last_time": last_time, "row_count": count,
            "timezone_offset": f"{offset[:3]}:{offset[3:]}" if offset else None,
            "time_basis": "CSV 원본 시각" if offset else "CSV 원본 시각 · 시간대 정보 없음"}


def query_range(settings: Settings, tag: str, unit: str | None, start: datetime, end: datetime, limit: int):
    before = settings.dataset.stat()
    header = columns(settings)
    column = header.index(tag)
    times, raw_values = [], []
    values = array('d')
    valid, errors = bytearray(), bytearray()
    first_instant = None
    first_row = 0
    valid_count = missing_count = parse_error_count = 0
    minimum = maximum = None
    for sequence, source_time, instant, cells in records(settings, header):
        if first_instant is None:
            first_instant = instant
            if (start.utcoffset() is None) != (instant.utcoffset() is None):
                raise HistoryTimezoneMismatch("조회 시각의 시간대 형식이 CSV 원본과 다릅니다.")
        elif instant.utcoffset() != first_instant.utcoffset():
            raise ValueError("CSV history requires a consistent timezone offset")
        if instant < start or instant > end:
            continue
        index = len(values)
        if not index:
            first_row = sequence + 1
        if index % 8 == 0:
            valid.append(0)
            errors.append(0)
        raw = cells[column]
        value = math.nan
        if raw.strip():
            try:
                value = float(raw)
                if not math.isfinite(value):
                    raise ValueError('Non-finite value')
                valid[index >> 3] |= 1 << (index & 7)
                valid_count += 1
                minimum = value if minimum is None else min(minimum, value)
                maximum = value if maximum is None else max(maximum, value)
            except ValueError:
                errors[index >> 3] |= 1 << (index & 7)
                parse_error_count += 1
        else:
            missing_count += 1
        times.append(source_time)
        raw_values.append(raw)
        values.append(value)
    after = settings.dataset.stat()
    if before.st_mtime_ns != after.st_mtime_ns or before.st_size != after.st_size:
        raise ValueError("CSV changed during history query; retry the request")
    original_count = len(values)
    sample_count = min(original_count, limit)
    selected = [round(index * (original_count - 1) / (sample_count - 1)) for index in range(sample_count)] if sample_count > 1 else [0] if sample_count else []
    points = []
    sample = 0
    gap = False
    for index in range(original_count):
        mask = 1 << (index & 7)
        is_valid = valid[index >> 3] & mask
        if sample < len(selected) and index == selected[sample]:
            quality = 'valid' if is_valid else 'parse_error' if errors[index >> 3] & mask else 'missing'
            points.append({"source_row": first_row + index, "source_time": times[index], "raw": raw_values[index],
                           "value": values[index] if is_valid else None, "quality": quality, "gap_before": gap})
            sample += 1
            gap = False
        if not is_valid:
            gap = True
    return {"tag": tag, "unit": unit, "start": start.isoformat(), "end": end.isoformat(),
            "original_count": original_count, "sample_count": len(points), "valid_count": valid_count,
            "missing_count": missing_count, "parse_error_count": parse_error_count,
            "min": minimum, "max": maximum, "downsampled": original_count > len(points),
            "sampling": "original-observations", "points": points}
