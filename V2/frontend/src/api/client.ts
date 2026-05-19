const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  /// Parsed JSON body if the server returned structured error info (e.g., the
  /// prompt-preview 400 with `{ parseError, renderedPrompt, rawResponse }`).
  /// Undefined when the body was empty or not JSON.
  public body?: any;
  constructor(public status: number, message: string, body?: any) {
    super(message);
    this.body = body;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const raw = await res.text();
    let parsed: any;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      parsed = undefined;
    }
    const message = parsed?.message ?? parsed?.error ?? raw ?? res.statusText;
    throw new ApiError(res.status, message, parsed);
  }
  return (await res.json()) as T;
}
