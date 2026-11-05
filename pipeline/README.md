# HappyWheel+ 데이터 파이프라인

OSM 보행 네트워크와 Copernicus 고도 자료로 도시별 접근성 점수를 계산하고, 웹이 읽는 JSON 파일(`web/public/data/<도시>/`)을 만든다.

## 설치

Python 3.11 이상.

```
cd pipeline
python -m venv .venv
.venv/Scripts/python.exe -m pip install -e ".[dev]"
```

## 명령

`pipeline/` 디렉터리에서 실행한다.

```
python -m happywheel run [--city ID ...] [--out PATH] [--cache PATH]
python -m happywheel check-size [--out PATH] [--limit-mb 2.0]
python -m happywheel thumbs [--city ID ...] [--out PATH]
```

- `run`: 도시를 하나씩 처리한다(네트워크 수집, 고도 보정, 편의시설 수집, 결과 파일 쓰기). `--city`를 생략하면 `config/cities.yaml`의 전체 도시를 돈다. 처리한 도시만 `cities.json` 항목을 갱신하고, 실행하지 않은 도시의 기존 항목은 그대로 둔다. 알 수 없는 도시 ID는 오류 메시지와 함께 종료 코드 2. 도시 하나가 실패하면 나머지를 계속 돌리고 종료 코드 1로 끝난다.
- `check-size`: 도시 폴더마다 파일을 gzip(레벨 9)으로 압축한 크기의 합을 출력한다. 하나라도 한도(기본 2.0 MB)를 넘으면 종료 코드 1.
- `thumbs`: 도시 폴더의 `segments.geojson`을 읽어 구간 점수 색(점수 색 5단, 통과 불가는 회색)으로 그린 480×320 WebP 미니 히트맵 `thumb.webp`를 쓴다(홈 화면 도시 카드용). 크기·dpi를 고정하고 메타데이터를 넣지 않아 같은 입력이면 같은 파일이 나온다. 도시당 60 KB 이하가 되도록 품질을 낮춰 가며 저장한다. `run` 다음에 따로 실행한다. `thumb.webp`는 `data_version` 계산 대상이 아니다. 필요한 패키지: matplotlib, Pillow(`.[dev]` 또는 `.[thumbs]`).
- 기본 출력은 `../web/public/data`, 기본 캐시는 `pipeline/.cache`(git에 넣지 않음).
- 테스트: `python -m pytest`.

## 설정(`config/cities.yaml`)

도시별 코스, 정류장, 현장 기록을 적는다. 분석 반경은 정류장 평균을 중심으로 `max(3000 m, 가장 먼 정류장 + 500 m)`로 자동 계산한다. 선택 키 `radius_m`을 적으면 자동 값 대신 그 값을 쓴다. 가장 먼 정류장 + 500 m보다 작게 적으면 도시 이름을 담은 ValueError로 설정 읽기가 실패한다.

캐시 파일 이름에 반경이 들어간다(`{id}_r{반경}_walk_raw.graphml`, `{id}_r{반경}_pois.json`). 반경을 바꾸면 그 도시만 새로 내려받는다. 네트워크 캐시는 단순화하지 않은 원본 그래프이고, 읽을 때마다 단순화(`kerb` 태그가 있는 노드는 보존)와 무방향 변환을 새로 한다. 내려받은 직후에도 저장한 파일을 다시 읽어 쓰므로 새로 받은 경우와 캐시를 읽은 경우의 간선 순서(구간 id)가 같다. 단순화 규칙을 바꿔도 다시 내려받을 필요가 없다.

## 데이터 출처와 라이선스

- 지도와 보행 네트워크, 편의시설: © OpenStreetMap contributors, Open Database License (ODbL) 1.0.
- 고도: Copernicus DEM GLO-30. © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

고도 타일(약 25~50 MB)은 처음 쓸 때 내려받아 `.cache/dem`에 저장한다. 중간에 끊겨도 이어받는다.

## 알려진 한계: 지형 보정

Copernicus GLO-30은 표면 모델(DSM)이라 건물과 수목 높이가 섞여 들어가 경사가 부풀려진다. 그래서 타일을 읽은 뒤 회색조 열림(opening, 5 px 창)으로 건물·수목 같은 돌출부를 깎고, 가우시안 평활(σ 1.5)을 거쳐 쌍선형 보간으로 표본을 뽑는다. 이는 근사일 뿐이다. 교량, 고가, 폭이 5 px(약 150 m)보다 넓은 큰 건물 단지는 완전히 제거되지 않거나 반대로 실제 언덕 끝이 깎일 수 있고, 수치는 전용 지형 모델(DTM)의 대체가 아니다. 경사 관련 점수는 이 한계를 감안해서 읽어야 한다.

## 출력 형식

도시마다 `web/public/data/<도시>/`에 네 파일이 생기고, `web/public/data/cities.json`이 도시 색인이다. 좌표는 모두 [경도, 위도], 소수 5자리. 값이 없으면 `null`.

- `segments.geojson`: 간선 하나가 Feature 하나다. Feature `id`가 구간 id(seg_id)이며 `properties`에는 `id`를 따로 넣지 않는다. `properties`: `len`(m), `p_slope`, `p_surface`, `p_kerb`, `p_unc`, `grade_max`(%), `surface_class`, `wc_yes`, `steps`, `blocked`, `span`(bool, 다리·터널 여부), `score`. **좌표는 `graph.json` 간선의 u→v 방향**(첫 좌표가 노드 u, 마지막 좌표가 노드 v)으로 정렬되어 있다.
- `graph.json`: `{"nodes": [[lon, lat], ...], "elev": [...], "edges": [...]}`.
  - `elev[i]`는 노드 i의 고도(m, 소수 1자리, 지형 보정한 DEM 값, 없으면 `null`).
  - 간선 행은 `[u, v, len, p_slope, p_surface, p_kerb, p_unc, flags]`이고 u, v는 `nodes`의 인덱스다. **seg_id는 행 번호**(0부터)이며 `segments.geojson`의 Feature `id`와 같다. `flags` 비트: 1 = blocked, 2 = steps, 4 = wheelchair=yes, 8 = span(다리 또는 터널: `bridge`/`tunnel` 태그가 있고 "no"가 아님).
  - 다리 중간 노드 고도: span이 아닌 간선이 하나도 닿지 않는 내부 노드는 DEM(강 수면·지면) 대신, span 간선만 따라 길이 기준 가장 가까운 두 바깥(비-내부) 노드의 고도를 길이 비례로 선형 보간한 값이다(`e = (e1·d2 + e2·d1)/(d1+d2)`; 단순 연쇄에서는 누적 길이 보간과 같고, 갈라지는 곳에서는 가장 가까운 두 끝을 섞는다). 바깥 노드 고도가 없으면 있는 쪽 값, 둘 다 없으면 `null`. `courses.json`의 `profile`도 이 보정된 노드 고도를 쓴다.
  - 웹에서 경로를 다시 계산해 고도 프로파일을 그릴 때, 다리·터널 간선은 DEM을 읽지 않고 두 끝 노드 `elev` 사이를 선형 보간한다(단순화 후 다리 끝 노드는 땅 위에 있다).
- `pois.geojson`: 편의시설 점(`kind`: toilet, elevator, bench, fountain).
- `courses.json`: 코스 배열. 경로(`routes.shortest`, `routes.accessible`)는 `coords`, `seg_ids`, `metrics`, `profile`을 가진다. **`profile` 행은 `[거리 m, 고도 m|null, 경사 %|null]`**이며 25 m 간격이다. 고도는 DEM 값이되 다리·터널 간선 위에서는 그 간선 두 끝 노드 고도 사이를 선형 보간한 값이고, 경사는 표본이 놓인 구간의 `grade_max`(없으면 `null`)다. 접근성 경로가 없으면(`reachable=false`) `routes.accessible`과 `comparison`이 `null`, `blocked_at`에 끊긴 정류장 좌표가 들어가며 `approximate`, `snap_max_m`은 그대로 있다. 이 모양은 `tests/data/courses_unreachable.json`에 고정해 두었다.
- `thumb.webp`(선택): `thumbs` 명령이 만드는 480×320 미니 히트맵. `data_version` 계산에는 넣지 않는다.
- `cities.json`: 도시 항목마다 `id`, `name_ko`, `country_ko`, `center`, `radius_m`, `data_version`, `metrics`, `course_count`. **`data_version`은 그 도시 네 파일(파일 이름순: courses.json, graph.json, pois.geojson, segments.geojson)의 바이트를 이어 붙인 sha256의 앞 12자리**라서 웹이 캐시 키로 쓸 수 있다.
- 분석 영역과 면적: `graph_from_point`와 `features_from_point`는 중심에서 `dist` 안의 정사각형(bbox)을 가져오므로 영역은 한 변 2r인 정사각형이다. `area_km2 = (2r)² / 1e6`이고 편의시설 밀도(`poi_per_km2`)도 이 면적으로 나눈다.

## 최근 실행 결과

9개 도시 전체 실행 후 `check-size` 통과(최대 gzip 1.72 MB, 런던). 정류장은 "계단 등으로 막힌 간선을 뺀 보행망의 가장 큰 연결 덩어리"에서 가장 가까운 노드로 붙인다(최단·접근성 경로가 같은 노드를 쓴다). 막힌 계단 하나에만 달린 노드나 지하 통로 같은 작은 섬에 정류장이 붙어 경로가 끊기는 일을 막기 위해서다. `courses.json`의 코스마다 `snap_max_m`(정류장에서 붙은 노드까지의 최대 거리, m)과 `approximate`(`snap_max_m` > 150 m)를 내보내므로 웹은 이 값으로 경고를 띄울 수 있다.

연석(`kerb`) 노드가 단순화 때 사라지던 문제를 고쳤다(이전: 루체른 35개, 인터라켄 0개 구간만 p_kerb > 0). `p_kerb > 0`은 `kerb=raised`(감점 60)가 있는 노드에 붙은 구간뿐이다. 인터라켄은 원본에 `lowered` 23, `flush` 11, `no` 3개만 있고 `raised`가 없어 0이 맞다.

### 도시별 네트워크

| 도시 | edges | p_kerb>0 구간 수 | mean_score | surface_coverage | slope_coverage | gzip MB | data_version |
|---|---|---|---|---|---|---|---|
| london | 52022 | 271 | 91.3 | 0.6928 | 0.9511 | 1.72 | 820a315bdfad |
| paris | 28159 | 227 | 87.2 | 0.8024 | 0.9558 | 0.88 | 8b60e4deb39e |
| lucerne | 28573 | 181 | 68.7 | 0.543 | 0.9878 | 1.07 | 50299549250c |
| bern | 32366 | 109 | 81.5 | 0.8054 | 0.9827 | 1.22 | ec84c9981e5c |
| interlaken | 6117 | 0 | 51.9 | 0.5305 | 0.9877 | 0.33 | 62d59d695305 |
| milan | 55460 | 2353 | 92.8 | 0.797 | 0.9766 | 1.70 | 08eaf7b73443 |
| venice | 10125 | 2 | 72.2 | 0.8122 | 0.9318 | 0.33 | 37e2fc247c43 |
| florence | 23870 | 87 | 81.7 | 0.7251 | 0.9874 | 0.85 | 9054ecf7d533 |
| rome | 45883 | 1520 | 82.3 | 0.6035 | 0.9847 | 1.62 | 791184d36a68 |

### 코스별 경로

| 도시 | 코스 | 최단 m | 접근성 m | steps_count 최단/접근 | extra_m | max_grade_pct 최단/접근 | cobble_m 최단/접근 | reachable | snap_max_m | approximate |
|---|---|---|---|---|---|---|---|---|---|---|
| london | 사우스뱅크 무계단 루프 | 3238.5 | 3481.0 | 10/0 | 242.5 | 7.5/7.2 | 8.5/91.2 | True | 118.4 | false |
| london | 웨스트민스터–세인트 제임스–트라팔가 | 1555.0 | 1579.1 | 1/0 | 24.1 | 7.3/6.1 | 0.0/6.9 | True | 97.7 | false |
| paris | 루브르–뛸르리–오랑주리 | 1400.0 | 1764.9 | 1/0 | 364.9 | 3.4/3.5 | 161.8/161.5 | True | 40.4 | false |
| paris | 노트르담–시테섬–퐁네프 | 1134.2 | 1517.2 | 5/0 | 383.0 | 5.1/5.1 | 474.4/134.2 | True | 50.8 | false |
| lucerne | 호반–카펠교–중앙역 | 948.6 | 1123.3 | 4/0 | 174.7 | 4.5/4.5 | 193.2/189.5 | True | 22.8 | false |
| bern | 아르강 전망–분수–연방의사당 | 722.6 | 745.6 | 0/0 | 23.0 | 3.9/3.9 | 191.7/33.6 | True | 25.3 | false |
| interlaken | 회퍼브루케–호헤마트 공원 | 745.1 | 805.1 | 0/0 | 60.0 | 2.6/2.6 | 0.0/12.9 | True | 51.6 | false |
| milan | 두오모–갤러리아 | 489.5 | 516.9 | 0/0 | 27.4 | 4.9/4.5 | 0.0/0.0 | True | 50.7 | false |
| milan | 스포르체스코 성–브레라 | 823.0 | 874.8 | 0/0 | 51.8 | 4.8/2.2 | 164.7/0.0 | True | 53.6 | false |
| venice | 두칼레–산 마르코 | 176.5 | 232.5 | 0/0 | 56.0 | 7.5/4.9 | 155.0/65.6 | True | 24.4 | false |
| venice | 리알토–산 폴로 | 355.2 | 624.6 | 5/0 | 269.4 | 1.9/4.0 | 127.5/72.5 | True | 325.2 | true |
| florence | 두오모–시뇨리아 | 711.5 | 712.9 | 0/0 | 1.4 | 5.8/5.8 | 247.1/148.1 | True | 35.9 | false |
| florence | 우피치–베키오 다리–피티궁 | 809.2 | 839.5 | 0/0 | 30.3 | 7.9/6.3 | 426.6/138.3 | True | 22.7 | false |
| rome | 나보나–판테온 | 372.6 | 465.0 | 0/0 | 92.4 | 7.7/5.2 | 236.9/57.4 | True | 9.9 | false |
| rome | 포로 로마노 주변 산책 | 874.0 | 1039.4 | 1/0 | 165.4 | 12.0/12.0 | 784.6/401.9 | True | 16.7 | false |

extra_m는 접근성 경로가 최단 경로보다 더 긴 거리, steps_count는 경로가 지나는 막힌(통과 불가) 계단 수.

### 한도 조정

런던(2.18 MB), 파리(2.24 MB), 밀라노(2.02 MB)가 기본 반경 3000 m에서 gzip 한도 2.0 MB를 넘어 `radius_m`을 설정했다(밀라노는 연석 노드를 보존하면서 간선이 늘어 넘었다).

| 도시 | 반경 | gzip | 간선 |
|---|---|---|---|
| 런던 | 3000 m -> 2700 m (가장 먼 정류장 2173 m + 500 m = 2673 m) | 2.18 -> 1.72 MB | 58600 -> 52022 |
| 파리 | 3000 m -> 1800 m (가장 먼 정류장 1258 m + 500 m = 1758 m) | 2.24 -> 0.88 MB | 60638 -> 28159 |
| 밀라노 | 3000 m -> 2700 m (가장 먼 정류장 627 m + 500 m = 1127 m) | 2.02 -> 1.70 MB | 66216 -> 55460 |

### 상식 점검

- 런던: 정류장을 가장 큰 연결 덩어리에 붙이자 두 코스 모두 reachable=true. 사우스뱅크 코스는 최단 경로가 막힌 계단 10곳을 지나고 접근성 경로는 0곳, 우회는 242.5 m. 이전 실행의 reachable=false는 정류장이 계단 하나로만 이어진 노드와 지하 통로 섬에 붙었기 때문이었다.
- 베네치아: 두칼레–산 마르코 코스의 최단 경로는 계단 간선을 하나도 지나지 않아 두 경로가 거의 같고(extra 56 m, 이는 경사·노면 때문), 리알토–산 폴로 코스는 최단 경로가 막힌 계단 5곳을 지나고 접근성 경로는 0곳으로 624.6 m를 돌아간다(steps_avoided=5). 다만 리알토–산 폴로 코스는 정류장이 접근 가능한 보행망에서 최대 325.2 m 떨어진 곳에 붙으므로 `approximate=true`이고 결과는 참고용이다. 현재 approximate 코스는 이 하나뿐이다.
- 로마 포로 로마노 코스: 자갈길 cobble_m 784.6 m(최단) / 401.9 m(접근성)로 런던 코스(8.5 m / 91.2 m)보다 크다. 기대와 일치.
