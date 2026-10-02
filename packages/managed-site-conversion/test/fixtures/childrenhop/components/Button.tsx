export function Button({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="button">
      <span>{children}</span>
    </a>
  );
}
