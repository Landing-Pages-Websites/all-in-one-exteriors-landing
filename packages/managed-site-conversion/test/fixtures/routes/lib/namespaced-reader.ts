import * as page from "../app/namespaced/page";

/** Reaches the binding without ever naming it. */
export function touch(): void {
  Object.assign(page.metadata, { robots: { index: false } });
}
