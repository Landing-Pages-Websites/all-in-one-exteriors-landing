import { metadata } from "../app/reachable/page";

/** Writes through the page's own live binding, from another module. */
export function rewrite(): void {
  metadata.robots = { index: false, follow: false };
}
