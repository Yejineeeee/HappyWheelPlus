import { icon } from "./icons";

/** 경로 표시 줄의 한 칸. 마지막 칸 뒤에도 "›"가 붙고 그 뒤에 제목이 온다. */
export interface Crumb {
  label: string;
  href: string;
}

/** 화면 배치: 기본(패널+지도), 넓은 패널(비교), 읽기(지도 숨김, 가운데 본문). */
export type Layout = "default" | "wide" | "reading";

export interface Shell {
  header: HTMLElement;
  panel: HTMLElement;
  /** 패널 맨 위 제목 영역. 시트가 손잡이와 본문 사이에 둔다. */
  pageHead: HTMLElement;
  mapContainer: HTMLElement;
  /**
   * 패널 맨 위 제목과 경로 표시 줄을 바꾼다. title이 null이면 홈(제목·경로 없음).
   * 뒤로 가기는 경로 표시 링크가 대신한다. docTitle을 주면 탭 제목은 그 값을 쓴다.
   */
  setTitle(title: string | null, crumbs?: Crumb[], docTitle?: string): void;
  setLayout(l: Layout): void;
  /** 테마 토글 후 호출. data-theme은 콜백 호출 전에 이미 바뀌어 있다. */
  onThemeChange(cb: (t: "light" | "dark") => void): void;
}

export const HOME_CRUMB: Crumb = { label: "홈", href: "#/" };

const THEME_KEY = "hw-theme";
const APP_NAME = "HappyWheel+";

function storedTheme(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

/** 저장된 선택이 없으면 항상 라이트로 시작한다(시스템 설정은 따르지 않는다). */
export function initialTheme(): "light" | "dark" {
  const saved = storedTheme();
  return saved === "dark" ? "dark" : "light";
}

function applyTheme(t: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", t);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", t === "dark" ? "#0e1013" : "#eef0f2");
}

const NAV_LINKS: { href: string; long: string; short: string }[] = [
  { href: "#/compare", long: "도시 비교", short: "비교" },
  { href: "#/about", long: "분석 방법", short: "방법" },
];

export function mountShell(root: HTMLElement): Shell {
  applyTheme(initialTheme());

  const links = NAV_LINKS.map(
    (l) =>
      `<a class="header-link" href="${l.href}"><span class="label-long">${l.long}</span><span class="label-short" aria-hidden="true">${l.short}</span></a>`,
  ).join("");
  root.innerHTML = `
    <header class="app-header">
      <a class="brand" href="#/">${APP_NAME}</a>
      <nav class="header-nav" aria-label="주 메뉴">${links}</nav>
      <button type="button" class="icon-btn theme-btn" data-role="theme" aria-label="테마 바꾸기"></button>
    </header>
    <div class="app-body" data-layout="default">
      <div class="map-container" data-role="map"></div>
      <section class="panel" data-role="panel"></section>
    </div>`;

  const q = <T extends HTMLElement>(role: string) => root.querySelector<T>(`[data-role="${role}"]`)!;
  const header = root.querySelector<HTMLElement>(".app-header")!;
  const body = root.querySelector<HTMLElement>(".app-body")!;
  const themeBtn = q<HTMLButtonElement>("theme");
  const navLinks = [...header.querySelectorAll<HTMLAnchorElement>(".header-link")];
  const themeListeners: ((t: "light" | "dark") => void)[] = [];

  const pageHead = document.createElement("div");
  pageHead.className = "page-head";

  const syncThemeIcon = () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    themeBtn.replaceChildren(icon(dark ? "sun" : "moon", 20));
  };
  syncThemeIcon();

  const syncNav = () => {
    const hash = location.hash || "#/";
    for (const a of navLinks) {
      if (a.getAttribute("href") === hash) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  };
  syncNav();
  window.addEventListener("hashchange", syncNav);

  themeBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    syncThemeIcon();
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* 저장할 수 없는 환경은 무시 */
    }
    for (const cb of themeListeners) cb(next);
  });

  return {
    header,
    panel: q("panel"),
    pageHead,
    mapContainer: q("map"),
    onThemeChange(cb) {
      themeListeners.push(cb);
    },
    setLayout(l) {
      body.dataset.layout = l;
    },
    setTitle(title, crumbs = [], docTitle) {
      syncNav();
      const t = docTitle ?? title;
      document.title = t === null ? APP_NAME : `${t} · ${APP_NAME}`;
      const h1 = document.createElement("h1");
      h1.className = "page-title";
      if (title === null) {
        // 홈은 소개 문장으로 시작하므로 제목은 화면 읽기 프로그램에만 준다.
        h1.classList.add("visually-hidden");
        h1.textContent = APP_NAME;
        pageHead.classList.add("is-home");
        pageHead.replaceChildren(h1);
        return;
      }
      pageHead.classList.remove("is-home");
      h1.textContent = title;
      const nodes: Node[] = [];
      if (crumbs.length > 0) {
        const nav = document.createElement("nav");
        nav.className = "crumbs";
        nav.setAttribute("aria-label", "현재 위치");
        const ol = document.createElement("ol");
        for (const c of crumbs) {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = c.href;
          a.textContent = c.label;
          const sep = document.createElement("span");
          sep.className = "crumb-sep";
          sep.setAttribute("aria-hidden", "true");
          sep.textContent = "›";
          li.append(a, sep);
          ol.append(li);
        }
        nav.append(ol);
        nodes.push(nav);
      }
      nodes.push(h1);
      pageHead.replaceChildren(...nodes);
    },
  };
}
