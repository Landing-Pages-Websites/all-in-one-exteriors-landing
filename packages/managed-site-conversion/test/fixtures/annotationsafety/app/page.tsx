import { Chips } from "@/components/Chips";
import { Ticker } from "@/components/Ticker";

const managedIndex = "a name the site already uses";

export default function Home() {
  return (
    <main>
      <h1 {...{ "data-analytics": "hero" }}>Signage that lasts</h1>
      <p>{managedIndex}</p>
      <Ticker />
      <Chips />
    </main>
  );
}
