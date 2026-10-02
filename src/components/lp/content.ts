/**
 * Copy and facts for the roof-replacement LP. Every claim here is sourced from
 * the client's live site or the approved offer brief — add nothing that is not.
 * The word "free" and any financing or insurance-outcome language are
 * prohibited by the campaign guardrails.
 */

export const PHONE_DISPLAY = "(404) 445-8136";
/** Must match the CTM routing number exactly. */
export const PHONE_HREF = "tel:4044458136";

export const PRIMARY_CTA = "Request a Roof Estimate";
export const FORM_ANCHOR = "estimate";
export const FINAL_FORM_ANCHOR = "final-estimate";

export const CITIES = [
  "Alpharetta",
  "Milton",
  "Johns Creek",
  "Marietta",
  "Woodstock",
  "Rome",
  "Roswell",
  "Dunwoody",
] as const;

/** "Alpharetta, Milton, ..., and Dunwoody" for running copy. */
export const CITY_LIST_TEXT = `${CITIES.slice(0, -1).join(", ")}, and ${CITIES[CITIES.length - 1]}`;

export const WARRANTY_QUALIFIER =
  "Lifetime materials warranty and 5 to 10 years on labor, depending on the manufacturer.";

export interface Testimonial {
  name: string;
  quote: string;
}

/** Verbatim excerpts from the client's Google reviews. */
export const TESTIMONIALS: readonly Testimonial[] = [
  {
    name: "Pam Perez-Ross",
    quote:
      "Had a great experience with Keefe. He was very knowledgeable and helped us make the right choice. Work was done phenomenally, on time and very clean.",
  },
  {
    name: "James E. Carlisle",
    quote: "Timely and professional service.",
  },
  {
    name: "Amber Broadway",
    quote:
      "Being on time is so important to us. When AIOE arrived they were professional and informative about the status of our roof. We were so grateful for knowing the top of our investment is in great condition after this company fixed all the problems we could not see.",
  },
  {
    name: "Vincent Santerre",
    quote:
      "Keefe did what he said he was going to do, when he committed to have it done. Very professional and great value. No hassles.",
  },
];
