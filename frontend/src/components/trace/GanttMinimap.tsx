interface GanttMinimapProps {
  zoom: { start: number; end: number };
  onZoomChange: (zoom: { start: number; end: number }) => void;
}

export function GanttMinimap({ zoom, onZoomChange }: GanttMinimapProps) {
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickPercent = ((e.clientX - rect.left) / rect.width) * 100;
    const windowSize = zoom.end - zoom.start;
    const half = windowSize / 2;
    const newStart = Math.max(0, Math.min(100 - windowSize, clickPercent - half));
    onZoomChange({ start: newStart, end: newStart + windowSize });
  };

  const handleReset = () => {
    onZoomChange({ start: 0, end: 100 });
  };

  const isZoomed = zoom.start !== 0 || zoom.end !== 100;

  if (!isZoomed) return null;

  return (
    <div className="flex items-center gap-2 mb-2">
      <div
        className="flex-1 h-4 bg-gray-100 rounded border relative cursor-pointer"
        onClick={handleClick}
        title="Click to pan"
      >
        {/* Viewport indicator */}
        <div
          className="absolute top-0 h-full bg-blue-200 border border-blue-400 rounded opacity-70"
          style={{
            left: `${zoom.start}%`,
            width: `${zoom.end - zoom.start}%`,
          }}
        />
      </div>
      <button
        onClick={handleReset}
        className="px-2 py-0.5 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded border border-blue-200"
      >
        Reset Zoom
      </button>
    </div>
  );
}
