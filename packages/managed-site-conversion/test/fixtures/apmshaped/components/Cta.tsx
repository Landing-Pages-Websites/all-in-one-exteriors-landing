/**
 * Rendered by two routes but by no layout, so its values are site scoped while
 * binding in the middle of the walk rather than at either end. Site scope is
 * the placement most of a converted site's values sit in, so the fixture holds
 * one of them somewhere other than the ends.
 */
export function Cta() {
  return (
    <aside>
      <h2>Talk to a real person</h2>
      <p>No call centre, no queue.</p>
      <a href="/contact">Start here</a>
    </aside>
  );
}
