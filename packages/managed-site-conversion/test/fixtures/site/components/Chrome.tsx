const BOOK_URL = "https://book.example.com";

export function Chrome() {
  return (
    <header>
      <a href="#">
        Fixture<span>Site</span>
      </a>
      <nav aria-label="Primary">
        <a href="#services">Services</a>
        <a href="#contact">Contact</a>
      </nav>
      <a href={BOOK_URL}>Book a call</a>
    </header>
  );
}
