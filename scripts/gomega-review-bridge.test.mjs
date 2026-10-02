import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL(
  "../src/components/analytics/GomegaReviewBridge.tsx",
  import.meta.url
);
const layoutPath = new URL("../src/app/layout.tsx", import.meta.url);
const bridgeSource = "https://app.gomega.ai/review-bridge/v10/review-bridge.js";
const bridgeIntegrity =
  "sha384-/+5J7l1l8JNgnIgvgOqEHDgx92NrGmbjezpRb/MZb2y0RildsCcaOVu8+mLZbrmF";

test("renders the credential-free Gomega review bridge in the initial HTML", async () => {
  const component = await readFile(componentPath, "utf8");

  assert.ok(component.includes(bridgeSource));
  assert.ok(component.includes(bridgeIntegrity));
  assert.doesNotMatch(component, /from "next\/script"/u);
  assert.match(component, /<script/u);
  assert.match(component, /src=\{GOMEGA_REVIEW_BRIDGE_SOURCE\}/u);
  assert.match(component, /integrity=\{GOMEGA_REVIEW_BRIDGE_INTEGRITY\}/u);
  assert.match(component, /crossOrigin="anonymous"/u);
  assert.match(component, /\bdefer\b/u);
  assert.doesNotMatch(component, /\bstrategy=/u);
});

test("mounts the bridge once in the root layout head", async () => {
  const layout = await readFile(layoutPath, "utf8");

  assert.match(
    layout,
    /import \{ GomegaReviewBridge \} from "@\/components\/analytics\/GomegaReviewBridge";/u
  );
  assert.equal((layout.match(/<GomegaReviewBridge \/>/gu) ?? []).length, 1);
  assert.match(layout, /<head>[\s\S]*<GomegaReviewBridge \/>[\s\S]*<\/head>/u);
  assert.doesNotMatch(layout, /<body[\s\S]*<GomegaReviewBridge/u);
});
