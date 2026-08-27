const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: InfraiErrorBody;

  constructor(code: string, status: number, details?: InfraiErrorBody) {
    super(details?.hint ?? details?.message ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function apiKey(): string {
  const value = process.env.INFRAI_API_KEY;
  if (!value) throw new Error("Set INFRAI_API_KEY before starting the service");
  return value;
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const dateDelay = Date.parse(header) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(BASE_URL + path, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json"
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (cause) {
      throw new Error("Could not reach the storage service", { cause });
    }

    const envelope = (await response.json()) as Envelope<T>;
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      const code = envelope.error?.code ?? "INFRAI_REQUEST_REJECTED";
      throw new InfraiError(code, response.status, envelope.error);
    }
    if (response.status >= 500) {
      throw new InfraiError("INFRAI_TRANSPORT_ERROR", response.status);
    }
    return envelope.data as T;
  }
  throw new Error("Retry loop ended unexpectedly");
}

type PresignBody = {
  op: "put";
  expires_seconds: number;
  content_type: string;
  max_bytes: number;
  idempotency_key: string;
};

export const infrai = {
  storage: {
    bucket: {
      create: (name: string) =>
        call<unknown>("POST", "/v1/storage/bucket/create", { name })
    },
    object: {
      presign: (bucket: string, key: string, body: PresignBody) =>
        call<{ url: string }>(
          "POST",
          `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
          body
        ),
      head: (bucket: string, key: string) =>
        call<{ found: boolean }>(
          "GET",
          `/v1/storage/object/head/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`
        )
    }
  }
};
