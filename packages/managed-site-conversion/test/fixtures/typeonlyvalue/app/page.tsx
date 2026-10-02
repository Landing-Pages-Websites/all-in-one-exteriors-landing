import type { managedText } from "@/src/content/managed-site";

import { Panel } from "@/components/Panel";

export type Reader = typeof managedText;

export default function Home() {
  return (
    <main>
      <h1>Signage that lasts</h1>
      <Panel />
    </main>
  );
}
