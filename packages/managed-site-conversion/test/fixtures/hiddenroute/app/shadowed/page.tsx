import { notFound } from "next/navigation";

/** The call is a local of the same name. The import is shadowed, not used. */
export default function Shadowed() {
  const notFound = () => undefined;
  notFound();
}
