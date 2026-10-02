"use client";

import { useEffect } from "react";

import { Card } from "@/components/Card";
import { Panel } from "@/components/Panel";
import { Toast } from "@/components/Toast";

const OFFERS = [{ title: "Survey" }, { title: "Publish" }];

export default function Home() {
  // Runs on mount and throws the result away, so no visitor ever sees either of
  // these. Card renders for real below, and must still be proposed exactly once.
  useEffect(() => (
    <Toast>
      <Card>Never shown</Card>
    </Toast>
  ));
  return (
    <main>
      <section id="offers">
        <h2>What you get</h2>
        {OFFERS.map((offer) => (
          <Card key={offer.title}>{offer.title}</Card>
        ))}
      </section>
      {/* Only Panel decides whether it renders this, so the span is refused aloud. */}
      <Panel renderFooter={() => <span>Written as a render prop.</span>} />
      {/* The DOM discards what a handler returns, so the span is refused in silence. */}
      <button onClick={() => <span>Never shown from a handler</span>}>Save</button>
    </main>
  );
}
