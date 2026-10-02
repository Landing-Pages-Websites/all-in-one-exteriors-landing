import { Detail } from "@/components/Detail";

const VARIANTS = { detail: Detail };

export default function DynamicPage({ variant }: { variant: keyof typeof VARIANTS }) {
  const Chosen = VARIANTS[variant];
  return (
    <main>
      <Chosen />
    </main>
  );
}
