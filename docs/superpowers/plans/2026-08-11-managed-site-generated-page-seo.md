# Generated-page SEO semantics

## Goal

Make generated routes and their SEO data deterministic before adding a production Astro fixture. Every route must have one exact SEO descriptor, and generated metadata must resolve to internal protected item fields in the route's declared collection.

## Invariants

- `internalSeo.pages` covers every static route exactly once and never targets a generated route.
- `internalSeo.generatedPages` covers every generated route exactly once, names the same collection as the route, and never targets a static route.
- Generated metadata title, description, canonical URL, indexing directives, and optional social text resolve to internal protected item fields with the exact required value type.
- A generated route key resolves to an internal protected string item field with semantic `route.slug`; active values use canonical lowercase URL-segment syntax and are unique in the route collection.
- Other generated-page field references resolve only inside the route collection. Page and asset references remain globally scoped.
- Existing static-page SEO shapes remain structurally unchanged; adding `generatedPages: []` is the only required contract migration for static-only sites.

## Implementation

1. Add strict generated-page SEO schemas and public readonly types.
2. Extend the type-derived stable-ID occurrence registry with exact global and route-collection scopes.
3. Add deterministic SEO coverage, route/collection binding, metadata field-policy, heading, and route-key semantic validation.
4. Validate active route-key content values against canonical slug syntax.
5. Update contract fixtures and the certified starter contract with explicit `generatedPages` coverage.
6. Regenerate the checked JSON Schema artifact and add table-driven adversarial tests.

## Boundaries

- Package contract/schema/semantic validation and the certified starter contract only.
- No Astro fixture, renderer, CMS UI, customer authority, provider, registry, preview, or publishing changes.
- Cloud CI performs the full package/root build and test gate; local work remains static and memory-light.

## Review gate

- One PR, files under 500 lines, class-wide adversarial matrix, deterministic schema snapshot, clean static review, and exact-head cloud CI before merge.
