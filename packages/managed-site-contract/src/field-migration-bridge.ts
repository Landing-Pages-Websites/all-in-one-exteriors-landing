import { canonicalizeJson } from "./canonical.js";
import {
  isSupportedBridgeVersion,
  SUPPORTED_BRIDGE_VERSIONS,
  type ManagedSiteBridgeDescriptor,
  type ManagedSiteContractV1,
  type SupportedBridgeVersion,
} from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";
import type { ManagedSiteFieldMigrationV1 } from "./field-migration-schema.js";

/**
 * Whether the platform can serve this bridge version at this integrity. Site
 * Guard answers it from the asset it actually serves; nothing here can, so it
 * is injected and has no default.
 */
export type ManagedSiteBridgeAdmission = (
  version: SupportedBridgeVersion,
  integrity: string,
) => boolean;

export interface ManagedSiteFieldMigrationBridgeStepV1 {
  readonly from: SupportedBridgeVersion;
  readonly to: SupportedBridgeVersion;
}

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

/** The descriptor without what a version step may change: version, src, integrity. */
function fixedPart(bridge: NonNullable<ManagedSiteBridgeDescriptor>): unknown {
  const { delivery, ...rest } = bridge;
  return { ...rest, crossOrigin: delivery.crossOrigin, load: delivery.load };
}

function assertDeclaredVersions(
  declared: NonNullable<ManagedSiteFieldMigrationV1["bridge"]>,
  production: SupportedBridgeVersion,
  candidate: SupportedBridgeVersion,
): void {
  if (!isSupportedBridgeVersion(declared.from) || !isSupportedBridgeVersion(declared.to)) {
    fail("MIGRATION_BRIDGE_UNSUPPORTED", "Declared bridge version is not supported");
  }
  if (declared.from !== production || declared.to !== candidate) {
    fail("MIGRATION_BRIDGE_MISMATCH", "Declared bridge step is not the contracts' step");
  }
}

function assertForwardStep(from: SupportedBridgeVersion, to: SupportedBridgeVersion): void {
  const distance = SUPPORTED_BRIDGE_VERSIONS.indexOf(to) - SUPPORTED_BRIDGE_VERSIONS.indexOf(from);
  if (distance <= 0) {
    fail("MIGRATION_BRIDGE_DOWNGRADE", `Bridge moves backwards: ${from} to ${to}`);
  }
  if (distance > 1) {
    fail("MIGRATION_BRIDGE_GAP", `Bridge skips a version: ${from} to ${to}`);
  }
}

function unchangedBridge(
  declaration: ManagedSiteFieldMigrationV1,
): null {
  if (declaration.bridge !== undefined) {
    fail("MIGRATION_BRIDGE_MISMATCH", "A bridge step is declared but the bridge is unchanged");
  }
  return null;
}

/**
 * The runtime may change only along a declared forward step of one supported
 * version that the platform admits; the rest of the descriptor is fixed.
 */
export function assertManagedSiteFieldMigrationBridgeV1(
  production: ManagedSiteContractV1,
  candidate: ManagedSiteContractV1,
  declaration: ManagedSiteFieldMigrationV1,
  admitBridge: ManagedSiteBridgeAdmission,
): ManagedSiteFieldMigrationBridgeStepV1 | null {
  if (sameJson(production.bridge, candidate.bridge)) return unchangedBridge(declaration);
  if (declaration.bridge === undefined) {
    return fail("MIGRATION_BRIDGE_UNDECLARED", "The bridge changed without a declared step");
  }
  if (production.bridge === null || candidate.bridge === null) {
    return fail("MIGRATION_BRIDGE_UNSUPPORTED", "A bridge cannot be added or removed by migration");
  }
  const from = production.bridge.delivery.version;
  const to = candidate.bridge.delivery.version;
  assertDeclaredVersions(declaration.bridge, from, to);
  assertForwardStep(from, to);
  if (!sameJson(fixedPart(production.bridge), fixedPart(candidate.bridge))) {
    fail("MIGRATION_BRIDGE_DESCRIPTOR_CHANGED", "Only the bridge version may change");
  }
  if (admitBridge(to, candidate.bridge.delivery.integrity) !== true) {
    fail("MIGRATION_BRIDGE_UNSUPPORTED", `The platform does not serve bridge ${to} at that integrity`);
  }
  return { from, to };
}
