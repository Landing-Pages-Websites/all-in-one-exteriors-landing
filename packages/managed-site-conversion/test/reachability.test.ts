import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { renderAnchor } from "../src/anchors.js";
import type { JsonObject } from "../src/json-write.js";
import { resolveRenderTree } from "../src/reachability.js";
import type { FindingCode } from "../src/report.js";
import { discoverLayoutChain, ModuleCache } from "../src/scan.js";
import {
  extractModule,
  findingsOf,
  run,
  sourceDocumentOf,
  workspace,
} from "./support/proposals.js";

/**
 * A field may only be proposed for a component the rendered route or layout tree
 * actually reaches. Where the tree cannot be followed the subtree is withheld
 * AND named, because a silent drop and a silent inclusion are the same failure
 * wearing different clothes.
 */

const ENTRY = "app/page.tsx";

interface Outcome {
  readonly reached: readonly string[];
  readonly codes: readonly FindingCode[];
}

function renderTreeOf(files: Readonly<Record<string, string>>): Outcome {
  const root = mkdtempSync(join(tmpdir(), "managed-site-reachability-"));
  for (const [path, source] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source, "utf8");
  }
  const tree = resolveRenderTree([join(root, ENTRY)], root, new ModuleCache());
  return {
    reached: tree.components.map((declaration) => declaration.name).sort(),
    codes: tree.findings.map((finding) => finding.code),
  };
}

interface ReachabilityCase {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly reached: readonly string[];
  readonly codes: readonly FindingCode[];
}

/** Each case names one shape of render reference and the ONE answer it must get. */
const REACHABILITY_CASES: readonly ReachabilityCase[] = [
  {
    name: "an export sitting beside the page renders nothing",
    files: {
      [ENTRY]: `export default function Page() { return <main><h1>Real</h1></main>; }
        export function UnusedPromo() { return <section id="p"><h2>Never</h2></section>; }`,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a component is reached through another component",
    files: {
      [ENTRY]: `import { A } from "@/components/A";
        export default function Page() { return <main><A /></main>; }`,
      "components/A.tsx": `import { B } from "./B";
        export function A() { return <section id="a"><B /></section>; }`,
      "components/B.tsx": `export function B() { return <section id="b"><p>Deep</p></section>; }`,
    },
    reached: ["A", "B", "Page"],
    codes: [],
  },
  {
    name: "a nested component that is rendered is a target in its own right",
    files: {
      [ENTRY]: `export default function Page() {
          const Badge = () => <span id="badge">New</span>;
          return <main><Badge /></main>;
        }`,
    },
    reached: ["Badge", "Page"],
    codes: [],
  },
  {
    name: "a nested arrow nothing renders is left out",
    files: {
      [ENTRY]: `export default function Page() {
          const UnusedPromo = () => <section id="promo"><h2>Never shown</h2></section>;
          return <main><h1>Live</h1></main>;
        }`,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a nested function declaration nothing renders is left out",
    files: {
      [ENTRY]: `export default function Page() {
          function UnusedPromo() { return <section id="promo"><h2>Never shown</h2></section>; }
          return <main><h1>Live</h1></main>;
        }`,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a lowercase nested helper returning JSX is not a render target",
    files: {
      [ENTRY]: `export default function Page() {
          const promoMarkup = () => <section id="promo"><h2>Never shown</h2></section>;
          return <main><h1>Live</h1></main>;
        }`,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a nested declaration inside a nested declaration is left out",
    files: {
      [ENTRY]: `export default function Page() {
          const UnusedPromo = () => {
            const Deeper = () => <section id="deep"><h2>Never shown</h2></section>;
            return <section id="promo"><Deeper /></section>;
          };
          return <main><h1>Live</h1></main>;
        }`,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "an import rendered only by an unrendered nested helper is not reached",
    files: {
      [ENTRY]: `import { Banner } from "@/components/Banner";
        export default function Page() {
          const UnusedPromo = () => <Banner />;
          return <main><h1>Live</h1></main>;
        }`,
      "components/Banner.tsx": `export function Banner() { return <section id="b"><p>Never shown</p></section>; }`,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a nested component rendered conditionally is still a target",
    files: {
      [ENTRY]: `export default function Page({ show }: { show: boolean }) {
          const Badge = () => <span id="badge">New</span>;
          return <main>{show && <Badge />}</main>;
        }`,
    },
    reached: ["Badge", "Page"],
    codes: [],
  },
  {
    name: "a nested component may render its sibling in the same closure",
    files: {
      [ENTRY]: `export default function Page() {
          const Inner = () => <section id="inner"><Leaf /></section>;
          const Leaf = () => <p id="leaf">Leaf</p>;
          return <main><Inner /></main>;
        }`,
    },
    reached: ["Inner", "Leaf", "Page"],
    codes: [],
  },
  {
    name: "a nested component is out of scope for a component it is not declared in",
    files: {
      [ENTRY]: `export function Other() {
          const Badge = () => <span id="badge">New</span>;
          return <section id="other"><Badge /></section>;
        }
        export default function Page() { return <main><Badge /></main>; }`,
    },
    reached: ["Page"],
    codes: ["UNRESOLVED_RENDER_TARGET"],
  },
  {
    name: "two nested components of one name are both kept, for the gate to withhold",
    files: {
      [ENTRY]: `export default function Page() {
          const Badge = () => <span id="badge">One</span>;
          const Row = () => {
            const Badge = () => <span id="badge">Two</span>;
            return <section id="row"><Badge /></section>;
          };
          return <main><Badge /><Row /></main>;
        }`,
    },
    reached: ["Badge", "Badge", "Page", "Row"],
    codes: [],
  },
  {
    name: "a named re-export through a barrel is followed",
    files: {
      [ENTRY]: `import { Barrelled } from "@/components";
        export default function Page() { return <main><Barrelled /></main>; }`,
      "components/index.ts": `export { Barrelled } from "./Barrelled";`,
      "components/Barrelled.tsx": `export function Barrelled() { return <section id="b"><p>Via barrel</p></section>; }`,
    },
    reached: ["Barrelled", "Page"],
    codes: [],
  },
  {
    name: "a star re-export through a barrel is followed",
    files: {
      [ENTRY]: `import { Starred } from "@/components";
        export default function Page() { return <main><Starred /></main>; }`,
      "components/index.ts": `export * from "./Starred";`,
      "components/Starred.tsx": `export function Starred() { return <section id="s"><p>Via star</p></section>; }`,
    },
    reached: ["Page", "Starred"],
    codes: [],
  },
  {
    name: "a renamed import still names the declaration it renders",
    files: {
      [ENTRY]: `import { Panel as Renamed } from "@/components/Panel";
        export default function Page() { return <main><Renamed /></main>; }`,
      "components/Panel.tsx": `export function Panel() { return <section id="p"><p>Renamed</p></section>; }`,
    },
    reached: ["Page", "Panel"],
    codes: [],
  },
  {
    name: "a default export re-exported by name is followed",
    files: {
      [ENTRY]: `import Hero from "@/components/Hero";
        export default function Page() { return <main><Hero /></main>; }`,
      "components/Hero.tsx": `function Hero() { return <section id="h"><h1>Hero</h1></section>; }
        export default Hero;`,
    },
    reached: ["Hero", "Page"],
    codes: [],
  },
  {
    name: "a member of a namespace import of our own code is followed",
    files: {
      [ENTRY]: `import * as Panels from "@/components/panels";
        export default function Page() { return <main><Panels.Check /></main>; }`,
      "components/panels.tsx": `export function Check() { return <section id="c"><p>Checked</p></section>; }`,
    },
    reached: ["Check", "Page"],
    codes: [],
  },
  {
    name: "a component from a package is resolved, not refused",
    files: {
      [ENTRY]: `import { Suspense } from "react";
        export default function Page() { return <main><Suspense><h1>Real</h1></Suspense></main>; }`,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a conditional branch still renders what it holds",
    files: {
      [ENTRY]: `import { Banner } from "@/components/Banner";
        export default function Page({ show }: { show: boolean }) {
          return <main>{show ? <Banner /> : null}</main>;
        }`,
      "components/Banner.tsx": `export function Banner() { return <section id="b"><p>Sometimes</p></section>; }`,
    },
    reached: ["Banner", "Page"],
    codes: [],
  },
  {
    name: "a component chosen at runtime is reported, never guessed",
    files: {
      [ENTRY]: `import { A } from "@/components/A";
        const VARIANTS = { a: A };
        export default function Page({ pick }: { pick: "a" }) {
          const Chosen = VARIANTS[pick];
          return <main><Chosen /></main>;
        }`,
      "components/A.tsx": `export function A() { return <section id="a"><p>A</p></section>; }`,
    },
    reached: ["Page"],
    codes: ["UNRESOLVED_RENDER_TARGET"],
  },
  {
    name: "a component arriving as a prop is reported",
    files: {
      [ENTRY]: `export default function Page({ Icon }: { Icon: () => JSX.Element }) {
          return <main><Icon /></main>;
        }`,
    },
    reached: ["Page"],
    codes: ["UNRESOLVED_RENDER_TARGET"],
  },
  {
    name: "a member of a namespace holding local values is reported",
    files: {
      [ENTRY]: `const Registry = { Card: () => <p>Card</p> };
        export default function Page() { return <main><Registry.Card /></main>; }`,
    },
    reached: ["Page"],
    codes: ["UNRESOLVED_RENDER_TARGET"],
  },
  {
    name: "an import that does not resolve is reported against its own module",
    files: {
      [ENTRY]: `import { Gone } from "./gone";
        export default function Page() { return <main><Gone /></main>; }`,
    },
    reached: ["Page"],
    codes: ["UNRESOLVED_COMPONENT"],
  },
  {
    name: "an unnamed default export cannot be anchored, so it is reported",
    files: {
      [ENTRY]: `export default function () { return <main><h1>Anonymous</h1></main>; }`,
    },
    reached: [],
    codes: ["UNRESOLVED_RENDER_TARGET"],
  },
  {
    name: "a non-ASCII component name is a component to every reading of the name",
    files: {
      [ENTRY]: `export default function Page() {
          const Élan = () => <span id="elan">Flair</span>;
          return <main><Élan /></main>;
        }`,
    },
    reached: ["Page", "Élan"],
    codes: [],
  },
  {
    name: "components that render each other terminate",
    files: {
      [ENTRY]: `import { A } from "@/components/A";
        export default function Page() { return <main><A /></main>; }`,
      "components/A.tsx": `import { B } from "./B";
        export function A() { return <section id="a"><B /></section>; }`,
      "components/B.tsx": `import { A } from "./A";
        export function B() { return <section id="b"><A /></section>; }`,
    },
    reached: ["A", "B", "Page"],
    codes: [],
  },
];

const CARD = `export function Card() { return <section id="c"><p>Card</p></section>; }`;
const ROW = `export function Row() { return <section id="r"><p>Row</p></section>; }`;
const BANNER = `export function Banner() { return <section id="b"><p>Never shown</p></section>; }`;

/**
 * A function a call is handed is run by that call, so what it renders is on the
 * page. These cases are the shapes that reach a component through one, and the
 * shapes that only look as though they do.
 */
const INVOKED_CALLBACK_CASES: readonly ReachabilityCase[] = [
  {
    name: "a component rendered from a map arrow is reached",
    files: {
      [ENTRY]: `import { Card } from "@/components/Card";
        const ITEMS = [{ title: "One" }];
        export default function Page() {
          return <main>{ITEMS.map((item) => <Card>{item.title}</Card>)}</main>;
        }`,
      "components/Card.tsx": CARD,
    },
    reached: ["Card", "Page"],
    codes: [],
  },
  {
    name: "a component rendered from a map function expression is reached",
    files: {
      [ENTRY]: `import { Card } from "@/components/Card";
        const ITEMS = [{ title: "One" }];
        export default function Page() {
          return <main>{ITEMS.map(function (item) { return <Card>{item.title}</Card>; })}</main>;
        }`,
      "components/Card.tsx": CARD,
    },
    reached: ["Card", "Page"],
    codes: [],
  },
  {
    name: "a component rendered from a callback named elsewhere is reached",
    files: {
      [ENTRY]: `import { Card } from "@/components/Card";
        const ITEMS = [{ title: "One" }];
        function renderCard(item: { title: string }) { return <Card>{item.title}</Card>; }
        export default function Page() {
          return <main>{ITEMS.map(renderCard)}</main>;
        }`,
      "components/Card.tsx": CARD,
    },
    reached: ["Card", "Page"],
    codes: [],
  },
  {
    name: "a callback named twice in one module is not guessed at",
    files: {
      [ENTRY]: `import { Card } from "@/components/Card";
        const ITEMS = [{ title: "One" }];
        function renderCard() { return <Card />; }
        export default function Page() {
          function renderCard() { return <h1>Live</h1>; }
          return <main>{ITEMS.map(renderCard)}</main>;
        }`,
      "components/Card.tsx": CARD,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a callback recursing through its own name terminates",
    files: {
      [ENTRY]: `import { Row } from "@/components/Row";
        const ITEMS = [{ children: [] }];
        function renderRow(item: { children: never[] }) {
          return <ul>{item.children.map(renderRow)}<Row /></ul>;
        }
        export default function Page() { return <main>{ITEMS.map(renderRow)}</main>; }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Page", "Row"],
    codes: [],
  },
  {
    // Where the result goes takes dataflow to answer, so it is named, not guessed.
    name: "a callback whose result is only bound to a name is refused out loud",
    files: {
      [ENTRY]: `import { Row } from "@/components/Row";
        const ITEMS = [{ label: "One" }];
        export default function Page() {
          const rows = ITEMS.map((item) => <Row><span>{item.label}</span></Row>);
          return <main>{rows}</main>;
        }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Page"],
    codes: ["UNRESOLVED_RENDER_TARGET"],
  },
  {
    name: "a callback whose result is rendered through a conditional is crossed",
    files: {
      [ENTRY]: `import { Row } from "@/components/Row";
        const ITEMS = [{ label: "One" }];
        export default function Page({ show }: { show: boolean }) {
          return <main>{show ? ITEMS.map(() => <Row />) : null}</main>;
        }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Page", "Row"],
    codes: [],
  },
  {
    name: "a callback whose result a chained call reads is crossed",
    files: {
      [ENTRY]: `import { Row } from "@/components/Row";
        const ITEMS = [{ on: true }];
        export default function Page() {
          return <main>{ITEMS.map(() => <Row />).slice(0, 2)}</main>;
        }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Page", "Row"],
    codes: [],
  },
  {
    name: "any call runs the function it is handed, not only map",
    files: {
      [ENTRY]: `import { Row } from "@/components/Row";
        function wrap(render: () => unknown) { return render(); }
        export default function Page() {
          return <main>{wrap(() => <Row />)}</main>;
        }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Page", "Row"],
    codes: [],
  },
  {
    /**
     * `List` does render what it is given, but nothing at the attribute says
     * so. Refusing here costs this case and buys every case below it.
     */
    name: "a component given a function is refused, even one that does render it",
    files: {
      [ENTRY]: `import { List } from "@/components/List";
        import { Row } from "@/components/Row";
        export default function Page() {
          return <main><List renderItem={() => <Row />} /></main>;
        }`,
      "components/List.tsx": `export function List({ renderItem }: { renderItem: () => unknown }) {
        return <section id="l">{renderItem()}</section>;
      }`,
      "components/Row.tsx": ROW,
    },
    reached: ["List", "Page"],
    codes: ["UNRESOLVED_RENDER_TARGET"],
  },
  {
    /** The counterexample: the DOM is handed the value and renders no part of it. */
    name: "a host element's handler renders nothing, and says nothing",
    files: {
      [ENTRY]: `import { Row } from "@/components/Row";
        export default function Page() {
          return <main><button onClick={() => <Row />}>Save</button></main>;
        }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    /** A component is as free to take a callback it never renders as one it does. */
    name: "a component's configuration callback is refused, not read as markup",
    files: {
      [ENTRY]: `import { Modal } from "@/components/Modal";
        import { Row } from "@/components/Row";
        export default function Page() {
          return <main><Modal onConfirm={() => <Row />} /></main>;
        }`,
      "components/Modal.tsx": `export function Modal({ onConfirm }: { onConfirm: () => unknown }) {
        return <section id="m"><button onClick={() => { onConfirm(); }}>Yes</button></section>;
      }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Modal", "Page"],
    codes: ["UNRESOLVED_RENDER_TARGET"],
  },
  {
    /**
     * The verdict and the report read the attribute through one helper, so a
     * spelling one sees is a spelling the other sees. Written twice, a cast
     * was followed by one reading and dropped in silence by the other.
     */
    name: "a cast makes no difference to which reading sees the attribute",
    files: {
      [ENTRY]: `import { List } from "@/components/List";
        import { Row } from "@/components/Row";
        type Render = () => JSX.Element;
        export default function Page() {
          return <main><List renderItem={((() => <Row />) as Render)} /></main>;
        }`,
      "components/List.tsx": `export function List({ renderItem }: { renderItem: () => unknown }) {
        return <section id="l">{renderItem()}</section>;
      }`,
      "components/Row.tsx": ROW,
    },
    reached: ["List", "Page"],
    codes: ["UNRESOLVED_RENDER_TARGET"],
  },
  {
    /**
     * A dotted tag is a member expression, which JSX resolves as a component
     * whatever its case, so `<motion.div />` is not a `div` and the DOM is not
     * provably what receives the value. Reading it as a host element would
     * spend silence on an unproven case, which is the drop nobody hears.
     */
    name: "a dotted tag is not a host element, however lowercase it looks",
    files: {
      [ENTRY]: `import { motion } from "framer-motion";
        import { Row } from "@/components/Row";
        export default function Page() {
          return <main><motion.div render={() => <Row />} /></main>;
        }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Page"],
    codes: ["UNRESOLVED_RENDER_TARGET"],
  },
  {
    /**
     * The refusal is scoped to functions that write JSX. Handlers are on nearly
     * every page and almost none write markup, so a rule that spoke about all
     * of them would bury the ones that matter.
     */
    name: "a callback that writes no JSX is not a decision for a human",
    files: {
      [ENTRY]: `import { Modal } from "@/components/Modal";
        export default function Page() {
          return <main><Modal onConfirm={() => "saved"} /></main>;
        }`,
      "components/Modal.tsx": `export function Modal({ onConfirm }: { onConfirm: () => unknown }) {
        return <section id="m"><button onClick={() => { onConfirm(); }}>Yes</button></section>;
      }`,
    },
    reached: ["Modal", "Page"],
    codes: [],
  },
  {
    /**
     * A component reached for real AND handed to a component elsewhere is still
     * reached. Narrowing a rule is where something real gets excluded.
     */
    name: "a refused attribute does not unreach a component rendered for real",
    files: {
      [ENTRY]: `import { Modal } from "@/components/Modal";
        import { Row } from "@/components/Row";
        export default function Page() {
          return <main><Row /><Modal onConfirm={() => <Row />} /></main>;
        }`,
      "components/Modal.tsx": `export function Modal({ onConfirm }: { onConfirm: () => unknown }) {
        return <section id="m"><button onClick={() => { onConfirm(); }}>Yes</button></section>;
      }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Modal", "Page", "Row"],
    codes: ["UNRESOLVED_RENDER_TARGET"],
  },
  {
    name: "an IIFE returning JSX is reached",
    files: {
      [ENTRY]: `import { Row } from "@/components/Row";
        export default function Page() {
          return <main>{(() => <Row />)()}</main>;
        }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Page", "Row"],
    codes: [],
  },
  {
    name: "a map nested inside a map is followed to the bottom",
    files: {
      [ENTRY]: `import { Group } from "@/components/Group";
        import { Row } from "@/components/Row";
        const GROUPS = [{ rows: [] }];
        export default function Page() {
          return (
            <main>
              {GROUPS.map((group) => (
                <Group>{group.rows.map(() => <Row />)}</Group>
              ))}
            </main>
          );
        }`,
      "components/Group.tsx": `export function Group({ children }: { children: React.ReactNode }) {
        return <section id="g">{children}</section>;
      }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Group", "Page", "Row"],
    codes: [],
  },
  {
    name: "a component declared inside a callback and rendered there is reached",
    files: {
      [ENTRY]: `const ITEMS = [{ label: "One" }];
        export default function Page() {
          return (
            <main>
              {ITEMS.map((item) => {
                const Cell = () => <span id="cell">{item.label}</span>;
                return <Cell />;
              })}
            </main>
          );
        }`,
    },
    reached: ["Cell", "Page"],
    codes: [],
  },
  {
    name: "a declaration inside a callback that nothing renders is still left out",
    files: {
      [ENTRY]: `import { Banner } from "@/components/Banner";
        import { Row } from "@/components/Row";
        const ITEMS = [{ label: "One" }];
        export default function Page() {
          return (
            <main>
              {ITEMS.map(() => {
                const UnusedPromo = () => <Banner />;
                return <Row />;
              })}
            </main>
          );
        }`,
      "components/Banner.tsx": BANNER,
      "components/Row.tsx": ROW,
    },
    reached: ["Page", "Row"],
    codes: [],
  },
  {
    name: "a component a callback renders but cannot name is reported, not dropped",
    files: {
      [ENTRY]: `const ITEMS = [{ label: "One" }];
        export default function Page({ Icon }: { Icon: () => JSX.Element }) {
          return <main>{ITEMS.map(() => <Icon />)}</main>;
        }`,
    },
    reached: ["Page"],
    codes: ["UNRESOLVED_RENDER_TARGET"],
  },
];

/**
 * Running a function is not rendering what it returns. A call written as a
 * statement throws its result away, so nothing the function wrote reaches the
 * browser. These are the shapes that run JSX and discard it, and none of them
 * is recognised by name.
 */
const DISCARDED_RESULT_CASES: readonly ReachabilityCase[] = [
  {
    name: "an effect runs its function and throws the result away",
    files: {
      [ENTRY]: `import { useEffect } from "react";
        import { Row } from "@/components/Row";
        export default function Page() {
          useEffect(() => <Row />);
          return <main><h1>Live</h1></main>;
        }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a timer runs its function and throws the result away",
    files: {
      [ENTRY]: `import { Row } from "@/components/Row";
        export default function Page() {
          setTimeout(() => <Row />, 0);
          return <main><h1>Live</h1></main>;
        }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "forEach returns nothing, so what its function writes renders nothing",
    files: {
      [ENTRY]: `import { Row } from "@/components/Row";
        const ITEMS = [{ label: "One" }];
        export default function Page() {
          ITEMS.forEach(() => <Row />);
          return <main><h1>Live</h1></main>;
        }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a component an effect discards is still reached where it really renders",
    files: {
      [ENTRY]: `import { useEffect } from "react";
        import { Row } from "@/components/Row";
        export default function Page() {
          useEffect(() => <Row />);
          return <main><Row /></main>;
        }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Page", "Row"],
    codes: [],
  },
  {
    // A filter callback returning JSX makes every item truthy, so the filter is
    // already a no-op. Nothing in the syntax tells it from `map`, and telling
    // them apart by name is the enumeration this rule refuses.
    name: "a filter callback is read as a map callback, which is the known limit",
    files: {
      [ENTRY]: `import { Row } from "@/components/Row";
        const ITEMS = [{ on: true }];
        export default function Page() {
          return <main>{ITEMS.filter(() => <Row />)}</main>;
        }`,
      "components/Row.tsx": ROW,
    },
    reached: ["Page", "Row"],
    codes: [],
  },
];

/**
 * `memo`, `forwardRef`, `lazy` and `dynamic` are handed a function like any
 * other call, but they build a component out of it instead of rendering what it
 * returns. What gives them away is what the call's RESULT becomes, so no list
 * of wrapper names decides this and none can fall behind.
 */
const COMPONENT_WRAPPER_CASES: readonly ReachabilityCase[] = [
  {
    name: "a memo-wrapped declaration nothing renders is left out",
    files: {
      [ENTRY]: `import { memo } from "react";
        import { Banner } from "@/components/Banner";
        export default function Page() {
          const UnusedPromo = memo(() => <Banner />);
          return <main><h1>Live</h1></main>;
        }`,
      "components/Banner.tsx": BANNER,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a forwardRef-wrapped declaration nothing renders is left out",
    files: {
      [ENTRY]: `import { forwardRef } from "react";
        import { Banner } from "@/components/Banner";
        export default function Page() {
          const UnusedField = forwardRef(() => <Banner />);
          return <main><h1>Live</h1></main>;
        }`,
      "components/Banner.tsx": BANNER,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a dynamic-style wrapper with options is left out",
    files: {
      [ENTRY]: `import dynamic from "next/dynamic";
        import { Banner } from "@/components/Banner";
        export default function Page() {
          const UnusedChart = dynamic(() => <Banner />, { ssr: false });
          return <main><h1>Live</h1></main>;
        }`,
      "components/Banner.tsx": BANNER,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "memo around forwardRef is still one component declaration",
    files: {
      [ENTRY]: `import { forwardRef, memo } from "react";
        import { Banner } from "@/components/Banner";
        export default function Page() {
          const UnusedField = memo(forwardRef(() => <Banner />));
          return <main><h1>Live</h1></main>;
        }`,
      "components/Banner.tsx": BANNER,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a wrapper result cast to a type is still a component declaration",
    files: {
      [ENTRY]: `import { memo } from "react";
        import { Banner } from "@/components/Banner";
        export default function Page() {
          const UnusedPromo = memo(() => <Banner />) as () => JSX.Element;
          return <main><h1>Live</h1></main>;
        }`,
      "components/Banner.tsx": BANNER,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a memo-wrapped component that IS rendered is reported, never guessed",
    files: {
      [ENTRY]: `import { memo } from "react";
        export default function Page() {
          const Badge = memo(() => <span id="badge">New</span>);
          return <main><Badge /></main>;
        }`,
    },
    reached: ["Page"],
    codes: ["UNRESOLVED_RENDER_TARGET"],
  },
  {
    name: "a non-ASCII component name is a declaration when a wrapper builds it",
    files: {
      [ENTRY]: `import { memo } from "react";
        import { Banner } from "@/components/Banner";
        export default function Page() {
          const Élan = memo(() => <Banner />);
          return <main><h1>Live</h1></main>;
        }`,
      "components/Banner.tsx": BANNER,
    },
    reached: ["Page"],
    codes: [],
  },
  {
    name: "a function stored on an object is not a call away from rendering",
    files: {
      [ENTRY]: `import { Banner } from "@/components/Banner";
        export default function Page() {
          const slots = { promo: () => <Banner /> };
          return <main><h1>Live</h1></main>;
        }`,
      "components/Banner.tsx": BANNER,
    },
    reached: ["Page"],
    codes: [],
  },
];

/**
 * Every case is judged before anything is reported, because a rule change
 * usually moves several at once and stopping at the first hides which.
 */
function assertCases(cases: readonly ReachabilityCase[]): void {
  const wrong: string[] = [];
  for (const entry of cases) {
    const outcome = renderTreeOf(entry.files);
    const reached = outcome.reached.join(", ");
    const codes = outcome.codes.join(", ");
    if (reached !== entry.reached.join(", ")) {
      wrong.push(`${entry.name}: reached [${reached}], wanted [${entry.reached.join(", ")}]`);
    }
    if (codes !== entry.codes.join(", ")) {
      wrong.push(`${entry.name}: findings [${codes}], wanted [${entry.codes.join(", ")}]`);
    }
  }
  assert.deepEqual(wrong, [], `${wrong.length} of ${cases.length} cases disagree`);
}

test("the render tree is followed where it can be, and named where it cannot", () => {
  assertCases(REACHABILITY_CASES);
});

test("a component a callback renders is on the page, so it is reached", () => {
  assertCases(INVOKED_CALLBACK_CASES);
});

test("a call that runs a function and discards its result has rendered nothing", () => {
  assertCases(DISCARDED_RESULT_CASES);
});

test("a call that builds a component out of a function has not rendered it", () => {
  assertCases(COMPONENT_WRAPPER_CASES);
});

interface ExtractionCase {
  readonly name: string;
  readonly source: string;
  readonly anchors: readonly string[];
  readonly codes: readonly FindingCode[];
}

function extractionOf(source: string): Omit<ExtractionCase, "name" | "source"> {
  const extracted = extractModule(source);
  return {
    anchors: extracted.candidates.map((candidate) => renderAnchor(candidate.anchor)).sort(),
    codes: extracted.findings.map((finding) => finding.code),
  };
}

/**
 * The extractor reads the same boundary but anchors what it finds to a
 * position, so it admits only the trigger that has one. What a call runs may
 * render any number of times, and a field pinned to one place for markup that
 * appears in several is worse than the refusal it replaces.
 */
const EXTRACTION_CASES: readonly ExtractionCase[] = [
  {
    /**
     * Not anchored here, and not reported here either: the render walk reads
     * every component this one does and names the attribute once, so saying it
     * again under an anchor would file one gap as two decisions.
     */
    name: "a function given to a component is not anchored to the element",
    source: `export function Page() {
      return <main><Panel renderFooter={() => <span>Footer note.</span>} /></main>;
    }`,
    anchors: [],
    codes: [],
  },
  {
    name: "a function behind a cast is refused by the same reading, not anchored",
    source: `type Render = () => JSX.Element;
    export function Page() {
      return <main><Panel renderFooter={(() => <span>Footer note.</span>) as Render} /></main>;
    }`,
    anchors: [],
    codes: [],
  },
  {
    /**
     * A host element's handler is settled, so nothing inside it is content. The
     * button's own label still is, which is the half a blunter rule would take
     * with it.
     */
    name: "markup written in a host element's handler is never customer content",
    source: `export function Page() {
      return <main><button onClick={() => <span>Never shown</span>}>Save</button></main>;
    }`,
    anchors: ["component:Page/region:main/role:button/text"],
    codes: [],
  },
  {
    name: "a map hoisted out of the JSX is refused, not placed where it does not render",
    source: `const ITEMS = [{ title: "One" }];
    export function Page() {
      const rows = ITEMS.map(() => <p>Fixed prose</p>);
      return <main><section id="s">{rows}</section></main>;
    }`,
    anchors: [],
    codes: ["NON_LITERAL_VALUE"],
  },
  {
    name: "a map template behind a cast still reads its item properties",
    source: `const ITEMS = [{ title: "One" }, { title: "Two" }];
    export function Page() {
      return <section id="s">{ITEMS.map((item) => (<p>{item.title}</p>) as JSX.Element)}</section>;
    }`,
    anchors: ["component:Page/region:s/each:ITEMS"],
    codes: [],
  },
];

test("the extractor reads every position it can anchor, and refuses the rest by name", () => {
  const wrong: string[] = [];
  for (const entry of EXTRACTION_CASES) {
    const outcome = extractionOf(entry.source);
    if (outcome.anchors.join(", ") !== entry.anchors.join(", ")) {
      wrong.push(`${entry.name}: anchors [${outcome.anchors.join(", ")}]`);
    }
    if (outcome.codes.join(", ") !== entry.codes.join(", ")) {
      wrong.push(`${entry.name}: findings [${outcome.codes.join(", ")}]`);
    }
  }
  assert.deepEqual(wrong, [], `${wrong.length} of ${EXTRACTION_CASES.length} cases disagree`);
});

test("only what a route renders becomes an editable field", () => {
  const proposal = run(workspace("reachability", null));

  // Home renders Feature, which renders Detail; Barrelled arrives through a barrel.
  // Detail's nested Badge is rendered, so it is proposed once, under its own name.
  assert.deepEqual(sourceDocumentOf(proposal, "src/content/pages/home.json"), {
    feature: { feature: { h2: { text: "Rendered feature" } } },
    detail: { detail: { p: { text: "Reached through Feature." } } },
    badge: { span: { badge: { text: "New" } } },
    barrelled: { barrelled: { p: { text: "Reached through a barrel file." } } },
  });

  // The layout wraps every route, so what it renders is site-scoped.
  assert.deepEqual(sourceDocumentOf(proposal, "src/content/site.json"), {
    siteFooter: {
      footer: {
        h2: { text: "Footer heading" },
        p: { text: "Rendered only by the layout." },
      },
    },
  });
});

/**
 * Every shape of declaration nothing renders: exported beside a page, exported
 * beside a component, nested in a page, nested in a layout, and a lowercase
 * helper. None may reach the customer, and none is a decision for a human.
 */
const UNRENDERED_MARKERS: readonly string[] = [
  "Never rendered",
  "Never shown from the page",
  "Never shown from the layout",
  "Never shown from a helper",
];

test("what nothing renders is left out, and is not a decision for a human", () => {
  const proposal = run(workspace("reachability", null));
  const documents = JSON.stringify([...proposal.sourceDocuments.values()]);
  for (const marker of UNRENDERED_MARKERS) {
    assert.ok(!documents.includes(marker), `'${marker}' was proposed as customer content`);
    for (const finding of proposal.report.findings) {
      assert.ok(!finding.evidence.includes(marker), `'${marker}' was reported: ${finding.code}`);
    }
  }
});

test("a route whose tree cannot be followed proposes nothing and says so", () => {
  const proposal = run(workspace("reachability", null));
  const located = (code: FindingCode): readonly string[] =>
    findingsOf(proposal, code).map((finding) => finding.location?.file ?? "");

  assert.ok(
    located("UNRESOLVED_RENDER_TARGET").some((file) => file.endsWith("dynamic/page.tsx")),
  );
  assert.ok(
    located("UNRESOLVED_RENDER_TARGET").some((file) => file.endsWith("anonymous/page.tsx")),
  );
  // The import is reported against the module that writes it, not the entry route.
  assert.ok(located("UNRESOLVED_COMPONENT").some((file) => file.endsWith("missing/page.tsx")));

  for (const slug of ["dynamic", "missing", "anonymous"]) {
    assert.equal(
      proposal.sourceDocuments.get(`src/content/pages/${slug}.json`),
      undefined,
      `${slug} proposed a value from a tree it could not follow`,
    );
  }
});

test("a component rendered only by the layout is proposed once, for every route", () => {
  const proposal = run(workspace("reachability", null));
  const scope = findingsOf(proposal, "SCOPE_NOT_OBSERVABLE");
  assert.equal(scope.length, 2, "one per value the layout renders on every route");
  for (const finding of scope) {
    assert.ok(finding.location?.file.endsWith("components/SiteFooter.tsx"));
  }
});

/** Collection item IDs are minted per run by design, so they carry no identity here. */
function withMintedIdsMasked(document: JsonObject): unknown {
  return JSON.parse(JSON.stringify(document).replace(/item_[a-z0-9]+/gu, "item_x")) as unknown;
}

/**
 * The shape that used to fail in silence: the collection reads item properties,
 * so it is proposed cleanly, and the component the template renders carries
 * literal markup of its own that nothing pointed a human at.
 *
 * The whole document is pinned, so several failures land here as well: markup
 * placed under the page that maps over it, anything an effect discards reaching
 * a customer, a component rendered both for real and inside an effect being
 * proposed twice, and markup a host element's handler writes being offered as
 * customer content.
 */
test("a component rendered from a callback contributes its own markup", () => {
  const proposal = run(workspace("callbacks", null));
  const home = sourceDocumentOf(proposal, "src/content/pages/home.json");
  assert.deepEqual(withMintedIdsMasked(home), {
    home: {
      main: {
        offers: {
          h2: { text: "What you get" },
          offers: {
            collection: {
              order: { orderedItemIds: ["item_x", "item_x"] },
              items: [
                { id: "item_x", title: "Survey" },
                { id: "item_x", title: "Publish" },
              ],
            },
          },
        },
        // Neither span is here: what `Panel` does with the function it is given
        // is not readable from the attribute, and a handler's return value is
        // never markup. The button's own label is content and stays.
        button: { text: "Save" },
      },
    },
    // Reached only through the map callback, and proposed under its own name.
    card: { card: { p: { text: "Included with every offer." } } },
    panel: { panel: { h2: { text: "How it works" } } },
  });

  // The refusals are not silent where they are not settled: `Panel` is named
  // once, and nothing points a human at the handler, which is settled.
  const refused = findingsOf(proposal, "UNRESOLVED_RENDER_TARGET");
  assert.equal(refused.length, 1, "one decision, for the one attribute nothing here can read");
  assert.ok(refused[0]?.evidence.includes("renderFooter"), refused[0]?.evidence);
  for (const finding of proposal.report.findings) {
    assert.ok(
      !finding.evidence.includes("Never shown from a handler"),
      `a settled refusal was filed as a decision: ${finding.code}`,
    );
  }
});

const SEO_CONFIG = {
  contentRoot: "src/content",
  assetRoot: "public",
  bridge: {
    version: "v10",
    src: "https://app.gomega.ai/review-bridge/v10/review-bridge.js",
    integrity: "sha384-/+5J7l1l8JNgnIgvgOqEHDgx92NrGmbjezpRb/MZb2y0RildsCcaOVu8+mLZbrmF",
    crossOrigin: "anonymous",
    load: "head_defer",
  },
  businessIdentity: {
    legalName: "Fixture Ltd",
    displayName: "Fixture",
    telephone: "+15555550100",
    email: "hello@example.com",
    description: "A fixture business.",
    sameAs: [],
  },
  pages: Object.fromEntries(
    ["/", "/anonymous", "/dynamic", "/missing"].map((route) => [
      route,
      {
        purpose: "landing",
        canonical: `https://example.com${route}`,
        sitemap: { included: true, changeFrequency: "monthly", priority: 0.5 },
        performanceBudget: {
          maxLcpMilliseconds: 2500,
          maxCls: 0.1,
          maxInpMilliseconds: 200,
          maxPageBytes: 2097152,
        },
      },
    ]),
  ),
};

test("a heading the layout renders is in the outline of every route it wraps", () => {
  const proposal = run(workspace("reachability", SEO_CONFIG));
  assert.equal(proposal.validationError, null);
  const pages = proposal.contract?.internalSeo.pages ?? [];
  assert.equal(pages.length, 4);
  for (const page of pages) {
    assert.ok(
      page.headingOutline.some((entry) => entry.semanticLevel === 2),
      "the layout's heading is missing from a route it renders on",
    );
  }
});

/**
 * A sibling directory whose name merely STARTS with the app directory's.
 *
 * The layout walk asked `directory.startsWith(appDirectory)`, so a file under
 * `apples/` counted as being under `app/` and picked up that sibling's
 * `layout.tsx` -- fields from a tree the route never renders. Same defect as
 * the output-directory exclusion in `name-anchors.ts`; both now ask
 * `containsPath`, which requires a path-component boundary.
 */
for (const sibling of ["apples", "app-legacy", "appendix/deep"] as const) {
  test(`a layout under ${sibling} is not in an app route's chain`, () => {
    const root = mkdtempSync(join(tmpdir(), "layout-boundary-"));
    const files: Record<string, string> = {
      "app/page.tsx": "export default function Page() {\n  return <p>Hello</p>;\n}\n",
      [`${sibling}/layout.tsx`]:
        "export default function Wrong({ children }: { children: React.ReactNode }) {\n" +
        "  return <div>{children}</div>;\n}\n",
      [`${sibling}/page.tsx`]: "export default function Other() {\n  return <p>Other</p>;\n}\n",
    };
    for (const [relative, text] of Object.entries(files)) {
      const file = join(root, relative);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text, "utf8");
    }
    const chain = discoverLayoutChain(root, join(root, sibling, "page.tsx"));
    assert.deepEqual(chain, [], `${sibling} borrowed the app/ walk`);
  });
}

/** A real layout IS found, so the rows above fail for the reason they claim. */
test("a layout in the route's own directory is in the chain", () => {
  const root = mkdtempSync(join(tmpdir(), "layout-boundary-"));
  for (const [relative, text] of Object.entries({
    "app/page.tsx": "export default function Page() {\n  return <p>Hello</p>;\n}\n",
    "app/layout.tsx":
      "export default function Root({ children }: { children: React.ReactNode }) {\n" +
      "  return <div>{children}</div>;\n}\n",
  })) {
    const file = join(root, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  assert.deepEqual(discoverLayoutChain(root, join(root, "app/page.tsx")), [
    join(root, "app/layout.tsx"),
  ]);
});
