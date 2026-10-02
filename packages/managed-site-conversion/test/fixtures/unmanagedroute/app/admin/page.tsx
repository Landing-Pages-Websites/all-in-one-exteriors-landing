import { AdminOnly } from "@/components/AdminOnly";
import { Masthead } from "@/components/Masthead";
import { Shared } from "@/components/Shared";

export default function Admin() {
  return (
    <>
      <Masthead />
      <Shared />
      <AdminOnly />
      <section>
        <h2>Shared password</h2>
        <p>Words on the internal screen.</p>
      </section>
    </>
  );
}
