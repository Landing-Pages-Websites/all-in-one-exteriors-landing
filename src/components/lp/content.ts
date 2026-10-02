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

export const WARRANTY_QUALIFIER =
  "Lifetime materials warranty and 5–10 years on labor, depending on the manufacturer.";

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

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "Is the roof inspection paid?",
    answer:
      "Yes. Inspections are a paid service. Start by requesting a roof estimate and we will talk through your property and roof needs.",
  },
  {
    question: "What warranty comes with a roof replacement?",
    answer:
      "Replacements carry manufacturer-backed coverage: a lifetime warranty on materials and 5–10 years on labor, depending on the manufacturer. Exact terms vary by manufacturer, so ask us for the specifics on the system you choose.",
  },
  {
    question: "Who should request the estimate?",
    answer:
      "The homeowner or the authorized decision maker for the property. That keeps the conversation with the person who can approve the scope of work.",
  },
  {
    question: "My roof is leaking or damaged. Can I still request an estimate?",
    answer:
      "Yes. Leaking or damaged roofs and standard, planned replacements both qualify. Tell us on the form if your roof is leaking or damaged so we know it is urgent.",
  },
  {
    question: "Do you work on commercial roofs?",
    answer:
      "Residential roof replacement is our focus, and light commercial inquiries are welcome. We hold NRCA certification for both low-slope and steep-slope roofing.",
  },
  {
    question: "Which areas do you serve?",
    answer:
      "Our initial footprint covers Alpharetta, Milton, Johns Creek, Marietta, Woodstock, Rome, Roswell, and Dunwoody, GA.",
  },
];
