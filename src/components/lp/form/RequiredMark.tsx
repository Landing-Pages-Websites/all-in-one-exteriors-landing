import type { ReactElement } from "react";

export function RequiredMark(): ReactElement {
  return (
    <span aria-hidden="true" className="text-gold">
      *
    </span>
  );
}
