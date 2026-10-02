import { notFound } from "next/navigation";

/** An internal screen that is also gone. Declining content is not serving one. */
export default function Internal() {
  notFound();
}
