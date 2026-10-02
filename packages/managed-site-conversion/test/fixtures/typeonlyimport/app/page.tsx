import type { ManagedFields } from "@/src/content/managed-site";
import { managedText } from "@/src/content/managed-site";

import { Panel } from "@/components/Panel";

export function readFields(fields: ManagedFields): number {
  return Object.keys(fields).length;
}

export default function Home() {
  return (
    <main>
      <h1>Signage that lasts</h1>
      <p>{managedText("field_written_by_hand").value}</p>
      <Panel />
    </main>
  );
}
