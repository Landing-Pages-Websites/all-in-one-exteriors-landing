import { TextReveal } from "./TextReveal";

export function FinalCta({ heading, tooltip, body }: { heading: string; tooltip: string; body: string }) {
  return (
    <section>
      <TextReveal lines={[heading]} tooltip={tooltip} />
      <p>{body}</p>
    </section>
  );
}
