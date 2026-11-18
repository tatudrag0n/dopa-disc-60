import type {
  LeaderboardResponse,
  MeResponse,
  ScoreRange,
  SubmitResponse,
} from "../shared/types";

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
    const message =
      (data as { error?: string } | null)?.error ?? `error:${res.status}`;
    throw new ApiError(message, res.status);
  }
  return data as T;
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
