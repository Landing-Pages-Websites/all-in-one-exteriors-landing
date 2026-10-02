import { ManagedSiteContractError } from "./errors.js";
import {
  HARD_MAX_JSON_TEXT_BYTES,
  resolveJsonTextLimits,
  type JsonTextParseLimits,
  type ResolvedJsonTextLimits,
} from "./json-limits.js";
import {
  parseJsonValue,
  type JsonValue,
} from "./json.js";

export { HARD_MAX_JSON_TEXT_BYTES };
export type { JsonTextParseLimits };

const HEX_ESCAPE_PATTERN = /^[0-9a-fA-F]{4}$/;
const DIGIT_PATTERN = /^[0-9]$/;
const NON_ZERO_DIGIT_PATTERN = /^[1-9]$/;
const ESCAPED_CHARACTERS: Readonly<Record<string, string>> = Object.freeze({
  '"': '"',
  "/": "/",
  "\\": "\\",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
});

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function isJsonWhitespace(value: string | undefined): boolean {
  return value === " " || value === "\t" || value === "\n" || value === "\r";
}

class JsonTextReader {
  private index = 0;
  private nodes = 0;

  public constructor(
    private readonly input: string,
    private readonly limits: ResolvedJsonTextLimits,
  ) {}

  public parse(): unknown {
    this.skipWhitespace();
    if (this.index === this.input.length) {
      return this.invalid();
    }
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.input.length) {
      return fail("JSON_TEXT_TRAILING", "JSON text contains trailing content");
    }
    return value;
  }

  private invalid(): never {
    return fail("JSON_TEXT_INVALID", "JSON text is malformed");
  }

  private peek(): string | undefined {
    return this.input[this.index];
  }

  private consume(expected: string): boolean {
    if (this.peek() !== expected) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private expect(expected: string): void {
    if (!this.consume(expected)) {
      this.invalid();
    }
  }

  private skipWhitespace(): void {
    while (isJsonWhitespace(this.peek())) {
      this.index += 1;
    }
  }

  private countNode(depth: number): void {
    if (depth > this.limits.maxDepth) {
      return fail("JSON_MAX_DEPTH", "JSON exceeds the configured depth limit");
    }
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) {
      return fail("JSON_MAX_NODES", "JSON exceeds the configured node limit");
    }
  }

  private parseValue(depth: number): unknown {
    this.countNode(depth);
    const token = this.peek();
    if (token === '"') {
      return this.parseString();
    }
    if (token === "[") {
      return this.parseArray(depth);
    }
    if (token === "{") {
      return this.parseObject(depth);
    }
    if (token === "-" || (token !== undefined && DIGIT_PATTERN.test(token))) {
      return this.parseNumber();
    }
    return this.parseLiteral();
  }

  private parseLiteral(): null | boolean {
    if (this.input.startsWith("false", this.index)) {
      this.index += "false".length;
      return false;
    }
    if (this.input.startsWith("null", this.index)) {
      this.index += "null".length;
      return null;
    }
    if (this.input.startsWith("true", this.index)) {
      this.index += "true".length;
      return true;
    }
    return this.invalid();
  }

  private parseString(): string {
    this.expect('"');
    let result = "";
    while (this.index < this.input.length) {
      const value = this.input[this.index];
      this.index += 1;
      if (value === '"') {
        return result;
      }
      result += this.parseStringCharacter(value);
    }
    return this.invalid();
  }

  private parseStringCharacter(value: string): string {
    if (value === "\\") {
      return this.parseEscape();
    }
    return value.charCodeAt(0) <= 0x1f ? this.invalid() : value;
  }

  private parseEscape(): string {
    const escape = this.input[this.index];
    this.index += 1;
    if (escape === "u") {
      return this.parseUnicodeEscape();
    }
    const decoded = ESCAPED_CHARACTERS[escape];
    return decoded === undefined ? this.invalid() : decoded;
  }

  private parseUnicodeEscape(): string {
    const encoded = this.input.slice(this.index, this.index + 4);
    if (!HEX_ESCAPE_PATTERN.test(encoded)) {
      return this.invalid();
    }
    this.index += 4;
    return String.fromCharCode(Number.parseInt(encoded, 16));
  }

  private parseNumber(): number {
    const start = this.index;
    this.consume("-");
    this.parseIntegerPart();
    this.parseFractionPart();
    this.parseExponentPart();
    return Number(this.input.slice(start, this.index));
  }

  private parseIntegerPart(): void {
    if (this.consume("0")) {
      if (DIGIT_PATTERN.test(this.peek() ?? "")) {
        this.invalid();
      }
      return;
    }
    const first = this.peek();
    if (first === undefined || !NON_ZERO_DIGIT_PATTERN.test(first)) {
      this.invalid();
    }
    this.index += 1;
    this.consumeDigits();
  }

  private parseFractionPart(): void {
    if (!this.consume(".")) {
      return;
    }
    this.consumeRequiredDigits();
  }

  private parseExponentPart(): void {
    const token = this.peek();
    if (token !== "e" && token !== "E") {
      return;
    }
    this.index += 1;
    if (this.peek() === "+" || this.peek() === "-") {
      this.index += 1;
    }
    this.consumeRequiredDigits();
  }

  private consumeRequiredDigits(): void {
    if (!DIGIT_PATTERN.test(this.peek() ?? "")) {
      this.invalid();
    }
    this.consumeDigits();
  }

  private consumeDigits(): void {
    while (DIGIT_PATTERN.test(this.peek() ?? "")) {
      this.index += 1;
    }
  }

  private parseArray(depth: number): readonly unknown[] {
    this.expect("[");
    this.skipWhitespace();
    const result: unknown[] = [];
    if (this.consume("]")) {
      return result;
    }
    result.push(this.parseValue(depth + 1));
    while (this.consumeContainerSeparator("]")) {
      result.push(this.parseValue(depth + 1));
    }
    return result;
  }

  private parseObject(depth: number): Readonly<Record<string, unknown>> {
    this.expect("{");
    this.skipWhitespace();
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    const normalizedKeys = new Set<string>();
    if (this.consume("}")) {
      return result;
    }
    this.parseObjectProperty(result, keys, normalizedKeys, depth);
    while (this.consumeContainerSeparator("}")) {
      this.parseObjectProperty(result, keys, normalizedKeys, depth);
    }
    return result;
  }

  private parseObjectProperty(
    result: Record<string, unknown>,
    keys: Set<string>,
    normalizedKeys: Set<string>,
    depth: number,
  ): void {
    const key = this.parseObjectKey(keys, normalizedKeys);
    this.skipWhitespace();
    this.expect(":");
    this.skipWhitespace();
    result[key] = this.parseValue(depth + 1);
  }

  private parseObjectKey(keys: Set<string>, normalizedKeys: Set<string>): string {
    if (this.peek() !== '"') {
      return this.invalid();
    }
    const key = this.parseString();
    if (keys.has(key)) {
      return fail("JSON_DUPLICATE_KEY", "JSON object keys must be unique");
    }
    const normalized = key.normalize("NFC");
    if (normalizedKeys.has(normalized)) {
      return fail(
        "JSON_KEY_NORMALIZATION_COLLISION",
        "Object keys collide after Unicode normalization",
      );
    }
    keys.add(key);
    normalizedKeys.add(normalized);
    return key;
  }

  private consumeContainerSeparator(end: string): boolean {
    this.skipWhitespace();
    if (this.consume(end)) {
      return false;
    }
    this.expect(",");
    this.skipWhitespace();
    return true;
  }
}

export function parseJsonText(
  input: string,
  limits: JsonTextParseLimits = {},
): JsonValue {
  if (typeof input !== "string") {
    return fail("JSON_TEXT_INVALID", "JSON text input must be a string");
  }
  const resolvedLimits = resolveJsonTextLimits(limits);
  if (Buffer.byteLength(input, "utf8") > resolvedLimits.maxBytes) {
    return fail("JSON_TEXT_MAX_BYTES", "JSON text exceeds the configured byte limit");
  }
  const parsed = new JsonTextReader(input, resolvedLimits).parse();
  return parseJsonValue(parsed, resolvedLimits);
}
