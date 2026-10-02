export function Panel({ renderFooter }: { renderFooter: () => React.ReactNode }) {
  return (
    <section id="panel">
      <h2>How it works</h2>
      {renderFooter()}
    </section>
  );
}
