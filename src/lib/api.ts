import type {
  ConfigResponse,
  LeaderboardResponse,
  MeResponse,
  ScoreRange,
  SubmitResponse,
} from "../shared/types";

export class ApiError extends Error {
  status: number;
  /** サーバーが返す理由コード（name.ng など）。 */
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

export function fetchLeaderboard(range: ScoreRange, limit = 50): Promise<LeaderboardResponse> {
  return request<LeaderboardResponse>(`/api/leaderboard?range=${range}&limit=${limit}`);
}

export interface SubmitPayload {
  shapeScore: number;
  rot: number;
  mom: number;
  /** 未登録のプレイヤーが最初の1回だけ送る */
  name?: string;
  /** Turnstile のトークン */
  turnstileToken?: string;
}

export function submitScore(payload: SubmitPayload): Promise<SubmitResponse> {
  return request<SubmitResponse>("/api/scores", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function renamePlayer(name: string): Promise<MeResponse> {
  return request<MeResponse>("/api/me/name", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function forgetPlayer(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/logout", { method: "POST", body: "{}" });
}
