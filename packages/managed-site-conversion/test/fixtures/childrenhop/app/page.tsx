import { Button } from "@/components/Button";

const ctas = {
  primary: { href: "/contact", label: "Talk to us" },
  secondary: { href: "/solutions", label: "Explore solutions" },
};

export default function Home() {
  return (
    <main>
      <h1>Signage that lasts</h1>
      <Button href={ctas.primary.href}>{ctas.primary.label}</Button>
      <Button href={ctas.secondary.href}>{ctas.secondary.label}</Button>
    </main>
  );
}
