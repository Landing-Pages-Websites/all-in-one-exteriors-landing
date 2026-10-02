const projects = [
  { slug: "riverside-mall", title: "Riverside Mall" },
  { slug: "harbour-point", title: "Harbour Point" },
];

export function generateStaticParams() {
  return projects.map((project) => ({ slug: project.slug }));
}

/**
 * A dynamic route, which the conversion excludes from the contract on purpose.
 *
 * Its pages are still built, so the comparison sees pages the contract never
 * declares -- and they must be identical too: they render the same shared
 * components, and the conversion passes them nothing.
 *
 * It does NOT reproduce the nested per-route bundle path that a real site
 * caught (`chunks/app/(site)/work/%5Bslug%5D/page-<hash>.js`). Turbopack names
 * every chunk flatly, so that shape belongs to another bundler and is held by a
 * unit row instead. Saying so here rather than implying this covers it.
 */
export default async function Project({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = projects.find((one) => one.slug === slug);
  return (
    <main>
      <h1>{project?.title ?? "Project"}</h1>
    </main>
  );
}
