import { type ReactElement } from "react";
import { HONEYPOT_FIELD_NAME } from "@/lib/leadValidation";

export default function HoneypotField(): ReactElement {
  return (
    <div className="hp-field" aria-hidden="true">
      <label htmlFor={HONEYPOT_FIELD_NAME}>Company website</label>
      <input
        id={HONEYPOT_FIELD_NAME}
        name={HONEYPOT_FIELD_NAME}
        type="text"
        tabIndex={-1}
        autoComplete="off"
      />
    </div>
  );
}
