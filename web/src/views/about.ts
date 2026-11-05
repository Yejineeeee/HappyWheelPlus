import { HOME_CRUMB } from "../ui/shell";
import type { CityIndex } from "../data/types";
import { el } from "../ui/components";
import type { AppContext, View } from "./types";

const REPO = "https://github.com/Yejineeeee/HappyWheelPlus";
const NOTEBOOK = `${REPO}/blob/main/pipeline/notebooks/methodology.ipynb`;

function link(href: string, text: string): HTMLElement {
  return el("a", { href, target: "_blank", rel: "noopener noreferrer" }, text);
}

function p(...children: (Node | string)[]): HTMLElement {
  return el("p", {}, ...children);
}

function ul(items: (Node | string)[][]): HTMLElement {
  const list = el("ul", { class: "about-list" });
  for (const it of items) list.append(el("li", {}, ...it));
  return list;
}

function table(caption: string, head: string[], rows: string[][]): HTMLElement {
  const wrap = el("div", { class: "about-table-wrap" });
  const t = el("table", { class: "metric-table about-table" }, el("caption", {}, caption));
  const tr = el("tr", {});
  for (const h of head) tr.append(el("th", { scope: "col" }, h));
  t.append(el("thead", {}, tr));
  const body = el("tbody");
  for (const r of rows) {
    const row = el("tr", {}, el("th", { scope: "row" }, r[0]));
    r.slice(1).forEach((v) => row.append(el("td", {}, v)));
    body.append(row);
  }
  t.append(body);
  wrap.append(t);
  return wrap;
}

function section(title: string, ...children: (Node | string)[]): HTMLElement {
  return el("section", { class: "about-section" }, el("h2", {}, title), ...children);
}

/** 한계 절에 넣는 도시별 수치. cities.json 값에서 바로 계산한다. */
export function limitFacts(index: CityIndex): { unknownMin: number; unknownMax: number; slopeMin: number } | null {
  if (index.cities.length === 0) return null;
  const unknown = index.cities.map((c) => c.metrics.surface_mix.unknown * 100);
  const slope = index.cities.map((c) => c.metrics.slope_coverage * 100);
  return {
    unknownMin: Math.round(Math.min(...unknown)),
    unknownMax: Math.round(Math.max(...unknown)),
    slopeMin: Math.floor(Math.min(...slope)),
  };
}

export function buildAbout(index: CityIndex): HTMLElement {
  const root = el("article", { class: "about" });
  const w = index.weights_default;
  const facts = limitFacts(index);

  root.append(
    section(
      "프로젝트 배경",
      p(
        "HappyWheel+는 2025–26 동계 해외문화탐방 8조가 휠체어 이용자를 위한 유럽 여행 코스를 직접 다녀오며 시작한 프로젝트예요. 4개국 9개 도시를 걸으며 탐방팀 체감과 메모를 현장 기록으로 남겼어요.",
      ),
      p(
        "이 사이트는 그 코스를 지도 데이터로 다시 분석한 결과예요. 길 하나하나에 접근성 점수를 매기고, 코스마다 최단 경로와 휠체어 경로를 나란히 보여 줘요.",
      ),
    ),

    section(
      "데이터",
      ul([
        [
          "보행 네트워크와 편의시설: © OpenStreetMap contributors, Open Database License (ODbL) 1.0.",
        ],
        [
          "고도: Copernicus DEM GLO-30. © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.",
        ],
        ["배경 지도: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors."],
        ["현장 기록: 탐방 때 직접 적은 탐방팀 체감(1~5)와 메모."],
      ]),
      p("분석 반경은 코스 정류장 평균 위치에서 가장 먼 정류장보다 500m 더 먼 곳까지(최소 3km)이고, 영역은 정사각형이에요."),
    ),

    section(
      "점수 모델",
      p("길(구간) 하나의 점수는 감점 네 가지를 가중해서 100에서 빼요. 0보다 작아지면 0, 100을 넘으면 100으로 잘라요."),
      el("p", { class: "about-formula" }, "점수 = 100 − (경사 × 가중치 + 노면 × 가중치 + 연석 × 가중치 + 불확실성 × 가중치)"),
      table(
        "항목별 감점 규칙(각 0~100)",
        ["항목", "감점 규칙"],
        [
          ["경사", "구간의 최대 경사 기준. 5% 미만 0, 5~8.33%에서 0→50, 8.33~12%에서 50→100(선형), 12% 이상 100. 8.33%는 미국 장애인법(ADA) 경사로 기준 1:12예요."],
          ["노면", "매끈함(아스팔트·콘크리트 등) 0, 포장블록 20, 다짐 40, 돌길 70, 비포장 90. 노면 상태가 나쁨 이하로 적혀 있으면 +20(최대 100)."],
          ["연석", "횡단 지점에 높은 연석이 있으면 60, 낮춘 연석이나 정보 없음은 0."],
          ["불확실성", "노면 정보가 없으면 +15, 경사를 구할 수 없으면 +15."],
          ["통과 불가", "계단(경사로나 휠체어 가능 표기가 있으면 제외), 휠체어 불가로 표기된 길. 점수 대신 통과 불가로 표시하고 휠체어 경로에서 빼요."],
          ["보너스", "휠체어 가능으로 표기된 길은 최종 점수 +10(최대 100)."],
        ],
      ),
      p(
        `기본 가중치는 경사 ${w.slope}, 노면 ${w.surface}, 연석 ${w.kerb}, 불확실성 ${w.uncertainty}예요. 코스 화면의 "내 조건"에서 바꿔 볼 수 있어요. 화면에서는 불확실성을 "정보가 없는 길 피하기"로 보여 줘요.`,
      ),
      p(
        `휠체어 경로는 구간 비용 = 길이 × (1 + ${index.alpha} × (100 − 점수) / 100)가 가장 작은 길이에요. 점수가 낮은 구간일수록 최대 ${1 + index.alpha}배까지 비싸게 쳐서 돌아가게 만들어요. 최단 경로는 길이만 봐요.`,
      ),
    ),

    section(
      "지형 보정",
      p(
        "고도 자료(Copernicus GLO-30)는 땅 높이가 아니라 건물과 나무 꼭대기까지 포함한 표면 높이예요. 그대로 쓰면 건물 옆을 지나는 평지도 가파르게 계산돼요.",
      ),
      p(
        "그래서 고도 격자를 읽은 뒤 회색조 열림(5픽셀 창)으로 창보다 좁은 돌출부를 깎고, 가우시안 평활(σ 1.5)로 다듬은 다음, 쌍선형 보간으로 표본을 뽑아요. 다리와 터널은 지면 고도를 쓰지 않고 양 끝 고도를 이어서 계산해요.",
      ),
      p("근사 방법이라서 폭이 약 150m보다 넓은 건물 단지나 교량 주변은 틀릴 수 있어요. 경사 점수는 이 점을 감안해서 읽어 주세요."),
    ),

    section(
      "정류장 연결 규칙",
      p(
        "코스 정류장은 계단 같은 통과 불가 구간을 뺀 보행망에서 가장 큰 연결 덩어리의 가장 가까운 지점에 붙여요. 정류장이 막힌 계단 하나에만 이어진 지점에 붙어 경로가 끊기는 일을 막기 위해서예요.",
      ),
      p("정류장에서 붙은 지점까지 150m가 넘으면 그 코스에 “위치 오차 있음”을 표시하고, 코스 화면에 안내를 띄워요."),
    ),

    section(
      "한계",
      ul([
        [
          facts
            ? `지도에 적힌 만큼만 알 수 있어요. 노면 정보가 없는 길이 도시에 따라 ${facts.unknownMin}~${facts.unknownMax}%이고, 이런 길은 감점 0에 불확실성 +15만 붙어서 실제로는 거칠 수 있어요. 경사 정보는 모든 도시에서 ${facts.slopeMin}% 이상 구했어요.`
            : "지도에 적힌 만큼만 알 수 있어요. 노면 정보가 없는 길은 실제로는 거칠 수 있어요.",
        ],
        ["고도 격자가 30m 간격이라 짧은 급경사나 연석 단차는 평균에 묻혀요."],
        ["건물 안 이동, 지하철·버스·트램의 휠체어 접근성은 다루지 않아요. 엘리베이터와 화장실은 위치만 표시해요."],
        ["보도 폭, 횡단보도 신호, 혼잡, 공사는 모델에 없어요."],
        ["감점 값과 가중치는 경사 기준(ADA)을 빼면 경험적으로 정한 값이고, 현장 데이터로 보정하지 않았어요."],
        ["탐방팀 체감 난이도는 탐방 때 팀이 직접 평가한 10개 코스(n=10)뿐이라 계산 점수와의 통계적 결론은 내리지 않았어요."],
      ]),
    ),

    section(
      "링크",
      ul([
        [link(REPO, "GitHub 저장소")],
        [link(NOTEBOOK, "분석 노트북 (pipeline/notebooks/methodology.ipynb)")],
      ]),
    ),
  );
  return root;
}

/** 좁은 화면에서는 시트를 가득 펼쳐 글이 지도를 덮는다. 떠날 때 원래 높이로 돌린다. */
export function aboutView(): View {
  let restore: (() => void) | null = null;
  return {
    mount(ctx: AppContext) {
      ctx.shell.setTitle("분석 방법", [HOME_CRUMB]);
      const prev = ctx.sheet.snap();
      restore = () => ctx.sheet.setSnap(prev);
      ctx.sheet.setContent(buildAbout(ctx.index));
      ctx.sheet.setSnap("full");
    },
    unmount() {
      restore?.();
      restore = null;
    },
  };
}
