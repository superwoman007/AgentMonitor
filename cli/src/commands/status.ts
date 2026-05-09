interface StatusOptions {
  baseUrl: string;
  apiKey: string;
}

interface StatusResult {
  totalRequests: number;
  successRate: number;
  avgLatency: number;
  todayTraces: number;
}

export async function getStatus(options: StatusOptions): Promise<StatusResult> {
  const response = await fetch(`${options.baseUrl}/api/v1/stats`, {
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch status: ${response.status}`);
  }

  const data = await response.json() as {
    stats?: {
      totalRequests?: number;
      successRate?: number;
      avgLatency?: number;
      todayTraces?: number;
    };
  };

  return {
    totalRequests: data.stats?.totalRequests || 0,
    successRate: data.stats?.successRate || 0,
    avgLatency: data.stats?.avgLatency || 0,
    todayTraces: data.stats?.todayTraces || 0,
  };
}
