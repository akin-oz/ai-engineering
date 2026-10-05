import { fail } from "../diagnostics.mjs";

const PERMISSION_KEYS = ["allow", "deny"];

/**
 * Security presets a workspace can name with `security:`. They expand at load
 * time, so an improvement to a preset reaches every workspace on its next sync;
 * the changelog names every change. The deny list is the set of files
 * `aie audit` reports as secret-readable, so a hardened workspace audits clean.
 */
export const SECURITY_PRESETS = {
  hardened: {
    permissions: { allow: [], deny: ["Read(.env)", "Read(.env.*)", "Read(*.pem)", "Read(*.key)"] },
    sandbox: { enabled: true },
  },
};

export function resolveSecurity(value, file) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const preset = typeof value === "string" ? SECURITY_PRESETS[value] : undefined;

  if (!preset) {
    fail(
      `Unknown security preset "${value}". Available presets: ${Object.keys(SECURITY_PRESETS).join(", ")}.`,
      { file }
    );
  }

  return { name: value, ...preset };
}

/**
 * Adds a workspace's own sandbox keys to a preset's. A key both set to
 * different values is an error: the workspace gave two answers to one question.
 */
export function mergeSandbox(preset, sandbox, file) {
  if (!preset) {
    return sandbox;
  }

  return mergeInto(preset.sandbox, sandbox, "sandbox", preset.name, file);
}

function mergeInto(base, extra, at, name, file) {
  const merged = { ...base };

  for (const [key, value] of Object.entries(extra)) {
    const here = `${at}.${key}`;

    if (!(key in merged)) {
      merged[key] = value;
    } else if (isObject(merged[key]) && isObject(value)) {
      merged[key] = mergeInto(merged[key], value, here, name, file);
    } else if (JSON.stringify(merged[key]) !== JSON.stringify(value)) {
      fail(
        `security: ${name} sets ${here} to ${JSON.stringify(merged[key])}, but this workspace sets it to ` +
        `${JSON.stringify(value)}. Remove one of them.`,
        { file }
      );
    }
  }

  return merged;
}

/**
 * Permission rules are the runtime's own vocabulary, like hook tool names, so
 * the core checks only their shape. Whether a runtime can enforce them is the
 * adapter's call.
 */
export function normalizePermissions(value, file, subject = "permissions") {
  if (value === undefined || value === null) {
    return { allow: [], deny: [] };
  }

  if (!isObject(value)) {
    fail(`"${subject}" must be a mapping with "allow" and "deny" lists`, { file });
  }

  for (const key of Object.keys(value)) {
    if (!PERMISSION_KEYS.includes(key)) {
      fail(`Unknown ${subject} field "${key}". Supported fields are ${PERMISSION_KEYS.join(", ")}.`, { file });
    }
  }

  return Object.fromEntries(PERMISSION_KEYS.map((key) => {
    const rules = value[key] ?? [];

    if (!Array.isArray(rules) || rules.some((rule) => typeof rule !== "string" || !rule.trim())) {
      fail(`"${subject}.${key}" must be a list of non-empty strings`, { file });
    }

    return [key, unique(rules.map((rule) => rule.trim()))];
  }));
}

/**
 * Combines permission groups in declaration order. A rule both allowed and
 * denied is dropped from allow: the runtime evaluates deny first anyway, and a
 * generated allow it never honors would only mislead the reader.
 */
export function combinePermissions(groups, diagnostics, file) {
  const deny = unique(groups.flatMap((group) => group.deny));
  const denied = new Set(deny);
  const requested = unique(groups.flatMap((group) => group.allow));

  for (const rule of requested.filter((item) => denied.has(item))) {
    diagnostics.warning(
      "permission-conflict",
      `"${rule}" is both allowed and denied. Deny wins, so it is left out of permissions.allow.`,
      { file, rule }
    );
  }

  return { allow: requested.filter((rule) => !denied.has(rule)), deny };
}

/**
 * The sandbox block is passed to adapters as data. The core only guarantees it
 * is a mapping of JSON values, so any adapter can serialize it deterministically.
 */
export function normalizeSandbox(value, file) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isObject(value)) {
    fail('"sandbox" must be a mapping', { file });
  }

  assertJson(value, "sandbox", file);

  return value;
}

function assertJson(value, at, file) {
  if (value === null || ["string", "boolean"].includes(typeof value)) {
    return;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJson(item, `${at}[${index}]`, file));
    return;
  }

  if (isObject(value) && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      assertJson(item, `${at}.${key}`, file);
    }
    return;
  }

  fail(`"${at}" must be a string, number, boolean, list, or mapping`, { file });
}

function unique(values) {
  return [...new Set(values)];
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
