import { metadata } from "./barrel";

export function rewriteThroughBarrel(): void {
  metadata.robots = { index: false, follow: false };
}
