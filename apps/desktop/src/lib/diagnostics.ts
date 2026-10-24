export type DiagnosticEvent = {
  time: string;
  category: string;
  operation?: string;
  code?: string;
  message?: string;
  traceback?: string;
  request_id?: string;
  provider?: string;
  stage?: string;
  asset?: string;
  error_type?: string;
  duration_ms?: number;
};

type DiagnosticDetails = Pick<
  DiagnosticEvent,
  "traceback" | "request_id" | "provider" | "stage" | "asset" | "error_type" | "duration_ms"
>;

const STORAGE_KEY = "volo-ai.diagnostics.v1";
const MAX_EVENTS = 500;
const MAX_BYTES = 1_000_000;
let storageWriteFailed = false;

export function recordFrontendDiagnostic(
  category: string,
  code: string,
  operation?: string,
  message?: string,
  details: DiagnosticDetails = {},
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
      ...(details.traceback ? { traceback: details.traceback.slice(0, 12_000) } : {}),
      ...(details.request_id ? { request_id: details.request_id.slice(0, 80) } : {}),
      ...(details.provider ? { provider: details.provider.slice(0, 80) } : {}),
      ...(details.stage ? { stage: details.stage.slice(0, 80) } : {}),
      ...(details.asset ? { asset: details.asset.slice(0, 500) } : {}),
      ...(details.error_type ? { error_type: details.error_type.slice(0, 80) } : {}),
      ...(Number.isFinite(details.duration_ms)
        ? { duration_ms: Math.max(0, Math.round(details.duration_ms!)) }
        : {}),
    });
    const events = current.slice(-MAX_EVENTS);
    let serialized = JSON.stringify(events);
    while (events.length > 1 && new TextEncoder().encode(serialized).length > MAX_BYTES) {
      events.shift();
      serialized = JSON.stringify(events);
    }
    window.localStorage.setItem(STORAGE_KEY, serialized);
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
          ...(typeof item.traceback === "string" ? { traceback: item.traceback } : {}),
          ...(typeof item.request_id === "string" ? { request_id: item.request_id } : {}),
          ...(typeof item.provider === "string" ? { provider: item.provider } : {}),
          ...(typeof item.stage === "string" ? { stage: item.stage } : {}),
          ...(typeof item.asset === "string" ? { asset: item.asset } : {}),
          ...(typeof item.error_type === "string" ? { error_type: item.error_type } : {}),
          ...(typeof item.duration_ms === "number" && Number.isFinite(item.duration_ms)
            ? { duration_ms: Math.max(0, Math.round(item.duration_ms)) }
            : {}),
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

export function frontendDiagnosticsForExport(homePath: string | null): DiagnosticEvent[] {
  const events = getFrontendDiagnostics();
  if (!homePath) {
    return events.map(({ message, traceback, asset, ...event }) => event);
  }
  const normalizedHome = homePath.replace(/[\\/]+$/, "");
  const prefixes = [
    normalizedHome,
    normalizedHome.replaceAll("\\", "/"),
    normalizedHome.replaceAll("/", "\\"),
  ].filter((prefix) => prefix && prefix !== ".");
  const redact = (value: string) =>
    prefixes.reduce((result, prefix) => result.split(prefix).join("~"), value);
  return events.map((event) => ({
    ...event,
    ...(event.message ? { message: redact(event.message) } : {}),
    ...(event.traceback ? { traceback: redact(event.traceback) } : {}),
    ...(event.asset ? { asset: redact(event.asset) } : {}),
  }));
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
