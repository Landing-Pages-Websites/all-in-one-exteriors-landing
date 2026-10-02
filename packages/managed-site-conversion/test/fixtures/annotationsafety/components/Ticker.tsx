"use client";

import { Label } from "./Label";

const scale = { line: "Fourteen states and counting." };

export function Ticker() {
  return (
    <section>
      <Label>{scale.line}</Label>
    </section>
  );
}
