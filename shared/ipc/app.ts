export type OpenFileOptions = {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

export type OpenFileResult = {
  path: string;
  filename: string;
  url: string;
};

export type ProviderUsageStats = {
  totalSessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalCost: number;
  topModels: Array<{ model: string; count: number }>;
  updatedAt: number;
};

export type ListeningPort = {
  port: number;
  pid: number;
  process: string;
  command: string;
};

export type HttpRequestOptions = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
};

export type HttpRequestResult = {
  status: number;
  headers: Record<string, string>;
  body: string;
  elapsed: number;
};
