export function Card({ children }: { children: React.ReactNode }) {
  return (
    <article id="card">
      <h3>{children}</h3>
      <p>Included with every offer.</p>
    </article>
  );
}
