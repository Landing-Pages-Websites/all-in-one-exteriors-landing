import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFormIdentityProblems } from "./form-identity.mjs";

/**
 * Builds a minimal site tree: a config declaring `keys`, and one `.tsx` per
 * entry in `renders` containing the LeadForm markup given.
 */
function site({
  keys,
  renders = [],
  withDefaultConstant = true,
  configPrologue = "",
  rawConfig = null,
}) {
  const root = mkdtempSync(join(tmpdir(), "form-identity-"));
  mkdirSync(join(root, "src/lib"), { recursive: true });
  mkdirSync(join(root, "src/components"), { recursive: true });
  const declared =
    keys === null
      ? ""
      : `  formKeys: [${keys.map((k) => `"${k}"`).join(", ")}],\n`;
  writeFileSync(
    join(root, "src/site.config.ts"),
    rawConfig ??
      `${configPrologue}export const siteConfig = {\n${declared}};\n`,
  );
  if (withDefaultConstant) {
    writeFileSync(
      join(root, "src/lib/leadValidation.ts"),
      'export const DEFAULT_FORM_KEY = "contact-form";\n',
    );
  }
  renders.forEach((markup, index) => {
    const spec =
      typeof markup === "string" ? { markup, imports: null } : markup;
    const imports =
      spec.imports ?? 'import { LeadForm } from "@/components/LeadForm";\n';
    for (const [path, contents] of Object.entries(spec.alsoWrite ?? {})) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), contents);
    }
    writeFileSync(
      join(root, `src/components/Form${index}.tsx`),
      `${imports}export function F${index}() {\n  return ${spec.markup};\n}\n`,
    );
  });
  return root;
}

test("a one-form site relying on the default is complete", async () => {
  const problems = await collectFormIdentityProblems(
    site({ keys: ["contact-form"], renders: ["<LeadForm />"] }),
  );
  assert.deepEqual(problems, []);
});

test("a multi-form site naming each form is complete", async () => {
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form", "careers-application"],
      renders: ["<LeadForm />", '<LeadForm formKey="careers-application" />'],
    }),
  );
  assert.deepEqual(problems, []);
});

test("two unnamed forms are refused, and the message names the files", async () => {
  // The whole failure this gate exists for: both register as contact-form, so
  // one routing rule serves both and nothing can tell a lead's origin.
  const problems = await collectFormIdentityProblems(
    site({ keys: ["contact-form"], renders: ["<LeadForm />", "<LeadForm />"] }),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /2 forms all send the form key "contact-form"/);
  assert.match(problems[0], /Form0\.tsx/);
  assert.match(problems[0], /Form1\.tsx/);
});

test("one named form beside an unnamed one is two distinct keys", async () => {
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form", "careers-application"],
      renders: ['<LeadForm formKey="careers-application" />', "<LeadForm />"],
    }),
  );
  assert.equal(problems.length, 0);
});

test("a rendered key the config does not declare is refused", async () => {
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form"],
      renders: ['<LeadForm formKey="quote-request" />'],
    }),
  );
  assert.ok(
    problems.some((p) => /sends the form key "quote-request"/.test(p)),
    problems.join("\n"),
  );
});

test("a declared key no form sends is refused", async () => {
  // Otherwise the customer configures recipients on a form that can never
  // receive a lead.
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form", "newsletter"],
      renders: ["<LeadForm />"],
    }),
  );
  assert.ok(
    problems.some((p) => /declares "newsletter" but no form sends it/.test(p)),
    problems.join("\n"),
  );
});

test("a key MEGA would reject is refused here instead", async () => {
  for (const bad of ["Careers Application", "-leading-hyphen", "trailing_"]) {
    const problems = await collectFormIdentityProblems(
      site({ keys: ["contact-form", bad], renders: ["<LeadForm />"] }),
    );
    assert.ok(
      problems.some((p) => p.includes(`formKeys contains "${bad}"`)),
      `${bad} was accepted: ${problems.join("\n")}`,
    );
  }
});

test("a duplicated key is refused", async () => {
  const problems = await collectFormIdentityProblems(
    site({ keys: ["contact-form", "contact-form"], renders: ["<LeadForm />"] }),
  );
  assert.ok(
    problems.some((p) => /lists "contact-form" twice/.test(p)),
    problems.join("\n"),
  );
});

test("a site with no formKeys at all is refused with an actionable fix", async () => {
  const problems = await collectFormIdentityProblems(
    site({ keys: null, renders: ["<LeadForm />"] }),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no formKeys declared/);
  assert.match(problems[0], /formKeys: \["contact-form"\]/);
});

test("multi-line and prop-carrying LeadForm renders are still seen", async () => {
  // A real site writes these across lines with other props; a matcher that
  // only saw `<LeadForm />` would report a single-form site and pass.
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form"],
      renders: [
        '(\n    <LeadForm\n      className="w-full"\n    />\n  )',
        '(\n    <LeadForm\n      className="w-full"\n    />\n  )',
      ],
    }),
  );
  assert.ok(
    problems.some((p) => /2 forms all send the form key/.test(p)),
    problems.join("\n"),
  );
});

test("two forms explicitly given the same key are refused", async () => {
  // The shape the earlier "does any form lack a key" rule could not see.
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form", "careers-application"],
      renders: [
        '<LeadForm formKey="careers-application" />',
        '<LeadForm formKey="careers-application" />',
      ],
    }),
  );
  assert.ok(
    problems.some((p) =>
      /2 forms all send the form key "careers-application"/.test(p),
    ),
    problems.join("\n"),
  );
});

test("a formKeys inside a comment is not configuration", async () => {
  // Review finding. A regex over the text took the first `formKeys: [...]` it
  // saw, so a documentation comment listing extra keys made the gate accept a
  // form the real config never declared — and MEGA then replaced that key
  // with contact-form, collapsing the form into default routing.
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form"],
      configPrologue: '// formKeys: ["contact-form", "quote"]\n',
      renders: ['<LeadForm formKey="quote" />'],
    }),
  );
  assert.ok(
    problems.some((p) => /sends the form key "quote"/.test(p)),
    problems.join("\n"),
  );
});

test("a formKeys inside a block comment is not configuration either", async () => {
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form"],
      configPrologue: '/*\n * formKeys: ["contact-form", "quote"]\n */\n',
      renders: ['<LeadForm formKey="quote" />'],
    }),
  );
  assert.ok(
    problems.some((p) => /sends the form key "quote"/.test(p)),
    problems.join("\n"),
  );
});

test("an unkeyed form must have its default key declared too", async () => {
  // Review finding. Membership was checked only for explicit props, so
  // `formKeys: ["careers-application"]` with an unkeyed form beside a keyed
  // one passed — while the unkeyed one submitted an undeclared contact-form
  // and MEGA registered a routing identity the config never mentioned.
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["careers-application"],
      renders: ["<LeadForm />", '<LeadForm formKey="careers-application" />'],
    }),
  );
  assert.ok(
    problems.some((p) =>
      /sends the form key "contact-form" \(the default/.test(p),
    ),
    problems.join("\n"),
  );
});

test("a commented-out LeadForm renders nothing", async () => {
  // The same defect as the config one, in the other half of the gate: a
  // commented-out render counted as a form and reported a collision that does
  // not exist, which would block a legitimate build.
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form"],
      renders: [
        "<LeadForm />",
        "(\n    <>\n      {/* <LeadForm /> */}\n    </>\n  )",
      ],
    }),
  );
  assert.deepEqual(problems, []);
});

test("a LeadForm inside a string renders nothing", async () => {
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form"],
      renders: ["<LeadForm />", '<pre>{"<LeadForm />"}</pre>'],
    }),
  );
  assert.deepEqual(problems, []);
});

test("formKeys with `as const` is read", async () => {
  const problems = await collectFormIdentityProblems(
    site({
      rawConfig:
        'export const siteConfig = {\n  formKeys: ["contact-form"] as const,\n};\n',
      keys: ["contact-form"],
      renders: ["<LeadForm />"],
    }),
  );
  assert.deepEqual(problems, []);
});

test("a formKey prop that is not a literal is reported, never assumed absent", async () => {
  // Treating it as absent would silently grade the form as sending the
  // default, which may be wrong in either direction.
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form"],
      renders: ["<LeadForm formKey={chosenKey} />"],
    }),
  );
  assert.ok(
    problems.some((p) => /formKey is not a string literal/.test(p)),
    problems.join("\n"),
  );
});

test("a formKeys element that is not a string literal is reported", async () => {
  const problems = await collectFormIdentityProblems(
    site({
      rawConfig:
        'const extra = "quote";\nexport const siteConfig = {\n  formKeys: ["contact-form", extra],\n};\n',
      keys: ["contact-form"],
      renders: ["<LeadForm />"],
    }),
  );
  assert.ok(
    problems.some((p) => /not a string literal/.test(p)),
    problems.join("\n"),
  );
});

test("a site with no site.config.ts at all is not this gate's business", async () => {
  // A legacy site has no config seam by definition. This gate ships inside
  // starter-derived repos, but the fixture proves it does not invent a problem
  // where there is no file to read.
  const root = mkdtempSync(join(tmpdir(), "form-identity-"));
  mkdirSync(join(root, "src/components"), { recursive: true });
  assert.deepEqual(await collectFormIdentityProblems(root), []);
});

test("a formKey supplied through a JSX spread is refused, not read as absent", async () => {
  // Review finding. The spread was skipped and the form graded as sending the
  // default, so a second explicit careers form passed the collision gate while
  // both actually submitted the careers key.
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form", "careers-application"],
      renders: [
        '<LeadForm {...{ formKey: "careers-application" }} />',
        '<LeadForm formKey="careers-application" />',
      ],
    }),
  );
  assert.ok(
    problems.some((p) => /spreads .* into a LeadForm/.test(p)),
    problems.join("\n"),
  );
});

test("a spread that could override an explicit formKey is refused too", async () => {
  // JSX order decides, so a later spread wins over an earlier explicit prop.
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form"],
      renders: ['<LeadForm formKey="contact-form" {...extra} />'],
    }),
  );
  assert.ok(
    problems.some((p) => /spreads extra into a LeadForm/.test(p)),
    problems.join("\n"),
  );
});

test("formKeys on a helper object is not the site's declaration", async () => {
  // Review finding. Runtime reads `siteConfig.formKeys` and only that, so any
  // other object named the same is not configuration.
  const problems = await collectFormIdentityProblems(
    site({
      rawConfig:
        'const defaults = { formKeys: ["contact-form", "quote"] };\n' +
        'export const siteConfig = { ...{}, formKeys: ["contact-form"] };\n',
      keys: ["contact-form"],
      renders: ['<LeadForm formKey="quote" />'],
    }),
  );
  assert.ok(
    problems.some((p) => /spreads/.test(p) || /"quote"/.test(p)),
    problems.join("\n"),
  );
});

test("a helper object's formKeys does not satisfy the declaration", async () => {
  const problems = await collectFormIdentityProblems(
    site({
      rawConfig:
        'const defaults = { formKeys: ["contact-form", "quote"] };\n' +
        'export const siteConfig = { formKeys: ["contact-form"] };\n',
      keys: ["contact-form"],
      renders: ['<LeadForm formKey="quote" />'],
    }),
  );
  assert.ok(
    problems.some((p) => /sends the form key "quote"/.test(p)),
    problems.join("\n"),
  );
});

test("an aliased import of LeadForm is still a LeadForm", async () => {
  // Review finding. `import { LeadForm as ApplicationForm }` renders the same
  // component, and matching the tag text alone made it invisible.
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form"],
      renders: [
        {
          imports:
            'import { LeadForm as ApplicationForm } from "@/components/LeadForm";\n',
          markup: "<ApplicationForm />",
        },
        "<LeadForm />",
      ],
    }),
  );
  assert.ok(
    problems.some((p) =>
      /2 forms all send the form key "contact-form"/.test(p),
    ),
    problems.join("\n"),
  );
});

test("a namespace import of LeadForm's module is refused, not ignored", async () => {
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form"],
      renders: [
        {
          imports: 'import * as Forms from "@/components/LeadForm";\n',
          markup: "<Forms.LeadForm />",
        },
      ],
    }),
  );
  assert.ok(
    problems.some((p) => /namespace/.test(p)),
    problems.join("\n"),
  );
});

test("a component merely named LeadForm from elsewhere is not this one", async () => {
  // Name boundaries: a different component of the same name is a different
  // component, and grading it would report a collision that cannot happen.
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form"],
      renders: [
        "<LeadForm />",
        {
          imports:
            'import { LeadForm } from "@/components/marketing/LeadForm";\n',
          markup: "<LeadForm />",
          alsoWrite: {
            "src/components/marketing/LeadForm.tsx":
              "export function LeadForm() {\n  return null;\n}\n",
          },
        },
      ],
    }),
  );
  assert.deepEqual(problems, []);
});

test("a duplicated formKeys property reads the one runtime would use", async () => {
  // Last wins in an object literal, so reading the first would grade the site
  // against a value it does not use.
  const problems = await collectFormIdentityProblems(
    site({
      rawConfig:
        'export const siteConfig = {\n  formKeys: ["quote-request"],\n  formKeys: ["contact-form"],\n};\n',
      keys: ["contact-form"],
      renders: ["<LeadForm />"],
    }),
  );
  assert.deepEqual(problems, []);
});

test("a siteConfig built by a call is refused rather than graded as empty", async () => {
  const problems = await collectFormIdentityProblems(
    site({
      rawConfig:
        'export const siteConfig = buildConfig({ formKeys: ["contact-form"] });\n',
      keys: ["contact-form"],
      renders: ["<LeadForm />"],
    }),
  );
  assert.ok(
    problems.some((p) => /not an object literal/.test(p)),
    problems.join("\n"),
  );
});

test("a siteConfig that is not exported is refused", async () => {
  const problems = await collectFormIdentityProblems(
    site({
      rawConfig: 'const siteConfig = { formKeys: ["contact-form"] };\n',
      keys: ["contact-form"],
      renders: ["<LeadForm />"],
    }),
  );
  assert.ok(
    problems.some((p) => /no exported `siteConfig`/.test(p)),
    problems.join("\n"),
  );
});

test("formKeys as a computed string property is still read", async () => {
  const problems = await collectFormIdentityProblems(
    site({
      rawConfig:
        'export const siteConfig = { ["formKeys"]: ["contact-form"] };\n',
      keys: ["contact-form"],
      renders: ["<LeadForm />"],
    }),
  );
  assert.deepEqual(problems, []);
});

test("a formKeysExtra property is not formKeys", async () => {
  const problems = await collectFormIdentityProblems(
    site({
      rawConfig:
        'export const siteConfig = { formKeysExtra: ["quote"], formKeys: ["contact-form"] };\n',
      keys: ["contact-form"],
      renders: ["<LeadForm />"],
    }),
  );
  assert.deepEqual(problems, []);
});

test("a relative import of the local component is resolved, not skipped", async () => {
  // Review finding. The specifier was pattern-matched against
  // `components/LeadForm`, so a valid `../LeadForm` from a subdirectory was
  // skipped and that file's renders were never counted — two unnamed renders
  // both sent the default with no collision reported.
  const root = site({ keys: ["contact-form"], renders: ["<LeadForm />"] });
  mkdirSync(join(root, "src/components/home"), { recursive: true });
  writeFileSync(
    join(root, "src/components/LeadForm.tsx"),
    "export function LeadForm() {\n  return null;\n}\n",
  );
  writeFileSync(
    join(root, "src/components/home/Contact.tsx"),
    'import { LeadForm } from "../LeadForm";\n' +
      "export function Contact() {\n  return <LeadForm />;\n}\n",
  );

  const problems = await collectFormIdentityProblems(root);

  assert.ok(
    problems.some((p) =>
      /2 forms all send the form key "contact-form"/.test(p),
    ),
    problems.join("\n"),
  );
});

test("an in-repo import pointing at no file is reported, not assumed harmless", async () => {
  // It could be this component reached a way the resolver mishandles, which
  // must not read as "some other component".
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form"],
      renders: [
        "<LeadForm />",
        {
          imports:
            'import { LeadForm } from "@/components/nowhere/LeadForm";\n',
          markup: "<LeadForm />",
        },
      ],
    }),
  );
  assert.ok(
    problems.some((p) => /resolves to no file/.test(p)),
    problems.join("\n"),
  );
});

test("a package import named LeadForm is not reported", async () => {
  // A package is never this component, so it needs no report.
  const problems = await collectFormIdentityProblems(
    site({
      keys: ["contact-form"],
      renders: [
        "<LeadForm />",
        {
          imports: 'import { LeadForm } from "some-ui-kit";\n',
          markup: "<LeadForm />",
        },
      ],
    }),
  );
  assert.deepEqual(problems, []);
});

test("DEFAULT_FORM_KEY behind `as const` is read, not substituted", async () => {
  // Review finding. Accepting only a bare literal meant a valid
  // `= "careers-application" as const` graded every unkeyed form as
  // contact-form, hiding a real collision with an explicit careers form.
  const root = site({
    keys: ["careers-application"],
    renders: ["<LeadForm />", '<LeadForm formKey="careers-application" />'],
    withDefaultConstant: false,
  });
  mkdirSync(join(root, "src/lib"), { recursive: true });
  writeFileSync(
    join(root, "src/lib/leadValidation.ts"),
    'export const DEFAULT_FORM_KEY = "careers-application" as const;\n',
  );

  const problems = await collectFormIdentityProblems(root);

  assert.ok(
    problems.some((p) =>
      /2 forms all send the form key "careers-application"/.test(p),
    ),
    problems.join("\n"),
  );
});

test("a non-literal DEFAULT_FORM_KEY is reported, never assumed", async () => {
  const root = site({ keys: ["contact-form"], renders: ["<LeadForm />"] });
  writeFileSync(
    join(root, "src/lib/leadValidation.ts"),
    "export const DEFAULT_FORM_KEY = computeKey();\n",
  );

  const problems = await collectFormIdentityProblems(root);

  assert.ok(
    problems.some((p) => /will not assume a fallback key/.test(p)),
    problems.join("\n"),
  );
});

test("a computed siteConfig property it cannot resolve is refused", async () => {
  // Review finding. A later property wins at runtime, so ignoring an
  // unresolvable computed name let it override the declared list unseen.
  const problems = await collectFormIdentityProblems(
    site({
      rawConfig:
        'export const siteConfig = {\n  formKeys: ["contact-form", "careers-application"],\n  [`form${"Keys"}`]: ["contact-form"],\n};\n',
      keys: ["contact-form"],
      renders: ["<LeadForm />"],
    }),
  );
  assert.ok(
    problems.some((p) => /computed property .* cannot resolve/.test(p)),
    problems.join("\n"),
  );
});

test("a shorthand formKeys property is reported, not graded as absent", async () => {
  // Found by auditing my own remaining `continue` branches rather than waiting
  // for a sixth review round. `{ formKeys }` is a real declaration whose value
  // lives elsewhere, so skipping it would grade the site as declaring nothing.
  const problems = await collectFormIdentityProblems(
    site({
      rawConfig:
        'const formKeys = ["contact-form", "quote"];\nexport const siteConfig = { formKeys };\n',
      keys: ["contact-form"],
      renders: ["<LeadForm />"],
    }),
  );
  assert.ok(
    problems.some((p) => /shorthand property/.test(p)),
    problems.join("\n"),
  );
});

test("a nested DEFAULT_FORM_KEY does not shadow the exported one", async () => {
  // Review finding. Walking every declaration and keeping the last let a
  // nested `const DEFAULT_FORM_KEY = "contact-form"` win, so unkeyed forms
  // graded against a key the site never sends — hiding a real collision with
  // an explicit careers form.
  const root = site({
    keys: ["contact-form", "careers-application"],
    renders: ["<LeadForm />", '<LeadForm formKey="careers-application" />'],
  });
  writeFileSync(
    join(root, "src/lib/leadValidation.ts"),
    'export const DEFAULT_FORM_KEY = "careers-application";\n' +
      "export function unrelated() {\n" +
      '  const DEFAULT_FORM_KEY = "contact-form";\n' +
      "  return DEFAULT_FORM_KEY;\n" +
      "}\n",
  );

  const problems = await collectFormIdentityProblems(root);

  assert.ok(
    problems.some((p) =>
      /2 forms all send the form key "careers-application"/.test(p),
    ),
    problems.join("\n"),
  );
});

test("a non-exported DEFAULT_FORM_KEY is reported", async () => {
  // It is not the binding a form imports, so its value proves nothing.
  const root = site({ keys: ["contact-form"], renders: ["<LeadForm />"] });
  writeFileSync(
    join(root, "src/lib/leadValidation.ts"),
    'const DEFAULT_FORM_KEY = "contact-form";\n',
  );

  const problems = await collectFormIdentityProblems(root);

  assert.ok(
    problems.some((p) =>
      /no top-level exported `const DEFAULT_FORM_KEY`/.test(p),
    ),
    problems.join("\n"),
  );
});

test("a mutable DEFAULT_FORM_KEY is reported", async () => {
  // `let` can be reassigned after export, so the initializer is not
  // necessarily the value a form sends.
  const root = site({ keys: ["contact-form"], renders: ["<LeadForm />"] });
  writeFileSync(
    join(root, "src/lib/leadValidation.ts"),
    'export let DEFAULT_FORM_KEY = "contact-form";\n',
  );

  const problems = await collectFormIdentityProblems(root);

  assert.ok(
    problems.some((p) => /declared with `let`/.test(p)),
    problems.join("\n"),
  );
});

test("a mutable siteConfig is reported", async () => {
  // The same rule, applied symmetrically rather than waiting for the review
  // that would have found it next.
  const problems = await collectFormIdentityProblems(
    site({
      rawConfig: 'export let siteConfig = { formKeys: ["contact-form"] };\n',
      keys: ["contact-form"],
      renders: ["<LeadForm />"],
    }),
  );
  assert.ok(
    problems.some((p) => /`siteConfig` is declared with `let`/.test(p)),
    problems.join("\n"),
  );
});
