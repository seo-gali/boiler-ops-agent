import json
from pathlib import Path

DEFINITIONS = json.loads(Path(__file__).with_name('sensor_definitions.json').read_text(encoding='utf-8'))

EQUIPMENT = [
    {"id": "feeders", "label": "Feeders", "name": "급탄기", "description": "석탄을 공급하는 설비입니다. 급탄기 속도와 관련 값을 확인합니다.", "primary_tag": "급탄기 A 속도 평균값 ", "position": [-7.45, 0, 3.54], "size": [1.8, 1.9, 1.7]},
    {"id": "furnace", "label": "Furnace", "name": "화로", "description": "연료를 태워 열을 만드는 공간입니다. 노내 튜브와 헤더의 온도를 확인합니다.", "primary_tag": "노내 상부 좌측부 튜브 헤더 출구 온도 평균값", "position": [-3.59, 0, 0.36], "size": [2.1, 4.2, 1.9]},
    {"id": "superheater", "label": "Superheater", "name": "과열기", "description": "증기를 더 가열하는 설비입니다. 출구 온도와 주증기 관련 값을 확인합니다.", "primary_tag": "최종과열기 출구 온도 평균값", "position": [0.27, 0, -2.82], "size": [2, 3, 1.4]},
    {"id": "reheater", "label": "Reheater", "name": "재열기", "description": "터빈을 거친 증기를 다시 가열하는 설비입니다. 이 앱의 5분 예측 대상입니다.", "primary_tag": "최종재열기 입구 온도 평균값", "position": [4.13, 0, -6], "size": [2.3, 2.3, 1.5]},
    {"id": "economizer", "label": "Economizer", "name": "절탄기", "description": "배기가스의 열로 급수를 예열하는 설비입니다. 입구 급수 온도를 확인합니다.", "primary_tag": "절탄기 입구 급수 온도 중간값", "position": [-0.68, 0, 7.04], "size": [2.5, 1.9, 1.8]},
    {"id": "scr", "label": "SCR", "name": "탈질 설비", "description": "촉매를 이용해 질소산화물을 줄이는 설비입니다. 배기가스 입구 온도를 확인합니다.", "primary_tag": "선택적 촉매 환원장치A 배기가스 입구 온도 평균값", "position": [3.18, 0, 3.86], "size": [2, 2.5, 1.8]},
    {"id": "stack", "label": "Stack", "name": "굴뚝", "description": "배기가스를 내보내는 통로입니다. 산소와 질소산화물 관련 값을 확인합니다.", "primary_tag": "배기가스 산소 중간값", "position": [7.04, 0, 0.68], "size": [1, 3.7, 1]},
]

REPRESENTATIVE = {
    "실제 출력값": ("generation", "logical-group"),
    "목표 발전량": ("generation", "logical-group"),
    "총 주증기 유량": ("superheater", "logical-group"),
    "터빈용 주증기 압력": ("superheater", "logical-group"),
    "최종과열기 출구 온도 평균값": ("superheater", "verified-by-tag"),
    "배기가스 산소 중간값": ("stack", "logical-group"),
    "과열기 스프레이 총 유량": ("superheater", "logical-group"),
    "굴뚝용 질소산화물 분석기": ("stack", "verified-by-tag"),
    "급탄기 A 속도 평균값 ": ("feeders", "verified-by-tag"),
    "노내 상부 좌측부 튜브 헤더 출구 온도 평균값": ("furnace", "verified-by-tag"),
    "절탄기 입구 급수 온도 중간값": ("economizer", "verified-by-tag"),
    "최종재열기 입구 온도 평균값": ("reheater", "verified-by-tag"),
    "선택적 촉매 환원장치A 배기가스 입구 온도 평균값": ("scr", "verified-by-tag"),
}


PROCESS_FLOWS = [
    {"id": "flue-gas", "label": "연소 / 배기가스 논리 흐름", "equipment": ["feeders", "furnace", "superheater", "economizer", "scr", "stack"]},
    {"id": "water-steam", "label": "급수 / 증기 논리 흐름", "equipment": ["economizer", "furnace", "superheater"]},
]


def classify(tag):
    if tag in REPRESENTATIVE:
        return REPRESENTATIVE[tag]
    groups = [
        (("선택적 촉매",), "scr"), (("재열",), "reheater"),
        (("과열", "주증기"), "superheater"), (("절탄", "급수"), "economizer"),
        (("급탄", "석탄"), "feeders"), (("노내", "보일러 노", "기수분리", "버너", "공기", "산소 제어", "산소농도"), "furnace"),
        (("배기가스", "불투명도", "굴뚝"), "stack"), (("발전량", "출력값"), "generation"),
    ]
    for tokens, equipment in groups:
        if any(token in tag for token in tokens):
            explicit = any(token in tag for token in ("입구", "출구", "급탄기", "좌측", "우측", "전면", "굴뚝"))
            return equipment, "verified-by-tag" if explicit else "logical-group"
    return "unmapped", "unverified"


def make_registry(tags: list[str]):
    equipment_by_id = {item["id"]: item for item in EQUIPMENT}
    result = {}
    for tag in tags:
        definition = DEFINITIONS['sensors'].get(tag, {})
        equipment, confidence = classify(tag)
        item = equipment_by_id.get(equipment)
        position = None if item is None else [item["position"][0], item["size"][1] + .4, item["position"][2]]
        role = "target" if tag.startswith("목표") else "control" if any(word in tag for word in ("제어", "요구값", "밸브", "기울기")) else "measurement"
        section = "inlet" if "입구" in tag else "outlet" if "출구" in tag else equipment
        result[tag] = {"tag": tag, "label": tag.strip(), "equipment": equipment, "section": section,
                       "measurement_type": role,
                       "unit": definition.get('unit'), "unit_basis": f"{DEFINITIONS['source_file']} · 행 {definition['source_row']} · {definition['source_unit']}" if definition else '정의 없음',
                       "source_tag": definition.get('source_tag'), "description": definition.get('description'),
                       "mapping_confidence": confidence, "scene_position": position,
                       "mapping_basis": f"CSV column: {tag}" if confidence != "unverified" else "미확인",
                       "representative": tag in REPRESENTATIVE}
    for tag, sensor in result.items():
        sensor["related_tags"] = [other for other, metadata in result.items() if other != tag and metadata["equipment"] == sensor["equipment"] and sensor["equipment"] != "unmapped"]
    return result
