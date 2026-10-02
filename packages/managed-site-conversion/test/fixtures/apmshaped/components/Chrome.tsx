const BOOK_URL = "https://book.example.com";

/**
 * Rendered by the root layout, so every value it holds is site scoped. This is
 * the shape a real converted site has most of: chrome text repeated on every
 * route, and no collection anywhere.
 */
export function Chrome() {
  return (
    <header>
      <a href="/">
        All<span>Points</span>
      </a>
      <nav aria-label="Primary">
        <a href="/services">Services</a>
        <a href="/contact">Contact</a>
      </nav>
      <p>Serving the region since 1998.</p>
      <a href={BOOK_URL}>Book a call</a>
      <a href="tel:+15555550100">Call us</a>
      <a href="mailto:hello@example.com">Email us</a>
    </header>
  );
}
