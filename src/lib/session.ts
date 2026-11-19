import type { ConfigResponse, MeResponse } from "../shared/types";

export class ApiError extends Error {
  status: number;
  /** サーバーが返す理由コード（name.ng など）。多言語の文言選びに使う。 */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      ...init,
    });
  } catch {
    throw new ApiError("network", 0);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const body = data as { error?: string; code?: string } | null;
    const message = body?.error ?? `error:${res.status}`;
    throw new ApiError(message, res.status, body?.code);
  }
  return data as T;
}

export function fetchConfig(): Promise<ConfigResponse> {
  return request<ConfigResponse>("/api/config");
}

export function fetchMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/me");
}

/** 名前を登録してセッションを作る（Turnstile のトークンが必要） */
export function claimName(name: string, turnstileToken: string): Promise<MeResponse> {
  return request<MeResponse>("/api/me/name?create=1", {
    method: "POST",
    body: JSON.stringify({ name, turnstileToken }),
  });
}

export function renamePlayer(name: string): Promise<MeResponse> {
  return request<MeResponse>("/api/me/name", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}
