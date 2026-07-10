import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ToolShell from './ToolShell';

type ChartType = 'bar' | 'line' | 'pie';

interface DataRow {
  id: string;
  label: string;
  value: number;
}

const STORAGE_PREFIX = 'xos-studio-chart-';

const AXIS_COLOR = '#607080';
const GRID_COLOR = 'rgba(96, 112, 128, 0.35)';
const TEXT_COLOR = '#C8D8E8';
const BAR_COLOR = '#00F5FF';
const LINE_COLOR = '#00F5FF';
const PIE_PALETTE = ['#00F5FF', '#8B5CF6', '#FF2D78', '#FFA500', '#39FF88', '#FFD700'];

function defaultRows(): DataRow[] {
  return [
    { id: 'row-1', label: 'Mon', value: 42 },
    { id: 'row-2', label: 'Tue', value: 68 },
    { id: 'row-3', label: 'Wed', value: 35 },
    { id: 'row-4', label: 'Thu', value: 90 },
  ];
}

let rowIdCounter = 0;
function nextRowId(): string {
  rowIdCounter += 1;
  return `row-${Date.now()}-${rowIdCounter}`;
}

function niceMax(rawMax: number): number {
  if (!isFinite(rawMax) || rawMax <= 0) return 10;
  let step: number;
  if (rawMax <= 20) step = 5;
  else if (rawMax <= 100) step = 10;
  else if (rawMax <= 500) step = 50;
  else if (rawMax <= 1000) step = 100;
  else step = Math.pow(10, Math.floor(Math.log10(rawMax)));
  return Math.ceil(rawMax / step) * step;
}

function truncateLabel(label: string, max = 10): string {
  const trimmed = label.trim();
  if (trimmed.length === 0) return '(untitled)';
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function drawAxesChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rows: DataRow[],
  kind: 'bar' | 'line'
) {
  const chartLeft = 54;
  const chartRight = width - 20;
  const chartTop = 30;
  const chartBottom = height - 50;
  const chartWidth = chartRight - chartLeft;
  const chartHeight = chartBottom - chartTop;

  const maxVal = rows.reduce((m, r) => Math.max(m, r.value), 0);
  const axisMax = niceMax(maxVal);

  ctx.strokeStyle = GRID_COLOR;
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const steps = 4;
  for (let i = 0; i <= steps; i += 1) {
    const frac = i / steps;
    const y = chartBottom - frac * chartHeight;
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();
    const tickVal = Math.round(axisMax * frac);
    ctx.fillText(String(tickVal), chartLeft - 8, y);
  }

  ctx.strokeStyle = AXIS_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(chartLeft, chartTop);
  ctx.lineTo(chartLeft, chartBottom);
  ctx.lineTo(chartRight, chartBottom);
  ctx.stroke();
  ctx.lineWidth = 1;

  if (rows.length === 0) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data', (chartLeft + chartRight) / 2, (chartTop + chartBottom) / 2);
    return;
  }

  const slot = chartWidth / rows.length;

  if (kind === 'bar') {
    const barWidth = Math.max(6, slot * 0.55);
    rows.forEach((row, i) => {
      const barHeight = axisMax > 0 ? (row.value / axisMax) * chartHeight : 0;
      const x = chartLeft + i * slot + (slot - barWidth) / 2;
      const y = chartBottom - barHeight;

      ctx.fillStyle = BAR_COLOR;
      ctx.fillRect(x, y, barWidth, barHeight);

      ctx.fillStyle = TEXT_COLOR;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(row.value), x + barWidth / 2, y - 4);

      ctx.textBaseline = 'top';
      ctx.fillText(truncateLabel(row.label), x + barWidth / 2, chartBottom + 8);
    });
  } else {
    const points = rows.map((row, i) => {
      const px =
        rows.length === 1
          ? chartLeft + chartWidth / 2
          : chartLeft + i * (chartWidth / (rows.length - 1));
      const py = axisMax > 0 ? chartBottom - (row.value / axisMax) * chartHeight : chartBottom;
      return { x: px, y: py, row };
    });

    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.lineWidth = 1;

    points.forEach((p) => {
      ctx.fillStyle = LINE_COLOR;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = TEXT_COLOR;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(p.row.value), p.x, p.y - 8);

      ctx.textBaseline = 'top';
      ctx.fillText(truncateLabel(p.row.label), p.x, chartBottom + 8);
    });
  }
}

function drawPie(ctx: CanvasRenderingContext2D, width: number, height: number, rows: DataRow[]) {
  const cx = width / 2;
  const cy = height / 2 - 10;
  const radius = Math.min(width, height) / 2 - 40;

  const total = rows.reduce((sum, r) => sum + Math.max(0, r.value), 0);

  if (total <= 0) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '13px monospace';
    ctx.fillText('Add values above zero to render the pie', cx, cy);
    return;
  }

  let startAngle = -Math.PI / 2;
  rows.forEach((row, i) => {
    const value = Math.max(0, row.value);
    const fraction = value / total;
    if (fraction <= 0) return;
    const endAngle = startAngle + fraction * Math.PI * 2;
    ctx.fillStyle = PIE_PALETTE[i % PIE_PALETTE.length];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fill();
    startAngle = endAngle;
  });
}

export default function ChartBuilder({ boardId, onExit }: { boardId: string; onExit: () => void }) {
  const storageKey = `${STORAGE_PREFIX}${boardId}`;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const loaded = useMemo(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { rows?: unknown; chartType?: unknown };
      const parsedRows = Array.isArray(parsed.rows) ? (parsed.rows as unknown[]) : null;
      let rows: DataRow[] | null = null;
      if (parsedRows && parsedRows.length > 0) {
        rows = parsedRows.map((entry) => {
          const r = entry as Partial<DataRow>;
          return {
            id: typeof r.id === 'string' ? r.id : nextRowId(),
            label: typeof r.label === 'string' ? r.label : '',
            value: typeof r.value === 'number' && isFinite(r.value) ? r.value : 0,
          };
        });
      }
      const ct = parsed.chartType;
      const chartType: ChartType | null =
        ct === 'bar' || ct === 'line' || ct === 'pie' ? ct : null;
      return { rows, chartType };
    } catch {
      return null;
    }
    // storageKey is stable for the lifetime of this tool instance (boardId doesn't change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [rows, setRows] = useState<DataRow[]>(() => loaded?.rows ?? defaultRows());
  const [chartType, setChartType] = useState<ChartType>(() => loaded?.chartType ?? 'bar');

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ rows, chartType }));
    } catch {
      // storage unavailable; nothing to do
    }
  }, [rows, chartType, storageKey]);

  const dims = useMemo(
    () => (chartType === 'pie' ? { width: 400, height: 400 } : { width: 560, height: 360 }),
    [chartType]
  );

  const updateLabel = useCallback((id: string, label: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r)));
  }, []);

  const updateValue = useCallback((id: string, raw: string) => {
    const num = raw === '' ? 0 : Number(raw);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, value: isFinite(num) ? num : 0 } : r)));
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, { id: nextRowId(), label: `Item ${prev.length + 1}`, value: 0 }]);
  }, []);

  const deleteRow = useCallback((id: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  }, []);

  const handleExport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'chart.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = dims;
    ctx.clearRect(0, 0, width, height);

    if (chartType === 'pie') {
      drawPie(ctx, width, height, rows);
    } else {
      drawAxesChart(ctx, width, height, rows, chartType);
    }
  }, [rows, chartType, dims]);

  const pieTotal = useMemo(() => rows.reduce((sum, r) => sum + Math.max(0, r.value), 0), [rows]);

  return (
    <ToolShell title="CHART / GRAPH BUILDER" onExit={onExit}>
      <div className="toolCol" style={{ gap: 16 }}>
        <div className="gpanel" style={{ padding: 12 }}>
          <div className="rsub">CHART TYPE</div>
          <div className="toolRow" style={{ gap: 8, marginTop: 8 }}>
            {(['bar', 'line', 'pie'] as ChartType[]).map((type) => (
              <button
                key={type}
                type="button"
                className={`chip${chartType === type ? ' on' : ''}`}
                onClick={() => setChartType(type)}
              >
                {type.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="gpanel" style={{ padding: 12 }}>
          <div className="rsub">DATA</div>
          <div className="toolCol" style={{ gap: 6, marginTop: 8 }}>
            {rows.map((row) => (
              <div key={row.id} className="toolRow" style={{ gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  value={row.label}
                  onChange={(e) => updateLabel(row.id, e.target.value)}
                  placeholder="Label"
                  style={{ flex: 2, minWidth: 0 }}
                />
                <input
                  type="number"
                  value={row.value}
                  onChange={(e) => updateValue(row.id, e.target.value)}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  type="button"
                  className="wbtn ghost"
                  onClick={() => deleteRow(row.id)}
                  disabled={rows.length <= 1}
                  title="Remove row"
                  style={{ opacity: rows.length <= 1 ? 0.4 : 1 }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="toolRow" style={{ marginTop: 10 }}>
            <button type="button" className="chip small" onClick={addRow}>
              + ADD ROW
            </button>
          </div>
          <div className="toolHint">Enter a label and numeric value per row. At least one row is required.</div>
        </div>

        <div className="gpanel" style={{ padding: 12 }}>
          <div className="rsub">PREVIEW</div>
          <div className="toolCanvasWrap" style={{ marginTop: 8 }}>
            <canvas ref={canvasRef} width={dims.width} height={dims.height} />
          </div>

          {chartType === 'pie' && (
            <div className="toolCol" style={{ gap: 4, marginTop: 10 }}>
              {rows.map((row, i) => {
                const pct = pieTotal > 0 ? (Math.max(0, row.value) / pieTotal) * 100 : 0;
                return (
                  <div key={row.id} className="toolRow" style={{ gap: 8, alignItems: 'center' }}>
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 2,
                        background: PIE_PALETTE[i % PIE_PALETTE.length],
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 12 }}>
                      {truncateLabel(row.label, 24)} — {pct.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="toolRow" style={{ marginTop: 12 }}>
            <button type="button" className="wbtn" onClick={handleExport}>
              EXPORT PNG
            </button>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
