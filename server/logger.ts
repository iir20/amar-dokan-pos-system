// Phase 2 — structured logging.
//
// Every log line is one JSON object: { ts, level, service, msg, ...meta }.
// Nothing secret is ever logged: keys matching the SENSITIVE pattern are
// replaced with "[redacted]" recursively, and request logs carry method,
// path, status and duration only — never headers, cookies or bodies (a
// body could contain a PIN). Use logInfo/logWarn/logError everywhere new
// server code logs; legacy console.log calls in older modules are left
// alone so this change cannot break existing behaviour.

const SENSITIVE = /(pin|password|secret|token|cookie|authorization|api[-_]?key|dsn)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE.test(key) ? '[redacted]' : redact(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && SENSITIVE.test(value)) return '[redacted]';
  return value;
}

export function logLine(level: 'info' | 'warn' | 'error', msg: string, meta: Record<string, unknown> = {}): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    service: 'amar-dokan',
    msg,
    ...(redact(meta) as Record<string, unknown>),
  };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export const logInfo = (msg: string, meta: Record<string, unknown> = {}): void => logLine('info', msg, meta);
export const logWarn = (msg: string, meta: Record<string, unknown> = {}): void => logLine('warn', msg, meta);
export const logError = (msg: string, meta: Record<string, unknown> = {}): void => logLine('error', msg, meta);
