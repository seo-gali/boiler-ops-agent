"""운전데이터와 참고자료 CSV 구분."""
import csv
from pathlib import Path


def discover_dataset(directory: Path) -> Path:
    candidates = []
    for path in directory.glob('*.csv'):
        try:
            with path.open(encoding='utf-8-sig', newline='') as stream:
                header = next(csv.reader(stream), [])
        except UnicodeDecodeError:
            continue
        if {'일자', '실제 출력값', '총 주증기 유량'}.issubset(header):
            candidates.append(path)
    if len(candidates) != 1:
        raise ValueError('data/raw에서 운전데이터 CSV 한 개를 찾을 수 없습니다. .env의 BOILER_DATASET_PATH를 지정하세요.')
    return candidates[0]


if __name__ == '__main__':
    print(discover_dataset(Path(__file__).resolve().parents[1] / 'data/raw'))
