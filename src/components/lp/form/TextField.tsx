import type { InputHTMLAttributes, ReactElement } from "react";
import { inputClasses, labelClasses } from "./formStyles";
import { RequiredMark } from "./RequiredMark";

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "name" | "value" | "onChange" | "className" | "required"
>;

export function TextField({
  id,
  name,
  label,
  value,
  onValueChange,
  ...inputProps
}: NativeInputProps & {
  id: string;
  name: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClasses}>
        {label} <RequiredMark />
      </label>
      <input
        {...inputProps}
        id={id}
        name={name}
        required
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={inputClasses}
      />
    </div>
  );
}
