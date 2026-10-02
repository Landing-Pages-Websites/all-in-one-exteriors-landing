import type { ReactElement } from "react";
import { labelClasses, optionClasses } from "./formStyles";
import { RequiredMark } from "./RequiredMark";

/** Yes/No toggle boxes: real radios under styled labels, so validity is native. */
export function ChoiceGroup({
  name,
  legend,
  options,
  value,
  onChange,
  disabled,
}: {
  name: string;
  legend: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}): ReactElement {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={`${labelClasses} mb-2`}>
        {legend} <RequiredMark />
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <label key={option} className="relative block">
            <input
              type="radio"
              name={name}
              value={option}
              required
              disabled={disabled}
              checked={value === option}
              onChange={() => onChange(option)}
              className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span className={optionClasses}>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
