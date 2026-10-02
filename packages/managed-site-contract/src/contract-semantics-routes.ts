import { ManagedSiteContractError } from "./errors.js";
import type { ManagedSiteContractFacts } from "./contract-semantics-facts.js";

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function routeSegments(path: string): readonly string[] {
  return path === "/" ? [] : path.slice(1).split("/");
}

function isGeneratedSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

function routesCollide(left: string, right: string): boolean {
  const leftSegments = routeSegments(left);
  const rightSegments = routeSegments(right);
  return leftSegments.length === rightSegments.length && leftSegments.every((segment, index) => segment === rightSegments[index] || isGeneratedSegment(segment) || isGeneratedSegment(rightSegments[index]));
}

export function validateManagedSiteContractRouteFacts(facts: ManagedSiteContractFacts): void {
  for (const [index, route] of facts.routes.entries()) {
    for (const other of facts.routes.slice(index + 1)) {
      if (routesCollide(route.path, other.path)) fail("CONTRACT_ROUTE_COLLISION", `Routes collide: ${route.location} and ${other.location}`);
    }
  }
}
