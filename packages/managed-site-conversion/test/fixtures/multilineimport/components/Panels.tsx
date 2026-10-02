export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}

export function Panel({ heading }: { heading: string }) {
  return <h2>{heading}</h2>;
}
