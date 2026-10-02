import { Eyebrow } from "./Eyebrow";
import { Figure } from "./Figure";

export function FeatureRow({
  eyebrow,
  lead,
  caption,
}: {
  eyebrow: string;
  lead: string;
  caption: string;
}) {
  return (
    <section>
      <Eyebrow>{eyebrow}</Eyebrow>
      <p>{lead}</p>
      <Figure src="/hero.png" caption={caption} />
    </section>
  );
}
