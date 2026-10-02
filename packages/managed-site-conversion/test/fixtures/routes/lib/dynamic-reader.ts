/** Reaches the page module through a dynamic import, which names no binding. */
export async function touch(): Promise<void> {
  const page = await import("../app/dynamic/page");
  Object.assign(page.metadata, { robots: { index: false } });
}
