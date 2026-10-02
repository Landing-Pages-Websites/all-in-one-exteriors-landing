export function Detail() {
  // Declared inside Detail and rendered by it, so it is extracted under its own name.
  const Badge = () => <span id="badge">New</span>;
  return (
    <section id="detail">
      <p>Reached through Feature.</p>
      <Badge />
    </section>
  );
}
