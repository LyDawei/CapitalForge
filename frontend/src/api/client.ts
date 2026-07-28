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

/// Like RequestInit, but body can be any value — the helper auto-encodes
/// object bodies as JSON. Plain strings, Blobs, FormData, etc. pass through.
type ApiInit = Omit<RequestInit, 'body'> & { body?: unknown };

export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  const hasBody = init?.body !== undefined && init?.body !== null;
  const { body, ...rest } = init ?? {};
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    ...(hasBody
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
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
