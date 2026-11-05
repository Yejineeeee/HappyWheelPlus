import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapStyleUrl } from "./style";

export interface AppMap {
  map: maplibregl.Map;
  ready: Promise<void>;
  setTheme(t: "light" | "dark"): void;
  fitTo(bounds: [[number, number], [number, number]], opts?: { animate?: boolean }): void;
  /** 스타일이 (다시) 로드될 때마다 호출되는 콜백 등록. 앱 레이어 복원에 쓴다. */
  onStyleLoad(cb: () => void): void;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function createMap(container: HTMLElement, theme: "light" | "dark"): AppMap {
  let currentTheme = theme;
  let styleLoaded = false;
  let fellBack = false;
  const listeners: (() => void)[] = [];

  const map = new maplibregl.Map({
    container,
    style: mapStyleUrl(theme),
    center: [10, 48],
    zoom: 3,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "OpenFreeMap" }));
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  const ready = new Promise<void>((resolve) => {
    map.once("style.load", () => resolve());
  });

  map.on("style.load", () => {
    styleLoaded = true;
    for (const cb of listeners) cb();
  });

  // 다크 스타일을 못 불러오면 한 번만 밝은 스타일로 대체한다.
  map.on("error", () => {
    if (styleLoaded || fellBack || currentTheme !== "dark") return;
    fellBack = true;
    map.setStyle(mapStyleUrl("light"));
  });

  return {
    map,
    ready,
    setTheme(t) {
      if (t === currentTheme) return;
      currentTheme = t;
      fellBack = false;
      styleLoaded = false;
      map.setStyle(mapStyleUrl(t));
    },
    fitTo(bounds, opts) {
      const animate = prefersReducedMotion() ? false : (opts?.animate ?? true);
      map.fitBounds(bounds, { padding: 48, animate, maxZoom: 17 });
    },
    onStyleLoad(cb) {
      listeners.push(cb);
    },
  };
}
