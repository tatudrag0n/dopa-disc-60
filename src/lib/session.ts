import type { MeResponse } from "../shared/types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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
    const message = (data as { error?: string } | null)?.error ?? `error:${res.status}`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export function fetchMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/me");
}

/** 名前を登録してセッションを作る */
export function claimName(name: string): Promise<MeResponse> {
  return request<MeResponse>("/api/me/name?create=1", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function renamePlayer(name: string): Promise<MeResponse> {
  return request<MeResponse>("/api/me/name", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}
