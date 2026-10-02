import { type ManagedFields, type managedText } from "@/src/content/managed-site";

import { Banner } from "@/components/Banner";
import { Panel } from "@/components/Panel";

export type Reader = typeof managedText;
export type Fields = ManagedFields;

export default function Home() {
  return (
    <main>
      <h1>Signage that lasts</h1>
      <Banner headline="Built by one crew" />
      <Panel />
    </main>
  );
}
