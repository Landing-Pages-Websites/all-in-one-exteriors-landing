import { renderAnchor } from "./anchors.js";
import type { Candidate } from "./candidates.js";
import type { Finding } from "./report.js";

/**
 * The confidence gate. Identity must be unique before anything is proposed:
 * two candidates that resolve to the same anchor path are BOTH rejected, never
 * silently disambiguated by order, text or position.
 */

export interface GateResult {
  readonly accepted: readonly Candidate[];
  readonly findings: readonly Finding[];
  /**
   * The rival groups, kept as groups. A report only needs to say a value was
   * refused; a tool that GIVES the rivals names needs to know which values are
   * rivals of which, and that is lost the moment they are flattened.
   */
  readonly ambiguous: readonly (readonly Candidate[])[];
}

function groupByAnchor(candidates: readonly Candidate[]): ReadonlyMap<string, Candidate[]> {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = renderAnchor(candidate.anchor);
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [candidate]);
    else existing.push(candidate);
  }
  return groups;
}

function duplicateComponentNames(candidates: readonly Candidate[]): ReadonlySet<string> {
  const filesByComponent = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const name of candidate.componentNames) {
      const files = filesByComponent.get(name) ?? new Set<string>();
      files.add(candidate.location.file);
      filesByComponent.set(name, files);
    }
  }
  return new Set(
    [...filesByComponent.entries()]
      .filter(([, files]) => files.size > 1)
      .map(([name]) => name),
  );
}

/**
 * Two readings of one declared binding are one value, not two rival claims on
 * an anchor: whatever the page shows for `ctas.primary.label` in the header, it
 * shows the same string in the footer, because both read the same declaration.
 * They merge, carrying every component that renders them.
 *
 * They merge ONLY when they name the same declaration. Two modules that each
 * declare `copy` produce one anchor naming two different values, which is the
 * ambiguity this gate exists to refuse — so that group falls through to the
 * ordinary refusal below rather than picking whichever was walked first.
 */
function mergeDeclaredReadings(group: readonly Candidate[]): readonly Candidate[] {
  const first = group[0];
  if (first === undefined || group.length === 1) return group;
  const modules = new Set<string>();
  for (const candidate of group) {
    if (candidate.identity.kind !== "declaration") return group;
    modules.add(candidate.identity.module);
  }
  if (modules.size !== 1) return group;
  const names = new Set(group.flatMap((candidate) => candidate.componentNames));
  const keys = new Set(group.flatMap((candidate) => candidate.componentKeys));
  return [{ ...first, componentNames: [...names], componentKeys: [...keys] }];
}

function ambiguityFinding(anchor: string, candidate: Candidate, siblings: number): Finding {
  return {
    code: "AMBIGUOUS_ANCHOR",
    anchor,
    location: candidate.location,
    evidence: candidate.evidence,
    decision:
      `${siblings} values share this anchor. Give each one a durable name — an ` +
      "`id` attribute on its section, its own named component, or a declared " +
      "collection — then re-run. Nothing was proposed for any of them.",
  };
}

function duplicateComponentFinding(candidate: Candidate, name: string): Finding {
  return {
    code: "DUPLICATE_COMPONENT_NAME",
    anchor: renderAnchor(candidate.anchor),
    location: candidate.location,
    evidence: candidate.evidence,
    decision:
      `Component '${name}' is declared in more than one file, ` +
      "so its anchors are not unique. Rename one of them before converting.",
  };
}

const TEXT_SUFFIX = "/text";

/**
 * An ambiguous text run means its *element* is ambiguous: two `<p>` with the
 * same anchor are two indistinguishable paragraphs, so anything nested inside
 * either of them is indistinguishable too.
 */
function containerPrefixOf(anchor: string): string {
  return anchor.endsWith(TEXT_SUFFIX) ? anchor.slice(0, -TEXT_SUFFIX.length) : anchor;
}

function inheritedAmbiguityFinding(anchor: string, candidate: Candidate, parent: string): Finding {
  return {
    code: "AMBIGUOUS_ANCHOR",
    anchor,
    location: candidate.location,
    evidence: candidate.evidence,
    decision:
      `Its container '${parent}' is ambiguous, so this value cannot be attributed to ` +
      "one of the identical containers either. Name the container first.",
  };
}

/**
 * Ambiguity is inherited. If a container cannot be told apart from its twin,
 * nothing inside it can be either, so the whole subtree is withheld rather than
 * attributed to whichever twin happened to be walked first.
 */
export function applyConfidenceGate(candidates: readonly Candidate[]): GateResult {
  const shadowed = duplicateComponentNames(candidates);
  const groups = new Map(
    [...groupByAnchor(candidates)].map(([anchor, group]) => [
      anchor,
      mergeDeclaredReadings(group),
    ]),
  );
  const ambiguous = [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([anchor]) => containerPrefixOf(anchor));
  const findings: Finding[] = [];
  const accepted: Candidate[] = [];
  const rivals: (readonly Candidate[])[] = [];

  for (const [anchor, group] of groups) {
    if (group.length > 1 && !group.some((c) => c.componentNames.some((n) => shadowed.has(n)))) {
      rivals.push(group);
    }
    const inherited = ambiguous.find((prefix) => anchor.startsWith(`${prefix}/`));
    for (const candidate of group) {
      const duplicated = candidate.componentNames.find((name) => shadowed.has(name));
      if (duplicated !== undefined) {
        findings.push(duplicateComponentFinding(candidate, duplicated));
        continue;
      }
      if (group.length > 1) {
        findings.push(ambiguityFinding(anchor, candidate, group.length));
        continue;
      }
      if (inherited !== undefined) {
        findings.push(inheritedAmbiguityFinding(anchor, candidate, inherited));
        continue;
      }
      accepted.push(candidate);
    }
  }
  return { accepted, findings, ambiguous: rivals };
}
