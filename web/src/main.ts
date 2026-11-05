import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import { onRouteChange, parseRoute, type Route } from "./router";
import { mountShell } from "./ui/shell";

const shell = mountShell(document.getElementById("app")!);

function render(route: Route): void {
  const home = route.name === "home";
  shell.setTitle(home ? "HappyWheel+" : route.name, home ? undefined : "#/");
}

render(parseRoute(location.hash));
onRouteChange(render);
