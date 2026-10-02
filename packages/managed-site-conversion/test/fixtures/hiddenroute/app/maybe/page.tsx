import { notFound } from "next/navigation";

import { renderMaybe } from "@/components/maybe-body";

/** Returns markup on one path, so nothing here PROVES the route 404s. */
export default function Maybe() {
  if (process.env.MAYBE === "on") return renderMaybe();
  notFound();
}
