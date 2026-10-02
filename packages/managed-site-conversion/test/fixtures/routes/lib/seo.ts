import type { Metadata } from "next";

interface SeoInput {
  readonly title: string;
  readonly description: string;
}

// A helper that passes its input straight through, which is how a real site
// keeps one metadata shape for every route.
export function seo({ title, description }: SeoInput): Metadata {
  return {
    title,
    description,
    openGraph: { title, description },
  };
}

// The same shape, but the description is decided inside the helper, so no call
// site supplies it.
export function seoWithDefault({ title }: { readonly title: string }): Metadata {
  return { title, description: "Decided inside the helper." };
}

// A renamed destructure: the local name differs from the key the call writes.
export function seoRenamed({ description: text }: { readonly description: string }): Metadata {
  return { description: text };
}

// Two returns, so which object is produced depends on a branch this reader has
// not followed.
export function seoBranching({ description }: { readonly description: string }): Metadata {
  if (description.length > 10) return { description };
  return { description: "short" };
}

// A `var` SHADOWS the parameter -- legal JavaScript, unlike a `const` -- so
// `{ description }` means the var. A substitution answering with the call's
// argument would report a description the page does not have.
export function seoShadowed({ description }: { readonly description: string }): Metadata {
  var description = "Shadowed by the helper.";
  void description;
  return { description };
}

// A rest element gathers keys this reader never enumerated.
export function seoRest({ description, ...rest }: Record<string, string>): Metadata {
  void rest;
  return { description };
}

// Two parameters, so which argument feeds the pattern is not one question.
export function seoTwoParams(
  { description }: { readonly description: string },
  extra: string,
): Metadata {
  void extra;
  return { description };
}

// A nested arrow with its own return, which is not this function's return.
export function seoNested({ description }: { readonly description: string }): Metadata {
  const build = (): string => description;
  return { description: build() };
}

// The parameter is REASSIGNED, so the object returns the new value and the
// call site's expression is not what Next renders.
export function seoReassigned({ description }: { readonly description: string }): Metadata {
  description = "Reassigned inside the helper.";
  return { description };
}

// A spread AFTER the key overwrites it, so the first matching property is not
// the one that wins at runtime.
const defaults = { description: "From the defaults." };
export function seoReturnSpread({ description }: { readonly description: string }): Metadata {
  return { description, ...defaults };
}

// A DESTRUCTURING assignment writes the binding without a bare identifier on
// the left, which a scan for `name = ...` cannot see.
export function seoDestructured({ description }: { readonly description: string }): Metadata {
  ({ description } = { description: "Reassigned by destructuring." });
  return { description };
}

// The write goes THROUGH the substituted binding rather than to it, so the
// object the call supplied is the one that changes.
export function seoMutated({ robots }: { readonly robots: { index: boolean } }): Metadata {
  robots.index = false;
  return { robots };
}

// `var` is function-scoped, so one inside a BLOCK shadows the parameter however
// deeply it is nested.
export function seoBlockVar({ description }: { readonly description: string }): Metadata {
  if (description.length >= 0) {
    var description = "Shadowed by a block var.";
  }
  return { description };
}

// A computed key AFTER the plain one overwrites it at runtime.
const overwrite = "description";
export function seoComputed({ description }: { readonly description: string }): Metadata {
  return { description, [overwrite]: "From the computed key." };
}

// A robots flag handed in as a name, not a literal. Defaulting it to `true`
// would turn a noindex route into an indexable one.
export function seoRobots({ index }: { readonly index: boolean }): Metadata {
  return { description: "Robots description.", robots: { index } };
}

// A parameter DEFAULT naming a constant in the helper's own module. Resolving it
// in the route's module would reach nothing, since the route never imports it.
const HELPER_FALLBACK = "Fallback from the helper module.";
export function seoDefaulted({
  description = HELPER_FALLBACK,
}: {
  readonly description?: string;
}): Metadata {
  return { description };
}

// A closure writes the parameter and is invoked before the return, so stopping
// at the function boundary would miss it.
export function seoClosure({ description }: { readonly description: string }): Metadata {
  const rewrite = (): void => {
    description = "Rewritten by a closure.";
  };
  rewrite();
  return { description };
}

// A CALL mutates the object the call site supplied, without writing to the
// binding at all.
export function seoAssign({ robots }: { readonly robots: { index: boolean } }): Metadata {
  Object.assign(robots, { index: false });
  return { description: "Assign description.", robots };
}

// An ACCESSOR is not a data member, and skipping it read as absent.
export function seoAccessor(_input: { readonly description: string }): Metadata {
  return {
    get description() {
      return "From an accessor.";
    },
  };
}

// A robots directive this reader does not model. Emitting `archive: true` here
// would contradict the route.
export function seoNoarchive({ description }: { readonly description: string }): Metadata {
  return { description, robots: { index: true, noarchive: true } };
}

// A call over a LOCAL, mentioning no substituted binding: this must still be
// read, because it is how a real helper builds its OG images.
export function seoLocalCall({ description }: { readonly description: string }): Metadata {
  const images = [{ url: "/og.png" }];
  return { description, openGraph: { images: images.map((one) => one.url) } };
}

// A substituted name appearing as a property NAME, not as a reference to the
// binding. `meta.description` mentions no `description` variable, so the call
// around it cannot reach one.
export function seoPropertyName({ description }: { readonly description: string }): Metadata {
  const meta = { description: "local" };
  const label = String(meta.description).trim();
  return { description, openGraph: { title: label } };
}

// An alias reaches the substituted object, and the CALL names the alias.
export function seoAliasAssign({ robots }: { readonly robots: { index: boolean } }): Metadata {
  const copy = robots;
  Object.assign(copy, { index: false });
  return { description: "Alias-assign description.", robots };
}

// An ACCESSOR one level down, in the nested robots object.
export function seoRobotsAccessor({ description }: { readonly description: string }): Metadata {
  return {
    description,
    robots: {
      get index() {
        return false;
      },
    },
  };
}

// DUPLICATE keys: JavaScript uses the last, and reading the first reports the
// value the runtime replaced.
export function seoDuplicate({ description }: { readonly description: string }): Metadata {
  void description;
  return { description: "first", description: "second" };
}

// A MEMBER of the substituted object is part of the same object, so writing
// through it writes through the parameter.
export function seoMemberAlias({
  robots,
}: {
  readonly robots: { index: boolean; inner: { index: boolean } };
}): Metadata {
  const inner = robots.inner;
  Object.assign(inner, { index: false });
  return { description: "Member-alias description.", robots };
}

// An accessor in a nested object that is NOT robots, so only the recursive
// member check can see it.
export function seoNestedAccessor({ description }: { readonly description: string }): Metadata {
  return {
    description,
    openGraph: {
      get title() {
        return "From a nested accessor.";
      },
    },
  };
}

// A CONTAINER holds the substituted object, so nothing tracked is aliased and
// the mutating call names only the container.
export function seoContainer({ robots }: { readonly robots: { index: boolean } }): Metadata {
  const holder = { robots };
  Object.assign(holder.robots, { index: false });
  return { description: "Container description.", robots };
}

// A `for...of` TARGET writes without being an assignment expression.
export function seoLoopTarget({ robots }: { readonly robots: { index: boolean } }): Metadata {
  for (robots.index of [false]) {
    break;
  }
  return { description: "Loop description.", robots };
}

// `arguments` IS the object the call supplied, under a name no parameter list
// mentions. `arguments[0].robots` reaches it while `robots` appears only as a
// property NAME.
export function seoArguments({ robots }: { readonly robots: { index: boolean } }): Metadata {
  Object.assign(arguments[0].robots, { index: false });
  return { description: "Arguments description.", robots };
}

// A side-effecting expression INSIDE the returned object. The object is
// returned after its property expressions are evaluated, so the mutation runs
// first and `robots` is not what the call supplied.
export function seoReturnSideEffect({
  robots,
}: {
  readonly robots: { index: boolean };
}): Metadata {
  return {
    robots,
    description: (Object.assign(robots, { index: false }), "Side-effect description."),
  };
}

// The same value in NESTED objects, which a real helper does for openGraph and
// twitter. These are plain values and must still be read.
export function seoNestedValues({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}): Metadata {
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

// A value held inside an ARRAY on the way up from the returned object. Not a
// position this reader models, so that field fails closed while a plain
// shorthand beside it still reads.
export function seoArrayNested({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}): Metadata {
  return { title, description, openGraph: { images: [{ alt: title }] } };
}

// A parameter DEFAULT, so a `__proto__` argument makes destructuring read an
// inherited value while the supplied map sees no such key.
export function seoInherited({
  description = "fallback",
}: {
  readonly description?: string;
}): Metadata {
  return { description };
}

// `__proto__` one level down, in the nested robots object. The object inherits
// `index: false`, which no scan of its own members can see.
export function seoProtoRobots({ description }: { readonly description: string }): Metadata {
  return { description, robots: { __proto__: { index: false } } };
}

// Direct `eval` runs source this reader never parses, so the string holds no
// `robots` identifier for any AST scan to find -- and mutates it anyway.
export function seoEval({ robots }: { readonly robots: { index: boolean } }): Metadata {
  eval("robots.index = false");
  return { description: "Eval description.", robots };
}

/** A helper handing back a metadata object inside another object. */
export function seoPair(): { metadata: Metadata } {
  return { metadata: { title: "Destructured2 title", robots: { index: false } } };
}

// A helper whose parameter is named for the robots flag itself. A route that
// ASSIGNS its own `{ index }` must not be answered with the call's, because the
// assigned object is written in the route, where the parameter means nothing.
export function seoAssignedRobots({ index }: { readonly index: boolean }): Metadata {
  return { description: "Assigned-robots description.", robots: { index } };
}

// The CALL supplies the whole robots object, and the helper also has a
// parameter named for the flag inside it. That object is written at the call,
// where the parameter means nothing -- the same rule an assigned object needs,
// reached by the other route into a nested object.
export function seoSuppliedRobots({
  index,
  robots,
}: {
  readonly index: boolean;
  readonly robots: { index: boolean };
}): Metadata {
  return { description: "Supplied-robots description.", robots, twitter: { index } };
}
