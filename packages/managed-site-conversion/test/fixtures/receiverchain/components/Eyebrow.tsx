export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="eyebrow">
      <span aria-hidden className="rule" />
      {children}
    </span>
  );
}
