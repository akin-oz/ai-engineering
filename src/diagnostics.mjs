export class DiagnosticError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = "DiagnosticError";
    this.diagnostics = diagnostics;
  }
}

export function fail(message, details = {}) {
  const suffix = details.file ? ` (${details.file})` : "";

  throw new DiagnosticError(`${message}${suffix}`, [
    {
      severity: "error",
      message,
      ...details,
    },
  ]);
}

export function createDiagnostics() {
  const entries = [];

  function add(severity, code, message, details = {}) {
    entries.push({ severity, code, message, ...details });
  }

  return {
    error: (code, message, details) => add("error", code, message, details),
    warning: (code, message, details) => add("warning", code, message, details),
    info: (code, message, details) => add("info", code, message, details),
    push: (diagnostic) => entries.push(diagnostic),
    get entries() {
      return [...entries];
    },
    has(severity) {
      return entries.some((entry) => entry.severity === severity);
    },
    throwIfFailed({ strict = false } = {}) {
      const failed = entries.filter(
        (entry) => entry.severity === "error" || (strict && entry.severity === "warning")
      );

      if (!failed.length) {
        return;
      }

      throw new DiagnosticError(formatDiagnostics(failed), entries);
    },
  };
}

export function formatDiagnostics(diagnostics) {
  return diagnostics
    .map((entry) => {
      const location = entry.file ? ` (${entry.file})` : "";

      return `${entry.severity}: ${entry.message}${location}`;
    })
    .join("\n");
}
