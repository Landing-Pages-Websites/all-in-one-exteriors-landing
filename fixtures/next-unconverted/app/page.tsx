import Image from "next/image";

import mark from "../public/mark.svg";
import { Feature } from "../components/Feature";
import { Story } from "../components/Story";
import { Ticker } from "../components/Ticker";

const routes = [
  { slug: "wayfinding", label: "Wayfinding" },
  { slug: "storefronts", label: "Storefronts" },
];

export default function Home() {
  return (
    <main>
      {/* Imported rather than referenced by path, so the build emits it under
          `/_next/static/media` with a hash of the picture in its name. That is
          the media the parity check compares, and a conversion must change
          neither the file nor the reference to it. */}
      <Image src={mark} alt="Northwind Signs" width={32} height={32} />
      <h1>Signage that lasts</h1>
      <p>Designed, built and installed by one crew.</p>
      <Feature
        title="What we do"
        lead="Wayfinding, storefronts and vehicle wraps."
        aside={<span>Since 1994</span>}
      />
      <ul>
        {routes.map((route) => (
          <li key={route.slug}>
            <h3>{route.label}</h3>
          </li>
        ))}
      </ul>
      <Story />
      <Ticker />
    </main>
  );
}
