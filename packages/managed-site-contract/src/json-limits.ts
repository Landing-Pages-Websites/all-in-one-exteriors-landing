import { ManagedSiteContractError } from "./errors.js";

export interface JsonParseLimits {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

export interface JsonTextParseLimits extends JsonParseLimits {
  readonly maxBytes?: number;
}

export interface ResolvedJsonParseLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
}

export interface ResolvedJsonTextLimits extends ResolvedJsonParseLimits {
  readonly maxBytes: number;
}

export const HARD_MAX_JSON_DEPTH = 64;
export const HARD_MAX_JSON_NODES = 50_000;
export const HARD_MAX_JSON_TEXT_BYTES = 16 * 1_024 * 1_024;

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function resolveLimit(
  name: string,
  value: number | undefined,
  hardMaximum: number,
): number {
  if (value === undefined) {
    return hardMaximum;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    return fail("JSON_LIMIT_INVALID", "JSON limits must be non-negative integers");
  }
  if (value > hardMaximum) {
    return fail(
      "JSON_LIMIT_EXCEEDS_HARD_CAP",
      `${name} cannot exceed the implementation hard cap`,
    );
  }
  return value;
}

export function resolveJsonParseLimits(
  limits: JsonParseLimits,
): ResolvedJsonParseLimits {
  return {
    maxDepth: resolveLimit("maxDepth", limits.maxDepth, HARD_MAX_JSON_DEPTH),
    maxNodes: resolveLimit("maxNodes", limits.maxNodes, HARD_MAX_JSON_NODES),
  };
}

export function resolveJsonTextLimits(
  limits: JsonTextParseLimits,
): ResolvedJsonTextLimits {
  return {
    ...resolveJsonParseLimits(limits),
    maxBytes: resolveLimit(
      "maxBytes",
      limits.maxBytes,
      HARD_MAX_JSON_TEXT_BYTES,
    ),
  };
}
