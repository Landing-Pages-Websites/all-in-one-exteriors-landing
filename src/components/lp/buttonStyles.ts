/** Shared CTA button styles: wrap on narrow phones, single line from sm up. */
const base =
  "inline-flex min-h-12 items-center whitespace-normal text-center justify-center sm:whitespace-nowrap gap-2 rounded-[2px] px-6 py-3.5 text-[0.875rem] font-bold uppercase tracking-[0.08em] transition duration-150 ease-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

export const buttonStyles = {
  primary: `${base} bg-brand text-white shadow-[0_8px_24px_-12px_rgba(201,26,11,0.9)] hover:-translate-y-0.5 hover:bg-brand-hover active:translate-y-0 active:bg-brand-active disabled:translate-y-0 disabled:bg-disabled disabled:text-white/80 disabled:shadow-none`,
  phone: `${base} border-2 border-white/80 text-white hover:-translate-y-0.5 hover:border-gold hover:text-gold active:translate-y-0`,
  secondary: `${base} border-2 border-line bg-surface text-white hover:-translate-y-0.5 hover:border-gold active:translate-y-0`,
} as const;
