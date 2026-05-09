import { useMemo } from 'react';
import { useTranslation } from '../App';
import { TrendPoint } from '../api';

interface TrendChartProps {
  data: TrendPoint[];
}

function LinePath({
  points,
  color,
  strokeWidth = 2,
}: {
  points: Array<{ x: number; y: number }>;
  color: string;
  strokeWidth?: number;
}) {
  if (points.length < 2) return null;
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');
  return <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
}

function AreaPath({
  points,
  color,
}: {
  points: Array<{ x: number; y: number }>;
  color: string;
}) {
  if (points.length < 2) return null;
  const d =
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') +
    ` L ${points[points.length - 1].x} 100 L ${points[0].x} 100 Z`;
  return <path d={d} fill={color} opacity={0.1} stroke="none" />;
}

export function TrendChart({ data }: TrendChartProps) {
  const { t } = useTranslation();

  const padding = { top: 10, right: 10, bottom: 24, left: 40 };
  const width = 600;
  const height = 200;
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const { tracePoints, tokenPoints, ratePoints } = useMemo(() => {
    if (data.length === 0) {
      return { tracePoints: [], tokenPoints: [], ratePoints: [] };
    }

    const maxTrace = Math.max(...data.map((d) => d.traceCount), 1);
    const maxToken = Math.max(...data.map((d) => d.tokenCount), 1);

    const tracePoints = data.map((d, i) => {
      const x = padding.left + (i / (data.length - 1)) * chartW;
      const y = padding.top + chartH - (d.traceCount / maxTrace) * chartH;
      return { x, y, value: d.traceCount, date: d.date };
    });

    const tokenPoints = data.map((d, i) => {
      const x = padding.left + (i / (data.length - 1)) * chartW;
      const y = padding.top + chartH - (d.tokenCount / maxToken) * chartH;
      return { x, y, value: d.tokenCount, date: d.date };
    });

    const ratePoints = data.map((d, i) => {
      const x = padding.left + (i / (data.length - 1)) * chartW;
      const y = padding.top + chartH - (d.successRate / 100) * chartH;
      return { x, y, value: d.successRate, date: d.date };
    });

    return { tracePoints, tokenPoints, ratePoints };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">{t.traceCenter}</h3>
        <div className="text-center text-gray-400 py-8 text-sm">{t.noData}</div>
      </div>
    );
  }

  const xLabels = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1 || 1)) * chartW;
    return { x, label: d.date.slice(5) };
  });

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">{t.traceCenter}</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            {t.totalRequests}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-orange-500" />
            {t.totalTokens}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {t.successRate}
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-48">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + chartH * (1 - ratio);
          return (
            <g key={ratio}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#9ca3af">
                {Math.round(ratio * 100)}%
              </text>
            </g>
          );
        })}

        {/* Area fills */}
        <AreaPath points={tracePoints} color="#3b82f6" />
        <AreaPath points={tokenPoints} color="#f97316" />
        <AreaPath points={ratePoints} color="#22c55e" />

        {/* Lines */}
        <LinePath points={tracePoints} color="#3b82f6" />
        <LinePath points={tokenPoints} color="#f97316" />
        <LinePath points={ratePoints} color="#22c55e" />

        {/* Data points */}
        {tracePoints.map((p, i) => (
          <circle key={`t-${i}`} cx={p.x} cy={p.y} r={3} fill="#3b82f6" />
        ))}
        {tokenPoints.map((p, i) => (
          <circle key={`tk-${i}`} cx={p.x} cy={p.y} r={3} fill="#f97316" />
        ))}
        {ratePoints.map((p, i) => (
          <circle key={`r-${i}`} cx={p.x} cy={p.y} r={3} fill="#22c55e" />
        ))}

        {/* X axis labels */}
        {xLabels.map((l, i) => (
          <text key={i} x={l.x} y={height - 4} textAnchor="middle" fontSize={10} fill="#9ca3af">
            {l.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
