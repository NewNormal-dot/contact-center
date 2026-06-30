import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, CalendarDays, TrendingUp, PhoneCall, Users } from 'lucide-react';
import apiClient from '../../lib/api-client';
import * as XLSX from 'xlsx';

type ForecastRow = {
  date: Date;
  segment: string;
  forecast: number;
  hr: number;
};

type ChartPoint = {
  key: string;
  label: string;
  forecast: number;
  hr: number;
  hasData?: boolean;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HOURS = Array.from({ length: 14 }, (_, index) => 9 + index); // 09-22

const normalizeHeader = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[._-]/g, '')
    .trim();

const getCell = (row: Record<string, unknown>, names: string[]) => {
  const normalizedNames = names.map(normalizeHeader);
  const entries = Object.entries(row);
  const found = entries.find(([key]) => normalizedNames.includes(normalizeHeader(key)));
  return found ? found[1] : undefined;
};

const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseExcelDate = (value: unknown) => {
  if (value instanceof Date) return value;

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0);
  }

  const raw = String(value || '').trim();
  if (!raw) return null;

  const normalized = raw.replace(/\./g, '-').replace('T', ' ');
  const direct = new Date(normalized);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) return null;

  const [, y, m, d, h = '0', min = '0'] = match;
  const fallback = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min));
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const formatMonthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const formatMonthLabel = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
};
const formatDayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = () => new Date();
const currentMonthKey = () => formatMonthKey(today());
const currentDayKey = () => formatDayKey(today());


const FORECAST_LOCAL_STORAGE_KEY = 'contact_center_forecast_rows_v2';
const FORECAST_UI_STATE_KEY = 'contact_center_forecast_ui_state_v1';

type ForecastUiState = {
  selectedMonth?: string;
  selectedSegment?: string;
  selectedDay?: string;
  fileName?: string;
};

const readForecastUiState = (): ForecastUiState => {
  try {
    const raw = window.localStorage.getItem(FORECAST_UI_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeForecastUiState = (state: ForecastUiState) => {
  try {
    window.localStorage.setItem(FORECAST_UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore localStorage failures. Filter state can safely fall back to defaults.
  }
};

const rowToPayload = (row: ForecastRow) => ({
  date: row.date.toISOString(),
  segment: row.segment,
  forecast: row.forecast,
  hr: row.hr,
});

const payloadToRow = (row: any): ForecastRow | null => {
  const date = parseExcelDate(row?.date ?? row?.dateTime ?? row?.date_time);
  if (!date) return null;

  return {
    date,
    segment: String(row?.segment ?? 'Unknown').trim() || 'Unknown',
    forecast: toNumber(row?.forecast),
    hr: toNumber(row?.hr),
  };
};

const readForecastBackup = (): ForecastRow[] => {
  try {
    const raw = window.localStorage.getItem(FORECAST_LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(payloadToRow).filter((row): row is ForecastRow => Boolean(row));
  } catch {
    return [];
  }
};

const writeForecastBackup = (rows: ForecastRow[]) => {
  try {
    window.localStorage.setItem(FORECAST_LOCAL_STORAGE_KEY, JSON.stringify(rows.map(rowToPayload)));
  } catch {
    // Ignore localStorage failures. DB persistence can still work.
  }
};

const replaceForecastRowsByMonthSegment = (currentRows: ForecastRow[], uploadRows: ForecastRow[]) => {
  const replaceKeys = new Set(uploadRows.map(row => `${formatMonthKey(row.date)}|||${row.segment.toLowerCase()}`));
  const remainingRows = currentRows.filter(row => !replaceKeys.has(`${formatMonthKey(row.date)}|||${row.segment.toLowerCase()}`));
  return [...remainingRows, ...uploadRows].sort((a, b) => {
    const timeDiff = a.date.getTime() - b.date.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.segment.localeCompare(b.segment);
  });
};

const buildDaysForMonth = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  const totalDays = new Date(year, month, 0).getDate();
  return Array.from({ length: totalDays }, (_, index) => {
    const day = index + 1;
    return {
      key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      label: String(day),
    };
  });
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const max = (values: number[]) => values.length ? Math.max(...values) : 0;
const formatCompactNumber = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const compact = value / 1000;
    const rounded = Math.round(compact * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}k`;
  }
  return Math.round(value).toLocaleString();
};

function ForecastComboChart({
  title,
  data,
  height = 350,
  dense = false,
  headerControl,
  onPointClick,
  selectedKey,
}: {
  title: string;
  subtitle?: string;
  data: ChartPoint[];
  height?: number;
  dense?: boolean;
  headerControl?: React.ReactNode;
  onPointClick?: (point: ChartPoint) => void;
  selectedKey?: string;
}) {
  const padding = { top: 28, right: 42, bottom: dense ? 56 : 48, left: 58 };
  // Keep a wide internal canvas so the chart fills the whole card instead of sitting in the center.
  const width = dense ? 1560 : 1320;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxForecast = Math.max(1, ...data.map(item => item.forecast));
  const maxHr = Math.max(1, ...data.map(item => item.hr));
  // Forecast and HR use different visual scales because calls can be thousands while HR is usually 1-30.
  // Area shows call volume; HR bars are scaled to a smaller lane at the bottom so they stay readable
  // without looking like they are equal to Forecast.
  const hrLaneHeight = plotHeight * 0.46;
  const barSlot = plotWidth / Math.max(data.length, 1);
  const barWidth = clamp(barSlot * 0.50, 12, 30);
  const safeId = dense ? 'forecast-hourly' : 'forecast-daily';

  const points = data.map((item, index) => {
    const x = padding.left + barSlot * index + barSlot / 2;
    const yForecast = padding.top + plotHeight - (item.forecast / maxForecast) * plotHeight;
    const hrHeight = (item.hr / maxHr) * hrLaneHeight;
    const visualHrHeight = item.hr > 0 ? Math.max(8, hrHeight) : 0;
    const visualYHr = padding.top + plotHeight - visualHrHeight;
    return { ...item, x, yForecast, yHr: visualYHr, hrHeight: visualHrHeight };
  });

  const allLinePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.yForecast}`).join(' ');

  const dataSegments: Array<typeof points> = [];
  points.forEach((point, index) => {
    if (!point.hasData) return;
    const previousPoint = points[index - 1];
    const lastSegment = dataSegments[dataSegments.length - 1];
    if (!lastSegment || !previousPoint?.hasData) {
      dataSegments.push([point]);
    } else {
      lastSegment.push(point);
    }
  });

  const segmentPath = (segment: typeof points) => segment
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.yForecast}`)
    .join(' ');

  const areaPathForSegment = (segment: typeof points) => {
    if (!segment.length) return '';
    const path = segmentPath(segment);
    return `${path} L ${segment[segment.length - 1].x} ${padding.top + plotHeight} L ${segment[0].x} ${padding.top + plotHeight} Z`;
  };

  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const y = padding.top + plotHeight - plotHeight * ratio;
    return { y, label: Math.round(maxForecast * ratio) };
  });

  return (
    <div className="rounded-[28px] border border-sky-500/15 bg-[#07111f]/95 p-5 shadow-2xl shadow-black/30">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[12px] font-black uppercase tracking-[0.30em] text-sky-400">{title}</p>
          {headerControl}
        </div>
        <div className="flex items-center gap-3 text-[11px] font-black uppercase tracking-widest">
          <span className="flex items-center gap-2 text-cyan-300"><span className="h-2.5 w-7 rounded-full bg-cyan-300/25 shadow-lg shadow-cyan-400/20 ring-1 ring-cyan-300/40" /> Forecast</span>
          <span className="flex items-center gap-2 text-red-300"><span className="h-3 w-2.5 rounded-sm bg-red-500 shadow-lg shadow-red-500/70" /> HR</span>
        </div>
      </div>

      <div className="overflow-hidden rounded-[22px] border border-white/5 bg-black/25 p-3">
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" className="block w-full">
          <style>{`
            .forecast-point, .hr-column {
              transition: transform 180ms ease, opacity 180ms ease, filter 180ms ease;
              transform-box: fill-box;
              transform-origin: center;
              cursor: pointer;
            }
            .forecast-point:hover {
              transform: scale(1.45);
              filter: drop-shadow(0 0 10px rgba(103, 232, 249, 0.85));
            }
            .hr-column:hover {
              transform: scaleX(1.24) scaleY(1.16);
              opacity: 1;
              filter: drop-shadow(0 0 18px rgba(239, 68, 68, 0.82));
            }
            .chart-hover-band {
              opacity: 0;
              transition: opacity 180ms ease;
            }
            .chart-hover-group:hover .chart-hover-band {
              opacity: 1;
            }
            .hover-value, .forecast-value {
              transform-box: fill-box;
              transform-origin: center center;
            }
            .chart-hover-group:hover .hover-value,
            .chart-hover-group:hover .forecast-value {
              opacity: 1;
              transform: translateY(-9px) scale(1.14);
              filter: drop-shadow(0 0 9px rgba(103, 232, 249, 0.75));
            }
            .forecast-muted {
              filter: blur(0.4px);
            }
          `}</style>
          <defs>
            <linearGradient id={`${safeId}-forecast-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.34" />
              <stop offset="52%" stopColor="#06b6d4" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#020617" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id={`${safeId}-staff-bar`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fecaca" stopOpacity="1" />
              <stop offset="45%" stopColor="#ef4444" stopOpacity="1" />
              <stop offset="100%" stopColor="#991b1b" stopOpacity="0.98" />
            </linearGradient>
            <filter id={`${safeId}-bar-glow`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.2" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id={`${safeId}-line-glow`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {yTicks.map((tick, index) => (
            <g key={index}>
              <line x1={padding.left} x2={width - padding.right} y1={tick.y} y2={tick.y} stroke="rgba(148,163,184,0.14)" strokeDasharray={index === 0 ? '0' : '5 8'} />
              <text x={padding.left - 14} y={tick.y + 4} textAnchor="end" fill="rgba(148,163,184,0.78)" fontSize="11" fontWeight="800">{formatCompactNumber(tick.label)}</text>
            </g>
          ))}

          {allLinePath && <path className="forecast-muted" d={allLinePath} fill="none" stroke="#67e8f9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.16" strokeDasharray="4 7" />}
          {dataSegments.map((segment, index) => {
            const areaPath = areaPathForSegment(segment);
            return areaPath ? <path key={`area-${index}`} d={areaPath} fill={`url(#${safeId}-forecast-area)`} /> : null;
          })}
          {dataSegments.map((segment, index) => {
            const linePath = segmentPath(segment);
            return linePath ? <path key={`line-${index}`} d={linePath} fill="none" stroke="#67e8f9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${safeId}-line-glow)`} /> : null;
          })}
          {points.map((point) => {
            const isSelected = selectedKey === point.key;
            const hrLabelY = Math.max(padding.top + 14, point.yHr - 7);
            const forecastLabelY = Math.max(14, Math.min(point.yForecast - 18, point.hr > 0 ? point.yHr - 28 : point.yForecast - 18));
            return (
            <g
              key={`${point.key}-hover`}
              className="chart-hover-group"
              onClick={() => onPointClick?.(point)}
              style={{ cursor: onPointClick ? 'pointer' : 'default' }}
            >
              <rect
                className={isSelected ? '' : 'chart-hover-band'}
                x={point.x - barSlot / 2 + 2}
                y={padding.top}
                width={Math.max(8, barSlot - 4)}
                height={plotHeight}
                rx="10"
                fill={isSelected ? 'rgba(14, 165, 233, 0.16)' : 'rgba(14, 165, 233, 0.08)'}
              />
              <rect
                className="hr-column"
                x={point.x - barWidth / 2}
                y={point.yHr}
                width={barWidth}
                height={point.hrHeight}
                rx="7"
                fill={`url(#${safeId}-staff-bar)`}
                opacity="1"
                filter={`url(#${safeId}-bar-glow)`}
              />
              {point.hr > 0 && (
                <text
                  className="hover-value"
                  x={point.x}
                  y={hrLabelY}
                  textAnchor="middle"
                  fill="#fee2e2"
                  fontSize="11"
                  fontWeight="900"
                  style={{ opacity: 0.944, transition: 'opacity 180ms ease, transform 180ms ease' }}
                >
                  {point.hr}
                </text>
              )}
              {point.hasData && point.forecast > 0 && (
                <text
                  className="forecast-value"
                  x={point.x}
                  y={forecastLabelY}
                  textAnchor="middle"
                  fill="#a5f3fc"
                  fontSize="11"
                  fontWeight="900"
                  style={{ opacity: 0.94, transition: 'opacity 180ms ease, transform 180ms ease, filter 180ms ease' }}
                >
                  {formatCompactNumber(point.forecast)}
                </text>
              )}
              <circle className="forecast-point" cx={point.x} cy={point.yForecast} r={point.hasData ? 4.2 : 3.2} fill="#082f49" stroke="#a5f3fc" strokeWidth="2" opacity={point.hasData ? 1 : 0.28} />
              <title>{`${point.label}: ${formatCompactNumber(point.forecast)} Forecast / ${point.hr} HR`}</title>
            </g>
            );
          })}

          {points.map((point, index) => {
            const show = dense ? index % Math.ceil(data.length / 18) === 0 || index === data.length - 1 : true;
            return show ? (
              <text key={`${point.key}-label`} x={point.x} y={height - 18} textAnchor="middle" fill="rgba(226,232,240,0.86)" fontSize="11" fontWeight="900">{point.label}</text>
            ) : null;
          })}
        </svg>
      </div>
    </div>
  );
}

export default function ForecastDashboard() {
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const initialUiState = useMemo(() => readForecastUiState(), []);
  const [selectedMonth, setSelectedMonth] = useState<string>(initialUiState.selectedMonth || '');
  const [selectedSegment, setSelectedSegment] = useState<string>(initialUiState.selectedSegment || 'All');
  const [selectedDay, setSelectedDay] = useState<string>(initialUiState.selectedDay || '');
  const [fileName, setFileName] = useState<string>(initialUiState.fileName || '');
  const [storageStatus, setStorageStatus] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    const loadForecastRows = async () => {
      const backupRows = readForecastBackup();
      if (backupRows.length && !cancelled) {
        setRows(backupRows);
        setStorageStatus('Local forecast дата ачааллаа');
      }

      try {
        const response = await apiClient.get('/forecast');
        const apiRows = Array.isArray(response.data)
          ? response.data.map(payloadToRow).filter((row): row is ForecastRow => Boolean(row))
          : [];

        if (cancelled) return;

        if (apiRows.length) {
          setRows(apiRows);
          writeForecastBackup(apiRows);
          setStorageStatus('DB forecast дата ачааллаа');
        } else if (backupRows.length) {
          // DB empty or route returned no rows. Do not wipe local forecast data.
          setRows(backupRows);
          setStorageStatus('DB хоосон тул local forecast дата харуулж байна');
        } else {
          setRows([]);
          setStorageStatus('Forecast дата ороогүй байна');
        }
      } catch (error) {
        console.error('Forecast DB load failed:', error);
        if (!cancelled) {
          setRows(backupRows);
          setStorageStatus(backupRows.length ? 'DB холбогдохгүй тул local forecast дата харуулж байна' : 'Forecast дата ороогүй байна');
        }
      }
    };

    loadForecastRows();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    writeForecastUiState({ selectedMonth, selectedSegment, selectedDay, fileName });
  }, [selectedMonth, selectedSegment, selectedDay, fileName]);

  const segments = useMemo(() => {
    const unique = Array.from(new Set(rows.map(row => row.segment).filter(Boolean))).sort();
    return ['All', ...unique];
  }, [rows]);

  const months = useMemo(() => Array.from(new Set(rows.map(row => formatMonthKey(row.date)))).sort(), [rows]);
  const activeMonth = useMemo(() => {
    if (selectedMonth && (!months.length || months.includes(selectedMonth))) return selectedMonth;

    const thisMonth = currentMonthKey();
    if (months.includes(thisMonth)) return thisMonth;

    // When the user comes back to Forecast after uploading a different month, keep the page on existing data
    // instead of falling back to the current month and showing an empty chart.
    return months[months.length - 1] || thisMonth;
  }, [months, selectedMonth]);

  useEffect(() => {
    if (months.length && (!selectedMonth || !months.includes(selectedMonth))) {
      setSelectedMonth(activeMonth);
    }
  }, [activeMonth, months, selectedMonth]);

  useEffect(() => {
    if (selectedSegment !== 'All' && !segments.includes(selectedSegment)) {
      setSelectedSegment('All');
    }
  }, [segments, selectedSegment]);

  const filteredRows = useMemo(() => rows.filter(row => {
    const monthOk = formatMonthKey(row.date) === activeMonth;
    const segmentOk = selectedSegment === 'All' || row.segment === selectedSegment;
    return monthOk && segmentOk;
  }), [rows, activeMonth, selectedSegment]);

  const dayOptions = useMemo(() => buildDaysForMonth(activeMonth), [activeMonth]);
  const activeDay = selectedDay || (activeMonth === currentMonthKey() && dayOptions.some(day => day.key === currentDayKey()) ? currentDayKey() : dayOptions[0]?.key || '');

  useEffect(() => {
    if (selectedDay && !dayOptions.some(day => day.key === selectedDay)) {
      setSelectedDay('');
    }
  }, [selectedDay, dayOptions]);

  const dailyData = useMemo<ChartPoint[]>(() => {
    const days = buildDaysForMonth(activeMonth);
    return days.map(day => {
      const dayRows = filteredRows.filter(row => formatDayKey(row.date) === day.key);
      return {
        key: day.key,
        label: day.label,
        forecast: Math.round(dayRows.reduce((sum, row) => sum + row.forecast, 0)),
        hr: Math.round(max(dayRows.map(row => row.hr))),
        hasData: dayRows.length > 0,
      };
    });
  }, [filteredRows, activeMonth]);

  const hourlyData = useMemo<ChartPoint[]>(() => {
    const points = HOURS.map(hour => {
      const hourRows = filteredRows.filter(row => formatDayKey(row.date) === activeDay && row.date.getHours() === hour);
      return {
        key: String(hour),
        label: `${String(hour).padStart(2, '0')}:00`,
        forecast: Math.round(average(hourRows.map(row => row.forecast))),
        hr: Math.round(average(hourRows.map(row => row.hr))),
        hasData: hourRows.length > 0,
      };
    });

    const withData = points.filter(point => point.hasData);
    return withData.length ? withData : points.filter(point => point.key !== '22');
  }, [filteredRows, activeDay]);

  const totals = useMemo(() => {
    const activeDays = dailyData.filter(day => day.hasData);
    const dailyHrValues = activeDays.map(day => day.hr).filter(value => value > 0);
    const totalCalls = Math.round(activeDays.reduce((sum, day) => sum + day.forecast, 0));
    const averageCalls = Math.round(average(activeDays.map(day => day.forecast)));
    const peakCalls = Math.round(max(activeDays.map(day => day.forecast)));
    const maxHr = Math.round(max(dailyHrValues));
    const minHr = dailyHrValues.length ? Math.round(Math.min(...dailyHrValues)) : 0;
    const averageHr = Math.round(average(dailyHrValues));

    return {
      totalCalls,
      averageCalls,
      peakCalls,
      maxHr,
      minHr,
      averageHr,
    };
  }, [dailyData]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });

    const parsedRows = jsonRows.map(row => {
      const date = parseExcelDate(getCell(row, ['Date', 'Огноо', 'Өдөр']));
      if (!date) return null;

      return {
        date,
        segment: String(getCell(row, ['Segment', 'Сегмент']) ?? '').trim() || 'Unknown',
        forecast: toNumber(getCell(row, ['Forecast', 'Дуудлага', 'Calls', 'CallForecast'])),
        hr: toNumber(getCell(row, ['HR', 'Staff', 'HC', 'Headcount', 'Ажилтан'])),
      } satisfies ForecastRow;
    }).filter((row): row is ForecastRow => Boolean(row));

    if (!parsedRows.length) {
      setStorageStatus('Excel файлд forecast дата олдсонгүй');
      event.target.value = '';
      return;
    }

    const mergedRows = replaceForecastRowsByMonthSegment(rows, parsedRows);
    setRows(mergedRows);
    writeForecastBackup(mergedRows);
    setFileName(file.name);
    const nextMonths = Array.from(new Set(parsedRows.map(row => formatMonthKey(row.date)))).sort();
    setSelectedMonth(nextMonths[0] || '');
    setSelectedSegment(parsedRows[0]?.segment || 'All');
    setSelectedDay('');
    setStorageStatus('Local дээр хадгаллаа');

    try {
      const response = await apiClient.post('/forecast/upload', { rows: parsedRows.map(rowToPayload) });
      const apiRows = Array.isArray(response.data?.rows)
        ? response.data.rows.map(payloadToRow).filter((row): row is ForecastRow => Boolean(row))
        : [];

      if (apiRows.length) {
        setRows(apiRows);
        writeForecastBackup(apiRows);
      } else {
        // Keep merged local rows if DB upload succeeds but returns no list.
        setRows(mergedRows);
        writeForecastBackup(mergedRows);
      }
      setStorageStatus(`DB дээр хадгаллаа (${response.data?.saved ?? parsedRows.length} мөр)`);
    } catch (error) {
      console.error('Forecast DB save failed:', error);
      setRows(mergedRows);
      writeForecastBackup(mergedRows);
      setStorageStatus('DB хадгалахад алдаа гарлаа. Local дээр хадгалсан.');
    }

    event.target.value = '';
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-sky-500/15 bg-[#07111f]/95 p-5 shadow-2xl shadow-black/30">
        <div className="flex flex-wrap items-center gap-4">
          <select
            value={selectedSegment}
            onChange={(event) => { setSelectedSegment(event.target.value); setSelectedDay(''); }}
            className="h-12 min-w-[190px] rounded-2xl border border-sky-500/20 bg-black/40 px-5 text-sm font-black uppercase tracking-widest text-sky-300 outline-none"
          >
            {segments.map(segment => <option key={segment} value={segment}>{segment === 'All' ? 'All segments' : segment}</option>)}
          </select>

          <button
            onClick={() => inputRef.current?.click()}
            className="ml-auto flex h-12 items-center gap-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-6 text-sm font-black uppercase tracking-widest text-emerald-300 transition hover:bg-emerald-500/20"
          >
            <Upload size={16} /> Upload
          </button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleUpload} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="overflow-hidden rounded-[24px] border border-white/5 bg-[#07111f]/95 shadow-xl shadow-black/20">
          <div className="grid grid-cols-[76px_1fr_1fr_1fr]">
            <div className="flex items-center justify-center border-r border-white/5 bg-cyan-400/5">
              <PhoneCall className="text-cyan-300" size={26} />
            </div>
            <div className="p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Сарын нийт дуудлага</p>
              <p className="mt-1 text-2xl font-black text-white">{totals.totalCalls.toLocaleString()}</p>
            </div>
            <div className="border-l border-white/5 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Сарын дундаж дуудлага</p>
              <p className="mt-1 text-2xl font-black text-white">{totals.averageCalls.toLocaleString()}</p>
            </div>
            <div className="border-l border-white/5 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Хамгийн их дуудлага</p>
              <p className="mt-1 text-2xl font-black text-white">{totals.peakCalls.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[24px] border border-white/5 bg-[#07111f]/95 shadow-xl shadow-black/20">
          <div className="grid grid-cols-[76px_1fr_1fr_1fr]">
            <div className="flex items-center justify-center border-r border-white/5 bg-rose-400/5">
              <Users className="text-rose-300" size={27} />
            </div>
            <div className="p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Хамгийн их ажиллах HR</p>
              <p className="mt-1 text-2xl font-black text-rose-300">{totals.maxHr.toLocaleString()}</p>
            </div>
            <div className="border-l border-white/5 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Хамгийн бага ажиллах HR</p>
              <p className="mt-1 text-2xl font-black text-rose-300">{totals.minHr.toLocaleString()}</p>
            </div>
            <div className="border-l border-white/5 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Сарын дундаж HR</p>
              <p className="mt-1 text-2xl font-black text-rose-300">{totals.averageHr.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      <ForecastComboChart
        title="Forecast өдрөөр"
        data={dailyData}
        height={360}
        dense
        selectedKey={activeDay}
        onPointClick={(point) => setSelectedDay(point.key)}
        headerControl={
          <select
            value={activeMonth}
            onChange={(event) => { setSelectedMonth(event.target.value); setSelectedDay(''); }}
            className="rounded-xl border border-sky-500/20 bg-black/30 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-sky-200 outline-none"
          >
            {(months.length ? months : [currentMonthKey()]).map(month => (
              <option key={month} value={month}>{formatMonthLabel(month)}</option>
            ))}
          </select>
        }
      />

      <ForecastComboChart
        title="Forecast цагаар"
        data={hourlyData}
        height={330}
        selectedKey={activeDay}
        headerControl={
          <span className="rounded-xl border border-sky-500/20 bg-black/30 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-sky-200">
            {formatMonthLabel(activeMonth).split(' ')[0]}.{Number(activeDay.split('-')[2] || 1)}
          </span>
        }
      />
    </div>
  );
}
