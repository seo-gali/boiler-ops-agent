"""공개 컬럼 정의서와 원본 Tag를 대조한 단위 메타데이터 추출."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
from zipfile import ZipFile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def read_definitions(path):
    with ZipFile(path) as archive:
        strings = [''.join(node.itertext()) for node in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)] if 'xl/sharedStrings.xml' in archive.namelist() else []
        sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
        rows = []
        for row in sheet.findall('.//s:row', NS):
            cells = {}
            for cell in row.findall('s:c', NS):
                node = cell.find('s:v', NS)
                inline = cell.find('s:is', NS)
                text = node.text if node is not None else ''.join(inline.itertext()) if inline is not None else ''
                cells[re.sub(r'\d', '', cell.attrib['r'])] = strings[int(text)] if cell.get('t') == 's' else text
            if cells.get('A') and cells['A'] != '항목명':
                rows.append((int(row.attrib['r']), cells))
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--definitions', type=Path, default=ROOT / 'data/raw/CustomExcelView.xlsx')
    parser.add_argument('--dataset', type=Path)
    args = parser.parse_args()
    datasets = list((ROOT / 'data/raw').glob('*운전데이터*.csv'))
    dataset = args.dataset or (datasets[0] if len(datasets) == 1 else None)
    if dataset is None:
        raise SystemExit('운전데이터 CSV를 --dataset으로 지정하세요.')
    with dataset.open(encoding='utf-8-sig', newline='') as stream:
        tags = next(csv.reader(stream))
    sensors = {}
    for row_number, cells in read_definitions(args.definitions):
        tag = cells['A']
        if tag == '일자':
            continue
        if tag in sensors or tag not in tags:
            raise ValueError(f'원본과 다른 Tag 또는 중복: {tag}')
        match = re.search(r'단위는\s*(.+?)입니다', cells.get('C', ''))
        unit = cells.get('G') or (match[1].strip() if match else None)
        if not unit:
            raise ValueError(f'단위 정의 누락: {tag}')
        sensors[tag] = {"source_tag": cells.get('B'), "description": cells.get('C'), "unit": '°C' if unit == 'degC' else unit,
                        "source_unit": unit, "source_row": row_number}
    if set(sensors) != set(tags) - {'일자'}:
        raise ValueError('컬럼 정의서와 운전데이터 Tag 집합 불일치')
    result = {"source_file": args.definitions.name, "source_sha256": hashlib.sha256(args.definitions.read_bytes()).hexdigest(),
              "dataset_sha256": hashlib.sha256(dataset.read_bytes()).hexdigest(), "sensors": sensors}
    target = ROOT / 'backend/app/domain/sensor_definitions.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'원본과 대조한 센서 단위 {len(sensors)}개 저장: {target.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
