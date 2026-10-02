/**
 * Form identity checks, split out of check-config so they can be driven over a
 * fixture tree. An unexercised build gate is a gate nobody knows has stopped
 * working.
 *
 * Everything here reads the site's SOURCE to decide what it will do at
 * runtime, so it parses rather than pattern-matches. A regex over the text
 * cannot tell a real `formKeys` property from one inside a comment, and cannot
 * tell a rendered `<LeadForm />` from a commented-out one. Both mistakes make
 * the gate pass a site whose forms actually collide, which is the one outcome
 * it exists to prevent.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Mirrors MEGA's own `FORM_KEY_PATTERN`. */
const FORM_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * The TypeScript parser, loaded on demand.
 *
 * A top-level import would kill this whole script wherever `typescript` cannot
 * be resolved, taking every unrelated check-config gate down with it — which
 * is what happened to `placeholder-assets.test.mjs`, whose fixture copies the
 * repo WITHOUT `node_modules`. Loaded here, an absent parser is a reportable
 * condition instead of a crash.
 */
let cachedTs;
async function loadTs() {
  if (cachedTs !== undefined) return cachedTs;
  try {
    cachedTs = (await import("typescript")).default;
  } catch {
    cachedTs = null;
  }
  return cachedTs;
}

function parseSource(ts, path, source) {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
}

/** Every `.tsx` under src/, relative to the repository root. */
function listSourceFiles(repositoryRoot) {
  const found = [];
  const walk = (relativeDir) => {
    const absolute = join(repositoryRoot, relativeDir);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const next = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".tsx")) found.push(next);
    }
  };
  walk("src");
  return found;
}

/**
 * MEGA's fallback key, read out of `leadValidation.ts` rather than copied.
 * A copy here would be a second statement of the contract, and the whole point
 * of this gate is that one form key means one form.
 */
function readDefaultFormKey(ts, repositoryRoot) {
  const path = join(repositoryRoot, "src/lib/leadValidation.ts");
  if (!existsSync(path)) {
    return {
      problem:
        "src/lib/leadValidation.ts: missing, so the key an unkeyed form falls " +
        "back to is unknown — collisions cannot be graded without it",
    };
  }
  // The TOP-LEVEL EXPORTED binding, and only that, because it is the one the
  // form imports. Walking every declaration and keeping the last let a nested
  // `const DEFAULT_FORM_KEY = "contact-form"` shadow the exported careers
  // value, so unkeyed forms graded against a key the site never sends. Same
  // rule the siteConfig reader already applies, which is where this should
  // have come from.
  const source = parseSource(ts, path, readFileSync(path, "utf8"));
  let declaration = null;
  let mutable = null;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (
      !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      continue;
    }
    for (const candidate of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(candidate.name) ||
        candidate.name.text !== "DEFAULT_FORM_KEY"
      ) {
        continue;
      }
      declaration = candidate;
      // `let` / `var` can be reassigned after export, so the initializer is
      // not the value the importer sees.
      // eslint-disable-next-line no-bitwise
      mutable =
        (statement.declarationList.flags & ts.NodeFlags.Const) === 0
          ? statement.declarationList.getText().split(" ")[0]
          : null;
    }
  }

  if (declaration === null || !declaration.initializer) {
    return {
      problem:
        "src/lib/leadValidation.ts: no top-level exported `const " +
        "DEFAULT_FORM_KEY` found — that is the binding a form imports, and " +
        "this gate cannot tell what an unkeyed form sends without it",
    };
  }
  if (mutable !== null) {
    return {
      problem:
        `src/lib/leadValidation.ts: DEFAULT_FORM_KEY is declared with \`${mutable}\`, ` +
        "so it can be reassigned after export and its initializer is not " +
        "necessarily the value a form sends — declare it `const`",
    };
  }
  // `as const` and `satisfies` are runtime-identical. Accepting only a bare
  // literal and substituting "contact-form" otherwise meant a valid
  // `= "careers-application" as const` graded every unkeyed form wrongly.
  const initializer = unwrap(ts, declaration.initializer);
  if (
    !ts.isStringLiteral(initializer) &&
    !ts.isNoSubstitutionTemplateLiteral(initializer)
  ) {
    return {
      problem:
        `src/lib/leadValidation.ts: DEFAULT_FORM_KEY is ${initializer.getText()}, ` +
        "not a string literal — this gate will not assume a fallback key",
    };
  }
  return { key: initializer.text };
}

/** Unwraps `as const`, `satisfies X` and parentheses without changing the value. */
function unwrap(ts, node) {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    (ts.isSatisfiesExpression?.(current) ?? false)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The `formKeys` of the EXPORTED `siteConfig`, and nothing else.
 *
 * Runtime reads `siteConfig.formKeys` and only that, so a `formKeys` property
 * on any other object is not configuration. Reading "any property named
 * formKeys" let a helper — `const defaults = { formKeys: [...] }` — declare
 * keys the running site never sees.
 *
 * Returns `{ keys }` on success, or `{ problem }` describing why the
 * declaration could not be read. It never guesses: a `siteConfig` built by a
 * call, spread from elsewhere, or declaring `formKeys` non-literally is
 * reported so someone makes it readable, because an unreadable declaration
 * graded as absent is a silent pass.
 */
function readDeclaredFormKeys(ts, repositoryRoot) {
  const path = join(repositoryRoot, "src/site.config.ts");
  if (!existsSync(path)) return { keys: null };

  const source = parseSource(ts, path, readFileSync(path, "utf8"));
  let initializer = null;
  let mutable = null;
  // Top-level and `const`, for the same reason DEFAULT_FORM_KEY is: this is
  // the binding the route imports, and a `let` could be reassigned after
  // export so its initializer is not necessarily what runtime reads.
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (
      !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== "siteConfig" ||
        !declaration.initializer
      ) {
        continue;
      }
      initializer = unwrap(ts, declaration.initializer);
      mutable =
        (statement.declarationList.flags & ts.NodeFlags.Const) === 0
          ? statement.declarationList.getText().split(" ")[0]
          : null;
    }
  }

  if (initializer !== null && mutable !== null) {
    return {
      problem:
        `src/site.config.ts: \`siteConfig\` is declared with \`${mutable}\`, so it ` +
        "can be reassigned after export and its formKeys are not necessarily " +
        "what the site reads — declare it `const`",
    };
  }

  if (initializer === null) {
    return {
      problem:
        "src/site.config.ts: no exported `siteConfig` object literal found — " +
        "this gate reads the same property the running site does, so it needs " +
        "`export const siteConfig = { … }` written out",
    };
  }
  if (!ts.isObjectLiteralExpression(initializer)) {
    return {
      problem:
        "src/site.config.ts: `siteConfig` is not an object literal, so its " +
        "formKeys cannot be read here — declare it inline rather than " +
        "building it, or this gate cannot tell what the site's forms are",
    };
  }

  // A spread could contribute or override formKeys from a place this cannot
  // follow, so it is refused rather than ignored.
  for (const member of initializer.properties) {
    if (ts.isSpreadAssignment(member)) {
      return {
        problem:
          `src/site.config.ts: \`siteConfig\` spreads ${member.expression.getText()}, ` +
          "which may supply or override formKeys from somewhere this gate " +
          "cannot follow — declare formKeys directly on siteConfig",
      };
    }
  }

  // Last wins, as it does at runtime, so a duplicated property cannot make the
  // gate read one value while the site uses another.
  let found = null;
  for (const member of initializer.properties) {
    // `{ formKeys }` is a real declaration whose value lives elsewhere, so
    // skipping it silently would grade the site as declaring nothing. Every
    // other shorthand is some other property and is not this gate's business.
    if (ts.isShorthandPropertyAssignment(member)) {
      if (member.name.text === "formKeys") {
        return {
          problem:
            "src/site.config.ts: `siteConfig` declares formKeys as a " +
            "shorthand property, so its value lives elsewhere and this gate " +
            "cannot read it — write the array out on siteConfig",
        };
      }
      continue;
    }
    if (!ts.isPropertyAssignment(member)) continue;
    const name = member.name;
    if (ts.isComputedPropertyName(name)) {
      const computed = unwrap(ts, name.expression);
      if (
        ts.isStringLiteral(computed) ||
        ts.isNoSubstitutionTemplateLiteral(computed)
      ) {
        if (computed.text === "formKeys") found = member;
        continue;
      }
      // It could BE formKeys, and a later property wins at runtime, so
      // ignoring it let `` [`form${"Keys"}`]: [...] `` override the declared
      // list while this gate read the earlier one.
      return {
        problem:
          "src/site.config.ts: `siteConfig` has a computed property " +
          `${name.expression.getText()} whose name this gate cannot resolve — ` +
          "it may be formKeys and may override the declared list, so use " +
          "plain property names",
      };
    }
    if (
      (ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
      name.text === "formKeys"
    ) {
      found = member;
    }
  }
  if (found === null) return { keys: null };

  const array = unwrap(ts, found.initializer);
  if (!ts.isArrayLiteralExpression(array)) {
    return {
      problem:
        "src/site.config.ts: formKeys is not an array literal, so this gate " +
        "cannot tell which forms the site declares",
    };
  }

  const keys = [];
  for (const element of array.elements) {
    if (
      ts.isStringLiteral(element) ||
      ts.isNoSubstitutionTemplateLiteral(element)
    ) {
      keys.push(element.text);
    } else {
      keys.push({ unreadable: element.getText() });
    }
  }
  return { keys };
}

/** The module that defines the component, as a root-relative path. */
const LEAD_FORM_MODULE = "src/components/LeadForm";

/**
 * Where an import specifier actually points, relative to the repository root,
 * or null for a package.
 *
 * Resolved rather than pattern-matched: recognising only specifiers ending in
 * `components/LeadForm` skipped `import { LeadForm } from "../LeadForm"`,
 * which is valid from `src/components/home/`, and a skipped import meant that
 * file's renders were never counted at all.
 */
function resolveSpecifier(repositoryRoot, importingFile, specifier) {
  if (specifier.startsWith("@/")) return `src/${specifier.slice(2)}`;
  if (!specifier.startsWith(".")) return null;
  const absolute = join(repositoryRoot, importingFile, "..", specifier);
  const prefix = repositoryRoot.endsWith("/")
    ? repositoryRoot
    : `${repositoryRoot}/`;
  const relative = absolute.startsWith(prefix)
    ? absolute.slice(prefix.length)
    : absolute;
  return relative.replace(/\\/gu, "/");
}

/**
 * Whether a repo-local specifier points at nothing on disk.
 *
 * A package specifier is not repo-local and is never this component, so it is
 * not reported. An `@/` or relative path that resolves to no file might be
 * this component reached a way the resolver mishandles, which must not read as
 * "some other component".
 */
function inRepoSpecifierPointsNowhere(
  repositoryRoot,
  importingFile,
  specifier,
) {
  const resolved = resolveSpecifier(repositoryRoot, importingFile, specifier);
  if (resolved === null) return false;
  return !["", ".tsx", ".ts", "/index.tsx", "/index.ts"].some((suffix) =>
    existsSync(join(repositoryRoot, `${resolved}${suffix}`)),
  );
}

/**
 * The local names `LeadForm` is imported under, from `@/components/LeadForm`.
 *
 * An alias is resolved rather than missed: `import { LeadForm as ApplicationForm }`
 * followed by `<ApplicationForm formKey="…" />` is the same runtime component,
 * and matching the tag text alone made it invisible to the collision check.
 * A namespace or default import is reported instead, because this cannot tell
 * which member of a namespace is being rendered.
 */
function leadFormLocalNames(ts, repositoryRoot, relativePath, source) {
  const names = new Set();
  const problems = [];
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      resolveSpecifier(
        repositoryRoot,
        relativePath,
        node.moduleSpecifier.text,
      ) === LEAD_FORM_MODULE
    ) {
      const clause = node.importClause;
      if (!clause) return;
      if (clause.name) {
        problems.push(
          "imports LeadForm's module as a default binding, which this gate " +
            "cannot follow — use `import { LeadForm }`",
        );
      }
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        problems.push(
          `imports LeadForm's module as a namespace (\`${bindings.name.text}\`), ` +
            "which this gate cannot follow — use `import { LeadForm }`",
        );
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (imported === "LeadForm") names.add(element.name.text);
        }
      }
    } else if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      inRepoSpecifierPointsNowhere(
        repositoryRoot,
        relativePath,
        node.moduleSpecifier.text,
      )
    ) {
      // An in-repo specifier pointing at no file on disk. It could be this
      // component reached by a path this resolver mishandles, so it is
      // reported rather than assumed to be something else.
      problems.push(
        `imports "${node.moduleSpecifier.text}", which resolves to no file — ` +
          "this gate cannot tell whether it is the lead form",
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { names, problems };
}

/**
 * The literal `formKey` a render declares, as
 * `{ key }` / `{ key: undefined }` for an omitted prop, or `{ problem }`.
 *
 * Later attributes win, as they do in JSX, and a spread is refused outright:
 * `<LeadForm {...{ formKey: "x" }} />` supplied a key this gate read as
 * absent, so the form was graded as sending the default while it sent `x`.
 */
function readFormKeyProp(ts, opening) {
  let key;
  for (const attribute of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      return {
        problem:
          `spreads ${attribute.expression.getText()} into a LeadForm, which may ` +
          "supply or override formKey — pass formKey explicitly instead",
      };
    }
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText() !== "formKey") continue;
    const value = attribute.initializer;
    if (value && ts.isStringLiteral(value)) {
      key = value.text;
      continue;
    }
    if (
      value &&
      ts.isJsxExpression(value) &&
      value.expression &&
      ts.isStringLiteral(value.expression)
    ) {
      key = value.expression.text;
      continue;
    }
    return {
      problem: "renders a LeadForm whose formKey is not a string literal",
    };
  }
  return { key };
}

/**
 * Every `<LeadForm>` the site really renders, with the key each one claims.
 *
 * Walks JSX nodes, so a commented-out or string-quoted render is not counted —
 * it renders nothing, and counting it would report a collision that does not
 * exist.
 */
function readLeadFormRenders(ts, repositoryRoot) {
  const renders = [];
  const problems = [];
  for (const relativePath of listSourceFiles(repositoryRoot)) {
    const text = readFileSync(join(repositoryRoot, relativePath), "utf8");
    if (!text.includes("LeadForm")) continue;
    if (relativePath === `${LEAD_FORM_MODULE}.tsx`) continue;
    const source = parseSource(ts, relativePath, text);
    const { names, problems: importProblems } = leadFormLocalNames(
      ts,
      repositoryRoot,
      relativePath,
      source,
    );
    for (const problem of importProblems) {
      problems.push(`${relativePath}: ${problem}`);
    }

    const visit = (node) => {
      const opening = ts.isJsxSelfClosingElement(node)
        ? node
        : ts.isJsxElement(node)
          ? node.openingElement
          : null;
      if (opening) {
        const tag = opening.tagName.getText();
        if (names.has(tag)) {
          const read = readFormKeyProp(ts, opening);
          if (read.problem) problems.push(`${relativePath}: ${read.problem}`);
          else renders.push({ file: relativePath, key: read.key });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { renders, problems };
}

/** Mirrors MEGA's own `FORM_KEY_PATTERN`. */
const KEY_SHAPE = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * Form identity: every form the site renders must be tellable from the others.
 *
 * `form_key` names the row in MEGA's form registry, is what per-form email and
 * SMS routing matches on, and is what the notification subject says the lead
 * came from. Two forms sharing a key collapse into one registry row with one
 * routing rule, so a site cannot send quote requests to sales and job
 * applications to the office. This is a build gate rather than advice because
 * the symptom appears in MEGA weeks later, not here.
 *
 * It does not attempt to determine a key through every construct TSX allows.
 * It ENFORCES the constructs under which the answer is readable — a direct
 * named import, no spreads, literal keys on the exported `siteConfig` — and
 * reports anything else. Three review rounds went on evasions of the inferring
 * version; a constraint that is checkable has no next variant.
 */
export async function collectFormIdentityProblems(repositoryRoot) {
  const hasConfig = existsSync(join(repositoryRoot, "src/site.config.ts"));
  const hasSource = existsSync(join(repositoryRoot, "src"));
  if (!hasConfig && !hasSource) return [];

  const ts = await loadTs();
  if (ts === null) {
    // Reported, never skipped silently. A real site cannot run `next build`
    // without typescript either, so this is reachable only in a synthetic tree.
    return [
      "form identity: could not load `typescript`, so the site's forms were " +
        "not checked — run `npm ci` and build again",
    ];
  }

  const declaration = readDeclaredFormKeys(ts, repositoryRoot);
  if (declaration.problem) return [declaration.problem];
  if (declaration.keys === null) {
    if (!hasConfig) return [];
    return [
      "src/site.config.ts: no formKeys declared — add at least " +
        '`formKeys: ["contact-form"]` so MEGA can name this site\'s forms',
    ];
  }

  const problems = [];
  const declared = [];
  for (const entry of declaration.keys) {
    if (typeof entry === "string") {
      declared.push(entry);
      continue;
    }
    problems.push(
      `src/site.config.ts: formKeys contains ${entry.unreadable}, which is ` +
        "not a string literal — this gate cannot tell what key that is, and " +
        "neither can a reviewer",
    );
  }

  if (declared.length === 0 && problems.length === 0) {
    problems.push(
      'src/site.config.ts: formKeys is empty — declare at least "contact-form"',
    );
  }
  for (const key of declared) {
    if (!KEY_SHAPE.test(key)) {
      problems.push(
        `src/site.config.ts: formKeys contains "${key}", which MEGA will ` +
          "reject and replace with contact-form — use lowercase letters, " +
          "digits and hyphens, starting with a letter or digit",
      );
    }
  }
  const seen = new Set();
  for (const key of declared) {
    if (seen.has(key)) {
      problems.push(
        `src/site.config.ts: formKeys lists "${key}" twice — one key is one form`,
      );
    }
    seen.add(key);
  }

  const fallback = readDefaultFormKey(ts, repositoryRoot);
  if (fallback.problem) return [...problems, fallback.problem];
  const defaultKey = fallback.key;
  const { renders, problems: renderProblems } = readLeadFormRenders(
    ts,
    repositoryRoot,
  );
  problems.push(...renderProblems);

  // What each rendered form actually sends: its declared key, or MEGA's
  // fallback when the prop is omitted. Two forms sending the same key is the
  // fault, not a form lacking a prop — a single unkeyed form alongside a keyed
  // one is two distinct keys and perfectly coherent.
  const effective = new Map();
  for (const render of renders) {
    const key = render.key ?? defaultKey;
    if (!effective.has(key)) effective.set(key, []);
    effective.get(key).push(render);
  }

  for (const [key, sharing] of effective) {
    if (sharing.length < 2) continue;
    const unnamed = sharing.filter((render) => render.key === undefined).length;
    problems.push(
      `${sharing.length} forms all send the form key "${key}" ` +
        `(${sharing.map((r) => r.file).join(", ")})` +
        (unnamed > 0
          ? ` — ${unnamed} of them declare no formKey, so they fall back to ` +
            `"${defaultKey}". `
          : " — ") +
        "Every lead from them registers as one form, so routing cannot tell " +
        "them apart. Give each a distinct formKey from site.config.ts.",
    );
  }

  // EVERY key a form sends must be declared, the fallback an omitted prop
  // resolves to included. Checking only explicit props let a site declare
  // `["careers-application"]`, render `<LeadForm />` beside
  // `<LeadForm formKey="careers-application" />`, and pass — while the unkeyed
  // form submitted an undeclared `contact-form`.
  for (const [key, sharing] of effective) {
    if (declared.includes(key)) continue;
    const viaDefault = sharing.some((render) => render.key === undefined);
    problems.push(
      `${sharing.map((r) => r.file).join(", ")}: send${
        sharing.length === 1 ? "s" : ""
      } the form key "${key}"` +
        (viaDefault
          ? " (the default, because no formKey prop is set), which " +
            "src/site.config.ts does not declare — declare it, or give the " +
            "form an explicit key"
          : ", which src/site.config.ts does not declare — MEGA will replace " +
            "it with contact-form"),
    );
  }

  // A declared key nothing sends is a registry row and a routing rule the
  // customer can configure and never receive a lead through.
  for (const key of declared) {
    if (!effective.has(key)) {
      problems.push(
        `src/site.config.ts: declares "${key}" but no form sends it — a ` +
          "routing rule for it could never receive a lead",
      );
    }
  }
  return problems;
}
