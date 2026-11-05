export interface Shell {
  header: HTMLElement;
  panel: HTMLElement;
  mapContainer: HTMLElement;
  setTitle(t: string, back?: string): void;
}

const THEME_KEY = "hw-theme";

function storedTheme(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function currentTheme(): "light" | "dark" {
  const saved = storedTheme();
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(t: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", t);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", t === "dark" ? "#111418" : "#f6f6f3");
}

export function mountShell(root: HTMLElement): Shell {
  applyTheme(currentTheme());

  root.innerHTML = `
    <header class="app-header">
      <button type="button" class="icon-btn" data-role="back" aria-label="뒤로" hidden>&#8592;</button>
      <h1 data-role="title">HappyWheel+</h1>
      <button type="button" class="icon-btn" data-role="theme" aria-label="테마 바꾸기">&#9680;</button>
    </header>
    <div class="app-body">
      <div class="map-container" data-role="map"></div>
      <section class="panel" data-role="panel"></section>
    </div>`;

  const q = <T extends HTMLElement>(role: string) => root.querySelector<T>(`[data-role="${role}"]`)!;
  const header = root.querySelector<HTMLElement>(".app-header")!;
  const backBtn = q<HTMLButtonElement>("back");
  const title = q("title");
  let backHref: string | undefined;

  backBtn.addEventListener("click", () => {
    if (backHref) location.hash = backHref;
  });

  q("theme").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* 저장할 수 없는 환경은 무시 */
    }
  });

  return {
    header,
    panel: q("panel"),
    mapContainer: q("map"),
    setTitle(t, back) {
      title.textContent = t;
      document.title = t === "HappyWheel+" ? t : `${t} · HappyWheel+`;
      backHref = back;
      backBtn.hidden = !back;
    },
  };
}
