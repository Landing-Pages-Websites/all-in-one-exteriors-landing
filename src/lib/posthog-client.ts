import type { PostHog } from "posthog-js";

/**
 * Registry for the lazily-initialized PostHog instance. PostHogProvider sets
 * it after init; trackEvent reads it. Type-only import keeps posthog-js out
 * of bundles that only need trackEvent.
 */
let client: PostHog | null = null;

export function setPostHogClient(instance: PostHog): void {
  client = instance;
}

export function getPostHogClient(): PostHog | null {
  return client;
}
