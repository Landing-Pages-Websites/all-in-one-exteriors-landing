import { notFound } from "next/navigation";

/** Deliberately hidden: this route answers 404 in production. */
export default function HiddenPage() {
  notFound();
}
