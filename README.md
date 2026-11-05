<div align="center">

# HappyWheel+

**휠체어 여행자를 위해 유럽 9개 도시의 길을 점수로 보여 주고, 계단 없는 경로를 안내하는 서비스**

2025 동계 해외문화탐방 8조 프로젝트를 데이터 분석 중심으로 리디자인한 프로젝트

[🔗 데모 바로가기](https://yejineeeee.github.io/HappyWheelPlus/) | [📄 탐방 발표자료 (PDF)](docs/field-trip-2026-01-27.pdf) | [📓 분석 노트북](pipeline/notebooks/methodology.ipynb)

<img src="docs/assets/demo.gif" width="800" alt="런던 사우스뱅크 코스에서 최단 경로, 휠체어 경로, 내 조건 경로를 차례로 바꿔 보는 화면">

![Python](https://img.shields.io/badge/Python-3670A0?style=for-the-badge&logo=python&logoColor=ffdd54)&nbsp;![GeoPandas](https://img.shields.io/badge/GeoPandas-139C5A?style=for-the-badge&logo=pandas&logoColor=white)&nbsp;![OSMnx](https://img.shields.io/badge/OSMnx-7EBC6F?style=for-the-badge&logo=openstreetmap&logoColor=white)&nbsp;![NetworkX](https://img.shields.io/badge/NetworkX-2C5BB4?style=for-the-badge&logoColor=white)&nbsp;![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)&nbsp;![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)&nbsp;![MapLibre](https://img.shields.io/badge/MapLibre-396CB2?style=for-the-badge&logo=maplibre&logoColor=white)&nbsp;![Observable Plot](https://img.shields.io/badge/Observable%20Plot-353E58?style=for-the-badge&logo=observable&logoColor=white)&nbsp;![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflareworkers&logoColor=white)&nbsp;![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)&nbsp;![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?style=for-the-badge&logo=githubpages&logoColor=white)

</div>

<br>

## 📌 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 기간 | 원 프로젝트 2025.12.26 \~ 2026.01.06 (동계 해외문화탐방) / 리디자인 2026.11 |
| 인원 | 원 프로젝트 2인 팀 / 리디자인 개인 |
| 범위 | 4개국 9개 도시 (런던, 파리, 루체른, 베른, 인터라켄, 밀라노, 베네치아, 피렌체, 로마), 탐방 코스 15개 |
| 배포 | GitHub Pages (웹앱) + Cloudflare Workers (AI 조건 해석 서버) |

동계 해외문화탐방에서 '휠체어 이용자의 유럽 여행'을 주제로 4개국 9개 도시를 다녔다.    
직접 다녀 보니 관광지 자체보다 관광지 사이를 오가는 길이 더 문제였다.     
계단으로만 건널 수 있는 다리도 있었고, 돌길 광장이나 짧은데 경사가 심한 언덕도 자주 나왔다. 그런데 일반 지도 앱에서는 이런 길이 다른 길과 똑같이 표시된다.    

탐방 때도 코스마다 난이도와 메모를 남겼지만, 처음 만든 앱에서는 그 난이도를 우리가 느낀 대로 직접 적어 넣었다.  
그러나 리디자인을 하면서, 같은 판단을 데이터를 통해 해 보고 싶었다.   

OpenStreetMap 보행망 약 28만 구간(약 7,853km)을 경사, 노면, 연석, 정보 부족 기준으로 채점했고, 코스마다 최단 경로와 휠체어 경로를 같이 계산했다.    
휠체어 경로가 무엇을 피하느라 얼마나 더 돌아가는지 한눈에 비교할 수 있게 하는 게 목표였고,    
조건 가중치를 바꾸면 브라우저에서 바로 경로를 다시 찾고, 따로 설정하지 않아도 링크만 열면 주요 기능을 다 쓸 수 있다.    


<br>

## ✨ 주요 기능

| 기능 | 하는 일 |
|---|---|
| 구간 채점 | OSM 태그와 고도로 길마다 0\~100점을 매기고, 도시별 히트맵으로 보여 준다 |
| 경로 비교 | 같은 정류장 사이의 최단 경로와 휠체어 경로를 거리, 계단, 경사, 돌길로 비교한다 |
| 내 조건 | 슬라이더로 가중치를 바꾸면 브라우저에서 경로를 바로 다시 찾는다 |
| 길안내 | 내 위치를 따라가며 "200m 앞 오른쪽, 다리 구간" 같은 안내를 띄운다 (가상 위치 시연 가능) |
| 도시 비교 | 9개 도시의 점수, 노면, 편의시설, 데이터 신뢰도를 그래프로 비교한다 |

### 화면 구성

| 홈 | 도시 점수 히트맵 |
|:---:|:---:|
| <img src="docs/assets/screen-home.png" width="420" alt="홈 화면"> | <img src="docs/assets/screen-city.png" width="420" alt="파리 점수 히트맵"> |
| 나라별 도시 목록과 평균 점수 | 길마다 점수 색, 못 지나가는 길은 빨간 점선 |
| **코스 비교** | **도시 비교** |
| <img src="docs/assets/screen-course.png" width="420" alt="런던 사우스뱅크 코스 비교"> | <img src="docs/assets/screen-compare.png" width="420" alt="도시 비교 그래프"> |
| 계단 10개를 피하는 대신 243m 더 돌아간다 | 9개 도시를 같은 기준으로 비교 |

<details>
<summary><b>내 조건 재계산과 모바일 길안내 보기</b></summary>

<br>

| 내 조건 | 모바일 길안내 |
|:---:|:---:|
| <img src="docs/assets/screen-conditions.png" width="560" alt="경사 피하기를 최대로 올린 내 조건 화면"> | <img src="docs/assets/screen-nav.png" width="240" alt="루체른 코스 모바일 길안내"> |
| 경사 피하기를 최대로 올리면 최대 경사 7.2% → 6.9% | 가상 위치로 따라가며 다음 안내와 남은 거리 표시 |

문장으로 조건을 적으면(예: "경사가 힘들어요") AI 서버가 가중치로 바꿔 주는 입력창도 있다.

</details>

<br>

## 🏗 시스템 구조

<p align="center"><img src="docs/assets/architecture.png" width="900" alt="데이터, 분석 파이프라인, 정적 데이터, 웹앱으로 이어지는 시스템 구조"></p>

파이프라인이 도시마다 정적 파일을 만들고, 웹앱은 서버 없이 이 파일만 읽는다.  
그래프도 브라우저에 있어서 가중치를 바꾸면 바로 경로를 다시 찾는다.

| 파일 (`web/public/data/<도시>/`) | 내용 |
|---|---|
| `segments.geojson` | 구간 선, 항목별 감점, 점수 |
| `graph.json` | 브라우저 경로 계산용 그래프 |
| `courses.json` | 코스별 두 경로, 비교 지표, 경사 단면, 현장 기록 |
| `pois.geojson` | 화장실, 엘리베이터, 벤치, 음수대 |
| `cities.json` (상위) | 도시 목록, 요약 지표, 데이터 버전 |

### 기술 스택

| 구분 | 사용 기술 |
|---|---|
| 데이터 수집 | OSMnx, rasterio |
| 공간 분석 | GeoPandas, Shapely, pyproj, SciPy, NetworkX |
| 분석 문서 | Jupyter, matplotlib |
| 웹앱 | TypeScript, Vite, MapLibre GL JS, OpenFreeMap, Observable Plot, vite-plugin-pwa |
| AI 조건 해석 | Cloudflare Workers, Workers KV, OpenAI API (gpt-4o-mini) |
| 테스트 | pytest, Vitest, Playwright |
| 배포 | GitHub Actions → GitHub Pages |

<br>

## 📊 분석 결과

### 구간 점수 모델

```
구간 점수 = 100 − Σ (가중치 × 감점)        감점: 경사, 노면, 연석, 불확실성 (각 0~100)
경로 비용 = 길이 × (1 + 3 × (100 − 점수) / 100)
```

| 항목 | 감점 규칙 | 가중치 |
|---|---|---|
| 경사 | 5% 미만 0, 8.33%에서 50, 12% 이상 100 (8.33%는 ADA 경사로 기준 1:12) | 1.0 |
| 노면 | 매끈함 0, 포장블록 20, 잔자갈 40, 돌길 70, 비포장 90 | 0.8 |
| 연석 | 높은 연석(`kerb=raised`) 60 | 0.6 |
| 불확실성 | 노면 정보 없음 +15, 경사 정보 없음 +15 | 0.3 |
| 통과 불가 | 계단, `wheelchair=no` (경사로가 있으면 통과 가능) | – |

정보가 없는 길이 좋은 길로 계산되지 않도록 불확실성 감점을 넣었다.

### 도시별 결과

<p align="center"><img src="docs/assets/city-scores.png" width="800" alt="도시별 평균 점수와 데이터 신뢰도"></p>

| 도시 | 평균 점수 | 분석한 길 | 노면 기록 비율 | 경사 측정 비율 | 1㎢당 화장실 |
|---|---:|---:|---:|---:|---:|
| 밀라노 | 92.8 | 1,334km | 79.7% | 97.7% | 2.5 |
| 런던 | 91.3 | 1,120km | 69.3% | 95.1% | 4.8 |
| 파리 | 87.2 | 558km | 80.2% | 95.6% | 15.6 |
| 로마 | 82.3 | 1,357km | 60.4% | 98.5% | 3.9 |
| 피렌체 | 81.7 | 955km | 72.5% | 98.7% | 1.3 |
| 베른 | 81.5 | 1,054km | 80.5% | 98.3% | 3.4 |
| 베네치아 | 72.2 | 201km | 81.2% | 93.2% | 1.7 |
| 루체른 | 68.7 | 827km | 54.3% | 98.8% | 1.9 |
| 인터라켄 | 51.9 | 448km | 53.1% | 98.8% | 0.9 |

인터라켄과 루체른은 산비탈 길도 많지만, 노면을 모르는 길도 절반 가까이 된다.  
그래서 점수가 낮은 이유가 지형인지 데이터 부족인지는 구분하기 어렵다.

### 사례: 최단 경로 vs 휠체어 경로

| 코스 | 최단 경로 | 휠체어 경로 | 해석 |
|---|---|---|---|
| 런던 사우스뱅크 | 3,238m, 계단 10곳 | 3,481m, 계단 0곳 | 243m 더 돌아 계단을 모두 피하지만, 돌길은 늘어난다 |
| 베네치아 리알토–산 폴로 | 355m, 계단 5곳 | 625m, 계단 0곳 | 다리 대부분이 계단이라 갈 수 있는 길이 끊겨 있다 (근사 결과) |
| 로마 포로 로마노 | 874m, 돌길 785m | 1,039m, 돌길 402m | 돌길이 절반으로 줄지만, 다른 길이 없어 완전히 피하진 못한다 |
| 루체른 카펠교 | 949m, 계단 4곳 | 1,123m, 계단 0곳 | 경사로나 리프트가 있는 계단은 지나갈 수 있는 길로 봤다 |

<details>
<summary><b>15개 코스 전체 비교</b></summary>

<br>

| 도시 | 코스 | 최단 (m) | 휠체어 (m) | 추가 (m) | 피한 계단 | 돌길 최단/휠체어 (m) | 경로 점수 최단/휠체어 |
|---|---|---:|---:|---:|---:|---:|---:|
| 런던 | 사우스뱅크 무계단 루프 | 3,238.5 | 3,481.0 | 242.5 | 10 | 8.5 / 91.2 | 90.1 / 90.0 |
| 런던 | 웨스트민스터–세인트 제임스–트라팔가 | 1,555.0 | 1,579.1 | 24.1 | 1 | 0.0 / 6.9 | 92.7 / 94.0 |
| 파리 | 루브르–뛸르리–오랑주리 | 1,400.0 | 1,764.9 | 364.9 | 1 | 161.8 / 161.5 | 56.8 / 85.8 |
| 파리 | 노트르담–시테섬–퐁네프 | 1,134.2 | 1,517.2 | 383.0 | 5 | 474.4 / 134.2 | 68.8 / 89.3 |
| 루체른 | 호반–카펠교–중앙역 | 948.6 | 1,123.3 | 174.7 | 4 | 193.2 / 189.5 | 86.1 / 88.9 |
| 베른 | 아르강 전망–분수–연방의사당 | 722.6 | 745.6 | 23.0 | 0 | 191.7 / 33.6 | 83.0 / 96.0 |
| 인터라켄 | 회퍼브루케–호헤마트 공원 | 745.1 | 805.1 | 60.0 | 0 | 0.0 / 12.9 | 87.3 / 98.8 |
| 밀라노 | 두오모–갤러리아 | 489.5 | 516.9 | 27.4 | 0 | 0.0 / 0.0 | 87.3 / 91.4 |
| 밀라노 | 스포르체스코 성–브레라 | 823.0 | 874.8 | 51.8 | 0 | 164.7 / 0.0 | 77.2 / 90.8 |
| 베네치아 | 두칼레–산 마르코 | 176.5 | 232.5 | 56.0 | 0 | 155.0 / 65.6 | 36.3 / 72.7 |
| 베네치아 | 리알토–산 폴로 (근사) | 355.2 | 624.6 | 269.4 | 5 | 127.5 / 72.5 | 73.4 / 78.9 |
| 피렌체 | 두오모–시뇨리아 | 711.5 | 712.9 | 1.4 | 0 | 247.1 / 148.1 | 70.8 / 76.2 |
| 피렌체 | 우피치–베키오 다리–피티궁 | 809.2 | 839.5 | 30.3 | 0 | 426.6 / 138.3 | 56.0 / 75.3 |
| 로마 | 나보나–판테온 | 372.6 | 465.0 | 92.4 | 0 | 236.9 / 57.4 | 52.8 / 86.9 |
| 로마 | 포로 로마노 주변 산책 | 874.0 | 1,039.4 | 165.4 | 1 | 784.6 / 401.9 | 30.5 / 71.4 |

</details>

<details>
<summary><b>탐방 현장 기록과 계산 점수 비교 (10개 코스)</b></summary>

<br>

| 코스 | 탐방팀 난이도 (1 쉬움, 5 어려움) | 휠체어 경로 점수 |
|---|:---:|---:|
| 베른 아르강 전망–분수–연방의사당 | 1 | 96.0 |
| 루체른 호반–카펠교–중앙역 | 1 | 88.9 |
| 런던 웨스트민스터–세인트 제임스–트라팔가 | 2 | 94.0 |
| 파리 노트르담–시테섬–퐁네프 | 2 | 89.3 |
| 피렌체 우피치–베키오 다리–피티궁 | 2 | 75.3 |
| 런던 사우스뱅크 무계단 루프 | 3 | 90.0 |
| 밀라노 두오모–갤러리아 | 3 | 91.4 |
| 베네치아 두칼레–산 마르코 | 3 | 72.7 |
| 파리 루브르–뛸르리–오랑주리 | 4 | 85.8 |
| 로마 포로 로마노 주변 산책 | 5 | 71.4 |

현장 난이도에는 혼잡이나 건물 내부처럼 점수에 없는 요소도 들어 있다.  
루브르는 길보다 박물관 안 인파가 더 힘들었다.  
코스가 10개뿐이라 통계적인 결론은 내리지 않았다.

</details>

<br>

## ✅ 검증

| 항목 | 결과 |
|---|---|
| 브라우저 계산 | 파이프라인과 같은 결과 (루체른 경로 길이 차이 0.1m) |
| 지형 보정 | 루체른 12% 넘는 급경사 구간 22% → 5.2% |
| 길안내 | ±15m GPS 오차를 넣은 시뮬레이션에서 위치 오차 55m 미만 |
| 자동 테스트 | pytest 126개, Vitest 258개, Playwright 1개 통과 |
| 데이터 크기 | 도시마다 압축 2MB 이하 (최대 1.72MB) |

<br>

## 🔥 트러블슈팅

<details>
<summary><b>1. 고도 데이터 때문에 경사가 부풀려진 문제</b></summary>

- **문제**: 루체른 경로에 41% 경사가 나왔다. 고도 데이터(DSM)에 건물과 나무 높이까지 들어 있었다.
- **해결**: 좁게 솟은 부분을 깎고(grey opening), 부드럽게 다듬고(가우시안), 쌍선형 보간으로 값을 뽑았다.
- **결과**: 12% 넘는 급경사 구간이 22%에서 5.2%로 줄었다.

</details>

<details>
<summary><b>2. 런던에서 휠체어 경로가 나오지 않은 문제</b></summary>

- **문제**: 정류장이 계단으로만 이어진 지점이나 지하 통로에 붙어 경로가 끊겼다.
- **해결**: 계단을 뺀 보행망에서 가장 크게 이어진 부분에만 정류장을 붙였다.
- **결과**: 런던 두 코스 모두 경로가 이어졌고, 사우스뱅크는 계단 10곳을 모두 피했다.

</details>

<details>
<summary><b>3. 연석 정보가 사라진 문제</b></summary>

- **문제**: 도로망을 단순화하면서 중간 지점에 있던 연석 정보가 같이 사라졌다.
- **해결**: 연석 정보가 있는 지점은 남기고 단순화하도록 바꿨다.
- **결과**: 루체른에서 높은 연석이 잡힌 구간이 35개에서 181개로 늘었다.

</details>

<details>
<summary><b>4. 다리 위 경사가 강바닥으로 꺼진 문제</b></summary>

- **문제**: 다리 위 고도가 강물 높이로 읽혀 단면 그래프가 아래로 꺼졌다.
- **해결**: 다리와 터널은 양 끝 높이를 이어서 채웠다.
- **결과**: 다리 위 단면이 자연스럽게 이어졌다.

</details>

<details>
<summary><b>5. 왕복 코스에서 길안내가 뒤로 간 문제</b></summary>

- **문제**: 갔던 길을 되돌아올 때 위치가 가는 길 쪽에 잡혀 진행 거리가 줄어들었다.
- **해결**: 실제로 움직인 거리와 경로 위 진행 거리를 함께 비교해 위치를 정했다.
- **결과**: 최대 오차가 927m에서 0.37m로 줄었다.

</details>

<details>
<summary><b>6. 데이터 파일이 너무 큰 문제</b></summary>

- **문제**: 일부 도시 파일이 압축해도 2MB를 넘었다.
- **해결**: 분석 반경을 코스에 맞게 줄이고, 도시 데이터는 볼 때만 불러오게 했다.
- **결과**: 모든 도시가 2MB 이하가 됐다.

</details>

<br>

## 🗂 데이터

| 데이터 | 용도 | 출처·라이선스 |
|---|---|---|
| 보행망, 편의시설 | 길 태그, 화장실·엘리베이터·벤치·음수대 | © OpenStreetMap contributors, ODbL 1.0 |
| 고도 (GLO-30, 30m) | 경사 | Copernicus DEM GLO-30. © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. |
| 배경 지도 | 지도 타일 | OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors |
| 탐방 현장 기록 | 코스 15개, 난이도와 메모 10개 | 2025 동계 해외문화탐방 8조 (`pipeline/config/cities.yaml`) |

<br>

## 📂 폴더 구조

```
HappyWheelPlus
├── pipeline/     # 데이터 분석 (Python)
├── web/          # 웹앱 (TypeScript + Vite)
├── worker/       # AI 조건 해석 서버 (Cloudflare Workers)
├── docs/         # 탐방 발표자료, README 이미지
└── .github/      # 테스트 후 GitHub Pages 배포
```

<br>

## 🚀 실행 방법

```bash
# 파이프라인 (Python 3.11+)
cd pipeline
python -m venv .venv
.venv/Scripts/python.exe -m pip install -e ".[dev]"
python -m happywheel run

# 웹앱 (Node.js 22)
cd web
npm ci
npm run dev
```

자세한 내용은 [pipeline/README.md](pipeline/README.md)와 [worker/README.md](worker/README.md)에 있다.

<br>

## ⚠️ 한계

- 경사는 30m 격자 데이터를 보정한 근사값이라 짧은 급경사나 연석 턱은 잘 안 잡힌다.
- 노면 정보가 없는 길이 도시에 따라 19\~47%라, 실제로는 더 험할 수 있다.
- 보도 폭, 신호, 혼잡, 공사는 반영하지 못했다.
- 건물 안이나 대중교통 이동은 다루지 않는다.
- 감점 값은 ADA 경사 기준 외에는 경험적으로 정했다.

<br>

## 📚 참고

- U.S. Department of Justice (2010). ADA Standards for Accessible Design, 405.2 Ramp Slope (1:12).
- Boeing, G. (2017). OSMnx: New Methods for Acquiring, Constructing, Analyzing, and Visualizing Complex Street Networks. Computers, Environment and Urban Systems, 65, 126–139.
- European Space Agency, Copernicus DEM — Global and European Digital Elevation Model (GLO-30).
- OpenMapTiles Vector Tile Schema, OpenFreeMap.
- MapLibre GL JS 문서.
- 2025 동계 해외문화탐방 8조 발표자료 ([PDF](docs/field-trip-2026-01-27.pdf)).
