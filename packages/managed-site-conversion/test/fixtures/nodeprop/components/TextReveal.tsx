export function TextReveal({ lines, tooltip }: { lines: React.ReactNode[]; tooltip: string }) {
  return (
    <h2 title={tooltip}>
      {lines.map((line, index) => (
        <span key={index} className="line">
          {line}
        </span>
      ))}
    </h2>
  );
}
