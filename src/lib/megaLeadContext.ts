/**
 * Attribution capture for Mega lead submissions.
 *
 * Extracted from `useMegaLeadForm` so a form that cannot use the hook can still
 * send a complete lead. That gap is not hypothetical: every customer site whose
 * form does something bespoke (a mailto handoff, a third-party form component,
 * a hand-rolled fetch) has re-implemented a thinner copy of this file, each one
 * quietly dropping the UTMs and click IDs, so those leads can never attribute to
 * a campaign. There was nothing to import, so everyone rewrote it worse.
 *
 * If you are wiring a non-hook form: call `captureLeadContext()` and spread the
 * result into the submission payload alongside `customer_id`, `site_id`,
 * `source_provider` and `form_data`. That is the whole integration.
 *
 * Browser-only, and it NEVER throws. Every function degrades to empty or
 * generated values rather than raising, during SSR and also when the browser
 * denies storage.
 *
 * That second case is not theoretical and is the reason for the wrappers below:
 * with site storage blocked, reading the `localStorage` PROPERTY itself raises
 * `SecurityError`, so even a `typeof localStorage === "undefined"` guard throws.
 * A caller that builds its payload inline would then skip its own `fetch` and
 * stop delivering leads in exactly the browsers that were working before. An
 * unattributed lead beats no lead, so failures here degrade, never propagate.
 */

const STORAGE_KEYS = {
  VISITOR_ID: "_mega_vid",
  SESSION_ID: "_mega_sid",
  ATTRIBUTION: "_mega_attr",
} as const;

/** Params that only exist in the URL on the visitor's FIRST page view. */
const FIRST_TOUCH_PARAMS = [
  "utm_source",
  "gclid",
  "fbclid",
  "gbraid",
  "wbraid",
] as const;

export interface Attribution {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbclid: string | null;
  fbp: string | null;
  fbc: string | null;
}

/** Everything a submission needs beyond the site's own IDs and the form fields. */
export interface LeadContext extends Attribution {
  url: string;
  referrer_url: string | null;
  session_id: string;
  visitor_id: string;
}

const EMPTY_ATTRIBUTION: Attribution = {
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_term: null,
  utm_content: null,
  gclid: null,
  gbraid: null,
  wbraid: null,
  fbclid: null,
  fbp: null,
  fbc: null,
};

const generateId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    },
  )}`;
};

const getCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(";").shift() || null;
  }
  return null;
};

/**
 * Storage access that cannot throw. Both the property read and the method call
 * can raise: `SecurityError` when the site is denied storage, and
 * `QuotaExceededError` on write, including Safari private browsing.
 */
const readStore = (kind: "local" | "session", key: string): string | null => {
  try {
    const store =
      kind === "local" ? window.localStorage : window.sessionStorage;
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const writeStore = (kind: "local" | "session", key: string, value: string) => {
  try {
    const store =
      kind === "local" ? window.localStorage : window.sessionStorage;
    store?.setItem(key, value);
  } catch {
    // Denied storage just means no persistence across pages. The lead still
    // sends, carrying whatever this page view could observe.
  }
};

const persistedId = (
  kind: "local" | "session",
  key: string,
  prefix: string,
): string => {
  const existing = readStore(kind, key);
  if (existing) return existing;
  const generated = generateId(prefix);
  writeStore(kind, key, generated);
  return generated;
};

export const getVisitorId = (): string =>
  persistedId("local", STORAGE_KEYS.VISITOR_ID, "vis");

export const getSessionId = (): string =>
  persistedId("session", STORAGE_KEYS.SESSION_ID, "sess");

const captureAttribution = (): Attribution => {
  if (typeof window === "undefined") return { ...EMPTY_ATTRIBUTION };

  const params = new URL(window.location.href).searchParams;

  const attribution: Attribution = {
    utm_source: params.get("utm_source"),
    utm_medium: params.get("utm_medium"),
    utm_campaign: params.get("utm_campaign"),
    utm_term: params.get("utm_term"),
    utm_content: params.get("utm_content"),
    gclid: params.get("gclid"),
    gbraid: params.get("gbraid"),
    wbraid: params.get("wbraid"),
    fbclid: params.get("fbclid"),
    fbp: getCookie("_fbp"),
    fbc: getCookie("_fbc"),
  };

  // Meta CAPI needs fbc; derive it from fbclid when the pixel has not yet set
  // the cookie, which is the common case on a first page view.
  if (attribution.fbclid && !attribution.fbc) {
    attribution.fbc = `fb.1.${Date.now()}.${attribution.fbclid}`;
  }

  return attribution;
};

/**
 * First-touch attribution, persisted.
 *
 * Click IDs and UTMs only exist in the URL on the landing page, so a visitor who
 * browses to a contact page before converting would otherwise submit with
 * nothing. Call this on page load as well as at submit time.
 */
export const initAttribution = (): Attribution => {
  if (typeof window === "undefined") return { ...EMPTY_ATTRIBUTION };

  const params = new URL(window.location.href).searchParams;
  const isFirstTouch = FIRST_TOUCH_PARAMS.some((param) => params.has(param));

  if (!isFirstTouch) {
    const stored = readStore("local", STORAGE_KEYS.ATTRIBUTION);
    if (stored) {
      try {
        return JSON.parse(stored) as Attribution;
      } catch {
        console.warn("Failed to parse stored attribution");
      }
    }
  }

  const attribution = captureAttribution();
  writeStore("local", STORAGE_KEYS.ATTRIBUTION, JSON.stringify(attribution));
  return attribution;
};

/**
 * The full context to attach to a lead submission.
 *
 * Spread this into the payload. Anything you leave out is attribution the lead
 * can never recover, because these values do not exist anywhere else by the
 * time the lead reaches Keystone.
 */
export const captureLeadContext = (): LeadContext => {
  try {
    return {
      ...initAttribution(),
      url: typeof window === "undefined" ? "" : window.location.href,
      referrer_url:
        typeof document === "undefined" ? null : document.referrer || null,
      session_id: getSessionId(),
      visitor_id: getVisitorId(),
    };
  } catch (error) {
    // Belt and braces over the per-call guards above. A caller spreading this
    // into a payload literal must never lose its own fetch to our exception.
    console.warn("Lead attribution capture failed (non-blocking):", error);
    return {
      ...EMPTY_ATTRIBUTION,
      url: "",
      referrer_url: null,
      session_id: generateId("sess"),
      visitor_id: generateId("vis"),
    };
  }
};
