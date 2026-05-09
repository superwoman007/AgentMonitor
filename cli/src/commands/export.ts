import fs from 'fs';

interface ExportOptions {
  baseUrl: string;
  apiKey: string;
  since?: string;
  format: 'json' | 'csv';
  outputPath: string;
}

export async function exportTraces(options: ExportOptions): Promise<void> {
  const query = new URLSearchParams();
  if (options.since) query.set('since', options.since);
  query.set('limit', '1000');

  const response = await fetch(`${options.baseUrl}/api/v1/traces?${query.toString()}`, {
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch traces: ${response.status}`);
  }

  const data = await response.json();

  if (options.format === 'csv') {
    const traces = (data.traces || []) as Array<Record<string, unknown>>;
    const headers = ['id', 'name', 'trace_type', 'status', 'latency_ms', 'started_at'];
    const rows = traces.map(t =>
      headers.map(h => {
        const val = t[h];
        if (val === null || val === undefined) return '';
        return String(val).replace(/,/g, ';');
      }).join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    fs.writeFileSync(options.outputPath, csv, 'utf-8');
  } else {
    fs.writeFileSync(options.outputPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
