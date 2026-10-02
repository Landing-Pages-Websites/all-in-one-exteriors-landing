"use client";

import { useEffect } from "react";
import { captureLeadContext } from "@/lib/megaLeadContext";

/**
 * First-touch attribution capture.
 *
 * UTMs and click IDs only exist in the URL of the page the visitor LANDS on.
 * A visitor who arrives on `/?gclid=…` and browses to the contact page before
 * converting would otherwise submit with nothing to attribute, because the form
 * only captures at submit time, by which point the params are long gone.
 *
 * Running once per page load persists the first touch for whichever form they
 * eventually use. Renders nothing.
 */
export function LeadAttribution() {
  useEffect(() => {
    captureLeadContext();
  }, []);

  return null;
}
