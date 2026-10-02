import { canonicalizeJson } from "./canonical.js";
import type { ManagedSiteContentValue } from "./content.js";
import { ManagedSiteContractError } from "./errors.js";
import type {
  ManagedSiteFieldMigrationPartV1,
  ManagedSiteFieldMigrationStepV1,
} from "./field-migration-schema.js";
import type {
  ManagedRichTextBlock,
  ManagedRichTextDocument,
  ManagedRichTextInline,
  ManagedRichTextMark,
} from "./rich-text.js";

/**
 * One run of text and the marks on it, outermost first. Unmarked text has an
 * empty list, so two runs compare by canonical JSON alone.
 */
export interface ManagedSiteFieldMigrationRunV1 {
  readonly text: string;
  readonly marks: readonly ManagedRichTextMark[];
}

/** Where one part sits in the target's text, in UTF-16 code units. */
export interface ManagedSiteFieldMigrationOffsetV1 {
  readonly start: number;
  readonly end: number;
}

export type ManagedSiteFieldMigrationTargetValueV1 =
  | string
  | ManagedRichTextDocument;

export interface ManagedSiteFieldMigrationResultV1 {
  readonly value: ManagedSiteFieldMigrationTargetValueV1;
  readonly offsets: readonly ManagedSiteFieldMigrationOffsetV1[];
}

/**
 * Where a step's hard breaks sit, as offsets into the target's text: a break
 * has no text of its own, so it is the offset its following part starts at.
 * Derived from the declaration and the offsets alone, so F and the read-back
 * agree on it without either trusting the other.
 */
export function managedSiteFieldMigrationBreakOffsets(
  step: ManagedSiteFieldMigrationStepV1,
  offsets: readonly ManagedSiteFieldMigrationOffsetV1[],
): readonly number[] {
  return step.parts.flatMap((part, index) =>
    part.joinedBy === "hard_break" ? [offsets[index]?.start ?? -1] : [],
  );
}

/** A source's text as read back out of a target. */
export interface ManagedSiteFieldMigrationReadBackV1 {
  readonly fieldId: string;
  readonly text: string;
  readonly runs: readonly ManagedSiteFieldMigrationRunV1[];
}

export type ManagedSiteFieldMigrationSourceValues = ReadonlyMap<
  string,
  ManagedSiteContentValue
>;

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function sameMarks(
  left: readonly ManagedRichTextMark[],
  right: readonly ManagedRichTextMark[],
): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

/** Drops empty runs and joins neighbours with identical marks: one spelling. */
export function joinManagedSiteFieldMigrationRuns(
  runs: readonly ManagedSiteFieldMigrationRunV1[],
): readonly ManagedSiteFieldMigrationRunV1[] {
  const joined: ManagedSiteFieldMigrationRunV1[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const last = joined.at(-1);
    if (last !== undefined && sameMarks(last.marks, run.marks)) {
      joined[joined.length - 1] = { text: last.text + run.text, marks: last.marks };
    } else {
      joined.push({ text: run.text, marks: [...run.marks] });
    }
  }
  return joined;
}

/**
 * A block's runs, or null when it holds a hard break. A run is text and marks,
 * so a break has no run to be, and a merge that dropped it would join two lines
 * into one: such a block is not something F can move yet.
 */
function inlineRuns(
  inlines: readonly ManagedRichTextInline[],
): readonly ManagedSiteFieldMigrationRunV1[] | null {
  const runs: ManagedSiteFieldMigrationRunV1[] = [];
  for (const node of inlines) {
    if (node.type === "hard_break") return null;
    runs.push({ text: node.text, marks: node.marks ?? [] });
  }
  return runs;
}

function singleTextBlock(document: ManagedRichTextDocument): ManagedRichTextBlock | null {
  const [block, ...rest] = document.content;
  if (rest.length > 0 || block === undefined) return null;
  return block.type === "paragraph" || block.type === "heading" ? block : null;
}

/**
 * A source's own runs: text fields are one unmarked run, and rich text must be
 * one paragraph or heading with no hard break, whose runs keep every mark they
 * carry. Anything else has structure a merge would flatten, so it is deferred.
 */
export function managedSiteFieldMigrationSourceRuns(
  value: ManagedSiteContentValue,
): readonly ManagedSiteFieldMigrationRunV1[] {
  if (value.type === "plain_text" || value.type === "heading_text") {
    return [{ text: value.value, marks: [] }];
  }
  if (value.type === "rich_text") {
    const block = singleTextBlock(value.value);
    const textBlock = block?.type === "paragraph" || block?.type === "heading" ? block : null;
    const runs = textBlock === null ? null : inlineRuns(textBlock.content);
    if (runs !== null) return runs;
  }
  return fail(
    "MIGRATION_TRANSFORM_DEFERRED",
    `Source ${value.fieldId} is not text or one block of rich text without hard breaks`,
  );
}

function withDeclaredMarks(
  run: ManagedSiteFieldMigrationRunV1,
  declared: readonly ManagedRichTextMark[],
): ManagedSiteFieldMigrationRunV1 {
  const marks = [...declared, ...run.marks];
  if (new Set(marks.map((mark) => mark.type)).size !== marks.length) {
    fail(
      "MIGRATION_MARK_CONFLICT",
      "A declared mark repeats a mark the source already carries",
    );
  }
  return { text: run.text, marks };
}

function sourceValue(
  sources: ManagedSiteFieldMigrationSourceValues,
  fieldId: string,
): ManagedSiteContentValue {
  const value = sources.get(fieldId);
  if (value === undefined) {
    return fail("MIGRATION_SOURCE_VALUE_MISSING", `Source ${fieldId} has no production value`);
  }
  return value;
}

function sameBlock(
  block: ManagedRichTextBlock,
  into: ManagedSiteFieldMigrationStepV1["into"],
): boolean {
  if (into.type !== "rich_text") return false;
  if (block.type === "heading") {
    return into.block.type === "heading" && into.block.level === block.attrs.level;
  }
  return into.block.type === block.type;
}

/**
 * A rich-text source's block is customer content as much as its text: its type
 * and heading level are the customer's, not code's. So the target must keep
 * that block exactly; flattening it into plain text, a list item or another
 * level would drop structure no run carries.
 */
function assertSourceBlockKept(
  value: ManagedSiteContentValue,
  into: ManagedSiteFieldMigrationStepV1["into"],
): void {
  if (value.type !== "rich_text") return;
  const block = singleTextBlock(value.value);
  if (block === null || !sameBlock(block, into)) {
    fail("MIGRATION_SOURCE_STRUCTURE_LOST", `Source ${value.fieldId} does not keep its block`);
  }
}

/** Declared marks wrap the part, so they are outermost on every run of it. */
/**
 * Rich text holds no control character: a line break there is a `hard_break`
 * node, and F writes one only where a part is declared `joinedBy`, never from
 * text. So a part whose text carries a control character (a plain-text source
 * allowing newlines, a literal) cannot move into rich text, and is deferred
 * rather than written as a value its own contract refuses.
 */
function assertNoLineBreakText(
  into: ManagedSiteFieldMigrationStepV1["into"],
  parts: readonly (readonly ManagedSiteFieldMigrationRunV1[])[],
): void {
  if (into.type !== "rich_text") return;
  if (parts.some((runs) => runs.some((run) => /\p{Cc}/u.test(run.text)))) {
    fail(
      "MIGRATION_TRANSFORM_DEFERRED",
      "A part carries a control character, which rich text holds only as a hard break",
    );
  }
}

function partRuns(
  part: ManagedSiteFieldMigrationPartV1,
  into: ManagedSiteFieldMigrationStepV1["into"],
  sources: ManagedSiteFieldMigrationSourceValues,
): readonly ManagedSiteFieldMigrationRunV1[] {
  const declared = part.marks ?? [];
  if ("literal" in part) return [{ text: part.literal, marks: [...declared] }];
  const value = sourceValue(sources, part.source);
  const runs = managedSiteFieldMigrationSourceRuns(value);
  assertSourceBlockKept(value, into);
  return runs.map((run) => withDeclaredMarks(run, declared));
}

function runsText(runs: readonly ManagedSiteFieldMigrationRunV1[]): string {
  return runs.map((run) => run.text).join("");
}

function offsetsOf(
  parts: readonly (readonly ManagedSiteFieldMigrationRunV1[])[],
): readonly ManagedSiteFieldMigrationOffsetV1[] {
  let start = 0;
  return parts.map((runs) => {
    const end = start + runsText(runs).length;
    const offset = { start, end };
    start = end;
    return offset;
  });
}

function textNodes(
  runs: readonly ManagedSiteFieldMigrationRunV1[],
): readonly ManagedRichTextInline[] {
  const joined = joinManagedSiteFieldMigrationRuns(runs);
  if (joined.length === 0) {
    fail("MIGRATION_TARGET_EMPTY", "A merged block holds no text");
  }
  return joined.map((run) =>
    run.marks.length === 0
      ? { type: "text", text: run.text }
      : { type: "text", text: run.text, marks: run.marks },
  );
}

/**
 * The parts of a block cut into the lines a hard break separates: a part
 * declared `joinedBy: "hard_break"` starts a new line. A run never joins a
 * neighbour across a break, even with identical marks, since the break is
 * between them.
 */
function lineParts<T>(
  step: ManagedSiteFieldMigrationStepV1,
  parts: readonly T[],
): readonly (readonly T[])[] {
  const lines: T[][] = [[]];
  parts.forEach((part, index) => {
    if (step.parts[index]?.joinedBy === "hard_break") lines.push([]);
    lines.at(-1)?.push(part);
  });
  return lines;
}

/**
 * A declared break joins a part to the part before it, so both hold text: with
 * an empty part on either side the node would sit between other parts than the
 * declaration names, and read-back (which sees only offsets) could not tell.
 */
function assertBoundaryPartsHoldText(
  step: ManagedSiteFieldMigrationStepV1,
  parts: readonly (readonly ManagedSiteFieldMigrationRunV1[])[],
): void {
  const emptyBoundary = step.parts.some(
    (part, index) =>
      part.joinedBy === "hard_break" &&
      (runsText(parts[index] ?? []) === "" || runsText(parts[index - 1] ?? []) === ""),
  );
  if (emptyBoundary) {
    fail("MIGRATION_HARD_BREAK_EMPTY_LINE", "A hard break joins two parts that each hold text");
  }
}

/**
 * A hard break sits between two lines that each hold text, which is the
 * contract's own rule for the node; a line of only empty parts, or only
 * spaces, would be an empty line spelled another way. F refuses it rather than write a value the
 * contract refuses, or drop the break the declaration asked for.
 */
function assertLinesHoldText(
  step: ManagedSiteFieldMigrationStepV1,
  parts: readonly (readonly ManagedSiteFieldMigrationRunV1[])[],
): void {
  assertBoundaryPartsHoldText(step, parts);
  const lines = lineParts(step, parts);
  if (lines.length === 1) return;
  const holdsNoText = (line: readonly (readonly ManagedSiteFieldMigrationRunV1[])[]): boolean =>
    line.map(runsText).join("").trim() === "";
  if (lines.some(holdsNoText)) {
    fail("MIGRATION_HARD_BREAK_EMPTY_LINE", "A hard break needs text on both sides of it");
  }
}

/** F is exported, so it holds the schema's rule itself: a break joins parts inside one paragraph or heading. */
function assertBreaksFitBlock(step: ManagedSiteFieldMigrationStepV1): void {
  if (!step.parts.some((part) => part.joinedBy === "hard_break")) return;
  if (step.into.type !== "rich_text" || step.into.block.type === "bullet_list") {
    fail("MIGRATION_DECLARATION_INVALID", "A hard break joins parts inside one paragraph or heading");
  }
}

/**
 * Plain text holds no marks, and none reach it: the schema refuses declared
 * marks on a plain-text merge, and a rich-text source cannot keep its block in
 * one, so it is refused before this.
 */
function plainTextValue(
  parts: readonly (readonly ManagedSiteFieldMigrationRunV1[])[],
): string {
  return parts.map(runsText).join("");
}

function richTextValue(
  step: ManagedSiteFieldMigrationStepV1,
  into: Extract<ManagedSiteFieldMigrationStepV1["into"], { type: "rich_text" }>,
  parts: readonly (readonly ManagedSiteFieldMigrationRunV1[])[],
): ManagedRichTextDocument {
  const { block } = into;
  if (block.type === "bullet_list") {
    const items = parts.map((runs) => ({
      type: "list_item" as const,
      content: [{ type: "paragraph" as const, content: textNodes(runs) }],
    }));
    return { type: "doc", content: [{ type: "bullet_list", content: items }] };
  }
  const content = lineParts(step, parts).flatMap((line, index) => [
    ...(index === 0 ? [] : [{ type: "hard_break" } as const]),
    ...textNodes(line.flat()),
  ]);
  if (block.type === "heading") {
    return { type: "doc", content: [{ type: "heading", attrs: { level: block.level }, content }] };
  }
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

/**
 * F: production source values and the step's parts, to the target value. Pure
 * and deterministic, so the same inputs always give the same canonical JSON.
 * A bullet list holds one item per part; every other block holds all parts
 * in order, with adjacent runs of identical marks joined, and a `hard_break`
 * before each part declared `joinedBy: "hard_break"`.
 */
export function applyManagedSiteFieldMigrationStepV1(
  step: ManagedSiteFieldMigrationStepV1,
  sources: ManagedSiteFieldMigrationSourceValues,
): ManagedSiteFieldMigrationResultV1 {
  const parts = step.parts.map((part) => partRuns(part, step.into, sources));
  assertBreaksFitBlock(step);
  assertNoLineBreakText(step.into, parts);
  assertLinesHoldText(step, parts);
  const value =
    step.into.type === "plain_text"
      ? plainTextValue(parts)
      : richTextValue(step, step.into, parts);
  return { value, offsets: offsetsOf(parts) };
}

interface PositionedRun extends ManagedSiteFieldMigrationRunV1 {
  readonly start: number;
}

function readBackFail(message: string): never {
  return fail("MIGRATION_READBACK_MISMATCH", message);
}

function positioned(
  runs: readonly ManagedSiteFieldMigrationRunV1[],
  origin: number,
): readonly PositionedRun[] {
  let start = origin;
  return runs.map((run) => {
    const result = { ...run, start };
    start += run.text.length;
    return result;
  });
}

function blockRuns(block: ManagedRichTextBlock | undefined): readonly ManagedSiteFieldMigrationRunV1[] {
  if (block?.type !== "paragraph" && block?.type !== "heading") {
    return readBackFail("Target block is not the declared block");
  }
  return inlineRuns(block.content) ?? readBackFail("Target block holds a hard break no part accounts for");
}

interface TargetLine {
  readonly runs: readonly ManagedSiteFieldMigrationRunV1[];
  /** Text offsets the block's hard breaks sit at. */
  readonly breaks: readonly number[];
}

/** A paragraph or heading's runs and the offsets of its breaks, in order. */
function blockLine(block: ManagedRichTextBlock | undefined): TargetLine {
  if (block?.type !== "paragraph" && block?.type !== "heading") {
    return readBackFail("Target block is not the declared block");
  }
  const runs: ManagedSiteFieldMigrationRunV1[] = [];
  const breaks: number[] = [];
  let length = 0;
  for (const node of block.content) {
    if (node.type === "hard_break") {
      breaks.push(length);
      continue;
    }
    runs.push({ text: node.text, marks: node.marks ?? [] });
    length += node.text.length;
  }
  return { runs, breaks };
}

function listItemRuns(
  document: ManagedRichTextDocument,
  offsets: readonly ManagedSiteFieldMigrationOffsetV1[],
): readonly PositionedRun[] {
  const [list, ...rest] = document.content;
  if (list?.type !== "bullet_list" || rest.length > 0 || list.content.length !== offsets.length) {
    return readBackFail("Target list does not hold one item per part");
  }
  return list.content.flatMap((item, index) => {
    const [paragraph, ...more] = item.content;
    if (more.length > 0) readBackFail("A list item holds more than one paragraph");
    const runs = blockRuns(paragraph);
    if (runsText(runs).length !== offsets[index].end - offsets[index].start) {
      readBackFail("A list item is not exactly its part");
    }
    return positioned(runs, offsets[index].start);
  });
}

function blockMatchesStep(
  block: ManagedRichTextBlock | undefined,
  step: ManagedSiteFieldMigrationStepV1,
): boolean {
  if (step.into.type !== "rich_text" || block === undefined) return false;
  const declared = step.into.block;
  if (declared.type === "heading") {
    return block.type === "heading" && block.attrs.level === declared.level;
  }
  return block.type === declared.type;
}

interface TargetRuns {
  readonly runs: readonly PositionedRun[];
  readonly breaks: readonly number[];
}

function targetRuns(
  value: ManagedSiteContentValue,
  step: ManagedSiteFieldMigrationStepV1,
  offsets: readonly ManagedSiteFieldMigrationOffsetV1[],
): TargetRuns {
  if (step.into.type === "plain_text") {
    if (value.type !== "plain_text") return readBackFail("Target is not plain text");
    return { runs: positioned([{ text: value.value, marks: [] }], 0), breaks: [] };
  }
  if (value.type !== "rich_text") return readBackFail("Target is not rich text");
  const [block, ...rest] = value.value.content;
  if (rest.length > 0 || !blockMatchesStep(block, step)) {
    return readBackFail("Target block is not the declared block");
  }
  if (step.into.block.type === "bullet_list") {
    return { runs: listItemRuns(value.value, offsets), breaks: [] };
  }
  const line = blockLine(block);
  return { runs: positioned(line.runs, 0), breaks: line.breaks };
}

/**
 * The target's breaks are exactly the declared ones, each between the two
 * parts it was declared between: a break that moved, was dropped or was added
 * reads back as a different value, never as the same text.
 */
function assertBreaksDeclared(
  breaks: readonly number[],
  step: ManagedSiteFieldMigrationStepV1,
  offsets: readonly ManagedSiteFieldMigrationOffsetV1[],
): void {
  const declared = managedSiteFieldMigrationBreakOffsets(step, offsets);
  if (declared.length !== breaks.length || declared.some((offset, index) => offset !== breaks[index])) {
    readBackFail("Target hard breaks are not exactly the declared ones");
  }
}

function sliceRuns(
  runs: readonly PositionedRun[],
  offset: ManagedSiteFieldMigrationOffsetV1,
): readonly ManagedSiteFieldMigrationRunV1[] {
  return runs.flatMap((run) => {
    const from = Math.max(offset.start, run.start) - run.start;
    const to = Math.min(offset.end, run.start + run.text.length) - run.start;
    return to > from ? [{ text: run.text.slice(from, to), marks: run.marks }] : [];
  });
}

/** Removes the part's declared marks, which must lead every run of it. */
function innerRuns(
  runs: readonly ManagedSiteFieldMigrationRunV1[],
  declared: readonly ManagedRichTextMark[],
): readonly ManagedSiteFieldMigrationRunV1[] {
  return runs.map((run) => {
    if (!sameMarks(run.marks.slice(0, declared.length), declared)) {
      readBackFail("A part lost a declared mark");
    }
    return { text: run.text, marks: run.marks.slice(declared.length) };
  });
}

function assertCovered(
  runs: readonly PositionedRun[],
  offsets: readonly ManagedSiteFieldMigrationOffsetV1[],
): void {
  const length = runs.reduce((sum, run) => sum + run.text.length, 0);
  if (length !== (offsets.at(-1)?.end ?? 0)) {
    readBackFail("Target text is not exactly its parts");
  }
}

/**
 * Reads each source's text, with its own marks, back out of a target value,
 * given the step and the offsets F recorded. It accepts any spelling of the
 * runs (two adjacent runs with identical marks read back as one), so on its
 * own it is not a canonical check: the verifier also requires the target to
 * equal F in canonical JSON. A literal must read back as
 * itself, unmarked beneath its declared marks; any text the parts do not
 * account for is refused.
 */
export function readBackManagedSiteFieldMigrationStepV1(
  target: ManagedSiteContentValue,
  step: ManagedSiteFieldMigrationStepV1,
  offsets: readonly ManagedSiteFieldMigrationOffsetV1[],
): readonly ManagedSiteFieldMigrationReadBackV1[] {
  if (offsets.length !== step.parts.length) readBackFail("One offset per part is required");
  const { runs, breaks } = targetRuns(target, step, offsets);
  assertCovered(runs, offsets);
  assertBreaksDeclared(breaks, step, offsets);
  return step.parts.flatMap((part, index) => {
    const inner = joinManagedSiteFieldMigrationRuns(
      innerRuns(sliceRuns(runs, offsets[index]), part.marks ?? []),
    );
    if ("literal" in part) {
      if (runsText(inner) !== part.literal || inner.some((run) => run.marks.length > 0)) {
        readBackFail("A literal does not read back as itself");
      }
      return [];
    }
    return [{ fieldId: part.source, text: runsText(inner), runs: inner }];
  });
}
