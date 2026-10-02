import { notFound } from "next/navigation";

/** Work before the 404, and a branch that returns nothing. It still 404s. */
export default async function Awaited() {
  await Promise.resolve();
  if (process.env.AWAITED === "log") console.warn("hidden");
  notFound();
}
