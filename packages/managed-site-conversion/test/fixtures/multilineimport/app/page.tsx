import {
  Eyebrow,
  Panel,
} from "@/components/Panels";
import { managedText } from "@/src/content/managed-site";

export default function Home() {
  return (
    <main>
      <h1>{managedText("field_already_here").value}</h1>
      <Eyebrow>How it works</Eyebrow>
      <Panel heading="Built by one crew" />
    </main>
  );
}
