/** Hash routing: works on any static host without rewrites. Pure functions. */
import type { Route, RouteHref } from "../ui-contracts.ts";

const ID = /^[0-9a-f]{16}$/;

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  const parts = path.split("/").filter((p) => p !== "");
  if (parts.length === 0) return { name: "overview" };
  const [head, a, b] = parts;
  switch (head) {
    case "demo":
      if (parts.length === 1) return { name: "demo" };
      break;
    case "queue":
      if (parts.length === 1) return { name: "queue", batchId: null };
      if (parts.length === 2 && ID.test(a!)) return { name: "queue", batchId: a! };
      break;
    case "case":
      if (parts.length === 3 && ID.test(a!) && ID.test(b!)) return { name: "case", batchId: a!, findingId: b! };
      break;
    case "results":
    case "how":
    case "roadmap":
      if (parts.length === 1) return { name: head };
      break;
  }
  return { name: "not_found", hash: path.slice(0, 200) };
}

export function formatRoute(route: Route): RouteHref {
  switch (route.name) {
    case "overview":
      return "#/";
    case "demo":
      return "#/demo";
    case "queue":
      return route.batchId ? `#/queue/${route.batchId}` : "#/queue";
    case "case":
      return `#/case/${route.batchId}/${route.findingId}`;
    case "results":
    case "how":
    case "roadmap":
      return `#/${route.name}`;
    case "not_found":
      return "#/";
  }
}
