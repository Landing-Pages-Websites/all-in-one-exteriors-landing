import type { ReactElement, ReactNode } from "react";

/** Gold eyebrow + red rule + heavy H2. `align="center"` for closing blocks. */
export function SectionHeading({
  eyebrow,
  title,
  intro,
  align = "left",
  id,
  titleAttributes,
}: {
  eyebrow: string;
  title: ReactNode;
  intro?: ReactNode;
  align?: "left" | "center";
  id?: string;
  /** Managed-content annotation for the H2, when the title is a managed field. */
  titleAttributes?: Readonly<Record<`data-${string}`, string>>;
}): ReactElement {
  const centered = align === "center";
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <p
        className={`flex items-center gap-3 text-small font-bold uppercase tracking-[0.18em] text-gold ${centered ? "justify-center" : ""}`}
      >
        <span aria-hidden="true" className="h-[3px] w-8 bg-brand" />
        {eyebrow}
      </p>
      <h2
        id={id}
        className="mt-4 text-h2 font-extrabold tracking-tight text-balance text-white"
        {...titleAttributes}
      >
        {title}
      </h2>
      {intro ? (
        <p className="mt-5 text-lg leading-relaxed text-muted">{intro}</p>
      ) : null}
    </div>
  );
}
