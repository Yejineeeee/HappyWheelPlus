import { loadIndex } from "./data/load";
import type { CityIndex } from "./data/types";
import { clearCityLayers } from "./map/layers";
import { createMap } from "./map/map";
import { formatRoute, onRouteChange, parseRoute, type Route } from "./router";
import { errorBlock, loadingBlock } from "./ui/components";
import { mountSheet } from "./ui/sheet";
import { mountShell } from "./ui/shell";
import { aboutView } from "./views/about";
import { cityView } from "./views/city";
import { compareView } from "./views/compare";
import { courseView } from "./views/course";
import { homeView } from "./views/home";
import { notFoundView } from "./views/notFound";
import { placeholderView } from "./views/placeholder";
import type { AppContext, View } from "./views/types";

function makeView(route: Route): View {
  switch (route.name) {
    case "home":
      return homeView();
    case "city":
      return cityView(route.city);
    case "course":
      return courseView(route.city, route.course);
    case "nav":
      return placeholderView("길안내");
    case "compare":
      return compareView();
    case "about":
      return aboutView();
    case "notFound":
      return notFoundView();
  }
}

/** 같은 도시(또는 홈)에 머무는 동안은 지도 레이어를 지우지 않는다. */
function layerContext(route: Route): string | null {
  switch (route.name) {
    case "home":
      return "home";
    case "city":
    case "course":
    case "nav":
      return `city:${route.city}`;
    default:
      // 비교·방법론·없는 주소는 서로 다른 맥락이라 이동할 때 지도 마커를 지운다.
      return route.name;
  }
}

export function startApp(root: HTMLElement): void {
  const shell = mountShell(root);
  const sheet = mountSheet(shell.panel);
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const map = createMap(shell.mapContainer, theme);
  // data-theme은 셸이 먼저 바꾼 뒤 이 콜백이 불리므로 지도 레이어가 새 색을 읽는다.
  shell.onThemeChange((t) => map.setTheme(t));

  let index: CityIndex | null = null;
  let current: { view: View; ctl: AbortController } | null = null;
  let layerKey: string | null = null;

  const show = (route: Route): void => {
    if (!index) return;
    if (current) {
      current.ctl.abort();
      current.view.unmount();
      current = null;
    }
    const key = layerContext(route);
    if (key !== layerKey) clearCityLayers(map);
    layerKey = key;

    const ctl = new AbortController();
    const view = makeView(route);
    current = { view, ctl };
    const ctx: AppContext = {
      map,
      sheet,
      shell,
      index,
      navigate: (r) => {
        location.hash = formatRoute(r);
      },
      signal: ctl.signal,
    };
    const fail = () => {
      if (ctl.signal.aborted) return;
      shell.setTitle("HappyWheel+");
      sheet.setContent(errorBlock("화면을 열지 못했어요.", () => show(parseRoute(location.hash))));
    };
    try {
      Promise.resolve(view.mount(ctx)).catch(fail);
    } catch {
      fail();
    }
  };

  onRouteChange(show);

  const boot = (): void => {
    shell.setTitle("HappyWheel+");
    sheet.setContent(loadingBlock("도시 정보를 불러오는 중"));
    loadIndex().then(
      (loaded) => {
        index = loaded;
        show(parseRoute(location.hash));
      },
      () => {
        sheet.setContent(errorBlock("도시 정보를 불러오지 못했어요.", boot));
      },
    );
  };
  boot();
}
