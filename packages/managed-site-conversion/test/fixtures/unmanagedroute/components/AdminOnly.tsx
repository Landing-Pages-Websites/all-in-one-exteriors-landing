const TOOLS = [
  { title: "Upload", body: "Add a newsletter." },
  { title: "Revoke", body: "Take one down." },
];

export function AdminOnly() {
  return (
    <section>
      <h2>Rendered only by the internal screen</h2>
      <img src="/console.png" alt="The operator console" />
      {TOOLS.map((tool) => (
        <div key={tool.title}>
          <h3>{tool.title}</h3>
          <p>{tool.body}</p>
        </div>
      ))}
    </section>
  );
}
