export function Toast({ children }: { children: React.ReactNode }) {
  return (
    <aside id="toast">
      <h2>{children}</h2>
      <p>Never shown, because the effect discards it.</p>
    </aside>
  );
}
