"use client";

import { useState } from "react";

const regions = [
  { name: "Northwest", note: "Four states" },
  { name: "Great Lakes", note: "Six states" },
];

/**
 * A client component rendering BOTH its own text and a collection, so the
 * conversion has to give it two threaded props. One with no parameter at all
 * was given a whole parameter for each, which does not parse.
 */
export function Ticker() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => { setOpen(!open); }}>
        Fourteen states and counting.
      </button>
      <ul hidden={!open}>
        {regions.map((region) => (
          <li key={region.name}>
            <h3>{region.name}</h3>
            <p>{region.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
