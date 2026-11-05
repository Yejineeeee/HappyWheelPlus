export type Route =
  | { name: "home" }
  | { name: "compare" }
  | { name: "about" }
  | { name: "city"; city: string }
  | { name: "course"; city: string; course: number }
  | { name: "nav"; city: string; course: number }
  | { name: "notFound"; path: string };

export function parseRoute(hash: string): Route {
  const path = "/" + hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  const parts = path.split("/").filter((p) => p !== "");
  const notFound: Route = { name: "notFound", path };
  if (parts.length === 0) return { name: "home" };
  const [first, second, third] = parts;
  if (parts.length === 1) {
    if (first === "compare") return { name: "compare" };
    if (first === "about") return { name: "about" };
    return { name: "city", city: first };
  }
  if (first === "compare" || first === "about") return notFound;
  if (!/^\d+$/.test(second)) return notFound;
  const course = Number(second);
  if (parts.length === 2) return { name: "course", city: first, course };
  if (parts.length === 3 && third === "nav") return { name: "nav", city: first, course };
  return notFound;
}

export function formatRoute(r: Exclude<Route, { name: "notFound" }>): string {
  switch (r.name) {
    case "home":
      return "#/";
    case "compare":
      return "#/compare";
    case "about":
      return "#/about";
    case "city":
      return `#/${r.city}`;
    case "course":
      return `#/${r.city}/${r.course}`;
    case "nav":
      return `#/${r.city}/${r.course}/nav`;
  }
}

export function onRouteChange(cb: (r: Route) => void): () => void {
  const handler = () => cb(parseRoute(location.hash));
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}
