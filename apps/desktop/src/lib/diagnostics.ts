export type DiagnosticEvent = {
  time: string;
  category: string;
  operation?: string;
  code?: string;
  message?: string;
};

const STORAGE_KEY = "volo-ai.diagnostics.v1";
const MAX_EVENTS = 500;
let storageWriteFailed = false;

export function recordFrontendDiagnostic(
  category: string,
  code: string,
  operation?: string,
  message?: string,
): void {
  if (typeof window === "undefined") return;
  try {
    const current = getFrontendDiagnostics();
    current.push({
      time: new Date().toISOString(),
      category: category.slice(0, 80),
      code: code.slice(0, 80),
      ...(operation ? { operation: operation.slice(0, 80) } : {}),
      ...(message ? { message: message.slice(0, 500) } : {}),
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current.slice(-MAX_EVENTS)));
  } catch {
    storageWriteFailed = true;
    // Browser storage may be disabled; diagnostics must not interrupt the app.
  }
}

export function frontendDiagnosticsComplete(): boolean {
  return !storageWriteFailed;
}

export function getFrontendDiagnostics(): DiagnosticEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) {
      storageWriteFailed = true;
      return [];
    }
    const events = value.flatMap((item): DiagnosticEvent[] => {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof item.time !== "string" ||
        typeof item.category !== "string"
      ) {
        return [];
      }
      return [
        {
          time: item.time,
          category: item.category,
          ...(typeof item.operation === "string" ? { operation: item.operation } : {}),
          ...(typeof item.code === "string" ? { code: item.code } : {}),
          ...(typeof item.message === "string" ? { message: item.message } : {}),
        },
      ];
    });
    if (events.length !== value.length) storageWriteFailed = true;
    return events.slice(-MAX_EVENTS);
  } catch {
    storageWriteFailed = true;
    return [];
  }
}

export function clearFrontendDiagnostics(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    storageWriteFailed = false;
  } catch {
    storageWriteFailed = true;
    // Browser storage may be disabled; diagnostics must not interrupt the app.
  }
}
