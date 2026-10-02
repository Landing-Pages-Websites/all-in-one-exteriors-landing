import { Masthead } from "@/components/Masthead";
import { Shared } from "@/components/Shared";

export default function Home() {
  return (
    <>
      <Masthead />
      <Shared />
      <section>
        <h2>Words the customer owns</h2>
        <p>The public page a customer edits.</p>
      </section>
    </>
  );
}
