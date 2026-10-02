import {
  parseJsonPointer,
  parseRepositoryPath,
  type JsonPointer,
  type JsonPointerSourceResolver,
} from "@landing-pages-websites/managed-site-contract";

/**
 * Every resolver and pointer the proposer emits is built here, so a malformed
 * repository path or pointer fails at construction time rather than at contract
 * parse time. The package's own parsers are the only authority on the formats.
 */
export function pointerFor(pointer: string): JsonPointer {
  return parseJsonPointer(pointer).value;
}

export function resolverFor(path: string, pointer: string): JsonPointerSourceResolver {
  return {
    kind: "json_pointer",
    path: parseRepositoryPath(path),
    pointer: pointerFor(pointer),
  };
}
