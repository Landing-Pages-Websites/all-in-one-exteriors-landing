import { FeatureRow } from "@/components/FeatureRow";

export default function Home() {
  return (
    <main>
      <h1>Signage that lasts</h1>
      <FeatureRow
        eyebrow="How it works"
        lead="Designed, built and installed by one crew."
        caption="Participation in the real world"
      />
    </main>
  );
}
