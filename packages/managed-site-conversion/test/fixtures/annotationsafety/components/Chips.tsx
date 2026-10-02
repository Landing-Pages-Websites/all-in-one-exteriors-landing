import { Label } from "./Label";

const chips = [{ title: "Retail" }, { title: "Healthcare" }];

export function Chips() {
  return (
    <ul>
      {chips.map((chip) => (
        <li key={chip.title}>
          <Label>{chip.title}</Label>
        </li>
      ))}
    </ul>
  );
}
