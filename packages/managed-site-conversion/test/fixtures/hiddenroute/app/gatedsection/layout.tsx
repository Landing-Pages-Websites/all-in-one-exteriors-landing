import { notFound } from "next/navigation";

/** The whole section is gone, so every route under it is too. */
export default function GatedSectionLayout() {
  notFound();
}
