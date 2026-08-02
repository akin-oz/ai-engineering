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
