import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { LazyMedia } from "../../components/LazyMedia";
import { DigitalClock } from "../../components/DigitalClock";
import {
  Users,
  Settings,
  LogOut,
  Search,
  Plus,
  Edit,
  Trash2,
  CheckCircle2,
  X,
  AlertCircle,
  FileText,
  Download,
  Bell,
  BookOpen,
  Eye,
  Calendar,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronDown as ChevronDownIcon,
  ExternalLink,
  Filter,
  Mail,
  Send,
  Inbox,
  CheckCircle,
  XCircle,
  Info,
  Trash,
  Palmtree,
  UserPlus,
  BarChart3,
  Shield,
  Lock,
  ShieldAlert,
  Camera,
  RefreshCcw,
  Copy,
  ArrowDownLeft,
  Upload,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "../../contexts/AuthContext";
import {
  CSR,
  Notification,
  TrainingMaterial,
  VacationRequest,
  HourlyLeaveRequest,
} from "../../types";
import { logAction } from "../../utils/logger";
import {
  getLocalData,
  setLocalData,
  addLocalItem,
  updateLocalItem,
  deleteLocalItem,
} from "../../utils/localStorage";
import apiClient from "../../lib/api-client";
import { SHOW_VACATION_FEATURE } from "../../config/features";
import { validatePasswordStrength } from "../../utils/passwordValidation";
import {
  groupNotificationsByDay,
  groupTrainingMaterialsByDay,
} from "../../utils/notificationGroups";
import ForecastDashboard from "./ForecastDashboard";

const ENG_MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

const EMPLOYEE_LOCATIONS = ["Ulaanbaatar", "Darkhan"] as const;
type EmployeeLocation = (typeof EMPLOYEE_LOCATIONS)[number];

const normalizeEmployeeLocation = (value: unknown): EmployeeLocation | "" => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (
    EMPLOYEE_LOCATIONS.find((location) => location.toLowerCase() === normalized) || ""
  );
};

const formatMonthShort = (monthIndex: number) => {
  const month = ENG_MONTHS[monthIndex] || "";
  return month.charAt(0) + month.slice(1).toLowerCase();
};

const parseDateKeyParts = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
};

const formatDateKeyShort = (dateKey: string) => {
  const { month, day } = parseDateKeyParts(dateKey);
  return `${formatMonthShort(month - 1)}.${day}`;
};

const areDateKeysContiguous = (dateKeys: string[]) => {
  if (dateKeys.length <= 1) return true;
  const sortedTimes = [...dateKeys]
    .sort()
    .map((dateKey) => {
      const { year, month, day } = parseDateKeyParts(dateKey);
      const date = new Date(year, month - 1, day);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    });

  const oneDay = 24 * 60 * 60 * 1000;
  return sortedTimes.every((time, index) => index === 0 || time - sortedTimes[index - 1] === oneDay);
};

const formatDateKeyRangeLabel = (startKey: string, endKey: string) => {
  if (startKey === endKey) return formatDateKeyShort(startKey);

  const start = parseDateKeyParts(startKey);
  const end = parseDateKeyParts(endKey);
  const startLabel = `${formatMonthShort(start.month - 1)}.${start.day}`;

  if (start.year === end.year && start.month === end.month) {
    return `${startLabel}-${end.day}`;
  }

  return `${startLabel}-${formatMonthShort(end.month - 1)}.${end.day}`;
};

const formatSelectedDateRange = (dateKeys: string[]) => {
  if (dateKeys.length === 0) return "";
  const sorted = [...new Set(dateKeys)].sort();
  if (sorted.length === 1) return formatDateKeyShort(sorted[0]);

  const oneDay = 24 * 60 * 60 * 1000;
  const ranges: Array<{ start: string; end: string }> = [];

  sorted.forEach((dateKey) => {
    if (ranges.length === 0) {
      ranges.push({ start: dateKey, end: dateKey });
      return;
    }

    const previous = ranges[ranges.length - 1];
    const previousParts = parseDateKeyParts(previous.end);
    const currentParts = parseDateKeyParts(dateKey);
    const previousDate = new Date(previousParts.year, previousParts.month - 1, previousParts.day);
    const currentDate = new Date(currentParts.year, currentParts.month - 1, currentParts.day);
    previousDate.setHours(0, 0, 0, 0);
    currentDate.setHours(0, 0, 0, 0);

    if (currentDate.getTime() - previousDate.getTime() === oneDay) {
      previous.end = dateKey;
    } else {
      ranges.push({ start: dateKey, end: dateKey });
    }
  });

  return ranges.map((range) => formatDateKeyRangeLabel(range.start, range.end)).join(", ");
};

const formatDateTimeLocal = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
};

const addHoursToDateTimeLocal = (value: string, hours: number) => {
  const base = value ? new Date(value) : new Date();
  if (Number.isNaN(base.getTime())) return formatDateTimeLocal(new Date(Date.now() + hours * 60 * 60 * 1000));
  base.setHours(base.getHours() + hours);
  return formatDateTimeLocal(base);
};


const formatBookingDateDisplay = (value?: string) => {
  if (!value) return "Сонгоогүй";
  const [datePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return "Сонгоогүй";
  return `${year}.${formatMonthShort(month - 1)}.${String(day).padStart(2, "0")}`;
};

const getDateInputValue = (value?: string) => {
  if (!value) return "";
  return value.split("T")[0] || "";
};

const getHourInputValue = (value?: string) => {
  if (!value) return "00";
  const timePart = value.split("T")[1] || "00:00";
  return (timePart.split(":")[0] || "00").padStart(2, "0");
};

const getMinuteInputValue = (value?: string) => {
  if (!value) return "00";
  const timePart = value.split("T")[1] || "00:00";
  return (timePart.split(":")[1] || "00").padStart(2, "0");
};

const setDatePart = (currentValue: string, nextDate: string) => {
  if (!nextDate) return "";
  const hour = getHourInputValue(currentValue);
  const minute = getMinuteInputValue(currentValue);
  return `${nextDate}T${hour}:${minute}`;
};

const setTimePart = (currentValue: string, nextHour: string, nextMinute: string) => {
  const date = getDateInputValue(currentValue) || getDateInputValue(formatDateTimeLocal());
  return `${date}T${nextHour.padStart(2, "0")}:${nextMinute.padStart(2, "0")}`;
};

const HOURS_24 = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const MINUTES_60 = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

const formatBookingOpenAt = (value?: string) => {
  if (!value) return "одоо";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "одоо";
  return `${formatMonthShort(date.getMonth())}.${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const REST_SHIFT_LABEL = "Амралт";
const REST_SHIFT_INPUT = "амралт";

const isRestShiftText = (value: string) =>
  value.trim().toLowerCase() === REST_SHIFT_INPUT;

const compactShiftTimeInput = (value: string) =>
  value.trim().replace(/\s+/g, "").replace(/-+/g, "-");

const sanitizeShiftTimeInput = (value: string) => {
  const trimmed = value.trim();
  if (isRestShiftText(trimmed)) return REST_SHIFT_LABEL;

  // Only normalize extra spaces or repeated hyphens. Do not silently convert
  // invalid formats such as 0916 or 09:16 into a valid shift.
  return compactShiftTimeInput(trimmed).slice(0, 5);
};

const sanitizeShiftTemplateInput = (value: string) => {
  const trimmed = value.trimStart();
  const lower = trimmed.toLowerCase();
  const hasCyrillicLetters = /[а-яөү]/i.test(trimmed);

  if (hasCyrillicLetters) {
    if (REST_SHIFT_INPUT.startsWith(lower)) {
      return lower === REST_SHIFT_INPUT ? REST_SHIFT_LABEL : trimmed.slice(0, REST_SHIFT_INPUT.length);
    }
    return trimmed.slice(0, 10);
  }

  return sanitizeShiftTimeInput(trimmed);
};

const normalizeShiftTime = (value: string) => {
  const trimmed = value.trim();
  if (isRestShiftText(trimmed) || trimmed === REST_SHIFT_LABEL) return REST_SHIFT_LABEL;
  return compactShiftTimeInput(trimmed);
};
const isValidShiftTime = (value: string) =>
  /^(?:[01]\d|2[0-3])-(?:[01]\d|2[0-3])$/.test(value);
const isValidShiftTemplateValue = (value: string) => {
  const normalized = normalizeShiftTime(value);
  return normalized === REST_SHIFT_LABEL || isValidShiftTime(normalized);
};

type BookingWaveDraft = {
  id: string;
  name: string;
  slotLimit: number;
  bookingOpen: boolean;
  bookingOpenAt?: string;
  bookingCloseAt?: string;
};

const MORNING_WAVE_NAME = "Өглөөний slot";
const EVENING_WAVE_NAME = "Оройн slot";

const getWaveKind = (wave: Pick<BookingWaveDraft, "name">) =>
  String(wave?.name || "").toLowerCase().includes("орой") ? "evening" : "morning";

const getShiftWaveSelectionKey = (
  shift: any,
  wave: Pick<BookingWaveDraft, "name">,
) =>
  [
    normalizeShiftTime(shift?.time || ""),
    shift?.segment || "All",
    shift?.employmentType || "Full Time",
    getWaveKind(wave),
  ]
    .join("|")
    .toLowerCase();

const createBookingWave = (
  name: string,
  slotLimit: number,
  bookingOpen = false,
  bookingOpenAt = "",
  bookingCloseAt = "",
): BookingWaveDraft => ({
  id: Math.random().toString(36).substr(2, 9),
  name,
  slotLimit: Math.max(0, Number(slotLimit) || 0),
  bookingOpen,
  bookingOpenAt,
  bookingCloseAt,
});

const createDefaultBookingWaves = (
  totalSlots: number,
  bookingOpen = false,
  bookingOpenAt = "",
  bookingCloseAt = "",
) => {
  const safeTotal = Math.max(0, Number(totalSlots) || 0);
  const first = safeTotal > 0 ? Math.ceil(safeTotal / 2) : 0;
  const second = safeTotal > 0 ? safeTotal - first : 0;

  return [
    createBookingWave(MORNING_WAVE_NAME, first, bookingOpen, bookingOpenAt, bookingCloseAt),
    createBookingWave(EVENING_WAVE_NAME, second, bookingOpen, bookingOpenAt, bookingCloseAt),
  ];
};

const getBookingWavesForShift = (
  shift: any,
  dayBookingOpen = false,
  dayBookingOpenAt = "",
  dayBookingCloseAt = "",
): BookingWaveDraft[] => {
  const existing = Array.isArray(shift?.bookingWaves) ? shift.bookingWaves : [];
  const normalized = existing
    .map((wave: any, index: number) => ({
      id: String(wave.id || `wave-${index + 1}`),
      name: String(wave.name || `Эрх ${index + 1}`),
      slotLimit: Math.max(
        0,
        Number(wave.slotLimit ?? wave.slots ?? wave.capacity ?? 0) || 0,
      ),
      bookingOpen: Boolean(wave.bookingOpen),
      bookingOpenAt: wave.bookingOpenAt || "",
      bookingCloseAt: wave.bookingCloseAt || "",
    }));

  const morningExisting = normalized.find((wave: BookingWaveDraft) => getWaveKind(wave) === "morning");
  const eveningExisting = normalized.find((wave: BookingWaveDraft) => getWaveKind(wave) === "evening");

  if (morningExisting || eveningExisting) {
    return [
      morningExisting || createBookingWave(MORNING_WAVE_NAME, 0, Boolean(dayBookingOpen), dayBookingOpenAt, dayBookingCloseAt),
      eveningExisting || createBookingWave(EVENING_WAVE_NAME, 0, Boolean(dayBookingOpen), dayBookingOpenAt, dayBookingCloseAt),
    ];
  }

  const total = Math.max(0, Number(shift?.totalSlots) || 0);
  return createDefaultBookingWaves(total, Boolean(dayBookingOpen), dayBookingOpenAt, dayBookingCloseAt);
};

const getWaveBookedCount = (shift: any, waveId: string) => {
  const bookedBy = Array.isArray(shift?.bookedBy) ? shift.bookedBy : [];
  if (waveId === "default") return bookedBy.length;
  return bookedBy.filter((booking: any) => booking.bookingWaveId === waveId)
    .length;
};

const getWaveOpenLabel = (wave: BookingWaveDraft) => {
  if (!wave.bookingOpen) return "Хаалттай";

  const now = Date.now();
  const openAt = wave.bookingOpenAt ? new Date(wave.bookingOpenAt).getTime() : NaN;
  const closeAt = wave.bookingCloseAt ? new Date(wave.bookingCloseAt).getTime() : NaN;

  if (!Number.isNaN(closeAt) && closeAt <= now) return "Хаагдсан";
  if (!wave.bookingOpenAt || Number.isNaN(openAt) || openAt <= now) return "Нээлттэй";
  return `Товлогдсон ${formatBookingOpenAt(wave.bookingOpenAt)}`;
};

const isWaveCurrentlyOpen = (wave: BookingWaveDraft) => {
  if (!wave.bookingOpen) return false;
  const now = Date.now();
  const openAt = wave.bookingOpenAt ? new Date(wave.bookingOpenAt).getTime() : NaN;
  const closeAt = wave.bookingCloseAt ? new Date(wave.bookingCloseAt).getTime() : NaN;
  if (!Number.isNaN(closeAt) && closeAt <= now) return false;
  return !wave.bookingOpenAt || Number.isNaN(openAt) || openAt <= now;
};

const sumWaveSlots = (waves: BookingWaveDraft[] = []) =>
  waves.reduce((sum, wave) => sum + (Number(wave.slotLimit) || 0), 0);


type WeeklyShiftRule = {
  selectedDays: number;
  restDays: number;
  hourCounts: Record<string, number>;
  totalHours: number;
};

const DEFAULT_WEEKLY_SHIFT_RULE: WeeklyShiftRule = {
  selectedDays: 0,
  restDays: 0,
  hourCounts: {},
  totalHours: 0,
};

const makeSegmentTypeKey = (segment: string, employmentType: string) =>
  `${segment || "All"}|${employmentType || "Full Time"}`;

const makeMonthlyFontHourKey = (monthKey: string, segment: string, employmentType: string) =>
  `${monthKey}|${makeSegmentTypeKey(segment, employmentType)}`;

const normalizeWeeklyShiftRule = (value: any): WeeklyShiftRule => {
  const rawHourCounts = value?.hourCounts && typeof value.hourCounts === "object" ? value.hourCounts : {};
  const hourCounts: Record<string, number> = {};

  Object.entries(rawHourCounts).forEach(([hour, count]) => {
    const normalizedHour = String(hour);
    if (!/^(?:[4-9]|rest)$/.test(normalizedHour)) return;
    hourCounts[normalizedHour] = Math.max(0, Math.min(31, Number(count) || 0));
  });

  if (value?.sixHourShifts !== undefined && hourCounts["6"] === undefined) {
    hourCounts["6"] = Math.max(0, Math.min(31, Number(value.sixHourShifts) || 0));
  }
  if (value?.sevenHourShifts !== undefined && hourCounts["7"] === undefined) {
    hourCounts["7"] = Math.max(0, Math.min(31, Number(value.sevenHourShifts) || 0));
  }

  const restDays = Math.max(0, Math.min(31, Number(value?.restDays ?? hourCounts.rest ?? 0) || 0));
  if (restDays > 0 || hourCounts.rest !== undefined) hourCounts.rest = restDays;

  return {
    selectedDays: Math.max(0, Math.min(31, Number(value?.selectedDays ?? 0) || 0)),
    restDays,
    hourCounts,
    totalHours: Math.max(0, Math.min(744, Number(value?.totalHours ?? 0) || 0)),
  };
};

const mapDbSlotsToSchedules = (slots: any[] = []) => {
  const next: Record<string, any> = {};

  (Array.isArray(slots) ? slots : []).forEach((slot: any) => {
    const dateKey = String(slot.date || '').slice(0, 10);
    if (!dateKey) return;

    const isRest = Boolean(slot.isRest || slot.is_rest);
    const bookingOpen = Boolean(slot.bookingOpen ?? slot.booking_is_open);
    const bookingOpenAt = slot.bookingOpenAt || slot.booking_open_at || '';
    const bookingCloseAt = slot.bookingDeadline || slot.booking_deadline || '';
    const bookedBy = (slot.bookings || []).map((booking: any) => ({
      id: booking.id,
      userId: booking.userId || booking.user_id,
      userName: booking.userName || booking.user_name || 'CSR',
      userCode: booking.userCode || booking.user_code,
      bookedAt: booking.bookedAt || booking.booked_at,
    }));

    const day = next[dateKey] || {
      shifts: [],
      bookingOpen,
      bookingOpenAt,
      bookingCloseAt,
    };

    next[dateKey] = {
      ...day,
      bookingOpen: day.bookingOpen || bookingOpen,
      bookingOpenAt: day.bookingOpenAt || bookingOpenAt,
      bookingCloseAt: day.bookingCloseAt || bookingCloseAt,
      shifts: [
        ...(day.shifts || []),
        {
          id: String(slot.id),
          time: isRest
            ? REST_SHIFT_LABEL
            : `${String(slot.startTime || slot.start_time || '').slice(0, 5)}-${String(slot.endTime || slot.end_time || '').slice(0, 5)}`,
          isRest,
          totalSlots: Number(slot.capacity || slot.totalSlots || 1),
          bookedSlots: Number(slot.currentBookings ?? slot.current_bookings ?? bookedBy.length),
          bookedBy,
          segment: slot.segment || 'All',
          employmentType: slot.employmentType || slot.employment_type || 'Full Time',
          bookingWaves: createDefaultBookingWaves(
            Number(slot.capacity || slot.totalSlots || 1),
            bookingOpen,
            bookingOpenAt,
            bookingCloseAt,
          ),
        },
      ],
    };
  });

  return next;
};

type BulkUploadUser = Partial<CSR> & {
  rowNumber: number;
  error?: string;
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { logout, profile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trainingFileRef = useRef<HTMLInputElement>(null);
  const bulkUploadInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState("users");
  const [notifSubTab, setNotifSubTab] = useState<"inbox" | "send">("inbox");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Data States
  const [csrs, setCsrs] = useState<CSR[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [trainingMaterials, setTrainingMaterials] = useState<
    TrainingMaterial[]
  >([]);
  const [vacationRequests, setVacationRequests] = useState<VacationRequest[]>(
    [],
  );
  const [segments, setSegments] = useState<string[]>([]);
  const [monthlyQuotas, setMonthlyQuotas] = useState<Record<number, number>>(
    {},
  );
  const [monthlyFontHourRules, setMonthlyFontHourRules] = useState<Record<string, number>>({});
  const [weeklyShiftRules, setWeeklyShiftRules] = useState<Record<string, WeeklyShiftRule>>({});
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const lastDataRef = useRef<string>("");

  // UI States
  const [selectedMaterial, setSelectedMaterial] =
    useState<TrainingMaterial | null>(null);
  const [showSeenDetails, setShowSeenDetails] = useState<
    Notification | TrainingMaterial | null
  >(null);
  const [isAddingMaterial, setIsAddingMaterial] = useState(false);
  const [editingMaterial, setEditingMaterial] =
    useState<TrainingMaterial | null>(null);
  const [newMaterial, setNewMaterial] = useState<Partial<TrainingMaterial>>({
    type: "PDF",
    deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
  });

  const [newNotification, setNewNotification] = useState<Partial<Notification>>(
    {
      type: "general",
      deadline: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
    },
  );

  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    onConfirm: () => void;
  } | null>(null);
  const [secureConfirmAction, setSecureConfirmAction] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
    username?: string;
    password?: string;
    error?: string;
  } | null>(null);
  const [isAddingHoliday, setIsAddingHoliday] = useState(false);
  const [holidayData, setHolidayData] = useState({
    id: "",
    date: "",
    name: "",
  });
  const [selectedHolidayName, setSelectedHolidayName] = useState("");
  const [holidays, setHolidays] = useState<any[]>([]);

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [schedules, setSchedules] = useState<Record<string, any>>({});
  const [selectedDateSchedule, setSelectedDateSchedule] = useState<string>("");
  const [isBulkBookingMode, setIsBulkBookingMode] = useState(false);
  const [selectedBookingDates, setSelectedBookingDates] = useState<string[]>(
    [],
  );
  const [selectedWaveKeys, setSelectedWaveKeys] = useState<string[]>([]);
  const [bulkShiftDateKeys, setBulkShiftDateKeys] = useState<string[]>([]);
  const [bookingOpenAtInput, setBookingOpenAtInput] = useState(
    formatDateTimeLocal(),
  );
  const [bookingCloseAtInput, setBookingCloseAtInput] = useState(() =>
    addHoursToDateTimeLocal(formatDateTimeLocal(), 6),
  );
  const [isBookingTimeModalOpen, setIsBookingTimeModalOpen] = useState(false);
  const [scheduleViewMode, setScheduleViewMode] = useState<"cards" | "grid">(
    "grid",
  );
  const [hourlyLeaveRequests, setHourlyLeaveRequests] = useState<
    HourlyLeaveRequest[]
  >([]);
  const [shiftTemplates, setShiftTemplates] = useState<any[]>([]);
  const [bulkQuickShiftTime, setBulkQuickShiftTime] = useState("09-18");
  const [bulkQuickSlotCount, setBulkQuickSlotCount] = useState(0);
  const [selectedYearCalendar, setSelectedYearCalendar] = useState<number>(
    new Date().getFullYear(),
  );
  const [selectedMonthCalendar, setSelectedMonthCalendar] = useState<number>(
    new Date().getMonth(),
  );
  const [isManagingShiftTemplates, setIsManagingShiftTemplates] =
    useState(false);
  const [newTemplateTime, setNewTemplateTime] = useState("");
  const [isAddingTemplate, setIsAddingTemplate] = useState(false);
  const [isEditingShiftModal, setIsEditingShiftModal] = useState(false);
  const [isShiftTemplatePickerOpen, setIsShiftTemplatePickerOpen] = useState(false);
  const [isCopyingSchedule, setIsCopyingSchedule] = useState(false);
  const [editingShiftData, setEditingShiftData] = useState<{
    id?: string;
    time: string;
    segment: string;
    employmentType: "Full Time" | "Part Time";
    totalSlots: number;
    bookingWaves?: BookingWaveDraft[];
    dateKey: string;
  } | null>(null);
  const [filters, setFilters] = useState({
    segment: "All",
    location: "All",
    employmentType: "All",
    supervisorName: "All",
  });

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    old: "",
    new: "",
    confirm: "",
  });
  const [vacationSegmentFilter, setVacationSegmentFilter] = useState("All");

  // Notifications Count
  const unreadCount = notifications.filter(
    (n) =>
      (n.type === "general" || n.type === "important") &&
      !n.seenBy?.some((s) => s.userId === "admin"),
  ).length;
  const unreadTrainingCount = trainingMaterials.filter(
    (m) => !m.seenBy?.some((s) => s.userId === "admin"),
  ).length;

  useEffect(() => {
    if (!SHOW_VACATION_FEATURE && activeTab === "vacation") {
      setActiveTab("schedule");
    }
  }, [activeTab]);

  const [activeEmploymentView, setActiveEmploymentView] = useState<
    "Full Time" | "Part Time"
  >("Full Time");
  const [activeSegmentView, setActiveSegmentView] = useState<string>("");

  const mapCsrForUi = (raw: any): CSR => {
    const name = raw.name || raw.email?.split("@")?.[0] || "CSR";
    return {
      id: raw.id,
      code: raw.code || "",
      location: normalizeEmployeeLocation(raw.location) || raw.location || "",
      supervisorName: String(raw.supervisorName || raw.supervisor_name || "").trim(),
      name,
      email: raw.email || "",
      lineType: raw.lineType || raw.segment || "",
      employmentType: raw.employmentType || raw.employment_type || "Full Time",
      role: "csr",
      status: raw.status || "active",
      photoUrl:
        raw.photoUrl ||
        raw.photo_url ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2563eb&color=fff&size=128`,
    };
  };

  const fetchCsrUsers = async () => {
    try {
      const response = await apiClient.get("/users/csr");
      const localUsers = getLocalData("users", []) as CSR[];
      const users = (response.data || []).map((raw: any) => {
        const mapped = mapCsrForUi(raw);
        const localMatch = localUsers.find(
          (user) =>
            user.id === mapped.id ||
            (user.email && user.email === mapped.email),
        );
        return {
          ...mapped,
          location: mapped.location || localMatch?.location || "",
          supervisorName: mapped.supervisorName || localMatch?.supervisorName || "",
        };
      });
      setCsrs(users);
      setLocalData("users", users);
      return users;
    } catch (error) {
      console.error("Error fetching CSR users:", error);
      return getLocalData("users", []);
    }
  };

  const mapLeaveRequestForUi = (raw: any): HourlyLeaveRequest => ({
    id: String(raw.id),
    csrId: raw.userId || raw.user_id,
    csrName: raw.userName || raw.user_name || "CSR",
    type: raw.type === "daily" ? "daily" : "hourly",
    date: raw.date,
    endDate: raw.endDate || raw.end_date || raw.date,
    startTime: raw.startTime || raw.start_time || "",
    endTime: raw.endTime || raw.end_time || "",
    reason: raw.reason || "",
    status: raw.status || "pending",
    createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
    comment: raw.comment || "",
  });

  const fetchLeaveRequests = async () => {
    try {
      const response = await apiClient.get("/requests/leave");
      const data = (response.data || []).map(mapLeaveRequestForUi);
      setHourlyLeaveRequests(data);
      setLocalData("hourlyLeaveRequests", data);
      return data;
    } catch (error) {
      console.error("Error fetching leave requests:", error);
      const local = getLocalData("hourlyLeaveRequests", []);
      setHourlyLeaveRequests(local);
      return local;
    }
  };

  const mapVacationRequestForUi = (raw: any): VacationRequest => {
    const startDate = raw.startDate || raw.start_date || "";
    const endDate = raw.endDate || raw.end_date || startDate;
    return {
      id: String(raw.id),
      userId: raw.userId || raw.user_id,
      csrId: raw.userId || raw.user_id,
      csrName: raw.userName || raw.user_name || "CSR",
      csrPhoto: "",
      month: String(startDate).slice(0, 7),
      startDate,
      endDate,
      reason: raw.reason || "",
      type: "vacation",
      status: raw.status || "pending",
      createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
      approvedBy: raw.approvedBy || raw.approved_by,
    };
  };

  const fetchVacationRequests = async () => {
    try {
      const response = await apiClient.get("/requests/vacation");
      const data = (response.data || []).map(mapVacationRequestForUi);
      setVacationRequests(data);
      setLocalData("vacationRequests", data);
      return data;
    } catch (error) {
      console.error("Error fetching vacation requests:", error);
      const local = getLocalData("vacationRequests", []);
      setVacationRequests(local);
      return local;
    }
  };



  const fetchShiftRules = async () => {
    try {
      const response = await apiClient.get("/rules");
      const nextMonthlyRules = response.data?.monthlyFontHourRules || {};
      const nextWeeklyRules = response.data?.weeklyShiftRules || {};
      setMonthlyFontHourRules(nextMonthlyRules);
      setWeeklyShiftRules(nextWeeklyRules);
      return { monthlyFontHourRules: nextMonthlyRules, weeklyShiftRules: nextWeeklyRules };
    } catch (error) {
      console.error("Error fetching shift rules:", error);
      return { monthlyFontHourRules, weeklyShiftRules };
    }
  };

  const fetchDbSchedule = async () => {
    try {
      const response = await apiClient.get("/slots");
      const dbSchedules = mapDbSlotsToSchedules(response.data || []);
      if (Object.keys(dbSchedules).length > 0) {
        setSchedules(dbSchedules);
        setLocalData("schedules", dbSchedules);
      }
      return dbSchedules;
    } catch (error) {
      console.error("Error fetching DB schedule:", error);
      return null;
    }
  };

  const persistSchedules = async (
    nextSchedules: Record<string, any>,
    dateKeys: string[],
  ) => {
    const uniqueDateKeys = Array.from(new Set(dateKeys.filter(Boolean)));
    setSchedules(nextSchedules);
    setLocalData("schedules", nextSchedules);
    if (uniqueDateKeys.length === 0) return;

    try {
      await apiClient.post("/slots/sync-schedules", {
        schedules: nextSchedules,
        dateKeys: uniqueDateKeys,
      });
    } catch (error: any) {
      console.error("Sync schedules to DB error:", error);
      alert(error.response?.data?.error || "Хуваарь DB-д хадгалахад алдаа гарлаа.");
    }
  };

  const saveMonthlyFontHoursRule = async (
    monthKey: string,
    segment: string,
    employmentType: "Full Time" | "Part Time",
    hours: number,
  ) => {
    const normalizedHours = Math.max(0, Number(hours) || 0);
    await apiClient.put("/rules/monthly-font-hours", {
      monthKey,
      segment,
      employmentType,
      hours: normalizedHours,
    });
  };

  const saveWeeklyShiftRule = async (
    segment: string,
    employmentType: "Full Time" | "Part Time",
    rule: WeeklyShiftRule,
  ) => {
    await apiClient.put("/rules/weekly-shift-rules", {
      segment,
      employmentType,
      rule: normalizeWeeklyShiftRule(rule),
    });
  };



  const mapNotificationForUi = (raw: any): Notification => ({
    id: String(raw.id),
    title: raw.title || '',
    content: raw.content || '',
    desc: raw.content || raw.desc || '',
    time: raw.createdAt || raw.created_at || new Date().toISOString(),
    unread: !raw.readAt && !raw.read_at,
    type: raw.type || 'general',
    imageUrl: raw.imageUrl || raw.image_url || '',
    deadline: raw.deadline || '',
    createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
    authorId: raw.authorId || raw.author_id || '',
    authorName: raw.authorName || raw.author_name || 'System',
    targetUserId: raw.targetUserId || raw.target_user_id,
    relatedEntityType: raw.relatedEntityType || raw.related_entity_type,
    relatedEntityId: raw.relatedEntityId || raw.related_entity_id,
    tradeRequestId: raw.relatedEntityType === 'trade_requests' || raw.related_entity_type === 'trade_requests'
      ? (raw.relatedEntityId || raw.related_entity_id)
      : raw.tradeRequestId,
    seenBy: [],
  } as Notification);

  const fetchNotificationsFromDb = async () => {
    try {
      const response = await apiClient.get('/broadcasts/notifications');
      const data = (response.data || []).map(mapNotificationForUi);
      setNotifications(data);
      return data;
    } catch (error) {
      console.error('Error fetching notifications:', error);
      const local = getLocalData('notifications', []);
      setNotifications(local);
      return local;
    }
  };

  const handleApproveTradeNotification = async (tradeId?: string) => {
    if (!tradeId) return;
    try {
      await apiClient.patch(`/trades/${tradeId}/approve`);
      await fetchNotificationsFromDb();
      alert('Trade батлагдаж хуваарь автоматаар солигдлоо.');
    } catch (error: any) {
      console.error('Approve trade error:', error);
      alert(error.response?.data?.error || 'Trade approve хийхэд алдаа гарлаа.');
    }
  };

  const handleRejectTradeNotification = async (tradeId?: string) => {
    if (!tradeId) return;
    try {
      await apiClient.patch(`/trades/${tradeId}/reject`);
      await fetchNotificationsFromDb();
      alert('Trade хүсэлт татгалзагдлаа.');
    } catch (error: any) {
      console.error('Reject trade error:', error);
      alert(error.response?.data?.error || 'Trade reject хийхэд алдаа гарлаа.');
    }
  };

  const generateRandomPassword = (length = 10) => {
    const charset =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
    let value = "";
    for (let i = 0; i < length; i += 1) {
      value += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return value;
  };

  // Auto-adjust views when data changes (Initialize only)
  useEffect(() => {
    if (segments.length > 0) {
      if (!activeSegmentView || !segments.includes(activeSegmentView)) {
        setActiveSegmentView(segments[0]);
      }
    }
  }, [segments]);

  useEffect(() => {
    // Initial load
    const loadedCsrs = getLocalData("users", []);
    const loadedSegments = getLocalData("segments", []);

    setCsrs(loadedCsrs);
    setSegments(loadedSegments);
    if (loadedSegments.length > 0 && !activeSegmentView) {
      setActiveSegmentView(loadedSegments[0]);
    }

    fetchCsrUsers().catch(() => undefined);

    fetchNotificationsFromDb().catch(() => setNotifications(getLocalData("notifications", [])));
    setTrainingMaterials(getLocalData("trainingMaterials", []));
    setVacationRequests(getLocalData("vacationRequests", []));
    setSegments(getLocalData("segments", []));
    setMonthlyQuotas(
      getLocalData("monthlyQuotas", {
        0: 5,
        1: 5,
        2: 5,
        3: 5,
        4: 5,
        5: 5,
        6: 5,
        7: 5,
        8: 5,
        9: 5,
        10: 5,
        11: 5,
      }),
    );
    setSchedules(getLocalData("schedules", {}));
    fetchDbSchedule().catch(() => undefined);
    fetchShiftRules().catch(() => undefined);
    fetchLeaveRequests().catch(() =>
      setHourlyLeaveRequests(getLocalData("hourlyLeaveRequests", [])),
    );
    fetchVacationRequests().catch(() =>
      setVacationRequests(getLocalData("vacationRequests", [])),
    );
    setHolidays(
      getLocalData("holidays", []).map((h: any) => ({
        ...h,
        id: h.id || Math.random().toString(36).substr(2, 9),
      })),
    );
    const defaultShiftTemplates = [
      { id: "1", time: "09-14", label: "09-14" },
      { id: "2", time: "09-15", label: "09-15" },
      { id: "3", time: "09-16", label: "09-16" },
      { id: "4", time: "09-17", label: "09-17" },
      { id: "5", time: "10-15", label: "10-15" },
      { id: "6", time: "10-16", label: "10-16" },
      { id: "7", time: "10-17", label: "10-17" },
      { id: "8", time: "10-18", label: "10-18" },
      { id: "9", time: "11-16", label: "11-16" },
      { id: "10", time: "11-17", label: "11-17" },
      { id: "11", time: "11-18", label: "11-18" },
      { id: "12", time: "11-19", label: "11-19" },
      { id: "13", time: "12-17", label: "12-17" },
      { id: "14", time: "12-18", label: "12-18" },
      { id: "15", time: "12-19", label: "12-19" },
      { id: "16", time: "12-20", label: "12-20" },
      { id: "17", time: "13-18", label: "13-18" },
      { id: "18", time: "13-19", label: "13-19" },
      { id: "19", time: "13-20", label: "13-20" },
      { id: "20", time: "13-21", label: "13-21" },
      { id: "21", time: "14-19", label: "14-19" },
      { id: "22", time: "14-20", label: "14-20" },
      { id: "23", time: "14-21", label: "14-21" },
      { id: "24", time: "14-22", label: "14-22" },
      { id: "25", time: "18-01", label: "18-01" },
      { id: "26", time: "19-01", label: "19-01" },
      { id: "27", time: "20-01", label: "20-01" },
    ];
    const normalizedShiftTemplates = getLocalData(
      "shiftTemplates",
      defaultShiftTemplates,
    )
      .map((template: any) => {
        const rawTime = String(template.time || template.label || "");
        const time = normalizeShiftTime(rawTime);
        return { ...template, time, label: time };
      })
      .filter((template: any) => template.time === REST_SHIFT_LABEL || isValidShiftTime(template.time));
    if (!normalizedShiftTemplates.some((template: any) => template.time === REST_SHIFT_LABEL)) {
      normalizedShiftTemplates.push({
        id: "rest",
        time: REST_SHIFT_LABEL,
        label: REST_SHIFT_LABEL,
      });
    }
    setShiftTemplates(normalizedShiftTemplates);
    setLocalData("shiftTemplates", normalizedShiftTemplates);

    // Real-time polling
    const interval = setInterval(() => {
      const u = getLocalData("users", []);
      const n = getLocalData("notifications", []);
      const tm = getLocalData("trainingMaterials", []);
      const vr = getLocalData("vacationRequests", []);
      const segs = getLocalData("segments", []);
      const mq = getLocalData("monthlyQuotas", {
        0: 5,
        1: 5,
        2: 5,
        3: 5,
        4: 5,
        5: 5,
        6: 5,
        7: 5,
        8: 5,
        9: 5,
        10: 5,
        11: 5,
      });
      const sd = getLocalData("schedules", {});

      // Sanitize schedules data to ensure consistency
      const sanitizedSd: Record<string, any> = {};
      Object.entries(sd).forEach(([dateKey, data]: [string, any]) => {
        if (data && data.shifts) {
          sanitizedSd[dateKey] = {
            ...data,
            shifts: data.shifts.map((s: any) => ({
              ...s,
              segment: s.segment || "All",
              employmentType: s.employmentType || "Full Time",
            })),
          };
        } else {
          sanitizedSd[dateKey] = data;
        }
      });

      const hl = getLocalData("hourlyLeaveRequests", []);
      const hls = getLocalData("holidays", []).map((h: any) => ({
        ...h,
        id: h.id || Math.random().toString(36).substr(2, 9),
      }));

      const currentHash = JSON.stringify({
        u,
        n,
        tm,
        vr,
        segs,
        mq,
        sd: sanitizedSd,
        hl,
        hls,
      });
      if (currentHash !== lastDataRef.current) {
        lastDataRef.current = currentHash;
        setCsrs(u);
        fetchNotificationsFromDb().catch(() => setNotifications(n));
        setTrainingMaterials(tm);
        setVacationRequests(vr);
        setSegments(segs);
        setMonthlyQuotas(mq);
        setSchedules(sanitizedSd);
        fetchLeaveRequests().catch(() => setHourlyLeaveRequests(hl));
        setHolidays(hls);
      }
    }, 2000);

    const apiRefreshInterval = setInterval(() => {
      fetchLeaveRequests().catch(() => undefined);
      fetchVacationRequests().catch(() => undefined);
      fetchShiftRules().catch(() => undefined);
    }, 10000);

    const handleStorageUpdate = (event: StorageEvent) => {
      if (event.key === "notifications") {
        fetchNotificationsFromDb().catch(() => setNotifications(getLocalData("notifications", [])));
      }
      if (event.key === "users") {
        fetchCsrUsers().catch(() => undefined);
      }
    };

    window.addEventListener("storage", handleStorageUpdate);
    return () => {
      clearInterval(interval);
      clearInterval(apiRefreshInterval);
      window.removeEventListener("storage", handleStorageUpdate);
    };
  }, []);

  useEffect(() => {
    if (!showSeenDetails) return;

    const currentView = (showSeenDetails as any)._view;
    const source =
      "authorId" in showSeenDetails ? notifications : trainingMaterials;
    const latest = source.find(
      (item) => String(item.id) === String(showSeenDetails.id),
    );

    if (!latest) return;

    setShowSeenDetails({
      ...latest,
      ...(currentView ? { _view: currentView } : {}),
    } as any);
  }, [notifications, trainingMaterials, showSeenDetails?.id]);

  const handleApproveHourlyLeave = async (id: string) => {
    try {
      await apiClient.patch(`/requests/leave/${id}`, { status: "approved" });
      const updated = updateLocalItem("hourlyLeaveRequests", id, {
        status: "approved",
      });
      setHourlyLeaveRequests(updated);
      await fetchLeaveRequests();
      logAction("Hourly Leave Approved", `Approved request ${id}`);
    } catch (error: any) {
      console.error("Error approving leave request:", error);
      alert(
        error.response?.data?.error ||
          "Чөлөөний хүсэлт зөвшөөрөхөд алдаа гарлаа.",
      );
    }
  };

  const handleRejectHourlyLeave = async (id: string, comment: string) => {
    try {
      await apiClient.patch(`/requests/leave/${id}`, {
        status: "rejected",
        comment,
      });
      const updated = updateLocalItem("hourlyLeaveRequests", id, {
        status: "rejected",
        comment,
      });
      setHourlyLeaveRequests(updated);
      await fetchLeaveRequests();
      logAction("Hourly Leave Rejected", `Rejected request ${id}`);
    } catch (error: any) {
      console.error("Error rejecting leave request:", error);
      alert(
        error.response?.data?.error ||
          "Чөлөөний хүсэлт татгалзахад алдаа гарлаа.",
      );
    }
  };

  const handleRemoveUserFromShift = async (
    dateKey: string,
    shiftId: string,
    userId: string,
  ) => {
    if (isPastScheduleDate(dateKey)) {
      alert("Өнгөрсөн өдрийн хуваарь read-only тул ажилтан хасах боломжгүй.");
      return;
    }

    try {
      await apiClient.delete(`/slots/${shiftId}/bookings/${userId}`);
    } catch (error: any) {
      console.error("Remove booking from DB error:", error);
      alert(error.response?.data?.error || "Захиалга DB-ээс хасахад алдаа гарлаа.");
      return;
    }

    const currentSchedules = getLocalData("schedules", {});
    if (currentSchedules[dateKey]) {
      currentSchedules[dateKey].shifts = currentSchedules[dateKey].shifts.map(
        (s: any) => {
          if (s.id === shiftId) {
            return {
              ...s,
              bookedSlots: Math.max(0, s.bookedSlots - 1),
              bookedBy: s.bookedBy.filter((b: any) => b.userId !== userId),
            };
          }
          return s;
        },
      );
      void persistSchedules(currentSchedules, [dateKey]);
      logAction(
        "Member Removed from Shift",
        `Removed user ${userId} from shift ${shiftId} on ${dateKey}`,
      );
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        isFilterOpen &&
        filterRef.current &&
        !filterRef.current.contains(event.target as Node)
      ) {
        setIsFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isFilterOpen]);

  useEffect(() => {
    if (!selectedDateSchedule) {
      setSelectedHolidayName("");
      return;
    }

    const existingHoliday = holidays.find(
      (holiday: any) => holiday.date === selectedDateSchedule,
    );
    setSelectedHolidayName(existingHoliday?.name || "");
  }, [selectedDateSchedule, holidays]);

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && profile) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        try {
          updateLocalItem("users", profile.id, { photoUrl: base64 });
        } catch (error) {
          console.error("Error updating admin photo:", error);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleConfirm = (title: string, onConfirm: () => void) => {
    setConfirmAction({ title, onConfirm });
  };

  const handleSecureConfirm = (
    title: string,
    description: string,
    onConfirm: () => void,
  ) => {
    setSecureConfirmAction({
      title,
      description,
      onConfirm,
      username: "admin",
      password: "",
    });
  };

  const handleApproveVacation = async (requestId: string) => {
    const request = vacationRequests.find((r) => r.id === requestId);
    if (!request) return;

    try {
      await apiClient.patch(`/requests/vacation/${requestId}`, {
        status: "approved",
      });
    } catch (error: any) {
      console.error("Error approving vacation request:", error);
      alert(
        error.response?.data?.error ||
          "Амралтын хүсэлт зөвшөөрөхөд алдаа гарлаа.",
      );
      return;
    }

    const updatedVacationRequests = updateLocalItem(
      "vacationRequests",
      requestId,
      { status: "approved" },
    );
    setVacationRequests(updatedVacationRequests);
    logAction(
      "Vacation Approved",
      `Approved vacation for ${request.csrName}: ${request.startDate} - ${request.endDate}`,
    );

    // Auto-Notification
    const notification: Notification = {
      id: Math.random().toString(36).substr(2, 9),
      title: "Амралт зөвшөөрөгдлөө",
      content: `Таны ээлжийн амралтын хүсэлт (${request.startDate} - ${request.endDate}) зөвшөөрөгдлөө.`,
      createdAt: new Date().toISOString(),
      deadline: "",
      authorId: "admin",
      authorName: "Admin",
      type: "general",
      targetUserId: request.csrId,
      seenBy: [],
    };
    addLocalItem("notifications", notification);
  };

  const handleRejectVacation = async (requestId: string) => {
    const request = vacationRequests.find((r) => r.id === requestId);
    if (!request) return;

    try {
      await apiClient.patch(`/requests/vacation/${requestId}`, {
        status: "rejected",
      });
    } catch (error: any) {
      console.error("Error rejecting vacation request:", error);
      alert(
        error.response?.data?.error ||
          "Амралтын хүсэлт татгалзахад алдаа гарлаа.",
      );
      return;
    }

    const updatedVacationRequests = updateLocalItem(
      "vacationRequests",
      requestId,
      { status: "rejected" },
    );
    setVacationRequests(updatedVacationRequests);
    logAction("Vacation Rejected", `Rejected vacation for ${request.csrName}`);

    // Auto-Notification
    const notification: Notification = {
      id: Math.random().toString(36).substr(2, 9),
      title: "Амралт татгалзагдлаа",
      content: `Таны ээлжийн амралтын хүсэлт (${request.startDate} - ${request.endDate}) татгалзагдлаа. Админтай холбогдоно уу.`,
      createdAt: new Date().toISOString(),
      deadline: "",
      authorId: "admin",
      authorName: "Admin",
      type: "general",
      targetUserId: request.csrId,
      seenBy: [],
    };
    addLocalItem("notifications", notification);
  };

  const handleUpdateQuota = (monthIndex: number, newQuota: number) => {
    const currentQuotas = getLocalData("monthlyQuotas", {
      0: 5,
      1: 5,
      2: 5,
      3: 5,
      4: 5,
      5: 5,
      6: 5,
      7: 5,
      8: 5,
      9: 5,
      10: 5,
      11: 5,
    });
    const updated = { ...currentQuotas, [monthIndex]: newQuota };
    setLocalData("monthlyQuotas", updated);
    setMonthlyQuotas(updated);
  };

  const handleExportVacations = (
    monthIndex: number,
    requests: VacationRequest[],
  ) => {
    const months = [
      "1-р сар",
      "2-р сар",
      "3-р сар",
      "4-р сар",
      "5-р сар",
      "6-р сар",
      "7-р сар",
      "8-р сар",
      "9-р сар",
      "10-р сар",
      "11-р сар",
      "12-р сар",
    ];

    const rows = requests.map((req) => {
      const requester = csrs.find((c) => c.id === req.csrId);
      return {
        Код: requester?.code || "---",
        Ажилтан: req.csrName,
        Имэйл: requester?.email || "---",
        Сегмент: requester?.lineType || "---",
        Төрөл: requester?.employmentType || "---",
        Эхлэх: req.startDate,
        Дуусах: req.endDate,
        Төлөв:
          req.status === "pending"
            ? "Хүлээгдэж буй"
            : req.status === "approved"
              ? "Зөвшөөрсөн"
              : "Татгалзсан",
        Илгээсэн: new Date(req.createdAt || 0).toLocaleString(),
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Амралтын хүсэлтүүд");
    XLSX.writeFile(
      wb,
      `Vacation_Requests_${months[monthIndex]}_${vacationSegmentFilter}.xlsx`,
    );
    logAction(
      "Export Vacations",
      `Exported vacations for ${months[monthIndex]}`,
    );
  };

  const getCsrLocation = (csr: CSR) => normalizeEmployeeLocation(csr.location) || csr.location || "";
  const getCsrSupervisorName = (csr: CSR) => String(csr.supervisorName || "").trim();

  const getCsrSearchText = (csr: CSR) =>
    [
      csr.code,
      csr.name,
      csr.email,
      csr.lineType,
      csr.employmentType || "Full Time",
      getCsrLocation(csr),
      getCsrSupervisorName(csr),
      csr.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  const getFilteredCsrs = () => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return csrs.filter((c) => {
      const matchesSearch =
        !normalizedSearch || getCsrSearchText(c).includes(normalizedSearch);
      const matchesSegment =
        filters.segment === "All" || c.lineType === filters.segment;
      const matchesLocation =
        filters.location === "All" || getCsrLocation(c) === filters.location;
      const matchesEmploymentType =
        filters.employmentType === "All" ||
        (c.employmentType || "Full Time") === filters.employmentType;
      const matchesSupervisor =
        filters.supervisorName === "All" ||
        getCsrSupervisorName(c) === filters.supervisorName;
      return (
        matchesSearch &&
        matchesSegment &&
        matchesLocation &&
        matchesEmploymentType &&
        matchesSupervisor
      );
    });
  };

  const handleExportExcel = () => {
    const filteredCsrs = getFilteredCsrs();

    const rows = filteredCsrs.map((c) => ({
      "Ажилтны код": c.code || c.id.slice(0, 6).toUpperCase(),
      User: c.name,
      "e-mail":
        c.email || `${c.name.toLowerCase().replace(/\s/g, ".")}@example.com`,
      segment: c.lineType,
      "Part/Full": c.employmentType || "Full Time",
      Location: getCsrLocation(c),
      Supervisor: getCsrSupervisorName(c),
      Төлөв: c.status || "offline",
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Ажилтнууд");
    XLSX.writeFile(
      wb,
      `Employees_Export_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    logAction(
      "Export Employees",
      `Exported ${filteredCsrs.length} employees to Excel`,
    );
  };

  const handleDownloadBulkUploadTemplate = () => {
    const rows = [
      {
        "No.": 1,
        "Ажилтны код": "321123",
        User: "enkhtur.a",
        "e-mail": "enkhtur.a@mobicom.mn",
        segment: segments[0] || "Postpaid",
        "Part/Full": "Part",
        Location: "Darkhan",
        Supervisor: "ariunbayar",
      },
    ];
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Employees");
    XLSX.writeFile(workbook, "employee_bulk_upload_template.xlsx");
    logAction(
      "Bulk Upload Template Downloaded",
      "Downloaded employee bulk upload template",
    );
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    if (passwordForm.new !== passwordForm.confirm) {
      alert("Шинэ нууц үгнүүд зөрүүтэй байна!");
      return;
    }

    const passwordError = validatePasswordStrength(passwordForm.new);
    if (passwordError) {
      alert(passwordError);
      return;
    }

    try {
      await apiClient.post("/auth/change-password", {
        oldPassword: passwordForm.old,
        newPassword: passwordForm.new,
      });

      logAction("Password Changed", `Changed password for ${profile.name}`);
      alert("Нууц үг амжилттай солигдлоо!");
      setIsChangingPassword(false);
      setPasswordForm({ old: "", new: "", confirm: "" });
      return;
    } catch (error: any) {
      console.error("Error changing password:", error);
      alert(error.response?.data?.error || "Нууц үг солиход алдаа гарлаа.");
      return;
    }
  };

  const handleAddMaterial = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMaterial.title) {
      const processSubmission = (url: string = "", type: string = "Link") => {
        if (editingMaterial) {
          const updatedMaterials = updateLocalItem(
            "trainingMaterials",
            editingMaterial.id,
            {
              ...newMaterial,
              id: editingMaterial.id,
              url: url || newMaterial.url || "",
              type: type || newMaterial.type || "Link",
            },
          );
          setTrainingMaterials(updatedMaterials);
          logAction(
            "Material Updated",
            `Updated training material: ${newMaterial.title}`,
          );
        } else {
          const material: TrainingMaterial = {
            id: Math.random().toString(36).substr(2, 9),
            title: newMaterial.title!,
            description: newMaterial.description || "",
            url: url,
            type: type,
            date: new Date().toISOString().split("T")[0],
            deadline: newMaterial.deadline,
            seenBy: [],
          };
          const updatedMaterials = addLocalItem("trainingMaterials", material);
          setTrainingMaterials(updatedMaterials);
          setShowSeenDetails(material);
          logAction(
            "Material Added",
            `Added training material: ${material.title}`,
          );

          const notification: Notification = {
            id: Math.random().toString(36).substr(2, 9),
            title: "Шинэ сургалтын материал",
            content: `"${material.title}" нэртэй шинэ сургалтын материал нэмэгдлээ. Дуусах хугацаа: ${material.deadline}`,
            createdAt: new Date().toISOString(),
            deadline: material.deadline || "",
            authorId: "admin",
            authorName: "Admin",
            type: "training",
            seenBy: [],
          };
          const updatedNotifications = addLocalItem(
            "notifications",
            notification,
          );
          setNotifications(updatedNotifications);
        }
        setIsAddingMaterial(false);
        setEditingMaterial(null);
        setSelectedFile(null);
        setNewMaterial({
          type: "Article",
          deadline: new Date(Date.now() + 7 * 86400000)
            .toISOString()
            .slice(0, 16),
        });
      };

      if (selectedFile) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          let fileType = "File";
          if (selectedFile.type.startsWith("image/")) fileType = "Image";
          else if (selectedFile.type.startsWith("video/")) fileType = "Video";
          else if (selectedFile.type === "application/pdf") fileType = "PDF";
          processSubmission(base64, fileType);
        };
        reader.readAsDataURL(selectedFile);
      } else {
        processSubmission(newMaterial.url || "", newMaterial.type || "Article");
      }
    }
  };

  const handleDeleteMaterial = (id: string) => {
    const updatedMaterials = deleteLocalItem("trainingMaterials", id);
    setTrainingMaterials(updatedMaterials);
    setShowSeenDetails((prev) => (prev?.id === id ? null : prev));
    logAction("Material Deleted", `Deleted material with ID: ${id}`);
  };

  const handleSendNotification = (e: React.FormEvent) => {
    e.preventDefault();
    if (newNotification.title && newNotification.content) {
      const notification: Notification = {
        id: Math.random().toString(36).substr(2, 9),
        title: newNotification.title,
        content: newNotification.content,
        type: newNotification.type as any,
        deadline: newNotification.deadline || "",
        createdAt: new Date().toISOString(),
        authorId: "admin",
        authorName: "Admin",
        seenBy: [],
      };
      const updatedNotifications = addLocalItem("notifications", notification);
      setNotifications(updatedNotifications);
      setShowSeenDetails(notification);
      logAction(
        "Notification Sent",
        `Sent notification: ${notification.title}`,
      );
      setNewNotification({
        type: "general",
        deadline: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
      });
      setNotifSubTab("inbox");
    }
  };

  const markMaterialAsRead = (id: string) => {
    const mat = trainingMaterials.find((m) => m.id === id);
    if (mat && !mat.seenBy?.some((s) => s.userId === "admin")) {
      const seenBy = [
        ...(mat.seenBy || []),
        {
          userId: "admin",
          userName: "Admin",
          seenAt: new Date().toISOString(),
        },
      ];
      const updatedMaterials = updateLocalItem("trainingMaterials", id, {
        seenBy,
      });
      setTrainingMaterials(updatedMaterials);
      setShowSeenDetails((prev) =>
        prev?.id === id ? ({ ...prev, seenBy } as any) : prev,
      );
    }
  };

  const markNotificationAsRead = (id: string) => {
    const n = notifications.find((notif) => notif.id === id);
    if (n && !n.seenBy?.some((s) => s.userId === "admin")) {
      const seenBy = [
        ...(n.seenBy || []),
        {
          userId: "admin",
          userName: "Admin",
          seenAt: new Date().toISOString(),
        },
      ];
      const updatedNotifications = updateLocalItem("notifications", id, {
        seenBy,
      });
      setNotifications(updatedNotifications);
      setShowSeenDetails((prev) =>
        prev?.id === id ? ({ ...prev, seenBy } as any) : prev,
      );
    }
  };

  const handleDeleteNotification = (id: string) => {
    const updatedNotifications = deleteLocalItem("notifications", id);
    setNotifications(updatedNotifications);
    logAction("Notification Deleted", `Deleted notification: ${id}`);
  };

  const handleDeleteUser = async (id: string) => {
    const userToDelete = csrs.find((u) => u.id === id);
    if (!userToDelete) return;

    try {
      await apiClient.delete(`/users/${id}`);
      const updatedUsers = csrs.filter((u) => u.id !== id);
      setLocalData("users", updatedUsers);
      setCsrs(updatedUsers);
      logAction("Employee Deleted", `Deleted employee: ${userToDelete.name}`);
    } catch (error: any) {
      console.error("Error deleting CSR user:", error);
      alert(error.response?.data?.error || "Хэрэглэгч устгахад алдаа гарлаа.");
    }
  };

  const handleResetUserPassword = async (user: CSR) => {
    if (!user.id) {
      alert(
        "Хэрэглэгчийн ID олдсонгүй. Хуудсаа refresh хийгээд дахин оролдоно уу.",
      );
      return;
    }

    try {
      const response = await apiClient.post(`/users/${user.id}/reset-password`);
      logAction(
        "Password Reset Link",
        `Sent password setup link to CSR ${user.name} (${user.email})`,
      );
      alert(response.data?.message || `${user.email || user.name} хэрэглэгчийн и-мэйл рүү нууц үг тохируулах холбоос илгээгдлээ.`);
      await fetchCsrUsers();
    } catch (error: any) {
      console.error("Error resetting CSR password:", error);
      alert(error.response?.data?.error || "Нууц үг сэргээхэд алдаа гарлаа.");
    }
  };

  const exportNotificationSeenList = (notif: Notification) => {
    const data = csrs.map((csr) => {
      const seenInfo = notif.seenBy?.find((s) => s.userId === csr.id);
      return {
        Ажилтан: csr.name,
        Имэйл: csr.email || "-",
        Сегмент: csr.lineType,
        Төлөв: seenInfo ? "Үзсэн" : "Үзээгүй",
        "Үзсэн хугацаа": seenInfo
          ? new Date(seenInfo.seenAt).toLocaleString()
          : "-",
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Seen Status");
    XLSX.writeFile(workbook, `Notification_Report_${notif.id}.xlsx`);
    logAction(
      "Export Notification Report",
      `Exported seen report for: ${notif.title}`,
    );
  };

  const exportNotificationUnseenList = (notif: Notification) => {
    const unseenUsers = csrs.filter(
      (u) => !notif.seenBy?.some((s) => s.userId === u.id),
    );
    const data = unseenUsers.map((csr) => {
      return {
        Ажилтан: csr.name,
        Имэйл: csr.email || "-",
        Сегмент: csr.lineType,
        Эрх: csr.role,
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Unseen Users");
    XLSX.writeFile(workbook, `Notification_Unseen_${notif.id}.xlsx`);
    logAction(
      "Export Unseen Users",
      `Exported unseen users for: ${notif.title}`,
    );
  };

  const normalizeHolidayItems = (items: any[] = []) =>
    items.map((h: any) => ({
      ...h,
      id: h.id || Math.random().toString(36).substr(2, 9),
    }));

  const saveHolidayForDate = (
    date: string,
    name: string,
    existingId?: string,
  ) => {
    const trimmedName = name.trim();

    if (!date) {
      alert("Эхлээд календар дээр өдөр сонгоно уу.");
      return false;
    }

    if (!trimmedName) {
      alert("Баярын нэрийг оруулна уу.");
      return false;
    }

    const normalizedHolidays = normalizeHolidayItems(
      getLocalData("holidays", []),
    );
    const currentHoliday = existingId
      ? normalizedHolidays.find((h: any) => h.id === existingId)
      : normalizedHolidays.find((h: any) => h.date === date);

    const updated = currentHoliday
      ? normalizedHolidays.map((h: any) =>
          h.id === currentHoliday.id ? { ...h, date, name: trimmedName } : h,
        )
      : [
          ...normalizedHolidays,
          {
            id: Math.random().toString(36).substr(2, 9),
            date,
            name: trimmedName,
          },
        ];

    setLocalData("holidays", updated);
    setHolidays(updated);
    setSelectedHolidayName(trimmedName);
    setHolidayData({ id: "", date: "", name: "" });
    logAction(
      currentHoliday ? "Holiday Updated" : "Holiday Added",
      `${trimmedName} on ${date}`,
    );
    return true;
  };

  const removeHolidayForDate = (date: string) => {
    if (!date) return;

    const normalizedHolidays = normalizeHolidayItems(
      getLocalData("holidays", []),
    );
    const holiday = normalizedHolidays.find((h: any) => h.date === date);
    const updated = normalizedHolidays.filter((h: any) => h.date !== date);

    setLocalData("holidays", updated);
    setHolidays(updated);
    setSelectedHolidayName("");
    if (holidayData.date === date) {
      setHolidayData({ id: "", date: "", name: "" });
    }
    logAction(
      "Holiday Removed",
      `${holiday?.name || "Holiday"} removed from ${date}`,
    );
  };

  const handleAddHoliday = () => {
    const targetDates = selectedBookingDates.length > 0
      ? [...selectedBookingDates].sort()
      : holidayData.date
        ? [holidayData.date]
        : selectedDateSchedule
          ? [selectedDateSchedule]
          : [];

    if (targetDates.length === 0) {
      alert("Эхлээд календар дээр өдөр сонгоно уу.");
      return;
    }

    const trimmedName = holidayData.name.trim();
    if (!trimmedName) {
      alert("Баярын нэрийг оруулна уу.");
      return;
    }

    const normalizedHolidays = normalizeHolidayItems(getLocalData("holidays", []));
    const updatedByDate = new Map(normalizedHolidays.map((h: any) => [h.date, h]));

    targetDates.forEach((date) => {
      const currentHoliday = updatedByDate.get(date) as any;
      updatedByDate.set(date, currentHoliday
        ? { ...currentHoliday, name: trimmedName }
        : { id: Math.random().toString(36).substr(2, 9), date, name: trimmedName }
      );
    });

    const updated = Array.from(updatedByDate.values()).sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
    setLocalData("holidays", updated);
    setHolidays(updated);
    setSelectedHolidayName(targetDates.length === 1 ? trimmedName : "");
    setHolidayData({ id: "", date: "", name: "" });
    setIsAddingHoliday(false);
    logAction("Holiday Saved", `${trimmedName} saved for ${targetDates.length} day(s)`);
  };

  const [isAddingUser, setIsAddingUser] = useState(false);
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [isEditingUser, setIsEditingUser] = useState(false);
  const [editingUser, setEditingUser] = useState<CSR | null>(null);
  const [bulkUsers, setBulkUsers] = useState<BulkUploadUser[]>([]);
  const [bulkUploadFileName, setBulkUploadFileName] = useState("");
  const [bulkUploadError, setBulkUploadError] = useState("");
  const [isAddingSegment, setIsAddingSegment] = useState(false);
  const [newSegment, setNewSegment] = useState("");
  const [editingSegment, setEditingSegment] = useState<string | null>(null);
  const [segmentDraftName, setSegmentDraftName] = useState("");
  const [newUser, setNewUser] = useState<Partial<CSR>>({
    role: "csr",
    lineType: "",
    code: "",
    location: "",
    supervisorName: "",
    employmentType: "Full Time",
    status: "offline",
    photoUrl:
      "https://api.dicebear.com/7.x/avataaars/svg?seed=" + Math.random(),
  });

  const handleAddUser = async () => {
    const normalizedLocation = normalizeEmployeeLocation(newUser.location);
    if (
      !newUser.code ||
      !newUser.name ||
      !newUser.email ||
      !newUser.lineType ||
      !newUser.employmentType ||
      !normalizedLocation ||
      !String(newUser.supervisorName || "").trim()
    ) {
      alert(
        "Ажилтны код, User, e-mail, segment, Part/Full, Location, Supervisor бүгд шаардлагатай.",
      );
      return;
    }

    try {
      const response = await apiClient.post("/users", {
        code: newUser.code,
        name: newUser.name,
        email: newUser.email,
        location: normalizedLocation,
        supervisorName: String(newUser.supervisorName || "").trim(),
        role: "csr",
        status: "active",
        segment: newUser.lineType,
        employmentType: newUser.employmentType || "Full Time",
      });
      const userToAdd = mapCsrForUi({
        ...response.data,
        segment: newUser.lineType,
        location: normalizedLocation,
        supervisorName: String(newUser.supervisorName || "").trim(),
        photoUrl: newUser.photoUrl,
      });
      const updatedUsers = [...csrs, userToAdd];
      setLocalData("users", updatedUsers);
      setCsrs(updatedUsers);
      setIsAddingUser(false);
      setNewUser({
        role: "csr",
        lineType: "",
        code: "",
        location: "",
        supervisorName: "",
        employmentType: "Full Time",
        status: "offline",
        photoUrl:
          "https://api.dicebear.com/7.x/avataaars/svg?seed=" + Math.random(),
      });
      logAction("Employee Added", `Added employee: ${newUser.name}`);
      alert(response.data?.message || `CSR амжилттай нэмэгдэж, ${newUser.email} хаяг руу нууц үг тохируулах холбоос илгээгдлээ.`);
      await fetchCsrUsers();
    } catch (error: any) {
      console.error("Error adding CSR user:", error);
      alert(error.response?.data?.error || "Хэрэглэгч нэмэхэд алдаа гарлаа.");
    }
  };

  const handleEditUserClick = (user: CSR) => {
    setEditingUser(user);
    setIsEditingUser(true);
  };

  const handleUpdateUser = async () => {
    if (editingUser) {
      const normalizedLocation = normalizeEmployeeLocation(editingUser.location);
      if (!normalizedLocation) {
        alert("Location заавал Ulaanbaatar эсвэл Darkhan байна.");
        return;
      }
      if (!String(editingUser.supervisorName || "").trim()) {
        alert("Supervisor / ахлах ажилтны нэр шаардлагатай.");
        return;
      }
      try {
        await apiClient.put(`/users/${editingUser.id}`, {
          code: editingUser.code,
          name: editingUser.name,
          location: normalizedLocation,
          supervisorName: String(editingUser.supervisorName || "").trim(),
          status: editingUser.status || "active",
          segment: editingUser.lineType,
          employmentType: editingUser.employmentType || "Full Time",
        });
        const updatedUsers = csrs.map((u: CSR) =>
          u.id === editingUser.id ? { ...editingUser, location: normalizedLocation, supervisorName: String(editingUser.supervisorName || "").trim() } : u,
        );
        setLocalData("users", updatedUsers);
        setCsrs(updatedUsers);
        setIsEditingUser(false);
        setEditingUser(null);
        logAction("User Updated", `Updated user: ${editingUser.name}`);
        await fetchCsrUsers();
      } catch (error: any) {
        console.error("Error updating CSR user:", error);
        alert(
          error.response?.data?.error || "Хэрэглэгч шинэчлэхэд алдаа гарлаа.",
        );
      }
    }
  };

  const closeBulkUploadModal = () => {
    setIsBulkUploadOpen(false);
    setBulkUsers([]);
    setBulkUploadFileName("");
    setBulkUploadError("");
  };

  const normalizeExcelKey = (key: string) =>
    key.toLowerCase().replace(/[\s._/-]/g, "");

  const getExcelValue = (row: Record<string, any>, keys: string[]) => {
    for (const key of keys) {
      if (
        row[key] !== undefined &&
        row[key] !== null &&
        String(row[key]).trim() !== ""
      ) {
        return String(row[key]).trim();
      }
    }

    const normalizedRow = Object.entries(row).reduce(
      (acc, [key, value]) => {
        acc[normalizeExcelKey(key)] = value;
        return acc;
      },
      {} as Record<string, any>,
    );

    for (const key of keys) {
      const value = normalizedRow[normalizeExcelKey(key)];
      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ""
      ) {
        return String(value).trim();
      }
    }

    return "";
  };

  const normalizeEmploymentTypeInput = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (["part", "parttime", "part time", "pt"].includes(normalized))
      return "Part Time";
    return "Full Time";
  };

  const persistSegments = (updatedSegments: string[]) => {
    setLocalData("segments", updatedSegments);
    setSegments(updatedSegments);

    if (activeSegmentView && !updatedSegments.includes(activeSegmentView)) {
      setActiveSegmentView(updatedSegments[0] || "");
    }

    if (
      filters.segment !== "All" &&
      !updatedSegments.includes(filters.segment)
    ) {
      setFilters((prev) => ({ ...prev, segment: "All" }));
    }
  };

  const handleBulkUploadFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBulkUploadFileName(file.name);
    setBulkUploadError("");

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const workbook = XLSX.read(evt.target?.result, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
          defval: "",
        });
        const existingEmails = new Set(
          csrs.map((user) => (user.email || "").toLowerCase()).filter(Boolean),
        );
        const fileEmails = new Set<string>();

        const parsedRows: BulkUploadUser[] = rows.map((row, index) => {
          const email = getExcelValue(row, [
            "e-mail",
            "email",
            "Email",
            "E-mail",
            "И-мэйл",
            "Имэйл",
          ]);
          const name = getExcelValue(row, [
            "User",
            "user",
            "Нэр",
            "Name",
            "name",
          ]);
          const code = getExcelValue(row, [
            "Ажилтны код",
            "Code",
            "code",
            "Employee code",
            "Employee Code",
          ]);
          const segment = getExcelValue(row, ["segment", "Segment", "Сегмент"]);
          const locationRaw = getExcelValue(row, [
            "Location",
            "location",
            "Байршил",
            "Салбар",
          ]);
          const location = normalizeEmployeeLocation(locationRaw);
          const supervisorName = getExcelValue(row, [
            "Supervisor",
            "SV",
            "supervisor",
            "supervisorName",
            "supervisor_name",
            "Ахлах ажилтан",
            "Ахлах",
          ]);
          const matchedSegment =
            segments.find(
              (existingSegment) =>
                existingSegment.toLowerCase() === String(segment).toLowerCase(),
            ) || segment;
          const employmentType = normalizeEmploymentTypeInput(
            getExcelValue(row, [
              "Part/Full",
              "Part Full",
              "part/full",
              "Employment Type",
              "employmentType",
              "Ажлын төрөл",
            ]),
          );

          const errors: string[] = [];
          const normalizedEmail = email.toLowerCase();

          if (!code) errors.push("ажилтны код дутуу");
          if (!name) errors.push("User/нэр дутуу");
          if (!email) errors.push("e-mail дутуу");
          if (!segment) errors.push("segment дутуу");
          if (!location) errors.push("Location нь Ulaanbaatar эсвэл Darkhan байх ёстой");
          if (!supervisorName) errors.push("Supervisor/ахлах ажилтан дутуу");
          if (normalizedEmail && existingEmails.has(normalizedEmail))
            errors.push("email бүртгэлтэй");
          if (normalizedEmail && fileEmails.has(normalizedEmail))
            errors.push("файл дотор email давхардсан");
          if (normalizedEmail) fileEmails.add(normalizedEmail);

          return {
            rowNumber: index + 2,
            code,
            name,
            email,
            location,
            supervisorName,
            lineType: matchedSegment,
            employmentType,
            role: "csr",
            status: "active",
            photoUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name || email || String(index))}`,
            error: errors.join(", "),
          };
        });

        setBulkUsers(parsedRows);
        if (parsedRows.length === 0) {
          setBulkUploadError("Excel файл дээр унших мөр олдсонгүй.");
        }
      } catch (error) {
        console.error("Error parsing bulk upload file:", error);
        setBulkUsers([]);
        setBulkUploadError(
          "Excel файл уншихад алдаа гарлаа. Загварын дагуу .xlsx файл оруулна уу.",
        );
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleBulkAdd = async () => {
    const validUsers = bulkUsers.filter(
      (u) =>
        !u.error && u.code && u.name && u.email && u.lineType && u.location && u.supervisorName,
    );
    if (validUsers.length === 0) {
      alert(
        "Нэмэх боломжтой мөр алга байна. Excel файлын алдаатай мөрүүдийг засна уу.",
      );
      return;
    }

    try {
      const uploadSegments = Array.from(
        new Set(
          validUsers
            .map((user) => String(user.lineType || "").trim())
            .filter(Boolean),
        ),
      );
      const missingSegments = uploadSegments.filter(
        (segment) =>
          !segments.some(
            (existingSegment) =>
              existingSegment.toLowerCase() === String(segment).toLowerCase(),
          ),
      );
      if (missingSegments.length > 0) {
        persistSegments([...segments, ...missingSegments]);
      }

      const usersToAdd: CSR[] = [];
      for (const user of validUsers) {
        const response = await apiClient.post("/users", {
          code: user.code,
          name: user.name,
          email: user.email,
          location: user.location,
          supervisorName: user.supervisorName,
          role: "csr",
          status: "active",
          segment: user.lineType,
          employmentType: user.employmentType || "Full Time",
        });
        usersToAdd.push(
          mapCsrForUi({
            ...response.data,
            segment: user.lineType,
            location: user.location,
            supervisorName: user.supervisorName,
            photoUrl: user.photoUrl,
          }),
        );
      }

      const updatedUsers = [...csrs, ...usersToAdd];
      setLocalData("users", updatedUsers);
      setCsrs(updatedUsers);
      closeBulkUploadModal();
      logAction(
        "Bulk Employees Added",
        `${usersToAdd.length} ажилтан Excel-ээр олноор нэмэгдлээ.`,
      );
      await fetchCsrUsers();
      alert(`${usersToAdd.length} CSR амжилттай нэмэгдэж, нууц үг тохируулах холбоосууд и-мэйлээр илгээгдлээ.`);
    } catch (error: any) {
      console.error("Error bulk adding CSR users:", error);
      alert(
        error.response?.data?.error || "Хэрэглэгч олноор нэмэхэд алдаа гарлаа.",
      );
    }
  };

  const handleAddSegment = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedSegment = newSegment.trim();
    if (
      trimmedSegment &&
      !segments.some((s) => s.toLowerCase() === trimmedSegment.toLowerCase())
    ) {
      const updatedSegments = [...segments, trimmedSegment];
      persistSegments(updatedSegments);
      setIsAddingSegment(false);
      setNewSegment("");
      logAction("Segment Added", `Added segment: ${trimmedSegment}`);
    }
  };

  const handleDeleteSegment = (segmentName: string) => {
    const updatedSegments = segments.filter((s) => s !== segmentName);
    persistSegments(updatedSegments);
    logAction("Segment Deleted", `Deleted segment: ${segmentName}`);
  };

  const handleMoveSegment = (segmentName: string, direction: -1 | 1) => {
    const currentIndex = segments.indexOf(segmentName);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= segments.length)
      return;

    const updatedSegments = [...segments];
    [updatedSegments[currentIndex], updatedSegments[nextIndex]] = [
      updatedSegments[nextIndex],
      updatedSegments[currentIndex],
    ];
    persistSegments(updatedSegments);
    logAction("Segment Reordered", `Moved segment ${segmentName}`);
  };

  const handleStartRenameSegment = (segmentName: string) => {
    setEditingSegment(segmentName);
    setSegmentDraftName(segmentName);
  };

  const handleRenameSegment = async (oldName: string) => {
    const nextName = segmentDraftName.trim();
    if (!nextName || nextName === oldName) {
      setEditingSegment(null);
      setSegmentDraftName("");
      return;
    }

    if (
      segments.some(
        (segment) =>
          segment !== oldName &&
          segment.toLowerCase() === nextName.toLowerCase(),
      )
    ) {
      alert("Ийм нэртэй сегмент байна.");
      return;
    }

    const affectedUsers = csrs.filter((user) => user.lineType === oldName);

    try {
      await Promise.all(
        affectedUsers.map((user) =>
          apiClient.put(`/users/${user.id}`, {
            code: user.code,
            name: user.name,
            status: user.status || "active",
            segment: nextName,
            employmentType: user.employmentType || "Full Time",
          }),
        ),
      );

      const updatedSegments = segments.map((segment) =>
        segment === oldName ? nextName : segment,
      );
      const updatedUsers = csrs.map((user) =>
        user.lineType === oldName ? { ...user, lineType: nextName } : user,
      );
      const updatedSchedules = Object.entries(schedules).reduce(
        (acc, [dateKey, dayData]: [string, any]) => {
          acc[dateKey] = dayData?.shifts
            ? {
                ...dayData,
                shifts: dayData.shifts.map((shift: any) =>
                  shift.segment === oldName
                    ? { ...shift, segment: nextName }
                    : shift,
                ),
              }
            : dayData;
          return acc;
        },
        {} as Record<string, any>,
      );

      persistSegments(updatedSegments);
      setLocalData("users", updatedUsers);
      setCsrs(updatedUsers);
      await persistSchedules(updatedSchedules, Object.keys(updatedSchedules));
      if (activeSegmentView === oldName) setActiveSegmentView(nextName);
      if (filters.segment === oldName)
        setFilters((prev) => ({ ...prev, segment: nextName }));
      setEditingSegment(null);
      setSegmentDraftName("");
      logAction("Segment Renamed", `Renamed segment ${oldName} to ${nextName}`);
      await fetchCsrUsers();
    } catch (error: any) {
      console.error("Error renaming segment:", error);
      alert(error.response?.data?.error || "Сегмент нэр солиход алдаа гарлаа.");
    }
  };

  const getTodayDateKey = () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const isPastScheduleDate = (dateKey?: string | null) => {
    return !!dateKey && dateKey < getTodayDateKey();
  };

  useEffect(() => {
    if (activeTab !== "schedule") return;

    const today = new Date();
    const todayKey = getTodayDateKey();
    setSelectedDateSchedule(todayKey);
    setSelectedYearCalendar(today.getFullYear());
    setSelectedMonthCalendar(today.getMonth());
  }, [activeTab]);

  const isBookingOpenAtDue = (bookingOpenAt?: string) => {
    if (!bookingOpenAt) return true;
    const openAtTime = new Date(bookingOpenAt).getTime();
    return Number.isNaN(openAtTime) || openAtTime <= Date.now();
  };

  const isScheduleBookingOpen = (dateKey?: string | null) => {
    const daySchedule = dateKey ? schedules[dateKey] : null;
    return (
      !!dateKey &&
      !isPastScheduleDate(dateKey) &&
      !!daySchedule?.bookingOpen &&
      isBookingOpenAtDue(daySchedule.bookingOpenAt)
    );
  };

  const getScheduleBookingLabel = (dateKey?: string | null) => {
    const daySchedule = dateKey ? schedules[dateKey] : null;
    const daySlotTotal = (daySchedule?.shifts || []).reduce(
      (sum: number, shift: any) => sum + (Number(shift.totalSlots) || 0),
      0,
    );
    if (!dateKey || daySlotTotal <= 0 || isPastScheduleDate(dateKey)) return "";
    if (isScheduleBookingOpen(dateKey)) return "Захиалга нээлттэй";
    if (daySchedule?.bookingOpen) return `Товлогдсон ${formatBookingOpenAt(daySchedule.bookingOpenAt)}`;
    return "Захиалга хаалттай";
  };

  const renderUsersView = () => {
    const filteredCsrs = getFilteredCsrs();
    const segmentsToDisplay =
      filters.segment === "All"
        ? segments
        : segments.filter((s) => s === filters.segment);

    const groupedCsrs = segmentsToDisplay.reduce(
      (acc, segment) => {
        acc[segment] = filteredCsrs.filter((c) => c.lineType === segment);
        return acc;
      },
      {} as Record<string, CSR[]>,
    );

    if (filters.segment === "All") {
      const otherCsrs = filteredCsrs.filter(
        (c) => !segments.includes(c.lineType),
      );
      if (otherCsrs.length > 0) groupedCsrs["Бусад"] = otherCsrs;
    }

    return (
      <div className="space-y-12">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          {/* Action buttons and search in one row */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsAddingUser(true)}
              className="flex items-center gap-2.5 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white bg-blue-600 shadow-xl shadow-blue-900/50 hover:scale-[1.02] hover:bg-blue-500 active:scale-95 transition-all"
            >
              <UserPlus size={18} />
              Нэгээр нэмэх
            </button>
            <button
              onClick={() => setIsBulkUploadOpen(true)}
              className="flex items-center gap-2.5 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
            >
              <Upload size={18} />
              Олноор нэмэх
            </button>
            <button
              onClick={() => setIsAddingSegment(true)}
              className="flex items-center gap-2.5 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
            >
              <Plus size={18} />
              Сегмент нэмэх
            </button>
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-2.5 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white bg-green-500 hover:bg-green-600 transition-all"
            >
              <Download size={18} />
              Excel татах
            </button>
          </div>
          <div className="relative group overflow-hidden rounded-[2rem] xl:ml-4">
            <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-gray-500 group-focus-within:text-blue-500 transition-colors z-10">
              <Search size={20} />
            </div>
            <input
              type="text"
              placeholder="Хайх..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-14 pr-8 py-4 bg-gray-900/40 border border-gray-800 rounded-[2rem] text-sm focus:outline-none focus:border-blue-500/50 focus:bg-gray-900/60 transition-all xl:w-56 text-white backdrop-blur-xl shadow-inner scroll-smooth"
            />
          </div>
        </div>

        {(Object.entries(groupedCsrs) as [string, CSR[]][]).map(
          ([segment, members]) => (
            <div key={`segment-group-${segment}`} className="space-y-6">
              <div className="flex items-center gap-4">
                {editingSegment === segment ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleRenameSegment(segment);
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      value={segmentDraftName}
                      onChange={(event) =>
                        setSegmentDraftName(event.target.value)
                      }
                      className="w-56 rounded-xl border border-blue-500/40 bg-gray-900 px-4 py-2 text-sm font-black uppercase tracking-widest text-white outline-none focus:border-blue-400"
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="rounded-xl bg-blue-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-blue-500"
                    >
                      Хадгалах
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSegment(null);
                        setSegmentDraftName("");
                      }}
                      className="rounded-xl bg-gray-800 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-gray-300 hover:text-white"
                    >
                      Болих
                    </button>
                  </form>
                ) : (
                  <h3 className="text-xl font-outfit font-black text-white uppercase tracking-widest">
                    {segment}
                  </h3>
                )}
                <div className="flex-1 h-px bg-gradient-to-r from-gray-800 to-transparent" />
                <div className="flex items-center gap-4">
                  <span className="text-xs font-outfit font-black text-gray-500 uppercase tracking-widest">
                    {members.length} ажилтан
                  </span>
                  {segments.includes(segment) && (
                    <div className="flex items-center gap-1">
                      {(() => {
                        const segmentIndex = segments.indexOf(segment);
                        return (
                          <>
                            <button
                              onClick={() => handleMoveSegment(segment, -1)}
                              disabled={segmentIndex <= 0}
                              className="p-1.5 text-gray-600 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-600"
                              title="Сегментийг дээш зөөх"
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              onClick={() => handleMoveSegment(segment, 1)}
                              disabled={
                                segmentIndex === -1 ||
                                segmentIndex >= segments.length - 1
                              }
                              className="p-1.5 text-gray-600 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-600"
                              title="Сегментийг доош зөөх"
                            >
                              <ArrowDown size={14} />
                            </button>
                          </>
                        );
                      })()}
                      <button
                        onClick={() => handleStartRenameSegment(segment)}
                        className="p-1.5 text-gray-600 hover:text-blue-500 hover:bg-blue-500/10 rounded-lg transition-all"
                        title="Сегментийн нэр солих"
                      >
                        <Edit size={14} />
                      </button>
                      {members.length === 0 && (
                        <button
                          onClick={() => handleDeleteSegment(segment)}
                          className="p-1.5 text-gray-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                          title="Хоосон сегмент устгах"
                        >
                          <Trash size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-gray-900/40 border border-gray-800 rounded-3xl overflow-x-auto backdrop-blur-md shadow-2xl">
                {members.length > 0 ? (
                  <table className="w-full min-w-[1320px] table-fixed text-left">
                    <thead>
                      <tr className="border-b border-gray-800 bg-gray-800/30">
                        <th className="w-[140px] px-6 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest whitespace-nowrap">
                          Ажилтны код
                        </th>
                        <th className="w-[230px] px-6 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest whitespace-nowrap">
                          User
                        </th>
                        <th className="w-[300px] px-6 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest whitespace-nowrap">
                          e-mail
                        </th>
                        <th className="w-[180px] px-6 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest whitespace-nowrap">
                          segment
                        </th>
                        <th className="w-[170px] px-6 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest whitespace-nowrap">
                          Part/Full
                        </th>
                        <th className="w-[170px] px-6 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest whitespace-nowrap">
                          Location
                        </th>
                        <th className="w-[190px] px-6 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest whitespace-nowrap">
                          Supervisor
                        </th>
                        <th className="w-[130px] px-6 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest text-right whitespace-nowrap">
                          Үйлдэл
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {members.map((csr) => (
                        <tr
                          key={csr.id}
                          className="hover:bg-blue-600/5 transition-all group"
                        >
                          <td className="px-6 py-5 align-middle whitespace-nowrap">
                            <span className="text-sm font-black text-blue-500 group-hover:scale-110 transition-transform inline-block lowercase">
                              {csr.code || csr.id.slice(0, 6).toUpperCase()}
                            </span>
                          </td>
                          <td className="px-6 py-5 align-middle whitespace-nowrap">
                            <div className="max-w-[210px] truncate text-base font-black text-white group-hover:translate-x-1 transition-transform inline-block cursor-default tracking-wide uppercase">
                              {csr.name}
                            </div>
                          </td>
                          <td className="px-6 py-5 align-middle whitespace-nowrap">
                            <div className="max-w-[280px] truncate text-sm font-black text-white flex items-center gap-2">
                              <Mail size={14} className="shrink-0 text-blue-500" />
                              {csr.email ||
                                `${csr.name.toLowerCase().replace(/\s/g, ".")}@example.com`}
                            </div>
                          </td>
                          <td className="px-6 py-5 align-middle whitespace-nowrap">
                            <span className="block max-w-[160px] truncate text-sm font-black uppercase tracking-widest text-white">
                              {csr.lineType || "-"}
                            </span>
                          </td>
                          <td className="px-6 py-5 align-middle whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Clock size={14} className="text-blue-500" />
                              <span className="text-sm font-black uppercase tracking-widest text-white">
                                {csr.employmentType || "Full Time"}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-5 align-middle whitespace-nowrap">
                            <span className="text-sm font-bold text-gray-300">
                              {getCsrLocation(csr) || "-"}
                            </span>
                          </td>
                          <td className="px-6 py-5 align-middle whitespace-nowrap">
                            <span className="block max-w-[170px] truncate text-sm font-black uppercase tracking-wide text-white">
                              {getCsrSupervisorName(csr) || "-"}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-right align-middle">
                            <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleEditUserClick(csr)}
                              className="p-2.5 text-gray-600 hover:text-blue-500 hover:bg-blue-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                              title="Засах"
                            >
                              <Edit size={20} />
                            </button>
                            <button
                              onClick={() => handleResetUserPassword(csr)}
                              className="p-2.5 text-gray-600 hover:text-green-500 hover:bg-green-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                              title="Нууц үг reset"
                            >
                              <RefreshCcw size={20} />
                            </button>
                            <button
                              onClick={() =>
                                handleSecureConfirm(
                                  `Ажилтан хасах баталгаажуулалт`,
                                  `'${csr.name}' ажилтныг бүртгэлээс хасахын тулд өөрийн нэвтрэх нэр болон нууц үгээ оруулна уу.`,
                                  () => handleDeleteUser(csr.id),
                                )
                              }
                              className="p-2.5 text-gray-600 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 size={20} />
                            </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-12 text-center">
                    <p className="text-gray-500 text-sm font-medium">
                      Энэ сегментэд ажилтан бүртгэгдээгүй байна.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ),
        )}
      </div>
    );
  };

  const renderVacationView = () => {
    const months = [
      "1-р сар",
      "2-р сар",
      "3-р сар",
      "4-р сар",
      "5-р сар",
      "6-р сар",
      "7-р сар",
      "8-р сар",
      "9-р сар",
      "10-р сар",
      "11-р сар",
      "12-р сар",
    ];

    if (selectedMonth !== null) {
      const monthRequests = vacationRequests
        .filter((req) => {
          const date = new Date(req.startDate);
          const isMonth = date.getMonth() === selectedMonth;

          if (!isMonth) return false;
          if (vacationSegmentFilter === "All") return true;

          const requester = csrs.find((c) => c.id === req.csrId);
          return requester?.lineType === vacationSegmentFilter;
        })
        .sort(
          (a, b) =>
            new Date(a.createdAt || 0).getTime() -
            new Date(b.createdAt || 0).getTime(),
        );

      return (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSelectedMonth(null)}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-xl transition-all"
              >
                <ChevronLeft size={24} />
              </button>
              <div>
                <h2 className="text-3xl font-outfit font-black text-white tracking-tight">
                  {months[selectedMonth]}
                </h2>
                <p className="text-gray-400 mt-1">
                  Нийт {monthRequests.length} хүсэлт ирсэн байна.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative group">
                <select
                  value={vacationSegmentFilter}
                  onChange={(e) => setVacationSegmentFilter(e.target.value)}
                  className="appearance-none bg-gray-900 border border-gray-800 rounded-2xl px-6 py-3 pr-10 text-xs font-black text-white uppercase tracking-widest focus:outline-none focus:border-blue-500 transition-all cursor-pointer min-w-[160px]"
                >
                  <option value="All">Бүх сегмент</option>
                  {segments.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                  <Filter size={14} />
                </div>
              </div>

              <button
                onClick={() =>
                  handleExportVacations(selectedMonth!, monthRequests)
                }
                className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-green-900/20"
              >
                <Download size={14} /> Татах
              </button>
            </div>
          </div>

          <div className="bg-gray-900/40 border border-gray-800 rounded-3xl overflow-hidden backdrop-blur-md">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-800/30">
                  <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest w-40">
                    Код
                  </th>
                  <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">
                    Ажилтан
                  </th>
                  <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">
                    Имэйл хаяг
                  </th>
                  <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">
                    Хугацаа
                  </th>
                  <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest text-right">
                    Үйлдэл
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {monthRequests.map((req) => {
                  const requester = csrs.find((c) => c.id === req.csrId);
                  return (
                    <tr
                      key={req.id}
                      className="hover:bg-gray-800/10 transition-colors group"
                    >
                      <td className="px-8 py-6">
                        <span className="text-sm font-black text-blue-500">
                          {requester?.code || "---"}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <div className="font-bold text-white uppercase tracking-wide">
                          {req.csrName}
                        </div>
                      </td>
                      <td className="px-8 py-6 text-sm text-gray-400">
                        {requester?.email || "---"}
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-2 text-sm text-gray-300">
                          <Calendar size={14} className="text-blue-400" />
                          {req.startDate} - {req.endDate}
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right">
                        {req.status === "pending" && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() =>
                                handleConfirm(
                                  `'${req.csrName}'-ийн хүсэлтийг зөвшөөрөх үү?`,
                                  () => handleApproveVacation(req.id),
                                )
                              }
                              className="p-2 text-green-500 hover:bg-green-500/10 rounded-xl transition-all"
                              title="Зөвшөөрөх"
                            >
                              <CheckCircle2 size={20} />
                            </button>
                            <button
                              onClick={() =>
                                handleConfirm(
                                  `'${req.csrName}'-ийн хүсэлтээс татгалзах уу?`,
                                  () => handleRejectVacation(req.id),
                                )
                              }
                              className="p-2 text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                              title="Татгалзах"
                            >
                              <XCircle size={20} />
                            </button>
                          </div>
                        )}
                        {req.status !== "pending" && (
                          <span
                            className={`text-[10px] font-black uppercase tracking-widest ${req.status === "approved" ? "text-green-500" : "text-red-500"}`}
                          >
                            {req.status === "approved"
                              ? "Зөвшөөрсөн"
                              : "Татгалзсан"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {monthRequests.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-20 text-center text-gray-500 font-bold uppercase tracking-widest text-xs opacity-50"
                    >
                      Энэ сард амралтын хүсэлт байхгүй байна
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-black text-white tracking-tight">
              Ээлжийн амралт
            </h2>
            <p className="text-gray-400 mt-1">
              Сар бүрийн амралтын квот болон захиалгын мэдээлэл.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative group">
              <select
                value={vacationSegmentFilter}
                onChange={(e) => setVacationSegmentFilter(e.target.value)}
                className="appearance-none bg-gray-900 border border-gray-800 rounded-2xl px-6 py-3 pr-10 text-xs font-black text-white uppercase tracking-widest focus:outline-none focus:border-blue-500 transition-all cursor-pointer min-w-[160px]"
              >
                <option value="All">Бүх сегмент</option>
                {segments.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                <Filter size={14} />
              </div>
            </div>

            <button
              onClick={() => {
                const allFiltered = vacationRequests.filter((req) => {
                  if (vacationSegmentFilter === "All") return true;
                  const requester = csrs.find((c) => c.id === req.csrId);
                  return requester?.lineType === vacationSegmentFilter;
                });
                handleExportVacations(selectedMonthCalendar, allFiltered); // Using selectedMonthCalendar as a placeholder for year view
              }}
              className="flex items-center gap-2 px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all border border-white/5"
            >
              <Download size={14} /> Татах
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {months.map((month, index) => {
            const monthRequests = vacationRequests.filter((req) => {
              const date = new Date(req.startDate);
              const isMonth = date.getMonth() === index;
              if (!isMonth) return false;
              if (vacationSegmentFilter === "All") return true;
              const requester = csrs.find((c) => c.id === req.csrId);
              return requester?.lineType === vacationSegmentFilter;
            });
            const quota = monthlyQuotas[index] || 5;

            return (
              <div
                key={month}
                className="bg-gray-900/40 border border-gray-800 rounded-[2rem] p-5 hover:border-blue-500/50 transition-all group flex items-center gap-8 shadow-lg backdrop-blur-xl"
              >
                <div className="w-32 flex-shrink-0">
                  <h3 className="text-xl font-black text-white">{month}</h3>
                </div>

                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-black text-white">
                        {monthRequests.length}{" "}
                        <span className="text-gray-600">/</span> {quota}
                      </span>
                      <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest bg-gray-800 px-2 py-0.5 rounded-lg">
                        Захиалсан
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                        Квот:
                      </span>
                      <input
                        type="number"
                        value={quota}
                        onChange={(e) =>
                          handleUpdateQuota(
                            index,
                            parseInt(e.target.value) || 0,
                          )
                        }
                        className="w-16 bg-gray-800 border border-gray-700 rounded-xl px-2 py-1.5 text-sm text-center font-bold text-white focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-700 ease-out ${
                        monthRequests.length >= quota
                          ? "bg-red-500"
                          : "bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                      }`}
                      style={{
                        width: `${Math.min((monthRequests.length / quota) * 100, 100)}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="flex-shrink-0">
                  <button
                    onClick={() => setSelectedMonth(index)}
                    className="flex items-center gap-2 px-6 py-3 bg-gray-800 text-gray-300 rounded-2xl hover:bg-blue-600 hover:text-white transition-all font-black text-[10px] uppercase tracking-widest"
                  >
                    <Eye size={16} />
                    Харах
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderNotificationsView = () => {
    const notificationGroups = groupNotificationsByDay(
      notifications.filter(
        (n) => n.type === "general" || n.type === "important",
      ),
    );

    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-black text-white tracking-tight">
              Мэдэгдэл
            </h2>
            <p className="text-gray-400 mt-1">
              Системийн мэдэгдэл илгээх болон хянах.
            </p>
          </div>
          <div className="flex bg-gray-900 border border-gray-800 p-1.5 rounded-2xl shadow-xl">
            <button
              onClick={() => setNotifSubTab("inbox")}
              className={`flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${notifSubTab === "inbox" ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40" : "text-gray-500 hover:text-gray-300"}`}
            >
              <Inbox size={16} />
              Ирсэн
            </button>
            <button
              onClick={() => setNotifSubTab("send")}
              className={`flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${notifSubTab === "send" ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40" : "text-gray-500 hover:text-gray-300"}`}
            >
              <Send size={16} />
              Илгээх
            </button>
          </div>
        </div>

        {notifSubTab === "inbox" ? (
          <div className="space-y-8">
            {notificationGroups.length > 0 ? (
              notificationGroups.map((group) => (
                <section key={group.key} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-black text-gray-300 uppercase tracking-widest">
                      {group.title}
                    </h3>
                    <span className="rounded-full border border-gray-800 bg-gray-900 px-2.5 py-1 text-[10px] font-black text-gray-500">
                      {group.notifications.length}
                    </span>
                  </div>
                  <div className="space-y-4">
                    {group.notifications.map((notif, idx) => {
                      const isUnread = !notif.seenBy?.some(
                        (s) => s.userId === "admin",
                      );
                      return (
                        <div
                          key={`notif-${notif.id}-${idx}`}
                          className={`relative p-6 rounded-3xl border transition-all ${isUnread ? "bg-blue-600/5 border-blue-500/30 ring-1 ring-blue-500/20" : "bg-gray-900/30 border-gray-800 hover:border-gray-700"}`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex gap-4">
                              <div
                                className={`mt-1 p-3 rounded-2xl ${notif.type === "important" ? "bg-red-500/10 text-red-400" : "bg-blue-500/10 text-blue-400"}`}
                              >
                                {notif.type === "important" ? (
                                  <AlertCircle size={20} />
                                ) : (
                                  <Info size={20} />
                                )}
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center gap-3">
                                  <h3 className="font-black text-white">
                                    {notif.title}
                                  </h3>
                                  {isUnread && (
                                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shadow-glow shadow-blue-500" />
                                  )}
                                </div>
                                <p className="text-sm text-gray-400 leading-relaxed">
                                  {notif.content}
                                </p>
                                {(notif.relatedEntityType === "trade_requests" || notif.tradeRequestId) && (
                                  <div className="flex flex-wrap items-center gap-2 pt-2">
                                    <button
                                      onClick={() => handleApproveTradeNotification(notif.tradeRequestId || notif.relatedEntityId)}
                                      className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-[10px] font-black uppercase tracking-widest transition-all"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      onClick={() => handleRejectTradeNotification(notif.tradeRequestId || notif.relatedEntityId)}
                                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-widest transition-all"
                                    >
                                      Reject
                                    </button>
                                  </div>
                                )}
                                <div className="flex items-center gap-3">
                                  <button
                                    onClick={() =>
                                      exportNotificationSeenList(notif)
                                    }
                                    className="flex items-center gap-1.5 text-blue-400/80 hover:text-blue-400 transition-colors text-[10px] font-black uppercase tracking-widest"
                                  >
                                    <Download size={12} />
                                    {notif.seenBy?.length || 0} үзсэн
                                  </button>
                                  <button
                                    onClick={() =>
                                      exportNotificationUnseenList(notif)
                                    }
                                    className="flex items-center gap-1.5 text-orange-400/80 hover:text-orange-400 transition-colors text-[10px] font-black uppercase tracking-widest"
                                  >
                                    <Download size={12} />
                                    {csrs.length -
                                      (notif.seenBy?.length || 0)}{" "}
                                    үзээгүй
                                  </button>
                                  <button
                                    onClick={() => setShowSeenDetails(notif)}
                                    className="flex items-center gap-1.5 text-green-400/80 hover:text-green-400 transition-colors text-[10px] font-black uppercase tracking-widest"
                                  >
                                    <Eye size={12} />
                                    Дэлгэрэнгүй
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {!isUnread && (
                                <button
                                  onClick={() =>
                                    handleDeleteNotification(notif.id)
                                  }
                                  className="p-2 text-gray-600 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                                >
                                  <Trash2 size={20} />
                                </button>
                              )}
                              {isUnread && (
                                <button
                                  onClick={() =>
                                    markNotificationAsRead(notif.id)
                                  }
                                  className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-xl transition-all"
                                >
                                  <CheckCircle2 size={24} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))
            ) : (
              <div className="text-center py-20 bg-gray-900/20 rounded-3xl border border-dashed border-gray-800">
                <Mail
                  size={48}
                  className="mx-auto text-gray-800 mb-4 opacity-20"
                />
                <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">
                  Мэдэгдэл байхгүй байна
                </p>
              </div>
            )}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gray-900/40 border border-gray-800 p-8 rounded-3xl shadow-2xl backdrop-blur-md"
          >
            <form onSubmit={handleSendNotification} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                    Мэдэгдэлийн төрөл
                  </label>
                  <div className="flex p-1 bg-gray-800 rounded-2xl border border-gray-700">
                    <button
                      type="button"
                      onClick={() =>
                        setNewNotification((prev) => ({
                          ...prev,
                          type: "general",
                        }))
                      }
                      className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${newNotification.type === "general" ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40" : "text-gray-500 hover:text-gray-300"}`}
                    >
                      Энгийн
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setNewNotification((prev) => ({
                          ...prev,
                          type: "important",
                        }))
                      }
                      className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${newNotification.type === "important" ? "bg-red-600 text-white shadow-lg shadow-red-900/40" : "text-gray-500 hover:text-gray-300"}`}
                    >
                      Чухал
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                    Дуусах хугацаа
                  </label>
                  <input
                    type="datetime-local"
                    value={newNotification.deadline}
                    onChange={(e) =>
                      setNewNotification((prev) => ({
                        ...prev,
                        deadline: e.target.value,
                      }))
                    }
                    className="w-full bg-gray-800 border border-gray-700 rounded-2xl py-3.5 px-5 text-white focus:outline-none focus:border-blue-500 transition-all font-bold"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                  Гарчиг
                </label>
                <input
                  type="text"
                  placeholder="Мэдэгдэлийн гарчиг..."
                  value={newNotification.title || ""}
                  onChange={(e) =>
                    setNewNotification((prev) => ({
                      ...prev,
                      title: e.target.value,
                    }))
                  }
                  className="w-full bg-gray-800 border border-gray-700 rounded-2xl py-4 px-6 text-white focus:outline-none focus:border-blue-500 transition-all text-lg font-black"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                  Агуулга
                </label>
                <textarea
                  placeholder="Мэдэгдэлийн дэлгэрэнгүй агуулга..."
                  value={newNotification.content || ""}
                  onChange={(e) =>
                    setNewNotification((prev) => ({
                      ...prev,
                      content: e.target.value,
                    }))
                  }
                  className="w-full h-40 bg-gray-800 border border-gray-700 rounded-2xl py-4 px-6 text-white focus:outline-none focus:border-blue-500 transition-all resize-none leading-relaxed"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-blue-900/40 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
              >
                <Send size={24} strokeWidth={3} />
                Мэдэгдэл Илгээх
              </button>
            </form>
          </motion.div>
        )}
      </div>
    );
  };

  const renderTrainingView = () => {
    const trainingGroups = groupTrainingMaterialsByDay(trainingMaterials);

    return (
      <div className="space-y-8 max-w-6xl mx-auto py-8">
        <div className="flex items-center justify-end">
          <button
            onClick={() => {
              setEditingMaterial(null);
              setNewMaterial({
                type: "PDF",
                deadline: new Date(Date.now() + 7 * 86400000)
                  .toISOString()
                  .slice(0, 16),
              });
              setIsAddingMaterial(true);
            }}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-2xl font-black text-sm uppercase tracking-wider flex items-center gap-2 transition-all shadow-lg shadow-blue-500/20 active:scale-95"
          >
            <Plus size={20} />
            Материал нэмэх
          </button>
        </div>

        {trainingGroups.length > 0 ? (
          trainingGroups.map((group) => (
            <section key={group.key} className="space-y-4">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-black text-gray-300 uppercase tracking-widest">
                  {group.title}
                </h3>
                <span className="rounded-full border border-gray-800 bg-gray-900 px-2.5 py-1 text-[10px] font-black text-gray-500">
                  {group.materials.length}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {group.materials.map((material, idx) => (
                  <div
                    key={`training-${material.id}-${idx}`}
                    className="bg-gray-900/40 border border-gray-800 p-6 rounded-3xl space-y-4 hover:border-blue-500/30 transition-all group relative"
                  >
                    <div
                      onClick={() => setSelectedMaterial(material)}
                      className="aspect-video bg-gray-800 rounded-2xl overflow-hidden relative cursor-pointer"
                    >
                      {material.thumbnailUrl ? (
                        <LazyMedia
                          src={material.thumbnailUrl}
                          alt={material.title}
                          type="Image"
                          className="w-full h-full"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-gray-600">
                          <BookOpen size={40} />
                          <span className="text-[10px] font-black uppercase mt-2">
                            Зураггүй
                          </span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-white text-xs font-black uppercase tracking-widest bg-blue-600 px-4 py-2 rounded-full">
                          Нээх
                        </span>
                      </div>
                    </div>

                    <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingMaterial(material);
                          setNewMaterial(material);
                          setIsAddingMaterial(true);
                        }}
                        className="p-2 bg-gray-800/80 backdrop-blur-md text-blue-400 rounded-xl hover:bg-blue-600 hover:text-white transition-all shadow-xl"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfirm("Устгах уу?", () =>
                            handleDeleteMaterial(material.id || ""),
                          );
                        }}
                        className="p-2 bg-gray-800/80 backdrop-blur-md text-red-400 rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-xl"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 bg-blue-600/10 text-blue-400 text-[10px] font-black uppercase border border-blue-500/20 rounded-md">
                          {material.type}
                        </span>
                        <span className="text-[10px] font-bold text-gray-500">
                          {new Date(material.date).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="text-lg font-black text-white truncate">
                        {material.title}
                      </h3>
                      <p className="text-sm text-gray-400 line-clamp-2 h-10">
                        {material.description}
                      </p>
                      <div className="pt-4 border-t border-gray-800 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowSeenDetails(material);
                          }}
                          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-400 transition-colors"
                        >
                          <Eye size={14} className="text-blue-500" />
                          <span className="font-bold">
                            {material.seenBy?.length || 0} үзсэн
                          </span>
                        </button>
                        <div
                          className={`text-[10px] font-black uppercase ${new Date(material.deadline || "") < new Date() ? "text-red-500" : "text-gray-500"}`}
                        >
                          Хугацаа:{" "}
                          {material.deadline
                            ? new Date(material.deadline).toLocaleDateString()
                            : "Байхгүй"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="text-center py-20 bg-gray-900/20 rounded-3xl border border-dashed border-gray-800">
            <BookOpen
              size={48}
              className="mx-auto text-gray-800 mb-4 opacity-20"
            />
            <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">
              Сургалтын материал байхгүй байна
            </p>
          </div>
        )}
      </div>
    );
  };

  const getHoursForShift = (time: string) => {
    if (!time || time === REST_SHIFT_LABEL) return 0;
    const normalizedTime = normalizeShiftTime(time);
    if (!isValidShiftTime(normalizedTime)) return 0;

    const [start, end] = normalizedTime.split("-").map(Number);
    let diff = end - start;
    if (diff < 0) diff += 24;
    return Math.round(diff * 10) / 10;
  };

  const getStartTimeValue = (time: string) => {
    if (!time || time === REST_SHIFT_LABEL) return 9999;
    const normalizedTime = normalizeShiftTime(time);
    if (isValidShiftTime(normalizedTime)) {
      return Number(normalizedTime.slice(0, 2)) * 60;
    }
    return 9999;
  };

  const getShiftTimeKey = (time: string) =>
    time === REST_SHIFT_LABEL ? "Амралт" : normalizeShiftTime(time);

  const getShiftRuleHourKey = (time: string) => {
    if (time === REST_SHIFT_LABEL) return "rest";
    const hours = Math.round(getHoursForShift(time));
    return hours >= 4 && hours <= 9 ? String(hours) : "";
  };

  const renderScheduleView = () => {
    const years = [2024, 2025, 2026];
    const monthNames = [
      "1-р сар",
      "2-р сар",
      "3-р сар",
      "4-р сар",
      "5-р сар",
      "6-р сар",
      "7-р сар",
      "8-р сар",
      "9-р сар",
      "10-р сар",
      "11-р сар",
      "12-р сар",
    ];
    const dayNames = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];

    const getDatesInMonth = (year: number, month: number) => {
      const firstDayOfMonth = new Date(year, month, 1);
      const days = [];
      const firstDayIdx = (firstDayOfMonth.getDay() + 6) % 7;

      for (let i = 0; i < firstDayIdx; i++) days.push(null);

      const date = new Date(year, month, 1);
      while (date.getMonth() === month) {
        days.push(new Date(date));
        date.setDate(date.getDate() + 1);
      }
      return days;
    };

    const formatDateKey = (date: Date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    const getCSRCount = (segment: string, type: "Full Time" | "Part Time") => {
      return csrs.filter(
        (c) => c.lineType === segment && c.employmentType === type,
      ).length;
    };

    const hasAnyCSR = (segment: string) => {
      return csrs.some((c) => c.lineType === segment);
    };

    const monthDates = getDatesInMonth(
      selectedYearCalendar,
      selectedMonthCalendar,
    );
    const selectedBookingDateSet = new Set(selectedBookingDates);
    const activeSegmentTotal = csrs.filter(
      (c) => c.lineType === activeSegmentView,
    ).length;
    const activeEmploymentTotal = getCSRCount(
      activeSegmentView,
      activeEmploymentView,
    );

    const selectedMonthKey = `${selectedYearCalendar}-${String(selectedMonthCalendar + 1).padStart(2, "0")}`;
    const activeRuleKey = makeSegmentTypeKey(activeSegmentView, activeEmploymentView);
    const activeMonthFontKey = makeMonthlyFontHourKey(selectedMonthKey, activeSegmentView, activeEmploymentView);
    const activeWeeklyRule = normalizeWeeklyShiftRule(weeklyShiftRules[activeRuleKey]);
    const activeMonthlyFontHours = Math.max(0, Number(monthlyFontHourRules[activeMonthFontKey]) || 0);

    const updateActiveMonthlyFontHours = (value: number) => {
      const nextHours = Math.max(0, Number(value) || 0);
      const next = { ...monthlyFontHourRules, [activeMonthFontKey]: nextHours };
      setMonthlyFontHourRules(next);
      saveMonthlyFontHoursRule(selectedMonthKey, activeSegmentView, activeEmploymentView, nextHours).catch((error) => {
        console.error("Save monthly font hours rule error:", error);
        alert("Сарын фонт цаг DB-д хадгалахад алдаа гарлаа. Дахин оролдоно уу.");
      });
    };

    const updateActiveWeeklyRule = (patch: Partial<WeeklyShiftRule>) => {
      const nextRule = normalizeWeeklyShiftRule({ ...activeWeeklyRule, ...patch });
      const next = { ...weeklyShiftRules, [activeRuleKey]: nextRule };
      setWeeklyShiftRules(next);
      saveWeeklyShiftRule(activeSegmentView, activeEmploymentView, nextRule).catch((error) => {
        console.error("Save weekly shift rule error:", error);
        alert("7 хоногийн дүрэм DB-д хадгалахад алдаа гарлаа. Дахин оролдоно уу.");
      });
    };

    const toggleBookingDateSelection = (dateKey: string) => {
      if (isPastScheduleDate(dateKey)) {
        setSelectedDateSchedule(dateKey);
        return;
      }

      const nextDates = selectedBookingDates.includes(dateKey)
        ? selectedBookingDates.filter((date) => date !== dateKey)
        : [...selectedBookingDates, dateKey].sort();

      setSelectedBookingDates(nextDates);
      setSelectedDateSchedule(
        nextDates.includes(dateKey)
          ? dateKey
          : nextDates[nextDates.length - 1] || "",
      );
    };

    const setBookingAccessForDates = async (dateKeys: string[], isOpen: boolean) => {
      const pastDates = dateKeys.filter((dateKey) =>
        isPastScheduleDate(dateKey),
      );
      if (pastDates.length > 0) {
        alert("Өнгөрсөн өдрийн захиалгын эрхийг өөрчлөх боломжгүй.");
        return;
      }

      const datesWithSchedules = dateKeys.filter((dateKey) => {
        const shifts = schedules[dateKey]?.shifts || [];
        return shifts.some((shift: any) => Number(shift.totalSlots) > 0);
      });
      if (datesWithSchedules.length === 0) {
        alert(
          "Эрх нээх өдөр сонгоно уу. Сонгосон өдөр shift болон slot орсон байх хэрэгтэй.",
        );
        return;
      }

      const newSchedules = { ...schedules };
      const nextBookingOpenAt = isOpen ? bookingOpenAtInput : "";
      const nextBookingCloseAt = isOpen ? bookingCloseAtInput : "";
      datesWithSchedules.forEach((dateKey) => {
        const day = newSchedules[dateKey] || { shifts: [] };
        const nextShifts = (day.shifts || []).map((shift: any) => ({
          ...shift,
          bookingWaves: getBookingWavesForShift(
            shift,
            isOpen,
            nextBookingOpenAt,
            nextBookingCloseAt,
          ).map((wave) => ({
            ...wave,
            bookingOpen: isOpen,
            bookingOpenAt: nextBookingOpenAt,
            bookingCloseAt: nextBookingCloseAt,
          })),
        }));

        newSchedules[dateKey] = {
          ...day,
          shifts: nextShifts,
          bookingOpen: isOpen,
          bookingOpenAt: nextBookingOpenAt,
          bookingCloseAt: nextBookingCloseAt,
        };
      });

      await persistSchedules(newSchedules, datesWithSchedules);
      setSelectedBookingDates([]);
      logAction(
        isOpen ? "Schedule Booking Opened" : "Schedule Booking Closed",
        `${datesWithSchedules.length} days ${isOpen ? `opened from ${nextBookingOpenAt || "now"}` : "closed"} for CSR booking`,
      );
    };

    const handleSetBookingAccessForSelected = (isOpen: boolean) => {
      void setBookingAccessForDates(selectedBookingDates, isOpen);
    };

    const copyPreviousDayIntoDate = (currentDateKey: string, scheduleDraft: any) => {
      if (!currentDateKey || isPastScheduleDate(currentDateKey)) {
        return { copied: 0, sourceKey: "" };
      }

      const [y, m, d] = currentDateKey.split("-").map(Number);
      const current = new Date(y, m - 1, d);
      const currentShifts = scheduleDraft[currentDateKey]?.shifts || [];

      const previousDate = new Date(current);
      previousDate.setDate(previousDate.getDate() - 1);
      const sourceKey = formatDateKey(previousDate);
      const previousDayShifts = scheduleDraft[sourceKey]?.shifts || [];

      const matchingShifts = previousDayShifts.filter(
        (s: any) =>
          s.employmentType === activeEmploymentView &&
          s.segment === activeSegmentView,
      );

      if (matchingShifts.length === 0) {
        return { copied: 0, sourceKey: "" };
      }

      const shiftsToCopy = matchingShifts.map((s: any) => ({
        ...s,
        time: normalizeShiftTime(s.time),
        id: Math.random().toString(36).substr(2, 9),
        bookedBy: [],
        bookedSlots: 0,
        bookingOpen: false,
        bookingOpenAt: "",
        bookingCloseAt: "",
        bookingWaves: getBookingWavesForShift(s, false, "").map((wave) => ({
          ...wave,
          id: Math.random().toString(36).substr(2, 9),
          bookingOpen: false,
          bookingOpenAt: "",
          bookingCloseAt: "",
        })),
      }));

      const existingTimes = new Set(
        currentShifts
          .filter(
            (s: any) =>
              s.employmentType === activeEmploymentView &&
              s.segment === activeSegmentView,
          )
          .map((s: any) => normalizeShiftTime(s.time)),
      );

      const uniqueCopies = shiftsToCopy.filter(
        (s: any) => !existingTimes.has(normalizeShiftTime(s.time)),
      );

      if (uniqueCopies.length === 0) {
        return { copied: 0, sourceKey };
      }

      const currentDay = scheduleDraft[currentDateKey] || { shifts: [] };
      scheduleDraft[currentDateKey] = {
        ...currentDay,
        shifts: [...currentShifts, ...uniqueCopies],
      };

      return { copied: uniqueCopies.length, sourceKey };
    };

    const handleCopyPreviousDay = (targetDateKeys: string[]) => {
      const futureDateKeys = targetDateKeys.filter((dateKey) => !isPastScheduleDate(dateKey));
      if (futureDateKeys.length === 0) {
        alert("Өмнөх өдрөөс хуулах ирээдүйн өдөр сонгоно уу.");
        return;
      }

      const newSchedules = { ...schedules };
      let totalCopied = 0;
      let foundSource = false;

      futureDateKeys.forEach((dateKey) => {
        const result = copyPreviousDayIntoDate(dateKey, newSchedules);
        totalCopied += result.copied;
        if (result.sourceKey) foundSource = true;
      });

      if (!foundSource) {
        alert("Сонгосон өдрийн яг өмнөх өдөрт энэ segment/type-ийн хуулах ээлж олдсонгүй.");
        return;
      }

      if (totalCopied === 0) {
        alert("Өмнөх өдрийн бүх ээлж сонгосон өдөрт аль хэдийн нэмэгдсэн байна.");
        return;
      }

      void persistSchedules(newSchedules, futureDateKeys);
      logAction(
        "Schedule Copied",
        `Copied ${totalCopied} ${activeEmploymentView} shifts for ${activeSegmentView} into ${futureDateKeys.length} day(s)`,
      );
    };

    const handleDeleteSelectedDayShifts = (targetDateKeys: string[]) => {
      const editableDateKeys = targetDateKeys.filter((dateKey) => !isPastScheduleDate(dateKey));
      if (editableDateKeys.length === 0) return;

      handleConfirm("Сонгосон өдрүүдийн бүх ээлжийг устгах уу?", () => {
        const newSchedules = { ...schedules };

        editableDateKeys.forEach((dateKey) => {
          const currentShifts = newSchedules[dateKey]?.shifts || [];
          const remainingShifts = currentShifts.filter(
            (shift: any) =>
              !(
                shift.segment === activeSegmentView &&
                shift.employmentType === activeEmploymentView
              ),
          );

          if (remainingShifts.length === 0) {
            delete newSchedules[dateKey];
          } else {
            newSchedules[dateKey] = {
              ...newSchedules[dateKey],
              shifts: remainingShifts,
            };
          }
        });

        void persistSchedules(newSchedules, editableDateKeys);
        logAction(
          "Schedule Deleted",
          `Deleted ${activeEmploymentView} shifts for ${activeSegmentView} from ${editableDateKeys.length} day(s)`,
        );
      });
    };

    const handleExportScheduleReport = () => {
      const scheduleRows: any[] = [];
      const bookedUserIds = new Set<string>();

      monthDates.forEach((date) => {
        if (!date) return;
        const dateKey = formatDateKey(date);
        const daySchedule = schedules[dateKey];
        if (daySchedule && daySchedule.shifts.length > 0) {
          daySchedule.shifts.forEach((shift: any) => {
            if (shift.bookedBy && shift.bookedBy.length > 0) {
              shift.bookedBy.forEach((booking: any) => {
                bookedUserIds.add(booking.userId);
                scheduleRows.push({
                  Огноо: dateKey,
                  Гараг: date.toLocaleDateString("mn-MN", { weekday: "long" }),
                  "Ээлжийн цаг": normalizeShiftTime(shift.time),
                  Сегмент: shift.segment,
                  Төрөл: shift.employmentType || "Full Time",
                  "Ажилтан код": booking.userCode || "---",
                  "Ажилтан нэр": booking.userName,
                  "Захиалсан огноо": new Date(
                    booking.bookedAt,
                  ).toLocaleString(),
                });
              });
            }
          });
        }
      });

      const unbookedCSRs = csrs
        .filter((csr) => csr.role === "csr" && !bookedUserIds.has(csr.id))
        .map((csr) => ({
          Код: csr.code,
          Нэр: csr.name,
          Имэйл: csr.email,
          Сегмент: csr.lineType,
          Төлөв: "Захиалаагүй",
        }));

      const wb = XLSX.utils.book_new();

      const wsSchedule = XLSX.utils.json_to_sheet(scheduleRows);
      XLSX.utils.book_append_sheet(wb, wsSchedule, "Хуваарь");

      const wsUnbooked = XLSX.utils.json_to_sheet(unbookedCSRs);
      XLSX.utils.book_append_sheet(wb, wsUnbooked, "Захиалаагүй ажилтнууд");

      XLSX.writeFile(
        wb,
        `Schedule_Report_${monthNames[selectedMonthCalendar]}_${selectedYearCalendar}.xlsx`,
      );
      logAction(
        "Export Schedule Report",
        `Exported full report for ${monthNames[selectedMonthCalendar]}`,
      );
    };

    return (
      <div className="space-y-3 min-w-0">
        {/* Compact Controls */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 px-3 py-2 shadow-2xl backdrop-blur-xl overflow-hidden">
          <div className="flex w-full min-w-0 items-center gap-3 whitespace-nowrap">
            <div className="w-[220px] shrink-0">
              <div className="flex h-9 items-center bg-black/40 rounded-xl p-1 border border-white/5">
                <button
                  onClick={() =>
                    setSelectedMonthCalendar((prev) =>
                      prev === 0 ? 11 : prev - 1,
                    )
                  }
                  className="h-8 w-8 shrink-0 flex items-center justify-center text-gray-500 hover:text-white transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="flex-1 px-2 flex items-center font-black text-blue-500 text-xs uppercase tracking-widest justify-center overflow-hidden text-ellipsis">
                  {monthNames[selectedMonthCalendar]} {selectedYearCalendar}
                </div>
                <button
                  onClick={() =>
                    setSelectedMonthCalendar((prev) =>
                      prev === 11 ? 0 : prev + 1,
                    )
                  }
                  className="h-8 w-8 shrink-0 flex items-center justify-center text-gray-500 hover:text-white transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            <div className="w-[220px] shrink min-w-[170px]">
              <div className="relative group">
                <select
                  value={activeSegmentView}
                  onChange={(e) => setActiveSegmentView(e.target.value)}
                  className={`h-9 w-full bg-black/60 border rounded-xl pl-4 pr-9 text-[10px] font-black uppercase tracking-wider focus:outline-none cursor-pointer appearance-none shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] transition-all hover:bg-black/80 ${activeSegmentTotal === 0 ? "border-red-500/40 text-red-400 focus:border-red-500/60" : "border-white/10 text-white focus:border-blue-500/50"}`}
                >
                  {segments.map((seg) => {
                    const count = csrs.filter((c) => c.lineType === seg).length;
                    return (
                      <option
                        key={seg}
                        value={seg}
                        className={
                          count === 0
                            ? "bg-gray-900 text-red-400 font-bold py-4"
                            : "bg-gray-900 text-white font-bold py-4"
                        }
                      >
                        {seg} ({count} ажилтан)
                      </option>
                    );
                  })}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-blue-500/50 group-hover:text-blue-400 transition-colors">
                  <ChevronDown size={14} />
                </div>
              </div>
            </div>

            <div className="w-[160px] shrink min-w-[140px]">
              <div className="relative group">
                <select
                  value={activeEmploymentView}
                  onChange={(e) =>
                    setActiveEmploymentView(e.target.value as any)
                  }
                  className={`h-9 w-full bg-black/60 border rounded-xl pl-4 pr-9 text-[10px] font-black uppercase tracking-wider focus:outline-none cursor-pointer appearance-none shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] transition-all hover:bg-black/80 ${activeEmploymentTotal === 0 ? "border-red-500/40 text-red-400 focus:border-red-500/60" : "border-white/10 text-white focus:border-blue-500/50"}`}
                >
                  {["Full Time", "Part Time"].map((type) => {
                    const count = getCSRCount(activeSegmentView, type as any);
                    return (
                      <option
                        key={type}
                        value={type}
                        className={
                          count === 0
                            ? "bg-gray-900 text-red-400 font-bold"
                            : "bg-gray-900 text-white font-bold"
                        }
                      >
                        {type} ({count})
                      </option>
                    );
                  })}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-blue-500/50 group-hover:text-blue-400 transition-colors">
                  <ChevronDown size={14} />
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-3">
              <label className="relative h-9 w-[190px] shrink-0 rounded-xl border border-white/10 bg-black/50 transition-all focus-within:border-blue-500/60">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[9px] font-black uppercase tracking-widest text-gray-500">Сарын фонт цаг</span>
                <input
                  type="number"
                  min={0}
                  value={activeMonthlyFontHours}
                  onChange={(e) => updateActiveMonthlyFontHours(Number(e.target.value))}
                  className="h-full w-full rounded-xl bg-transparent pl-[118px] pr-3 text-right text-[11px] font-black text-white outline-none"
                />
              </label>
              <button
                onClick={handleExportScheduleReport}
                className="ml-auto h-9 px-4 bg-green-600/10 hover:bg-green-600 text-green-500 hover:text-white rounded-xl text-[9px] font-black uppercase tracking-wider transition-all border border-green-500/20 flex items-center justify-center gap-1.5"
              >
                <Download size={13} /> Татах
              </button>
              <button
                onClick={() => setIsManagingShiftTemplates(true)}
                className="h-9 px-4 bg-gray-800/60 hover:bg-gray-800 text-gray-300 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all border border-white/5"
              >
                Shift загвар
              </button>
              <button
                onClick={() => {
                  setHolidayData({ id: "", date: "", name: "" });
                  setIsAddingHoliday(true);
                }}
                className="h-9 px-4 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white rounded-xl text-[9px] font-black uppercase tracking-wider transition-all border border-red-500/20 flex items-center justify-center gap-1.5"
              >
                <Palmtree size={12} /> Баяр
              </button>
            </div>
          </div>

        </div>

        <div className="grid grid-cols-[minmax(620px,760px)_minmax(360px,430px)] justify-center gap-5 items-start w-full min-w-0">
          {/* Calendar Grid */}
          <div className="w-full max-w-[760px] min-w-0 bg-black/40 rounded-[1.5rem] border border-white/5 p-3 overflow-hidden">
            <div className="grid grid-cols-7 gap-2 w-full max-w-[720px] mx-auto">
              {dayNames.map((day, idx) => (
                <div
                  key={day}
                  className={`text-center text-[9px] font-outfit font-black uppercase tracking-[0.16em] mb-1 ${idx >= 5 ? "text-red-500" : "text-gray-500"}`}
                >
                  {day}
                </div>
              ))}
              {monthDates.map((date, idx) => {
                if (!date)
                  return (
                    <div
                      key={`empty-${idx}`}
                      className="aspect-square w-full max-w-[96px] mx-auto"
                    />
                  );

                const dateKey = formatDateKey(date);
                const daySchedule = schedules[dateKey];
                const holiday = holidays.find((h) => h.date === dateKey);
                const isWeekend = idx % 7 >= 5;
                const hasAnyShifts = !!daySchedule?.shifts?.length;
                const daySlotTotal = (daySchedule?.shifts || []).reduce(
                  (sum: number, shift: any) => sum + (Number(shift.totalSlots) || 0),
                  0,
                );
                const hasAnySlots = daySlotTotal > 0;
                const isSelected = selectedDateSchedule === dateKey;
                const isBulkSelected = selectedBookingDateSet.has(dateKey);
                const isBookingOpen = isScheduleBookingOpen(dateKey);
                const isBookingScheduled =
                  !isPastScheduleDate(dateKey) &&
                  !!daySchedule?.bookingOpen &&
                  !isBookingOpen;
                const bookingBadge = !hasAnySlots || isPastScheduleDate(dateKey)
                  ? null
                  : isBookingOpen
                    ? { text: "Нээлттэй", className: "bg-green-500/20 text-green-200 border border-green-400/30" }
                    : isBookingScheduled
                      ? { text: "Товлосон", className: "bg-yellow-500/15 text-yellow-300 border border-yellow-400/30" }
                      : { text: "Хаалттай", className: "bg-black/40 text-gray-400 border border-white/10" };
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const isToday = formatDateKey(new Date()) === dateKey;
                const isPast = date.getTime() < today.getTime();

                return (
                  <button
                    key={dateKey}
                    onClick={() => toggleBookingDateSelection(dateKey)}
                    className={`group aspect-square w-full max-w-[96px] mx-auto relative overflow-hidden rounded-xl border-2 transition-all duration-300 flex items-center justify-center p-2 ${
                      isBulkSelected
                        ? "bg-blue-600 border-blue-300 text-white shadow-[0_0_24px_rgba(37,99,235,0.35)] z-10 scale-[1.02]"
                        : holiday && isPast
                          ? "bg-red-950/20 border-red-500/10 text-red-500/60 opacity-55 grayscale-[0.25] hover:border-red-400/25"
                          : holiday
                            ? "bg-red-500/15 border-red-500/35 text-white hover:border-red-400/70 hover:shadow-[0_0_18px_rgba(248,113,113,0.30)]"
                            : isPast
                              ? "bg-white/[0.03] border-white/5 text-gray-700 opacity-40 grayscale-[0.5]"
                              : isWeekend
                                ? "bg-red-950/20 border-red-500/10 text-gray-500 hover:border-red-400/50 hover:shadow-[0_0_18px_rgba(248,113,113,0.22)]"
                                : "bg-[#111] border-white/5 text-gray-400 hover:border-cyan-400/70 hover:shadow-[0_0_18px_rgba(34,211,238,0.30)]"
                    } ${isSelected && !isBulkSelected ? "ring-2 ring-cyan-400/80 shadow-[0_0_22px_rgba(34,211,238,0.55)] border-cyan-300/80 z-10" : ""}`}
                  >

                    {bookingBadge && (
                      <span
                        className={`absolute right-1 top-1 rounded-md px-1 py-0.5 text-[6px] font-black uppercase tracking-widest max-w-[70%] truncate ${bookingBadge.className}`}
                      >
                        {bookingBadge.text}
                      </span>
                    )}
                    <span
                      className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[clamp(1.15rem,1.8vw,1.75rem)] font-outfit font-black tracking-tighter leading-none transition-transform group-hover:scale-105 ${
                        isBulkSelected
                          ? "text-white"
                          : holiday && isPast
                            ? "text-red-500/55"
                            : holiday
                              ? "text-white"
                              : isToday
                                ? "text-blue-500"
                                : isWeekend
                                  ? "text-red-500/70"
                                  : isPast
                                    ? "text-gray-700"
                                    : "text-white"
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    {holiday && (
                      <div className="absolute bottom-1 inset-x-0 flex flex-col items-center justify-center pointer-events-none px-1 z-10">
                        <span className={`text-[7px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-tight truncate max-w-[90%] shadow-lg border ${isPast ? "text-red-200/70 bg-red-950/40 border-red-500/15" : "text-white bg-black/60 backdrop-blur-md border-white/10"}`}>
                          {holiday.name}
                        </span>
                      </div>
                    )}
                    {isToday && !isSelected && (
                      <div className="absolute bottom-2 right-2 w-1 h-1 bg-blue-400 rounded-full shadow-[0_0_8px_#3b82f6] animate-pulse" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Side Detail Panel */}
          <motion.div
            key={`${selectedDateSchedule}-${activeSegmentView}-${activeEmploymentView}`}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            className="w-full min-w-0 self-start rounded-[1.5rem] border border-gray-800 bg-gray-900/95 p-4 shadow-2xl"
          >
            {(() => {
              const dayShifts = schedules[selectedDateSchedule]?.shifts || [];
              const filteredShifts = dayShifts
                .filter(
                  (s: any) =>
                    s.employmentType === activeEmploymentView &&
                    s.segment === activeSegmentView,
                )
                .sort(
                  (a: any, b: any) =>
                    getStartTimeValue(a.time) - getStartTimeValue(b.time),
                );
              const totalSlots = filteredShifts.reduce(
                (sum: number, shift: any) =>
                  sum + (Number(shift.totalSlots) || 0),
                0,
              );
              const bookedSlots = filteredShifts.reduce(
                (sum: number, shift: any) =>
                  sum + (Number(shift.bookedSlots) || 0),
                0,
              );
              const isPastDay = isPastScheduleDate(selectedDateSchedule);
              const isOpen = isScheduleBookingOpen(selectedDateSchedule);
              const holiday = holidays.find(
                (h: any) => h.date === selectedDateSchedule,
              );
              const [y, m, d] = selectedDateSchedule.split("-").map(Number);
              const weekdayName = new Date(y, m - 1, d).toLocaleDateString(
                "mn-MN",
                { weekday: "long" },
              );

              const openShiftEditor = (shift?: any) => {
                if (isPastDay) return;
                setBulkShiftDateKeys([]);
                setEditingShiftData(
                  shift
                    ? {
                        ...shift,
                        time: normalizeShiftTime(shift.time),
                        bookingWaves: getBookingWavesForShift(
                          shift,
                          !!schedules[selectedDateSchedule]?.bookingOpen,
                          schedules[selectedDateSchedule]?.bookingOpenAt || "",
                          schedules[selectedDateSchedule]?.bookingCloseAt || "",
                        ),
                        dateKey: selectedDateSchedule,
                      }
                    : {
                        dateKey: selectedDateSchedule,
                        time: "09-18",
                        segment: activeSegmentView,
                        employmentType: activeEmploymentView,
                        totalSlots: 5,
                        bookingWaves: createDefaultBookingWaves(
                          5,
                          false,
                          bookingOpenAtInput,
                        ),
                      },
                );
                setIsEditingShiftModal(true);
              };

              const checkedDateKeys = [...selectedBookingDates].filter(Boolean).sort();
              const selectedKeys = checkedDateKeys;
              const isMultiSelect = checkedDateKeys.length > 0;
              const hasSelectedDays = selectedKeys.length > 0;
              const holidayTargetDates = selectedKeys;
              const holidayTargetLabel = formatSelectedDateRange(selectedKeys);
              const canEditSelection = selectedKeys.some((dateKey) => !isPastScheduleDate(dateKey));
              const getMatchingShiftsForDate = (dateKey: string) =>
                (schedules[dateKey]?.shifts || []).filter(
                  (shift: any) =>
                    shift.segment === activeSegmentView &&
                    shift.employmentType === activeEmploymentView,
                );

              const selectedRuleShiftAvailability = selectedKeys.reduce<Record<string, number>>((acc, dateKey) => {
                const dayHourKeys = Array.from(new Set<string>(
                  getMatchingShiftsForDate(dateKey)
                    .map((shift: any) => getShiftRuleHourKey(shift.time))
                    .filter((hourKey: string) => hourKey === "rest" || /^[4-9]$/.test(hourKey)),
                ));
                dayHourKeys.forEach((hourKey) => {
                  acc[hourKey] = (acc[hourKey] || 0) + 1;
                });
                return acc;
              }, {});

              const selectedDaysHaveShifts =
                selectedKeys.length > 0 &&
                selectedKeys.every((dateKey) => getMatchingShiftsForDate(dateKey).length > 0);

              const selectedRuleShiftHours = Object.keys(selectedRuleShiftAvailability).sort((a, b) => {
                if (a === "rest") return 1;
                if (b === "rest") return -1;
                return Number(b) - Number(a);
              });

              const calculateRuleHourTotal = (hourCounts: Record<string, number>) =>
                Object.entries(hourCounts || {}).reduce((sum, [hour, count]) => {
                  if (hour === "rest") return sum;
                  return sum + Number(hour) * (Number(count) || 0);
                }, 0);

              const sumRuleCounts = (hourCounts: Record<string, number>) =>
                Object.values(hourCounts || {}).reduce((sum, count) => sum + (Number(count) || 0), 0);

              const clampRuleHourCounts = (
                hourCounts: Record<string, number>,
                selectedDayLimit: number,
              ) => {
                const nextCounts: Record<string, number> = {};
                let remaining = Math.max(0, Number(selectedDayLimit) || 0);
                selectedRuleShiftHours.forEach((hourKey) => {
                  const maxAvailable = Math.max(0, Number(selectedRuleShiftAvailability[hourKey]) || 0);
                  const nextCount = Math.max(0, Math.min(maxAvailable, remaining, Number(hourCounts?.[hourKey]) || 0));
                  if (nextCount > 0) {
                    nextCounts[hourKey] = nextCount;
                    remaining -= nextCount;
                  }
                });
                return nextCounts;
              };

              const activeRuleTotalSelected = Math.max(0, Math.min(selectedKeys.length, Number(activeWeeklyRule.selectedDays) || 0));
              const visibleRuleHourCounts = selectedRuleShiftHours.reduce<Record<string, number>>((acc, hourKey) => {
                acc[hourKey] = Math.max(
                  0,
                  Math.min(
                    Number(selectedRuleShiftAvailability[hourKey]) || 0,
                    Number((activeWeeklyRule.hourCounts || {})[hourKey]) || 0,
                  ),
                );
                return acc;
              }, {});
              const activeRuleHourTotal = calculateRuleHourTotal(visibleRuleHourCounts);

              const updateSelectedDayLimit = (count: number) => {
                const nextSelectedDays = Math.max(0, Math.min(selectedKeys.length, Number(count) || 0));
                const nextHourCounts = clampRuleHourCounts(activeWeeklyRule.hourCounts || {}, nextSelectedDays);
                updateActiveWeeklyRule({
                  selectedDays: nextSelectedDays,
                  hourCounts: nextHourCounts,
                  restDays: Number(nextHourCounts.rest) || 0,
                  totalHours: calculateRuleHourTotal(nextHourCounts),
                });
              };

              const updateDynamicWeeklyRule = (hourKey: string, count: number) => {
                const maxAvailable = Math.max(0, Number(selectedRuleShiftAvailability[hourKey]) || 0);
                const selectedDayLimit = Math.max(0, Math.min(selectedKeys.length, activeRuleTotalSelected || selectedKeys.length));
                const currentCounts = clampRuleHourCounts(activeWeeklyRule.hourCounts || {}, selectedDayLimit);
                const otherTotal = sumRuleCounts({ ...currentCounts, [hourKey]: 0 });
                const maxBySelectedDays = Math.max(0, selectedDayLimit - otherTotal);
                const nextCount = Math.max(0, Math.min(maxAvailable, maxBySelectedDays, Number(count) || 0));
                const nextHourCounts = clampRuleHourCounts({ ...currentCounts, [hourKey]: nextCount }, selectedDayLimit);
                updateActiveWeeklyRule({
                  selectedDays: selectedDayLimit,
                  hourCounts: nextHourCounts,
                  restDays: Number(nextHourCounts.rest) || 0,
                  totalHours: calculateRuleHourTotal(nextHourCounts),
                });
              };

              const handleBulkShiftCreate = () => {
                const futureDates = selectedKeys.filter((dateKey) => !isPastScheduleDate(dateKey));
                if (futureDates.length === 0) {
                  alert("Ээлж оруулах ирээдүйн өдөр сонгоно уу.");
                  return;
                }
                const normalizedBulkShiftTime = normalizeShiftTime(bulkQuickShiftTime) || "09-18";
                const bulkSlotCount = Number(bulkQuickSlotCount) || 0;
                if (bulkSlotCount <= 0) {
                  alert("Slot тоо 1 ба түүнээс дээш байх ёстой.");
                  return;
                }
                setBulkShiftDateKeys(futureDates);
                setEditingShiftData({
                  dateKey: futureDates[0],
                  time: normalizedBulkShiftTime,
                  segment: activeSegmentView,
                  employmentType: activeEmploymentView,
                  totalSlots: bulkSlotCount,
                  bookingWaves: createDefaultBookingWaves(
                    bulkSlotCount,
                    false,
                    bookingOpenAtInput,
                  ),
                });
                setIsEditingShiftModal(true);
              };

              const addShiftFromTemplateToSelection = (templateTime: string) => {
                const normalizedTime = normalizeShiftTime(templateTime);
                const targetDateKeys = selectedKeys.filter((dateKey) => !isPastScheduleDate(dateKey));

                if (normalizedTime !== REST_SHIFT_LABEL && (!normalizedTime || !isValidShiftTime(normalizedTime))) {
                  alert("Shift загварын цаг буруу байна.");
                  return;
                }

                if (targetDateKeys.length === 0) {
                  alert("Shift оруулах ирээдүйн өдөр сонгоно уу.");
                  return;
                }

                const duplicateDate = targetDateKeys.find((dateKey) =>
                  (schedules[dateKey]?.shifts || []).some(
                    (shift: any) =>
                      getShiftTimeKey(shift.time) === normalizedTime &&
                      shift.segment === activeSegmentView &&
                      shift.employmentType === activeEmploymentView,
                  ),
                );

                if (duplicateDate) {
                  alert(`${duplicateDate} өдөр ${normalizedTime} цагийн shift аль хэдийн нэмэгдсэн байна.`);
                  return;
                }

                const newSchedules = { ...schedules };
                targetDateKeys.forEach((dateKey) => {
                  const currentSchedule = newSchedules[dateKey] || { shifts: [] };
                  const currentShifts = [...(currentSchedule.shifts || [])];
                  const totalSlots = 0;

                  currentShifts.push({
                    id: Math.random().toString(36).substr(2, 9),
                    time: normalizedTime,
                    totalSlots,
                    bookedSlots: 0,
                    segment: activeSegmentView,
                    employmentType: activeEmploymentView,
                    bookingWaves: createDefaultBookingWaves(
                      Math.max(1, totalSlots),
                      false,
                      bookingOpenAtInput,
                    ).map((wave) => ({
                      ...wave,
                      slotLimit: 0,
                      id: Math.random().toString(36).substr(2, 9),
                    })),
                    bookedBy: [],
                  });

                  newSchedules[dateKey] = {
                    ...currentSchedule,
                    shifts: currentShifts,
                  };
                });

                void persistSchedules(newSchedules, targetDateKeys);
                setIsShiftTemplatePickerOpen(false);
              };

              const updateShiftWaveSlotsForSelection = (
                targetShift: any,
                waveKind: "morning" | "evening",
                value: number,
              ) => {
                const targetDateKeys = selectedKeys.filter((dateKey) => !isPastScheduleDate(dateKey));
                const cleanSlots = Math.max(0, Number(value) || 0);
                const targetTime = getShiftTimeKey(targetShift.time);
                const newSchedules = { ...schedules };

                targetDateKeys.forEach((dateKey) => {
                  const currentSchedule = newSchedules[dateKey];
                  if (!currentSchedule?.shifts?.length) return;

                  newSchedules[dateKey] = {
                    ...currentSchedule,
                    shifts: currentSchedule.shifts.map((shift: any) => {
                      const isSameShift =
                        getShiftTimeKey(shift.time) === targetTime &&
                        shift.segment === targetShift.segment &&
                        shift.employmentType === targetShift.employmentType;

                      if (!isSameShift) return shift;

                      const existingWaves = getBookingWavesForShift(
                        shift,
                        !!currentSchedule.bookingOpen,
                        currentSchedule.bookingOpenAt || "",
                        currentSchedule.bookingCloseAt || "",
                      );
                      const updatedWaves = existingWaves.map((wave) =>
                        getWaveKind(wave) === waveKind
                          ? { ...wave, slotLimit: cleanSlots }
                          : wave,
                      );
                      const nextTotalSlots = sumWaveSlots(updatedWaves);

                      return {
                        ...shift,
                        totalSlots: nextTotalSlots,
                        bookingWaves: updatedWaves,
                      };
                    }),
                  };
                });

                void persistSchedules(newSchedules, targetDateKeys);
              };

              const toggleWaveSelection = (shift: any, wave: BookingWaveDraft) => {
                const key = getShiftWaveSelectionKey(shift, wave);
                setSelectedWaveKeys((prev) =>
                  prev.includes(key)
                    ? prev.filter((item) => item !== key)
                    : [...prev, key],
                );
              };

              const setBookingAccessForSelectedWaves = (isOpen: boolean) => {
                const targetDateKeys = selectedKeys.filter((dateKey) => !isPastScheduleDate(dateKey));
                if (targetDateKeys.length === 0) {
                  alert("Захиалга нээх ирээдүйн өдөр сонгоно уу.");
                  return;
                }
                if (selectedWaveKeys.length === 0) {
                  alert("Нээх/хаах өглөө эсвэл оройн slot-оо checkbox-оор сонгоно уу.");
                  return;
                }

                let touchedWaves = 0;
                let zeroSlotSelected = false;
                const nextBookingOpenAt = isOpen ? bookingOpenAtInput : "";
                const newSchedules = { ...schedules };

                targetDateKeys.forEach((dateKey) => {
                  const currentSchedule = newSchedules[dateKey];
                  if (!currentSchedule?.shifts?.length) return;

                  const nextShifts = currentSchedule.shifts.map((shift: any) => {
                    const waves = getBookingWavesForShift(
                      shift,
                      !!currentSchedule.bookingOpen,
                      currentSchedule.bookingOpenAt || "",
                      currentSchedule.bookingCloseAt || "",
                    );
                    let shiftTouched = false;
                    const updatedWaves = waves.map((wave) => {
                      const selectionKey = getShiftWaveSelectionKey(shift, wave);
                      if (!selectedWaveKeys.includes(selectionKey)) return wave;
                      if (Number(wave.slotLimit) <= 0) {
                        zeroSlotSelected = true;
                        return wave;
                      }
                      touchedWaves += 1;
                      shiftTouched = true;
                      return {
                        ...wave,
                        bookingOpen: isOpen,
                        bookingOpenAt: nextBookingOpenAt,
                        bookingCloseAt: isOpen ? bookingCloseAtInput : "",
                      };
                    });

                    if (!shiftTouched) return shift;
                    return {
                      ...shift,
                      bookingWaves: updatedWaves,
                    };
                  });

                  const anyOpen = nextShifts.some((shift: any) =>
                    getBookingWavesForShift(shift).some((wave) => wave.bookingOpen),
                  );

                  newSchedules[dateKey] = {
                    ...currentSchedule,
                    shifts: nextShifts,
                    bookingOpen: anyOpen,
                    bookingOpenAt: anyOpen ? nextBookingOpenAt : "",
                    bookingCloseAt: anyOpen ? bookingCloseAtInput : "",
                  };
                });

                if (zeroSlotSelected && touchedWaves === 0) {
                  alert("Сонгосон өглөө/оройн slot 0 байна. Эхлээд slot тоогоо оруулна уу.");
                  return;
                }
                if (touchedWaves === 0) {
                  alert("Сонгосон slot тухайн өдрүүд дээр олдсонгүй.");
                  return;
                }

                void persistSchedules(newSchedules, targetDateKeys);
                setSelectedWaveKeys([]);
                logAction(
                  isOpen ? "Booking Waves Opened" : "Booking Waves Closed",
                  `${touchedWaves} booking wave(s) ${isOpen ? `opened from ${nextBookingOpenAt || "now"}` : "closed"}`,
                );
              };

              return (
                <div className="space-y-4">
                  <div className="rounded-[1.45rem] border border-blue-500/15 bg-gray-950/60 p-3 shadow-inner">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="min-w-0 text-lg font-black leading-tight text-white sm:text-xl">
                        {checkedDateKeys.length > 0 ? `Сонгосон өдөр: ${checkedDateKeys.length}` : "Өдөр сонгоогүй"}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setIsShiftTemplatePickerOpen(true)}
                        disabled={!canEditSelection}
                        className="shrink-0 rounded-2xl bg-blue-600 px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-600 disabled:shadow-none"
                      >
                        Shift оруулах
                      </button>
                    </div>
                  </div>

                  {selectedKeys.length > 0 && selectedDaysHaveShifts && (
                    <div className="rounded-[1.45rem] border border-blue-500/15 bg-blue-500/5 p-4">
                      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-300">Сонгосон өдрийн дүрэм</p>
                          
                        </div>
                        <div className="text-right text-[10px] font-black uppercase tracking-widest text-gray-500">
                          Нийт: <span className="text-white">{activeRuleTotalSelected}</span> өдөр · <span className="text-blue-300">{activeRuleHourTotal}</span> цаг
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <label className="flex min-w-0 flex-col gap-1">
                          <span className="flex h-8 items-end text-[9px] font-black uppercase leading-tight tracking-widest text-gray-500">Нийт сонгох боломжтой</span>
                          <input
                            type="number"
                            min={0}
                            max={selectedKeys.length}
                            value={activeRuleTotalSelected}
                            onChange={(e) => updateSelectedDayLimit(Number(e.target.value))}
                            className="h-10 w-full rounded-xl border border-white/10 bg-black/50 px-3 text-sm font-black text-white outline-none focus:border-blue-500/60"
                          />
                        </label>
                        {selectedRuleShiftHours.map((hourKey) => (
                          <label key={hourKey} className="flex min-w-0 flex-col gap-1">
                            <span className="flex h-8 items-end text-[9px] font-black uppercase leading-tight tracking-widest text-gray-500">
                              {hourKey === "rest" ? "Амралт" : `${hourKey} цагтай`}
                              <span className="ml-1 text-[8px] text-blue-300/70">/{Number(selectedRuleShiftAvailability[hourKey]) || 0}</span>
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={Number(selectedRuleShiftAvailability[hourKey]) || 0}
                              value={Number(visibleRuleHourCounts[hourKey] || 0)}
                              onChange={(e) => updateDynamicWeeklyRule(hourKey, Number(e.target.value))}
                              className="h-10 w-full rounded-xl border border-white/10 bg-black/50 px-3 text-sm font-black text-white outline-none focus:border-blue-500/60"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedKeys.length > 0 && !selectedDaysHaveShifts && (
                    <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-yellow-300">
                      Сонгосон бүх өдөрт энэ segment/type-ийн shift эсвэл амралт орсон үед дүрэм тохируулна.
                    </div>
                  )}

                  {isPastDay && !isMultiSelect && (
                    <div className="rounded-2xl border border-orange-500/20 bg-orange-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-orange-300">
                      Өнгөрсөн өдрийн хуваарийг засах боломжгүй.
                    </div>
                  )}

                  <AnimatePresence>
                    {isBookingTimeModalOpen && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 px-4 backdrop-blur-md"
                        onClick={() => setIsBookingTimeModalOpen(false)}
                      >
                        <motion.div
                          initial={{ opacity: 0, scale: 0.96, y: 18 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.96, y: 18 }}
                          transition={{ type: "spring", damping: 22, stiffness: 260 }}
                          className="w-full max-w-lg rounded-[2rem] border border-gray-800 bg-gray-950 p-5 shadow-2xl"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="mb-4 flex justify-end">
                            <button
                              type="button"
                              onClick={() => setIsBookingTimeModalOpen(false)}
                              className="rounded-2xl border border-white/10 bg-white/5 p-3 text-gray-400 transition-all hover:bg-white/10 hover:text-white"
                              aria-label="Close"
                            >
                              <X size={18} />
                            </button>
                          </div>

                          <div className="space-y-4">
                            {[
                              {
                                label: "Нээгдэх өдөр/цаг",
                                value: bookingOpenAtInput,
                                onDateChange: (nextDate: string) => {
                                  const nextValue = setDatePart(bookingOpenAtInput, nextDate);
                                  setBookingOpenAtInput(nextValue);
                                  setBookingCloseAtInput(addHoursToDateTimeLocal(nextValue, 6));
                                },
                                onTimeChange: (nextHour: string, nextMinute: string) => {
                                  const nextValue = setTimePart(bookingOpenAtInput, nextHour, nextMinute);
                                  setBookingOpenAtInput(nextValue);
                                  setBookingCloseAtInput(addHoursToDateTimeLocal(nextValue, 6));
                                },
                              },
                              {
                                label: "Хаагдах өдөр/цаг",
                                value: bookingCloseAtInput,
                                onDateChange: (nextDate: string) => setBookingCloseAtInput(setDatePart(bookingCloseAtInput, nextDate)),
                                onTimeChange: (nextHour: string, nextMinute: string) => setBookingCloseAtInput(setTimePart(bookingCloseAtInput, nextHour, nextMinute)),
                              },
                            ].map((picker) => (
                              <div key={picker.label} className="rounded-3xl border border-white/10 bg-black/30 p-4">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                                    {picker.label}
                                  </span>
                                </div>
                                <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                                  <div className="relative min-w-0 rounded-2xl border border-white/10 bg-gray-950 px-3 py-3 text-sm font-black text-white outline-none transition-all focus-within:border-blue-500">
                                    <span className="block pr-8">{formatBookingDateDisplay(picker.value)}</span>
                                    <Calendar className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
                                    <input
                                      type="date"
                                      value={getDateInputValue(picker.value)}
                                      onClick={(event) => event.currentTarget.showPicker?.()}
                                      onFocus={(event) => event.currentTarget.showPicker?.()}
                                      onChange={(event) => picker.onDateChange(event.target.value)}
                                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                    />
                                  </div>
                                  <select
                                    value={getHourInputValue(picker.value)}
                                    onChange={(event) => picker.onTimeChange(event.target.value, getMinuteInputValue(picker.value))}
                                    className="rounded-2xl border border-white/10 bg-gray-950 px-3 py-3 text-sm font-black text-white outline-none focus:border-blue-500"
                                  >
                                    {HOURS_24.map((hour) => (
                                      <option key={hour} value={hour}>{hour}</option>
                                    ))}
                                  </select>
                                  <select
                                    value={getMinuteInputValue(picker.value)}
                                    onChange={(event) => picker.onTimeChange(getHourInputValue(picker.value), event.target.value)}
                                    className="rounded-2xl border border-white/10 bg-gray-950 px-3 py-3 text-sm font-black text-white outline-none focus:border-blue-500"
                                  >
                                    {MINUTES_60.map((minute) => (
                                      <option key={minute} value={minute}>{minute}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            ))}

                            <div className="grid grid-cols-3 gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setBookingOpenAtInput("");
                                  setBookingCloseAtInput("");
                                }}
                                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-gray-300 transition-all hover:bg-white/10"
                              >
                                Clear
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const now = formatDateTimeLocal();
                                  setBookingOpenAtInput(now);
                                  setBookingCloseAtInput(addHoursToDateTimeLocal(now, 6));
                                }}
                                className="rounded-2xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-blue-200 transition-all hover:bg-blue-500/20"
                              >
                                Now
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!bookingOpenAtInput || !bookingCloseAtInput) {
                                    alert("Нээгдэх болон хаагдах цагийг сонгоно уу.");
                                    return;
                                  }
                                  if (new Date(bookingCloseAtInput).getTime() <= new Date(bookingOpenAtInput).getTime()) {
                                    alert("Хаагдах цаг нь нээгдэх цагаас хойш байх ёстой.");
                                    return;
                                  }
                                  setBookingAccessForSelectedWaves(true);
                                  setIsBookingTimeModalOpen(false);
                                }}
                                className="rounded-2xl bg-green-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-green-500"
                              >
                                OK
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {isShiftTemplatePickerOpen && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4 backdrop-blur-md"
                        onClick={() => setIsShiftTemplatePickerOpen(false)}
                      >
                        <motion.div
                          initial={{ opacity: 0, scale: 0.96, y: 18 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.96, y: 18 }}
                          transition={{ type: "spring", damping: 22, stiffness: 260 }}
                          className="w-full max-w-xl rounded-[2rem] border border-gray-800 bg-gray-950 p-5 shadow-2xl"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="mb-4 flex items-start justify-between gap-4">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-400">
                                Shift сонгох
                              </p>
                              <h3 className="mt-1 text-2xl font-black text-white">
                                Shift загвар
                              </h3>
                              <p className="mt-1 text-xs font-bold text-gray-500">
                                Аль хэдийн нэмэгдсэн shift автоматаар хасагдана.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setIsShiftTemplatePickerOpen(false)}
                              className="rounded-2xl border border-white/10 bg-white/5 p-3 text-gray-400 transition-all hover:bg-white/10 hover:text-white"
                            >
                              <X size={18} />
                            </button>
                          </div>

                          {(() => {
                            const availableTemplates = [...shiftTemplates]
                              .sort(
                                (a, b) =>
                                  getStartTimeValue(a.time) - getStartTimeValue(b.time),
                              )
                              .filter((template) => {
                                const normalizedTime = getShiftTimeKey(template.time);
                                if (!normalizedTime) return false;
                                return !selectedKeys.some((dateKey) =>
                                  (schedules[dateKey]?.shifts || []).some(
                                    (shift: any) =>
                                      getShiftTimeKey(shift.time) === normalizedTime &&
                                      shift.segment === activeSegmentView &&
                                      shift.employmentType === activeEmploymentView,
                                  ),
                                );
                              });

                            if (availableTemplates.length === 0) {
                              return (
                                <div className="flex min-h-[180px] flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-gray-800 bg-black/30 text-center">
                                  <p className="text-sm font-black text-gray-400">
                                    Сонгох shift үлдээгүй байна
                                  </p>
                                  <p className="mt-2 max-w-xs text-[11px] font-bold leading-5 text-gray-600">
                                    Энэ өдөр/сонголт дээр shift загварт байгаа бүх цаг аль хэдийн нэмэгдсэн байна.
                                  </p>
                                </div>
                              );
                            }

                            return (
                              <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1 custom-scrollbar sm:grid-cols-3">
                                {availableTemplates.map((template) => {
                                  const normalizedTime = getShiftTimeKey(template.time);
                                  return (
                                    <button
                                      key={template.id || template.time}
                                      type="button"
                                      onClick={() => addShiftFromTemplateToSelection(normalizedTime)}
                                      disabled={!canEditSelection}
                                      className="rounded-2xl border border-white/5 bg-gray-900/80 px-4 py-4 text-left text-white transition-all hover:border-blue-500/50 hover:bg-blue-600/15 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      <p className="text-lg font-black">{normalizedTime}</p>
                                      <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-gray-500">
                                        {normalizedTime === REST_SHIFT_LABEL ? "Амрах slot" : `${getHoursForShift(normalizedTime)} цаг`}
                                      </p>
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="rounded-[1.5rem] border border-white/5 bg-black/20 p-3">
                    {filteredShifts.length === 0 ? (
                      <div className="flex min-h-[120px] flex-col items-center justify-center rounded-2xl border border-dashed border-gray-800 bg-gray-950/20 text-center">
                        <p className="text-sm font-black text-gray-500">
                          Хуваарь байхгүй
                        </p>
                        <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-blue-500/50">
                          Shift оруулах товчоор эхэлнэ
                        </p>
                      </div>
                    ) : (
                      <div className="max-h-[310px] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                        {filteredShifts.map((shift: any, idx: number) => {
                          const duplicateIndex = filteredShifts
                            .filter(
                              (item: any) =>
                                getShiftTimeKey(item.time) === getShiftTimeKey(shift.time),
                            )
                            .findIndex(
                              (item: any) =>
                                String(item.id || "") === String(shift.id || ""),
                            );
                          const isDuplicateShift = duplicateIndex > 0;
                          const bookingWaves = getBookingWavesForShift(
                            shift,
                            !!schedules[selectedDateSchedule]?.bookingOpen,
                            schedules[selectedDateSchedule]?.bookingOpenAt || "",
                            schedules[selectedDateSchedule]?.bookingCloseAt || "",
                          );
                          const morningWave = bookingWaves.find((wave) => getWaveKind(wave) === "morning") || createBookingWave(MORNING_WAVE_NAME, 0);
                          const eveningWave = bookingWaves.find((wave) => getWaveKind(wave) === "evening") || createBookingWave(EVENING_WAVE_NAME, 0);
                          const totalSlots = sumWaveSlots([morningWave, eveningWave]);
                          const morningKey = getShiftWaveSelectionKey(shift, morningWave);
                          const eveningKey = getShiftWaveSelectionKey(shift, eveningWave);

                          return (
                            <div
                              key={shift.id || idx}
                              className={`rounded-2xl border px-3 py-2 ${isDuplicateShift ? "border-red-500/40 bg-red-500/10" : "border-white/5 bg-gray-900/70"}`}
                            >
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <Clock size={14} className="text-blue-400" />
                                    <p className="text-sm font-black text-white">
                                      {getShiftTimeKey(shift.time)} <span className="text-gray-500">:</span> <span className="text-blue-300">{shift.time === REST_SHIFT_LABEL ? "амралт" : `${getHoursForShift(shift.time)} цаг`}</span>
                                    </p>
                                    {isDuplicateShift && (
                                      <span className="rounded-full bg-red-500 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-white">
                                        Давхардсан
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleConfirm("Ээлжийг устгах уу?", () => {
                                      if (isPastDay) return;

                                      const targetKeys = selectedKeys.length > 0 ? selectedKeys : [selectedDateSchedule].filter(Boolean);
                                      const targetTime = getShiftTimeKey(shift.time);
                                      const newSchedules = { ...schedules };

                                      targetKeys.forEach((dateKey) => {
                                        const currentDay = newSchedules[dateKey];
                                        if (!currentDay?.shifts?.length) return;

                                        const updatedShifts = currentDay.shifts.filter((s: any) => {
                                          const sameId = shift.id && s.id === shift.id;
                                          const sameContext =
                                            getShiftTimeKey(s.time) === targetTime &&
                                            s.segment === activeSegmentView &&
                                            s.employmentType === activeEmploymentView;
                                          return !(sameId || sameContext);
                                        });

                                        if (updatedShifts.length === 0) {
                                          delete newSchedules[dateKey];
                                        } else {
                                          newSchedules[dateKey] = {
                                            ...currentDay,
                                            shifts: updatedShifts,
                                          };
                                        }
                                      });

                                      void persistSchedules(newSchedules, targetKeys);
                                      logAction("Schedule Shift Deleted", `${targetTime} removed from ${targetKeys.join(", ")}`);
                                    })
                                  }
                                  disabled={isPastDay}
                                  title="Устгах"
                                  className="flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-xl bg-red-500/10 text-red-300 transition-all hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <Trash2 size={15} className="block" />
                                </button>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5">
                                <div className="flex h-8 min-w-[66px] items-center justify-between gap-1.5 rounded-full border border-white/10 bg-black/30 px-2.5">
                                  <span className="text-[7px] font-black uppercase tracking-widest text-gray-500">Нийт</span>
                                  <span className="text-xs font-black text-white">{totalSlots}</span>
                                </div>
                                {[morningWave, eveningWave].map((wave) => {
                                  const waveKind = getWaveKind(wave) as "morning" | "evening";
                                  const selectedKey = getShiftWaveSelectionKey(shift, wave);
                                  const isSelectedWave = selectedWaveKeys.includes(selectedKey);
                                  const booked = getWaveBookedCount(shift, wave.id);
                                  const waveOpen = isWaveCurrentlyOpen(wave);
                                  const canSelectWave = !isPastDay && Number(wave.slotLimit) > 0;
                                  return (
                                    <div
                                      key={selectedKey}
                                      role="button"
                                      tabIndex={canSelectWave ? 0 : -1}
                                      onClick={() => {
                                        if (!canSelectWave) return;
                                        toggleWaveSelection(shift, wave);
                                      }}
                                      onKeyDown={(event) => {
                                        if (!canSelectWave) return;
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault();
                                          toggleWaveSelection(shift, wave);
                                        }
                                      }}
                                      className={`flex h-8 min-w-[104px] items-center justify-between gap-2 rounded-full border px-2.5 transition-all ${
                                        isSelectedWave
                                          ? "border-blue-400 bg-blue-600/25 shadow-[0_0_18px_rgba(37,99,235,0.35)]"
                                          : "border-white/10 bg-black/30 hover:border-blue-500/40"
                                      } ${canSelectWave ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}
                                    >
                                      <div className="flex min-w-0 items-center gap-1.5 leading-none">
                                        <span className={`text-[7px] font-black uppercase tracking-widest ${isSelectedWave ? "text-blue-200" : "text-gray-500"}`}>
                                          {waveKind === "morning" ? "Өглөө" : "Орой"}
                                        </span>
                                        <span className={`text-[8px] font-black ${waveOpen ? "text-green-300" : isSelectedWave ? "text-blue-200" : "text-gray-500"}`}>
                                          {booked}/{Number(wave.slotLimit) || 0}
                                        </span>
                                      </div>
                                      <input
                                        type="number"
                                        min={0}
                                        value={Number(wave.slotLimit) || 0}
                                        onClick={(event) => event.stopPropagation()}
                                        onChange={(event) =>
                                          updateShiftWaveSlotsForSelection(
                                            shift,
                                            waveKind,
                                            Number(event.target.value) || 0,
                                          )
                                        }
                                        disabled={isPastDay}
                                        className="h-6 w-8 rounded-md border border-white/5 bg-black/40 text-center text-xs font-black text-white outline-none focus:border-blue-500/60 disabled:text-gray-600"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[1.5rem] border border-white/5 bg-black/20 p-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setBookingOpenAtInput(formatDateTimeLocal());
                          setBookingCloseAtInput(addHoursToDateTimeLocal(formatDateTimeLocal(), 6));
                          setIsBookingTimeModalOpen(true);
                        }}
                        disabled={!canEditSelection || !filteredShifts.length || selectedWaveKeys.length === 0}
                        className="rounded-2xl bg-green-600 px-3 py-3.5 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-gray-800/50 disabled:text-gray-600"
                      >
                        <CheckCircle2 size={15} className="inline mr-1" /> Захиалга нээх
                      </button>
                      <button
                        onClick={() => setBookingAccessForSelectedWaves(false)}
                        disabled={!canEditSelection || !filteredShifts.length || selectedWaveKeys.length === 0}
                        className="rounded-2xl border border-white/5 bg-gray-800/60 px-3 py-3.5 text-[10px] font-black uppercase tracking-widest text-gray-300 transition-all hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Lock size={15} className="inline mr-1" /> Хаах
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyPreviousDay(selectedKeys)}
                        disabled={!hasSelectedDays || !canEditSelection}
                        className="rounded-2xl border border-white/5 bg-gray-800/60 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-gray-300 transition-all hover:bg-blue-500/10 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Copy size={13} className="inline mr-1" /> Өмнөх өдөр
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSelectedDayShifts(selectedKeys)}
                        disabled={!hasSelectedDays || !canEditSelection || !selectedDaysHaveShifts}
                        className="rounded-2xl border border-red-500/10 bg-red-500/5 px-3 py-3 text-[10px] font-black uppercase tracking-widest text-red-300 transition-all hover:bg-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 size={13} className="inline mr-1" /> Бүгдийг устгах
                      </button>
                    </div>
                  </div>
                </div>
              );

            })()}
          </motion.div>
        </div>
      </div>
    );
  };

  const renderHourlyLeaveView = () => {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tight">
            Чөлөө
          </h2>
          <p className="text-gray-400 mt-1">
            Ажилтнуудын ирүүлсэн чөлөө хүсэлтүүд.
          </p>
        </div>

        <div className="bg-gray-900/40 border border-gray-800 rounded-3xl overflow-hidden backdrop-blur-md shadow-2xl">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/30">
                <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest w-40">
                  Код
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Ажилтан
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Огноо / Цаг
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Шалтгаан
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest text-right">
                  Үйлдэл
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {hourlyLeaveRequests
                .sort(
                  (a, b) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime(),
                )
                .map((req) => {
                  const requester = csrs.find((c) => c.id === req.csrId);
                  return (
                    <tr
                      key={req.id}
                      className="hover:bg-gray-800/10 transition-colors group"
                    >
                      <td className="px-8 py-6">
                        <span className="text-sm font-black text-blue-500">
                          {requester?.code || "---"}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <div className="font-bold text-white uppercase tracking-wide">
                          {req.csrName}
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="text-sm text-gray-300 font-bold mb-0.5">
                          {req.type === "daily"
                            ? req.endDate && req.endDate !== req.date
                              ? `${req.date} - ${req.endDate}`
                              : req.date
                            : req.date}
                        </div>
                        <div className="text-[10px] text-gray-500 font-black flex items-center gap-1.5 uppercase tracking-widest">
                          {req.type === "daily" ? (
                            <>
                              <Calendar size={12} /> Өдрийн чөлөө
                            </>
                          ) : (
                            <>
                              <Clock size={12} /> {req.startTime} -{" "}
                              {req.endTime}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-8 py-6 max-w-xs">
                        <p className="text-xs text-gray-400 font-medium leading-relaxed italic line-clamp-2">
                          "{req.reason}"
                        </p>
                      </td>
                      <td className="px-8 py-6 text-right">
                        {req.status === "pending" ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() =>
                                handleConfirm(
                                  `'${req.csrName}'-ийн хүсэлтийг зөвшөөрөх үү?`,
                                  () => handleApproveHourlyLeave(req.id),
                                )
                              }
                              className="p-2.5 text-green-500 hover:bg-green-500/10 rounded-xl transition-all"
                            >
                              <CheckCircle2 size={20} />
                            </button>
                            <button
                              onClick={() => {
                                const comment = prompt(
                                  "Татгалзсан шалтгаан орно уу:",
                                );
                                if (comment !== null)
                                  handleRejectHourlyLeave(req.id, comment);
                              }}
                              className="p-2.5 text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                            >
                              <XCircle size={20} />
                            </button>
                          </div>
                        ) : (
                          <span
                            className={`text-[10px] font-black uppercase tracking-widest ${req.status === "approved" ? "text-green-500" : "text-red-500"}`}
                          >
                            {req.status === "approved"
                              ? "Зөвшөөрсөн"
                              : "Татгалзсан"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              {hourlyLeaveRequests.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="py-20 text-center text-gray-500 font-bold uppercase tracking-widest text-xs opacity-50"
                  >
                    Одоогоор цагийн чөлөө ирээгүй байна
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderForecastView = () => <ForecastDashboard />;

  const SidebarItem = ({
    id,
    icon: Icon,
    label,
    badge,
  }: {
    id: string;
    icon: any;
    label: string;
    badge?: number;
  }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`w-full flex items-center gap-3 px-3 sm:px-4 py-3 lg:py-4 rounded-2xl transition-all relative group ${activeTab === id ? "bg-blue-600/10 text-blue-400 border border-blue-500/20 shadow-xl shadow-blue-500/5" : "text-gray-500 hover:text-gray-200 hover:bg-white/5 border border-transparent"}`}
    >
      <div
        className={`p-2 rounded-xl transition-colors ${activeTab === id ? "bg-blue-600 text-white shadow-lg shadow-blue-500/40" : "bg-gray-800/50 group-hover:bg-gray-800"}`}
      >
        <Icon size={18} strokeWidth={activeTab === id ? 3 : 2} />
      </div>
      {!isSidebarCollapsed && (
        <span className="text-sm font-black uppercase tracking-widest whitespace-nowrap">
          {label}
        </span>
      )}
      {activeTab === id && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute -left-1 w-1.5 h-8 bg-blue-500 rounded-r-full shadow-[0_0_15px_#3b82f6]"
        />
      )}
    </button>
  );

  return (
    <div className="flex min-h-screen flex-col lg:flex-row bg-[#0a0a0a] text-gray-100 font-sans overflow-x-hidden">
      {/* Sidebar */}
      <aside
        className={`bg-gray-900/40 backdrop-blur-xl border-b lg:border-b-0 lg:border-r border-gray-800 transition-all duration-500 flex flex-col ${isSidebarCollapsed ? "lg:w-24" : "lg:w-80"} w-full max-h-[46vh] lg:max-h-none relative z-50 shrink-0`}
      >
        <button
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="hidden lg:flex absolute -right-3 top-10 w-6 h-6 bg-blue-600 rounded-full items-center justify-center text-white shadow-lg z-30 hover:scale-110 transition-transform border border-white/20"
        >
          {isSidebarCollapsed ? (
            <ChevronRight size={14} />
          ) : (
            <ChevronLeft size={14} />
          )}
        </button>
        <div
          className={`p-4 sm:p-6 border-b border-gray-800 flex items-center gap-4 bg-black/20 ${isSidebarCollapsed ? "lg:justify-center" : ""}`}
        >
          <div
            className="relative group cursor-pointer"
            onClick={handlePhotoClick}
          >
            <div
              className={`relative overflow-hidden rounded-2xl border-2 border-blue-500/50 shadow-lg transition-transform group-hover:scale-105 bg-gray-800 ${isSidebarCollapsed ? "w-10 h-10" : "w-14 h-14"}`}
            >
              <img
                src={
                  profile?.photoUrl ||
                  "https://ui-avatars.com/api/?name=Admin&background=2563eb&color=fff&size=128"
                }
                alt="Profile"
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera
                  size={isSidebarCollapsed ? 12 : 16}
                  className="text-white"
                />
              </div>
            </div>
            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-gray-900 bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]"></div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              accept="image/*"
            />
          </div>
          {!isSidebarCollapsed && (
            <div className="flex-1 min-w-0">
              <h2 className="text-white font-black text-lg tracking-tight truncate uppercase italic">
                {profile?.name || "Supervisor"}
              </h2>
              <p className="text-blue-500 text-[10px] font-black uppercase tracking-[0.1em] truncate mb-0.5">
                Supervisor
              </p>
              <p className="text-gray-500 text-[9px] font-bold truncate opacity-60">
                {profile?.email}
              </p>
            </div>
          )}
        </div>

        <nav className="flex-1 px-3 sm:px-6 space-y-2 lg:space-y-3 overflow-y-auto custom-scrollbar py-3 lg:pt-8">
          <SidebarItem id="users" icon={Users} label="Ажилтны удирдлага" />
          <SidebarItem
            id="schedule"
            icon={Calendar}
            label="Хуваарь удирдлага"
          />
          {SHOW_VACATION_FEATURE && (
            <SidebarItem id="vacation" icon={Palmtree} label="Ээлжийн амралт" />
          )}
          <SidebarItem id="hourlyLeave" icon={Clock} label="Чөлөө" />
          <SidebarItem id="forecast" icon={BarChart3} label="Forecast" />
          <SidebarItem
            id="notifications"
            icon={Bell}
            label="Мэдэгдэл"
            badge={unreadCount}
          />
          <SidebarItem id="training" icon={BookOpen} label="Сургалт" />
        </nav>

        <div className="p-4 mt-auto space-y-2">
          <button
            onClick={() => setIsChangingPassword(true)}
            className="w-full flex items-center gap-3 px-4 py-4 text-gray-400 hover:bg-gray-800 rounded-2xl transition-all"
          >
            <Settings size={20} />
            {!isSidebarCollapsed && (
              <span className="text-sm font-bold">Нууц үг солих</span>
            )}
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-4 text-red-500 hover:bg-red-500/10 rounded-2xl transition-all"
          >
            <LogOut size={20} />
            {!isSidebarCollapsed && (
              <span className="text-sm font-bold">Системээс гарах</span>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col relative overflow-x-hidden overflow-y-auto">
        <header className="min-h-14 border-b border-gray-800/50 flex flex-wrap items-center justify-between gap-3 px-3 sm:px-4 lg:px-6 py-3 bg-gray-900/20 backdrop-blur-2xl z-10 shrink-0">
          <div>
            <h1 className="text-[clamp(1.25rem,2vw,1.75rem)] font-black text-white tracking-tighter capitalize whitespace-nowrap leading-none">
              {activeTab === "users"
                ? "Ажилтны удирдлага"
                : activeTab === "schedule"
                  ? "Хуваарь удирдлага"
                  : SHOW_VACATION_FEATURE && activeTab === "vacation"
                    ? "Ээлжийн амралт"
                    : activeTab === "hourlyLeave"
                      ? "Чөлөөний хүсэлт"
                      : activeTab === "forecast"
                        ? "Дуудлагын Forecast"
                        : activeTab === "notifications"
                          ? "Мэдэгдэл"
                          : activeTab === "training"
                            ? "Сургалт"
                            : "Мэдэгдэл"}
            </h1>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-4 relative">
            {activeTab === "users" && (
              <div className="relative" ref={filterRef}>
                <button
                  onClick={() => setIsFilterOpen(!isFilterOpen)}
                  className={`flex items-center gap-2.5 px-6 py-3 border rounded-[1.2rem] text-sm font-black transition-all shadow-xl ${isFilterOpen ? "bg-blue-600 border-blue-500 text-white" : "bg-[#111418] border-white/10 text-white hover:bg-gray-800"}`}
                >
                  <Filter
                    size={18}
                    className={isFilterOpen ? "text-white" : "text-[#00a3ff]"}
                  />
                  Шүүлтүүр
                </button>

                <AnimatePresence>
                  {isFilterOpen && (
                    <>
                      <motion.div
                        key="filter-panel"
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute right-0 mt-4 w-80 bg-[#111418] border border-white/10 rounded-3xl shadow-2xl p-6 z-[70] backdrop-blur-3xl"
                      >
                        <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-6">
                          Хайлт & Шүүлтүүр
                        </h3>

                        <div className="space-y-5">
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">
                              Сегмент
                            </label>
                            <select
                              value={filters.segment}
                              onChange={(e) =>
                                setFilters((prev) => ({
                                  ...prev,
                                  segment: e.target.value,
                                }))
                              }
                              className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none cursor-pointer"
                            >
                              <option value="All">Бүх сегмент</option>
                              {segments.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">
                              Location
                            </label>
                            <select
                              value={filters.location}
                              onChange={(e) =>
                                setFilters((prev) => ({
                                  ...prev,
                                  location: e.target.value,
                                }))
                              }
                              className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none cursor-pointer"
                            >
                              <option value="All">Бүх location</option>
                              {Array.from(
                                new Set(
                                  csrs
                                    .map((c) => getCsrLocation(c))
                                    .filter(Boolean),
                                ),
                              )
                                .sort()
                                .map((location) => (
                                  <option key={location} value={location}>
                                    {location}
                                  </option>
                                ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">
                              Цагийн төрөл
                            </label>
                            <select
                              value={filters.employmentType}
                              onChange={(e) =>
                                setFilters((prev) => ({
                                  ...prev,
                                  employmentType: e.target.value,
                                }))
                              }
                              className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none cursor-pointer"
                            >
                              <option value="All">Бүх төрөл</option>
                              <option value="Full Time">Full Time</option>
                              <option value="Part Time">Part Time</option>
                            </select>
                          </div>



                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">
                              Supervisor
                            </label>
                            <select
                              value={filters.supervisorName}
                              onChange={(e) =>
                                setFilters((prev) => ({
                                  ...prev,
                                  supervisorName: e.target.value,
                                }))
                              }
                              className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none cursor-pointer"
                            >
                              <option value="All">Бүх Supervisor</option>
                              {Array.from(new Set(csrs.map((c) => getCsrSupervisorName(c)).filter(Boolean)))
                                .sort()
                                .map((supervisorName) => (
                                  <option key={supervisorName} value={supervisorName}>
                                    {supervisorName}
                                  </option>
                                ))}
                            </select>
                          </div>

                          <div className="pt-2">
                            <button
                              onClick={() => {
                                setFilters({
                                  segment: "All",
                                  location: "All",
                                  employmentType: "All",
                                  supervisorName: "All",
                                });
                                setSearchQuery("");
                              }}
                              className="w-full py-3 bg-gray-800/50 hover:bg-gray-800 text-gray-400 hover:text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all"
                            >
                              Бүгдийг цэвэрлэх
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            )}
            <DigitalClock
              months={ENG_MONTHS}
              weekdays={["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]}
            />
          </div>
        </header>

        <div className="flex-1 min-w-0 p-2 lg:p-3 overflow-y-auto custom-scrollbar relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === "users" && renderUsersView()}
              {SHOW_VACATION_FEATURE &&
                activeTab === "vacation" &&
                renderVacationView()}
              {activeTab === "hourlyLeave" && renderHourlyLeaveView()}
              {activeTab === "schedule" && renderScheduleView()}
              {activeTab === "notifications" && renderNotificationsView()}
              {activeTab === "forecast" && renderForecastView()}
              {activeTab === "training" && renderTrainingView()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Modals */}
        <AnimatePresence>
          {isChangingPassword && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsChangingPassword(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl"
              >
                <button
                  onClick={() => setIsChangingPassword(false)}
                  className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors"
                >
                  <X size={24} />
                </button>
                <h2 className="text-2xl font-black text-white mb-6">
                  Нууц үг солих
                </h2>
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] ml-1 mb-2 block">
                      Хуучин нууц үг
                    </label>
                    <input
                      type="password"
                      value={passwordForm.old}
                      onChange={(e) =>
                        setPasswordForm({
                          ...passwordForm,
                          old: e.target.value,
                        })
                      }
                      className="w-full bg-gray-800 border border-gray-700 rounded-2xl py-3.5 px-5 text-white focus:outline-none focus:border-blue-500 font-bold"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] ml-1 mb-2 block">
                      Шинэ нууц үг
                    </label>
                    <input
                      type="password"
                      value={passwordForm.new}
                      onChange={(e) =>
                        setPasswordForm({
                          ...passwordForm,
                          new: e.target.value,
                        })
                      }
                      className="w-full bg-gray-800 border border-gray-700 rounded-2xl py-3.5 px-5 text-white focus:outline-none focus:border-blue-500 font-bold"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] ml-1 mb-2 block">
                      Шинэ нууц үг давтах
                    </label>
                    <input
                      type="password"
                      value={passwordForm.confirm}
                      onChange={(e) =>
                        setPasswordForm({
                          ...passwordForm,
                          confirm: e.target.value,
                        })
                      }
                      className="w-full bg-gray-800 border border-gray-700 rounded-2xl py-3.5 px-5 text-white focus:outline-none focus:border-blue-500 font-bold"
                      required
                    />
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setIsChangingPassword(false)}
                      className="flex-1 py-4 bg-gray-800 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-700 transition-all"
                    >
                      Цуцлах
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20"
                    >
                      Хадгалах
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {confirmAction && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setConfirmAction(null)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative bg-gray-900 border border-gray-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl"
              >
                <div className="w-16 h-16 bg-red-600/10 rounded-2xl flex items-center justify-center text-red-500 mb-6 mx-auto">
                  <AlertCircle size={32} />
                </div>
                <h3 className="text-xl font-black text-center text-white mb-2">
                  Баталгаажуулах
                </h3>
                <p className="text-gray-400 text-center text-sm mb-8 leading-relaxed">
                  {confirmAction.title}
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="flex-1 py-4 bg-gray-800 text-white rounded-2xl font-bold hover:bg-gray-700 transition-all"
                  >
                    Цуцлах
                  </button>
                  <button
                    onClick={() => {
                      confirmAction.onConfirm();
                      setConfirmAction(null);
                    }}
                    className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20"
                  >
                    Тийм
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {secureConfirmAction && (
            <div className="fixed inset-0 z-[155] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSecureConfirmAction(null)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, rotateX: 20, scale: 0.95 }}
                animate={{ opacity: 1, rotateX: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                  <Lock size={120} className="text-red-500" />
                </div>

                <div className="relative">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-14 h-14 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 border border-red-500/20 shadow-inner">
                      <ShieldAlert size={28} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-black text-white tracking-tight leading-none mb-1">
                        {secureConfirmAction.title}
                      </h3>
                      <p className="text-[10px] font-black text-red-500 uppercase tracking-[0.2em]">
                        Sensitive Operation
                      </p>
                    </div>
                  </div>

                  <p className="text-gray-400 text-sm mb-8 leading-relaxed font-medium">
                    {secureConfirmAction.description}
                  </p>

                  {secureConfirmAction.error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-bold animate-shake">
                      {secureConfirmAction.error}
                    </div>
                  )}

                  <div className="space-y-4 mb-8">
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">
                        Админ Нэр
                      </label>
                      <input
                        type="text"
                        value={secureConfirmAction.username || ""}
                        onChange={(e) =>
                          setSecureConfirmAction((prev) => ({
                            ...prev!,
                            username: e.target.value,
                          }))
                        }
                        className="w-full bg-gray-800 border border-gray-700 rounded-2xl py-4 px-5 text-white focus:outline-none focus:border-red-500/50 transition-all shadow-inner placeholder:text-gray-600"
                        placeholder="admin"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">
                        Нууц үг
                      </label>
                      <input
                        type="password"
                        autoFocus
                        value={secureConfirmAction.password || ""}
                        onChange={(e) =>
                          setSecureConfirmAction((prev) => ({
                            ...prev!,
                            password: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const isValid =
                              (secureConfirmAction.username?.toLowerCase() ===
                                "admin" ||
                                secureConfirmAction.username?.toLowerCase() ===
                                  "admin@mobicom.mn") &&
                              secureConfirmAction.password &&
                              secureConfirmAction.password.length > 0;
                            if (isValid) {
                              secureConfirmAction.onConfirm();
                              setSecureConfirmAction(null);
                            } else {
                              setSecureConfirmAction((prev) => ({
                                ...prev!,
                                error: "Нэвтрэх нэр эсвэл нууц үг буруу байна.",
                              }));
                            }
                          }
                        }}
                        className="w-full bg-gray-800 border border-gray-700 rounded-2xl py-4 px-5 text-white focus:outline-none focus:border-red-500/50 transition-all shadow-inner placeholder:text-gray-600"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={() => setSecureConfirmAction(null)}
                      className="flex-1 py-4 bg-gray-800 text-white font-black rounded-2xl hover:bg-gray-700 transition-all border border-gray-700/50 uppercase tracking-widest text-xs"
                    >
                      Болих
                    </button>
                    <button
                      onClick={() => {
                        const isValid =
                          (secureConfirmAction.username?.toLowerCase() ===
                            "admin" ||
                            secureConfirmAction.username?.toLowerCase() ===
                              "admin@mobicom.mn") &&
                          secureConfirmAction.password &&
                          secureConfirmAction.password.length > 0;
                        if (isValid) {
                          secureConfirmAction.onConfirm();
                          setSecureConfirmAction(null);
                        } else {
                          setSecureConfirmAction((prev) => ({
                            ...prev!,
                            error: "Нэвтрэх нэр эсвэл нууц үг буруу байна.",
                          }));
                        }
                      }}
                      className="flex-1 py-4 bg-red-600 text-white font-black rounded-2xl hover:bg-red-500 transition-all shadow-xl shadow-red-900/40 uppercase tracking-widest text-xs"
                    >
                      Баталгаажуулах
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}

          {isAddingHoliday && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsAddingHoliday(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-3xl bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-3xl font-black text-white">
                    {selectedBookingDates.length > 0 || (selectedDateSchedule && holidayData.date === selectedDateSchedule)
                      ? "Баярын өдөр тэмдэглэх"
                      : "Баяр ёслолын жагсаалт"}
                  </h3>
                  <button
                    onClick={() => setIsAddingHoliday(false)}
                    className="p-2 text-gray-500 hover:text-white transition-colors"
                  >
                    <X size={24} />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10 flex-1 overflow-hidden">
                  {/* Form */}
                  <div className="space-y-6 flex flex-col">
                    <h4 className="text-[10px] font-black text-blue-500 uppercase tracking-widest border-l-2 border-blue-500 pl-3">
                      {selectedBookingDates.length > 0 || (selectedDateSchedule && holidayData.date === selectedDateSchedule)
                        ? "Сонгосон өдөр"
                        : "Шинээр нэвтрүүлэх"}
                    </h4>
                    <div className="space-y-4 bg-white/5 p-6 rounded-3xl border border-white/5 flex-1">
                      {selectedBookingDates.length > 0 || (selectedDateSchedule && holidayData.date === selectedDateSchedule) ? (
                        <div>
                          <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">
                            Сонгосон огноо
                          </label>
                          <div className="w-full rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-sm font-black uppercase tracking-widest text-red-100">
                            {formatSelectedDateRange(selectedBookingDates.length > 0 ? selectedBookingDates : [holidayData.date].filter(Boolean))}
                          </div>
                          {selectedBookingDates.length > 0 && (
                            <p className="mt-2 text-[10px] font-bold text-gray-500">
                              Сонгосон {selectedBookingDates.length} өдөр бүгд баярын өдөр болно.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">
                            Огноо
                          </label>
                          <input
                            type="date"
                            value={holidayData.date}
                            onChange={(e) =>
                              setHolidayData((prev) => ({
                                ...prev,
                                date: e.target.value,
                              }))
                            }
                            className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 px-5 text-white focus:outline-none focus:border-blue-500 font-bold transition-all"
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">
                          Нэршил
                        </label>
                        <input
                          type="text"
                          placeholder="Жишээ: Цагаан сар"
                          value={holidayData.name}
                          onChange={(e) =>
                            setHolidayData((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 px-5 text-white focus:outline-none focus:border-blue-500 placeholder:text-gray-700 transition-all font-bold"
                        />
                      </div>
                      <div className="pt-4 flex gap-3">
                        {holidayData.id && (
                          <button
                            onClick={() =>
                              setHolidayData({ id: "", date: "", name: "" })
                            }
                            className="flex-1 py-4 bg-gray-800 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-gray-700 transition-all"
                          >
                            Болих
                          </button>
                        )}
                        <button
                          onClick={handleAddHoliday}
                          className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/20"
                        >
                          {holidayData.id ? "Шинэчлэх" : "Хадгалах"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* List */}
                  <div className="flex flex-col h-full overflow-hidden">
                    <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest border-l-2 border-red-500 pl-3 mb-6">
                      Бүртгэлтэй жагсаалт
                    </h4>
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-3 space-y-3">
                      {holidays.length > 0 ? (
                        holidays.map((h, i) => (
                          <div
                            key={i}
                            className="bg-white/5 border border-white/5 rounded-3xl p-5 flex items-center justify-between group hover:border-red-500/20 transition-all"
                          >
                            <div>
                              <p className="text-white font-black text-sm">
                                {h.name}
                              </p>
                              <p className="text-[9px] text-gray-500 font-black tracking-widest uppercase mt-1">
                                {h.date} • Баярын өдөр
                              </p>
                            </div>
                            <div className="flex items-center gap-2 transition-all">
                              <button
                                onClick={() => setHolidayData(h)}
                                className="p-3 text-gray-400 hover:text-blue-500 bg-black/40 rounded-2xl transition-all"
                                title="Засах"
                              >
                                <Edit size={16} />
                              </button>
                              <button
                                onClick={() => {
                                  handleConfirm(
                                    `'${h.name}'-г бүртгэлээс устгах уу?`,
                                    () => {
                                      const updated = holidays.filter(
                                        (item) => item.id !== h.id,
                                      );
                                      setLocalData("holidays", updated);
                                      setHolidays(updated);
                                      if (holidayData.id === h.id) {
                                        setHolidayData({
                                          id: "",
                                          date: "",
                                          name: "",
                                        });
                                      }
                                      if (selectedDateSchedule === h.date) {
                                        setSelectedHolidayName("");
                                      }
                                    },
                                  );
                                }}
                                className="p-3 text-gray-400 hover:text-red-500 bg-black/40 rounded-2xl transition-all"
                                title="Устгах"
                              >
                                <Trash size={16} />
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="h-40 flex flex-col items-center justify-center border-2 border-dashed border-white/5 rounded-[2rem] opacity-20 text-center">
                          <p className="text-xs font-bold text-gray-500">
                            Одоогоор баяр ёслол
                            <br />
                            бүртгэгдээгүй байна
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}

          {selectedMaterial && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedMaterial(null)}
                className="absolute inset-0 bg-black/90 backdrop-blur-md"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-5xl bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
              >
                <div className="p-6 border-b border-gray-800 flex items-center justify-between bg-gray-900/50 backdrop-blur-xl shrink-0">
                  <div className="flex-1">
                    <h2 className="text-xl font-black text-white">
                      {selectedMaterial.title}
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">
                      {selectedMaterial.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {(() => {
                      const isDeadlinePassed =
                        selectedMaterial.deadline &&
                        new Date(selectedMaterial.deadline) < new Date();
                      const alreadySeen = selectedMaterial.seenBy?.some(
                        (s) => s.userId === "admin",
                      );

                      if (!alreadySeen && !isDeadlinePassed) {
                        return (
                          <button
                            onClick={() => {
                              markMaterialAsRead(selectedMaterial.id);
                              setSelectedMaterial(null);
                            }}
                            className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-green-900/20 flex items-center gap-2"
                          >
                            <CheckCircle2 size={18} />
                            Би үзсэн
                          </button>
                        );
                      }
                      return null;
                    })()}
                    <button
                      onClick={() => setSelectedMaterial(null)}
                      className="p-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                    >
                      <X size={24} />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-auto bg-black flex items-center justify-center p-4">
                  {selectedMaterial.type === "Image" ? (
                    <LazyMedia
                      src={selectedMaterial.url}
                      alt={selectedMaterial.title}
                      type="Image"
                      className="max-w-full max-h-full rounded-xl"
                      objectFit="contain"
                    />
                  ) : selectedMaterial.type === "Video" ? (
                    <LazyMedia
                      src={selectedMaterial.url}
                      type="Video"
                      className="max-w-full max-h-full rounded-xl"
                      objectFit="contain"
                    />
                  ) : selectedMaterial.type === "PDF" ? (
                    <iframe
                      src={selectedMaterial.url}
                      className="w-full h-full min-h-[60vh] rounded-xl border-none"
                      title={selectedMaterial.title}
                    />
                  ) : (
                    <div className="text-center space-y-6 p-12">
                      <div className="w-20 h-20 bg-blue-600/10 rounded-3xl flex items-center justify-center mx-auto">
                        <FileText size={40} className="text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white mb-2">
                          {selectedMaterial.type === "File"
                            ? "Файл татах"
                            : "Гадна холбоос"}
                        </h3>
                        <p className="text-gray-400 max-w-md mx-auto">
                          {selectedMaterial.type === "File"
                            ? "Энэ материалыг шууд үзэх боломжгүй тул татаж авч үзнэ үү."
                            : "Энэ материал нь гадны вэбсайт дээр байрлаж байна."}
                        </p>
                      </div>
                      <a
                        href={selectedMaterial.url}
                        download={
                          selectedMaterial.type === "File"
                            ? selectedMaterial.title
                            : undefined
                        }
                        target={
                          selectedMaterial.type === "File"
                            ? undefined
                            : "_blank"
                        }
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-8 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/20"
                      >
                        {selectedMaterial.type === "File"
                          ? "Файлыг татах"
                          : "Холбоосыг нээх"}
                        {selectedMaterial.type === "File" ? (
                          <Download size={20} />
                        ) : (
                          <ExternalLink size={20} />
                        )}
                      </a>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}

          {showSeenDetails && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowSeenDetails(null)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl flex flex-col max-h-[80vh]"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-2xl font-black text-white">
                      Үзсэн / Үзээгүй ажилтнууд
                    </h2>
                    <p className="text-gray-400 text-sm">
                      {showSeenDetails.title}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-green-400">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      Шууд шинэчлэгдэж байна
                    </div>
                  </div>
                  <button
                    onClick={() => setShowSeenDetails(null)}
                    className="text-gray-500 hover:text-white"
                  >
                    <X size={24} />
                  </button>
                </div>

                {(() => {
                  const targetUsers = csrs.filter(
                    (user) => user.role === "csr" || !user.role,
                  );
                  const seenBy = showSeenDetails.seenBy ?? [];
                  const seenUserIds = new Set(
                    seenBy.map((seen) => String(seen.userId)),
                  );
                  const unseenUsers = targetUsers.filter(
                    (user) => !seenUserIds.has(String(user.id)),
                  );
                  const activeView =
                    (showSeenDetails as any)._view === "unseen"
                      ? "unseen"
                      : "seen";

                  return (
                    <>
                      <div className="flex gap-4 mb-4 border-b border-gray-800">
                        <button
                          onClick={() =>
                            setShowSeenDetails({
                              ...showSeenDetails,
                              _view: "seen",
                            } as any)
                          }
                          className={`px-4 py-2 font-bold text-sm transition-all ${activeView === "seen" ? "text-blue-400 border-b-2 border-blue-400" : "text-gray-500 hover:text-white"}`}
                        >
                          Үзсэн ({seenBy.length})
                        </button>
                        <button
                          onClick={() =>
                            setShowSeenDetails({
                              ...showSeenDetails,
                              _view: "unseen",
                            } as any)
                          }
                          className={`px-4 py-2 font-bold text-sm transition-all ${activeView === "unseen" ? "text-red-400 border-b-2 border-red-400" : "text-gray-500 hover:text-white"}`}
                        >
                          Үзээгүй ({unseenUsers.length})
                        </button>
                      </div>

                      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                        {activeView === "unseen" ? (
                          unseenUsers.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                              <CheckCircle2
                                size={48}
                                className="mb-4 opacity-20"
                              />
                              <p className="font-bold">
                                Бүх ажилтан үзсэн байна.
                              </p>
                            </div>
                          ) : (
                            unseenUsers.map((user, idx) => (
                              <div
                                key={`admin-unseen-detail-${user.id}-${idx}`}
                                className="flex items-center justify-between p-4 bg-gray-800/30 rounded-xl border border-gray-800"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-xs font-bold text-red-400">
                                    {user.name.charAt(0)}
                                  </div>
                                  <div>
                                    <p className="font-bold text-white">
                                      {user.name}
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <p className="text-[10px] text-gray-500 uppercase font-black">
                                        {user.email || "-"}
                                      </p>
                                      <span className="w-1 h-1 bg-gray-700 rounded-full" />
                                      <p className="text-[10px] text-gray-500 uppercase font-black">
                                        {user.lineType || "N/A"}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="flex items-center gap-1.5 text-red-500 text-xs font-bold mb-0.5">
                                    <XCircle size={14} />
                                    Үзээгүй
                                  </div>
                                  <p className="text-[10px] text-gray-500">
                                    Одоог хүртэл
                                  </p>
                                </div>
                              </div>
                            ))
                          )
                        ) : seenBy.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                            <AlertCircle
                              size={48}
                              className="mb-4 opacity-20"
                            />
                            <p className="font-bold">
                              Одоогоор үзсэн хэрэглэгч байхгүй байна.
                            </p>
                          </div>
                        ) : (
                          seenBy.map((seen, idx) => {
                            const user = csrs.find(
                              (item) => String(item.id) === String(seen.userId),
                            );
                            return (
                              <div
                                key={`admin-seen-detail-${seen.userId}-${idx}`}
                                className="flex items-center justify-between p-4 bg-gray-800/30 rounded-xl border border-gray-800"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-400">
                                    {(seen.userName || "?").charAt(0)}
                                  </div>
                                  <div>
                                    <p className="font-bold text-white">
                                      {seen.userName}
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <p className="text-[10px] text-blue-500 uppercase font-black">
                                        {user?.role || "CSR"}
                                      </p>
                                      <span className="w-1 h-1 bg-gray-700 rounded-full" />
                                      <p className="text-[10px] text-gray-500 uppercase font-black">
                                        {user?.lineType || "N/A"}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="flex items-center gap-1.5 text-green-500 text-xs font-bold mb-0.5">
                                    <CheckCircle2 size={14} />
                                    Үзсэн
                                  </div>
                                  <p className="text-[10px] text-gray-500">
                                    {new Date(seen.seenAt).toLocaleString()}
                                  </p>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </>
                  );
                })()}
              </motion.div>
            </div>
          )}

          {isAddingMaterial && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 overflow-hidden">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  setIsAddingMaterial(false);
                  setEditingMaterial(null);
                }}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown")
                    e.preventDefault();
                }}
                className="relative w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain custom-scrollbar bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl"
              >
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                  <BookOpen size={120} className="text-blue-500" />
                </div>

                <h2 className="text-2xl font-black text-white mb-6 relative">
                  {editingMaterial ? "Материал засах" : "Шинэ материал нэмэх"}
                </h2>
                <form
                  onSubmit={handleAddMaterial}
                  className="space-y-6 relative"
                >
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">
                        Гарчиг
                      </label>
                      <input
                        type="text"
                        value={newMaterial.title || ""}
                        onChange={(e) =>
                          setNewMaterial((prev) => ({
                            ...prev,
                            title: e.target.value,
                          }))
                        }
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="Материалын гарчиг..."
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">
                        Тайлбар
                      </label>
                      <textarea
                        value={newMaterial.description || ""}
                        onChange={(e) =>
                          setNewMaterial((prev) => ({
                            ...prev,
                            description: e.target.value,
                          }))
                        }
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 h-24 resize-none transition-colors"
                        placeholder="Материалын дэлгэрэнгүй..."
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">
                        Файл хуулах (Зураг, Видео, Файл)
                      </label>
                      <input
                        type="file"
                        ref={trainingFileRef}
                        onChange={(e) =>
                          setSelectedFile(e.target.files?.[0] || null)
                        }
                        className="hidden"
                        accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx"
                      />
                      <div
                        onClick={() => trainingFileRef.current?.click()}
                        className="w-full bg-gray-800/50 border-2 border-dashed border-gray-700 rounded-2xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-blue-500/50 hover:bg-gray-800 transition-all group"
                      >
                        {selectedFile ? (
                          <div className="flex flex-col items-center gap-2">
                            <CheckCircle className="text-green-500" size={32} />
                            <span className="text-sm font-bold text-white text-center line-clamp-1">
                              {selectedFile.name}
                            </span>
                            <span className="text-[10px] text-gray-500 uppercase">
                              {(selectedFile.size / (1024 * 1024)).toFixed(2)}{" "}
                              MB
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className="w-12 h-12 bg-gray-700 rounded-xl flex items-center justify-center group-hover:bg-blue-600/20 group-hover:text-blue-400 transition-all">
                              <Plus
                                size={24}
                                className="text-gray-400 group-hover:text-blue-400"
                              />
                            </div>
                            <div className="text-center">
                              <p className="text-sm font-bold text-gray-400">
                                Файл сонгох
                              </p>
                              <p className="text-[10px] text-gray-600 mt-1 uppercase tracking-widest">
                                Бүх төрлийн файл боломжтой
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">
                        Дуусах хугацаа
                      </label>
                      <input
                        type="datetime-local"
                        value={newMaterial.deadline || ""}
                        onChange={(e) =>
                          setNewMaterial((prev) => ({
                            ...prev,
                            deadline: e.target.value,
                          }))
                        }
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 transition-colors"
                        required
                      />
                    </div>
                  </div>
                  <div className="flex gap-4 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingMaterial(false);
                        setEditingMaterial(null);
                      }}
                      className="flex-1 py-4 bg-gray-800 text-white font-bold rounded-xl hover:bg-gray-700 transition-all"
                    >
                      Цуцлах
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-500 transition-all shadow-lg"
                    >
                      {editingMaterial ? "Хадгалах" : "Нэмэх"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {/* Add User Modal */}
          {isAddingUser && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsAddingUser(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl"
              >
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-2xl font-black text-white">
                    Ажилтан нэмэх
                  </h2>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSecureConfirm(
                      "Ажилтан нэмэх баталгаажуулалт",
                      `Шинэ ажилтныг бүртгэхийн тулд өөрийн нэвтрэх нэр болон нууц үгээ оруулна уу.`,
                      handleAddUser,
                    );
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      АЖИЛТНЫ КОД
                    </label>
                    <input
                      type="text"
                      placeholder="EMP001"
                      value={newUser.code || ""}
                      onChange={(e) =>
                        setNewUser({ ...newUser, code: e.target.value })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      USER
                    </label>
                    <input
                      type="text"
                      value={newUser.name || ""}
                      onChange={(e) =>
                        setNewUser({ ...newUser, name: e.target.value })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      ИМЭЙЛ ХАЯГ
                    </label>
                    <input
                      type="email"
                      placeholder="user@example.com"
                      value={newUser.email || ""}
                      onChange={(e) =>
                        setNewUser({ ...newUser, email: e.target.value })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      SUPERVISOR / АХЛАХ АЖИЛТАН
                    </label>
                    <input
                      type="text"
                      placeholder="Ахлах ажилтны нэр"
                      value={newUser.supervisorName || ""}
                      onChange={(e) =>
                        setNewUser({ ...newUser, supervisorName: e.target.value })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      СЕГМЕНТ
                    </label>
                    <select
                      value={newUser.lineType || ""}
                      onChange={(e) =>
                        setNewUser({ ...newUser, lineType: e.target.value })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                      required
                    >
                      <option value="">Сонгох...</option>
                      {segments.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      АЖЛЫН ТӨРӨЛ
                    </label>
                    <select
                      value={newUser.employmentType || "Full Time"}
                      onChange={(e) =>
                        setNewUser({
                          ...newUser,
                          employmentType: e.target.value as any,
                        })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="Full Time">Full Time</option>
                      <option value="Part Time">Part Time</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      LOCATION
                    </label>
                    <select
                      value={normalizeEmployeeLocation(newUser.location)}
                      onChange={(e) =>
                        setNewUser({ ...newUser, location: e.target.value })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                      required
                    >
                      <option value="">Сонгох...</option>
                      {EMPLOYEE_LOCATIONS.map((location) => (
                        <option key={location} value={location}>
                          {location}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-4 pt-6">
                    <button
                      type="button"
                      onClick={() => setIsAddingUser(false)}
                      className="flex-1 py-4 bg-gray-800 text-white rounded-2xl font-bold hover:bg-gray-700 transition-all uppercase tracking-widest text-[10px]"
                    >
                      Болих
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-4 bg-blue-600 text-white font-black uppercase tracking-widest rounded-2xl hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/40 text-[10px]"
                    >
                      Нэмэх
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {isBulkUploadOpen && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeBulkUploadModal}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 p-8 shadow-2xl"
              >
                <div className="mb-6 flex items-start justify-between gap-6">
                  <div>
                    <h2 className="text-2xl font-black text-white">
                      Олноор нэмэх
                    </h2>
                    <p className="mt-1 text-xs font-bold text-gray-500">
                      Excel файл upload хийгээд мөрүүдийг шалгасны дараа
                      ажилтнуудыг бүртгэнэ.
                    </p>
                  </div>
                  <button
                    onClick={closeBulkUploadModal}
                    className="rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-800 hover:text-white"
                  >
                    <X size={22} />
                  </button>
                </div>

                <input
                  ref={bulkUploadInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleBulkUploadFile}
                  className="hidden"
                />

                <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
                  <button
                    type="button"
                    onClick={() => bulkUploadInputRef.current?.click()}
                    className="flex h-40 flex-col items-center justify-center rounded-3xl border border-dashed border-blue-500/40 bg-blue-600/10 text-blue-300 transition-all hover:border-blue-400 hover:bg-blue-600/15"
                  >
                    <Upload size={34} />
                    <span className="mt-3 text-xs font-black uppercase tracking-widest">
                      Excel file upload
                    </span>
                    <span className="mt-1 text-[10px] font-bold text-gray-500">
                      .xlsx, .xls, .csv
                    </span>
                  </button>

                  <div className="rounded-3xl border border-gray-800 bg-black/20 p-5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                        Загварын баганууд
                      </p>
                      <button
                        type="button"
                        onClick={handleDownloadBulkUploadTemplate}
                        className="rounded-xl bg-green-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-green-400 transition-all hover:bg-green-500 hover:text-white"
                      >
                        Загвар татах
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {[
                        "No.",
                        "Ажилтны код",
                        "User",
                        "e-mail",
                        "segment",
                        "Part/Full",
                        "Location",
                        "Supervisor",
                      ].map((column) => (
                        <span
                          key={column}
                          className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-300"
                        >
                          {column}
                        </span>
                      ))}
                    </div>
                    <p className="mt-3 text-[10px] font-bold leading-relaxed text-gray-500">
                      Бүх багана заавал бөглөгдөнө. Location нь зөвхөн Ulaanbaatar эсвэл Darkhan байна. Supervisor баганад ахлах ажилтны нэрийг бичнэ.
                    </p>
                  </div>
                </div>

                {bulkUploadError && (
                  <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-xs font-bold text-red-300">
                    {bulkUploadError}
                  </div>
                )}

                {bulkUploadFileName && (
                  <div className="mb-4 flex items-center justify-between rounded-2xl border border-gray-800 bg-gray-950/50 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <FileText size={18} className="text-blue-400" />
                      <span className="text-sm font-black text-white">
                        {bulkUploadFileName}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest">
                      <span className="text-green-400">
                        {bulkUsers.filter((user) => !user.error).length} зөв
                      </span>
                      <span className="text-red-400">
                        {bulkUsers.filter((user) => user.error).length} алдаатай
                      </span>
                    </div>
                  </div>
                )}

                {bulkUsers.length > 0 ? (
                  <div className="min-h-0 flex-1 overflow-auto rounded-3xl border border-gray-800">
                    <table className="w-full min-w-[880px] text-left">
                      <thead className="sticky top-0 bg-gray-900">
                        <tr className="border-b border-gray-800">
                          <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">
                            Мөр
                          </th>
                          <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">
                            Код
                          </th>
                          <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">
                            User
                          </th>
                          <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">
                            e-mail
                          </th>
                          <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">
                            segment
                          </th>
                          <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">
                            Part/Full
                          </th>
                          <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">
                            Location
                          </th>
                          <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">
                            Supervisor
                          </th>
                          <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">
                            Төлөв
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {bulkUsers.map((user) => (
                          <tr
                            key={`bulk-upload-${user.rowNumber}`}
                            className={
                              user.error ? "bg-red-500/5" : "bg-green-500/0"
                            }
                          >
                            <td className="px-5 py-4 text-xs font-black text-gray-500">
                              {user.rowNumber}
                            </td>
                            <td className="px-5 py-4 text-sm font-black text-blue-400">
                              {user.code || "-"}
                            </td>
                            <td className="px-5 py-4 text-sm font-black text-white">
                              {user.name || "-"}
                            </td>
                            <td className="px-5 py-4 text-sm font-bold text-gray-300">
                              {user.email || "-"}
                            </td>
                            <td className="px-5 py-4 text-sm font-black text-white">
                              {user.lineType || "-"}
                            </td>
                            <td className="px-5 py-4 text-sm font-black text-white">
                              {user.employmentType || "Full Time"}
                            </td>
                            <td className="px-5 py-4 text-sm font-black text-white">
                              {user.location || "-"}
                            </td>
                            <td className="px-5 py-4 text-sm font-black text-white">
                              {user.supervisorName || "-"}
                            </td>
                            <td className="px-5 py-4">
                              {user.error ? (
                                <span className="rounded-lg bg-red-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-red-300">
                                  {user.error}
                                </span>
                              ) : (
                                <span className="rounded-lg bg-green-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-green-300">
                                  Бэлэн
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex min-h-48 flex-1 items-center justify-center rounded-3xl border border-dashed border-gray-800 text-center">
                    <p className="text-sm font-bold text-gray-600">
                      Upload хийсэн Excel мөрүүд энд preview байдлаар харагдана.
                    </p>
                  </div>
                )}

                {(() => {
                  const validCount = bulkUsers.filter(
                    (user) =>
                      !user.error &&
                      user.code &&
                      user.name &&
                      user.email &&
                      user.lineType &&
                      user.location &&
                      user.supervisorName,
                  ).length;
                  return (
                    <div className="mt-6 flex gap-4">
                      <button
                        type="button"
                        onClick={closeBulkUploadModal}
                        className="flex-1 rounded-2xl bg-gray-800 py-4 text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-gray-700"
                      >
                        Болих
                      </button>
                      <button
                        type="button"
                        disabled={validCount === 0}
                        onClick={() =>
                          handleSecureConfirm(
                            "Ажилтнуудыг олноор нэмэх",
                            `Нийт ${validCount} ажилтныг Excel файлаас бүртгэхийн тулд өөрийн нэвтрэх нэр болон нууц үгээ оруулна уу.`,
                            handleBulkAdd,
                          )
                        }
                        className="flex-1 rounded-2xl bg-blue-600 py-4 text-[10px] font-black uppercase tracking-widest text-white shadow-xl shadow-blue-900/40 transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-600 disabled:shadow-none"
                      >
                        Бүртгэх
                      </button>
                    </div>
                  );
                })()}
              </motion.div>
            </div>
          )}

          {/* Edit User Modal */}
          {isEditingUser && editingUser && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsEditingUser(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl"
              >
                <h2 className="text-2xl font-black text-white mb-6">
                  Ажилтан засах
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      АЖИЛТНЫ КОД
                    </label>
                    <input
                      type="text"
                      value={editingUser.code || ""}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, code: e.target.value })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      USER
                    </label>
                    <input
                      type="text"
                      value={editingUser.name || ""}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, name: e.target.value })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      ИМЭЙЛ ХАЯГ
                    </label>
                    <input
                      type="email"
                      value={editingUser.email || ""}
                      onChange={(e) =>
                        setEditingUser({
                          ...editingUser,
                          email: e.target.value,
                        })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      SUPERVISOR / АХЛАХ АЖИЛТАН
                    </label>
                    <input
                      type="text"
                      value={editingUser.supervisorName || ""}
                      onChange={(e) =>
                        setEditingUser({
                          ...editingUser,
                          supervisorName: e.target.value,
                        })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      СЕГМЕНТ
                    </label>
                    <select
                      value={editingUser.lineType || ""}
                      onChange={(e) =>
                        setEditingUser({
                          ...editingUser,
                          lineType: e.target.value,
                        })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Сонгох...</option>
                      {segments.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      АЖЛЫН ТӨРӨЛ
                    </label>
                    <select
                      value={editingUser.employmentType || "Full Time"}
                      onChange={(e) =>
                        setEditingUser({
                          ...editingUser,
                          employmentType: e.target.value as any,
                        })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="Full Time">Full Time</option>
                      <option value="Part Time">Part Time</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      LOCATION
                    </label>
                    <select
                      value={normalizeEmployeeLocation(editingUser.location)}
                      onChange={(e) =>
                        setEditingUser({
                          ...editingUser,
                          location: e.target.value,
                        })
                      }
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                      required
                    >
                      <option value="">Сонгох...</option>
                      {EMPLOYEE_LOCATIONS.map((location) => (
                        <option key={location} value={location}>
                          {location}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-4 pt-6">
                    <button
                      onClick={() => setIsEditingUser(false)}
                      className="flex-1 py-4 bg-gray-800 text-white rounded-2xl font-bold hover:bg-gray-700 transition-all uppercase tracking-widest text-[10px]"
                    >
                      Болих
                    </button>
                    <button
                      onClick={() =>
                        handleSecureConfirm(
                          "Мэдээлэл шинэчлэх",
                          `'${editingUser.name}' ажилтны мэдээллийг шинэчлэхийн тулд өөрийн нэвтрэх нэр болон нууц үгээ оруулна уу.`,
                          handleUpdateUser,
                        )
                      }
                      className="flex-1 py-4 bg-blue-600 text-white font-black uppercase tracking-widest rounded-2xl hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/40 text-[10px]"
                    >
                      Хадгалах
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}

          {/* Add Segment Modal */}
          {isAddingSegment && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsAddingSegment(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl"
              >
                <h2 className="text-2xl font-black text-white mb-6">
                  Сегмент нэмэх
                </h2>
                <form onSubmit={handleAddSegment} className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      Сегментийн нэр
                    </label>
                    <input
                      type="text"
                      value={newSegment}
                      onChange={(e) => setNewSegment(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                      placeholder="Жишээ: High Priority, Retail..."
                      required
                    />
                  </div>
                  <div className="flex gap-3 pt-6">
                    <button
                      type="button"
                      onClick={() => setIsAddingSegment(false)}
                      className="flex-1 py-3 bg-gray-800 text-white rounded-xl font-bold"
                    >
                      Болих
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-900/40"
                    >
                      Нэмэх
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {/* Shift Template Management Modal */}
          {isManagingShiftTemplates && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsManagingShiftTemplates(false)}
                className="absolute inset-0 bg-black/90 backdrop-blur-md"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-2xl bg-gray-900 border border-white/10 rounded-[2.5rem] p-10 shadow-2xl flex flex-col max-h-[85vh]"
              >
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-3xl font-black text-white">
                    Shift Загварууд
                  </h2>
                  {!isAddingTemplate && (
                    <button
                      onClick={() => setIsAddingTemplate(true)}
                      className="px-6 py-3 bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-500 transition-all flex items-center gap-2"
                    >
                      <Plus size={14} />
                      Загвар нэмэх
                    </button>
                  )}
                </div>

                {isAddingTemplate && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8 p-6 bg-blue-600/5 border border-blue-500/20 rounded-3xl space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">
                        Шинэ загвар үүсгэх
                      </p>
                      <button
                        onClick={() => setIsAddingTemplate(false)}
                        className="text-gray-500 hover:text-white"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={newTemplateTime}
                        onChange={(e) =>
                          setNewTemplateTime(
                            sanitizeShiftTemplateInput(e.target.value),
                          )
                        }
                        placeholder="Жишээ: 08-17 эсвэл амралт"
                        maxLength={10}
                        className="flex-1 bg-black/40 border border-white/10 rounded-2xl py-4 px-6 text-white focus:outline-none focus:border-blue-500 font-bold"
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          const normalizedTime = normalizeShiftTime(newTemplateTime);
                          if (!isValidShiftTemplateValue(normalizedTime)) {
                            alert("Зөвхөн HH-HH формат эсвэл \"Амралт\" оруулна уу.");
                            return;
                          }
                          if (
                            shiftTemplates.some(
                              (template) =>
                                getShiftTimeKey(template.time) ===
                                normalizedTime,
                            )
                          ) {
                            alert("Энэ shift загвар бүртгэлтэй байна.");
                            return;
                          }
                          if (normalizedTime) {
                            const newTemplates = [
                              ...shiftTemplates,
                              {
                                id: Math.random().toString(36).substr(2, 9),
                                time: normalizedTime,
                                label: normalizedTime,
                              },
                            ];
                            setShiftTemplates(newTemplates);
                            setLocalData("shiftTemplates", newTemplates);
                            setNewTemplateTime("");
                            setIsAddingTemplate(false);
                          }
                        }}
                        className="px-8 py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-blue-500 transition-all"
                      >
                        Хадгалах
                      </button>
                    </div>
                  </motion.div>
                )}

                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3 min-h-0">
                  {[...shiftTemplates]
                    .sort(
                      (a, b) =>
                        getStartTimeValue(a.time) - getStartTimeValue(b.time),
                    )
                    .map((template) => (
                      <div
                        key={template.id}
                        className="flex items-center justify-between p-6 bg-white/5 border border-white/5 rounded-3xl group"
                      >
                        <div className="flex items-center gap-6">
                          <div className="w-12 h-12 rounded-2xl bg-blue-600/10 flex items-center justify-center text-blue-400 border border-blue-500/20">
                            <Clock size={24} />
                          </div>
                          <div>
                            <p className="text-lg font-black text-white">
                              {template.time}
                            </p>
                            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                              {template.time === REST_SHIFT_LABEL ? "Амрах slot тохируулна" : `${getHoursForShift(template.time)} цаг`}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            const newTemplates = shiftTemplates.filter(
                              (item) => item.id !== template.id,
                            );
                            setShiftTemplates(newTemplates);
                            setLocalData("shiftTemplates", newTemplates);
                          }}
                          className="p-3 text-gray-600 hover:text-red-500 hover:bg-red-500/10 rounded-2xl transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash size={20} />
                        </button>
                      </div>
                    ))}
                </div>

                <button
                  onClick={() => setIsManagingShiftTemplates(false)}
                  className="mt-8 w-full py-5 bg-gray-800 text-white rounded-3xl font-black uppercase tracking-widest text-xs hover:bg-gray-700 transition-all"
                >
                  Хаах
                </button>
              </motion.div>
            </div>
          )}

          {/* Shift Editing Modal */}
          {isEditingShiftModal && editingShiftData && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  setIsEditingShiftModal(false);
                  setBulkShiftDateKeys([]);
                }}
                className="absolute inset-0 bg-black/90 backdrop-blur-md"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-xl bg-gray-900 border border-white/10 rounded-[2.5rem] p-10 shadow-2xl"
              >
                <h2 className="text-3xl font-black text-white mb-2">
                  {editingShiftData.id ? "Ээлж засах" : "Шинэ ээлж үүсгэх"}
                </h2>
                <p className="text-gray-400 mb-8 text-[10px] font-black uppercase tracking-widest">
                  {bulkShiftDateKeys.length > 1 && !editingShiftData.id
                    ? `${bulkShiftDateKeys.length} өдөрт оруулна`
                    : `${editingShiftData.dateKey} өдөр`}
                </p>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      Ээлжийн цаг (Manual or Select)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editingShiftData.time}
                        onChange={(e) =>
                          setEditingShiftData({
                            ...editingShiftData,
                            time: sanitizeShiftTemplateInput(e.target.value),
                          })
                        }
                        className="flex-1 bg-black/40 border border-white/5 rounded-2xl py-4 px-6 text-white focus:outline-none focus:border-blue-500 font-bold"
                        placeholder="Жишээ: 09-18 эсвэл амралт"
                        maxLength={10}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                      Түгээмэл цагууд
                    </label>
                    <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                      {[...shiftTemplates]
                        .sort(
                          (a, b) =>
                            getStartTimeValue(a.time) -
                            getStartTimeValue(b.time),
                        )
                        .map((t) => {
                          const normalizedTemplateTime = normalizeShiftTime(
                            t.time,
                          );
                          const isTimeAlreadyUsed = schedules[
                            editingShiftData.dateKey
                          ]?.shifts.some(
                            (s: any) =>
                              getShiftTimeKey(s.time) ===
                                normalizedTemplateTime &&
                              s.segment === editingShiftData.segment &&
                              s.employmentType ===
                                editingShiftData.employmentType &&
                              s.id !== editingShiftData.id,
                          );
                          return (
                            <button
                              key={t.id}
                              onClick={() => {
                                if (isTimeAlreadyUsed) {
                                  alert(
                                    "Энэ цаг нэмэгдсэн байна. Нэг shift дээр 2 захиалга авах бол Квот (Slots)-ыг нэмнэ үү.",
                                  );
                                  return;
                                }
                                setEditingShiftData({
                                  ...editingShiftData,
                                  time: normalizedTemplateTime,
                                });
                              }}
                              className={`p-2 rounded-xl text-[10px] font-bold border transition-all ${
                                normalizeShiftTime(editingShiftData.time) ===
                                normalizedTemplateTime
                                  ? "bg-blue-600 border-blue-400 text-white"
                                  : isTimeAlreadyUsed
                                    ? "bg-red-500/10 border-red-500/20 text-red-400 cursor-not-allowed opacity-50"
                                    : "bg-white/5 border-white/5 text-gray-400 hover:text-white hover:border-white/10"
                              }`}
                              title={
                                isTimeAlreadyUsed
                                  ? "Энэ цаг аль хэдийн нэмэгдсэн байна"
                                  : ""
                              }
                            >
                              {normalizedTemplateTime}
                              {isTimeAlreadyUsed && (
                                <span className="block text-[8px] mt-0.5 opacity-70">
                                  НЭМЭГДСЭН
                                </span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">
                        Квот (Slots)
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={editingShiftData.totalSlots}
                        onChange={(e) => {
                          const nextTotal = Math.max(
                            1,
                            parseInt(e.target.value) || 1,
                          );
                          setEditingShiftData({
                            ...editingShiftData,
                            totalSlots: nextTotal,
                            bookingWaves: editingShiftData.bookingWaves?.length
                              ? editingShiftData.bookingWaves
                              : createDefaultBookingWaves(
                                  nextTotal,
                                  false,
                                  bookingOpenAtInput,
                                ),
                          });
                        }}
                        className="w-full bg-black/40 border border-white/5 rounded-2xl py-4 px-6 text-white focus:outline-none focus:border-blue-500 font-bold"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-3xl border border-white/5 bg-black/20 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">
                          Захиалга нээх бүлэг
                        </p>
                        <p className="mt-1 text-[10px] font-bold text-gray-500">
                          Нэг shift-ийн slot-ыг өглөө/орой гэх мэтээр хувааж
                          нээнэ.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const current = editingShiftData.bookingWaves?.length
                            ? editingShiftData.bookingWaves
                            : createDefaultBookingWaves(
                                editingShiftData.totalSlots,
                                false,
                                bookingOpenAtInput,
                              );
                          setEditingShiftData({
                            ...editingShiftData,
                            bookingWaves: [
                              ...current,
                              createBookingWave(
                                `Эрх ${current.length + 1}`,
                                1,
                                false,
                                bookingOpenAtInput,
                              ),
                            ],
                          });
                        }}
                        className="rounded-xl bg-blue-600/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-blue-300 hover:bg-blue-600 hover:text-white"
                      >
                        Эрх нэмэх
                      </button>
                    </div>

                    {(editingShiftData.bookingWaves?.length
                      ? editingShiftData.bookingWaves
                      : createDefaultBookingWaves(
                          editingShiftData.totalSlots,
                          false,
                          bookingOpenAtInput,
                        )
                    ).map((wave, index) => (
                      <div
                        key={wave.id}
                        className="grid grid-cols-[1.2fr_90px_34px] items-center gap-2"
                      >
                        <input
                          value={wave.name}
                          onChange={(event) => {
                            const waves = [
                              ...(editingShiftData.bookingWaves?.length
                                ? editingShiftData.bookingWaves
                                : createDefaultBookingWaves(
                                    editingShiftData.totalSlots,
                                    false,
                                    bookingOpenAtInput,
                                  )),
                            ];
                            waves[index] = {
                              ...waves[index],
                              name: event.target.value,
                            };
                            setEditingShiftData({
                              ...editingShiftData,
                              bookingWaves: waves,
                            });
                          }}
                          className="rounded-xl border border-white/5 bg-gray-950 px-4 py-3 text-xs font-bold text-white outline-none focus:border-blue-500"
                        />
                        <input
                          type="number"
                          min={0}
                          value={wave.slotLimit}
                          onChange={(event) => {
                            const waves = [
                              ...(editingShiftData.bookingWaves?.length
                                ? editingShiftData.bookingWaves
                                : createDefaultBookingWaves(
                                    editingShiftData.totalSlots,
                                    false,
                                    bookingOpenAtInput,
                                  )),
                            ];
                            waves[index] = {
                              ...waves[index],
                              slotLimit: Math.max(
                                0,
                                parseInt(event.target.value) || 0,
                              ),
                            };
                            setEditingShiftData({
                              ...editingShiftData,
                              bookingWaves: waves,
                            });
                          }}
                          className="rounded-xl border border-white/5 bg-gray-950 px-3 py-3 text-center text-xs font-black text-white outline-none focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const waves = (
                              editingShiftData.bookingWaves?.length
                                ? editingShiftData.bookingWaves
                                : createDefaultBookingWaves(
                                    editingShiftData.totalSlots,
                                    false,
                                    bookingOpenAtInput,
                                  )
                            ).filter((_, waveIndex) => waveIndex !== index);
                            setEditingShiftData({
                              ...editingShiftData,
                              bookingWaves: waves.length
                                ? waves
                                : createDefaultBookingWaves(
                                    editingShiftData.totalSlots,
                                    false,
                                    bookingOpenAtInput,
                                  ),
                            });
                          }}
                          className="rounded-xl bg-red-500/10 p-3 text-red-400 hover:bg-red-500 hover:text-white"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}

                    <div
                      className={`rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-widest ${sumWaveSlots(editingShiftData.bookingWaves?.length ? editingShiftData.bookingWaves : createDefaultBookingWaves(editingShiftData.totalSlots, false, bookingOpenAtInput)) > editingShiftData.totalSlots ? "bg-red-500/10 text-red-300 border border-red-500/20" : "bg-white/5 text-gray-400 border border-white/5"}`}
                    >
                      Хуваарилсан эрх:{" "}
                      {sumWaveSlots(
                        editingShiftData.bookingWaves?.length
                          ? editingShiftData.bookingWaves
                          : createDefaultBookingWaves(
                              editingShiftData.totalSlots,
                              false,
                              bookingOpenAtInput,
                            ),
                      )}{" "}
                      / {editingShiftData.totalSlots}
                    </div>
                  </div>

                  {editingShiftData.time && (
                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex items-center justify-between">
                      <span className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">
                        Тооцоолсон ажлын цаг:
                      </span>
                      <span className="text-lg font-black text-white">
                        {getHoursForShift(editingShiftData.time)} цаг
                      </span>
                    </div>
                  )}

                  <div className="flex gap-4 pt-4">
                    <button
                      onClick={() => {
                        setIsEditingShiftModal(false);
                        setBulkShiftDateKeys([]);
                      }}
                      className="flex-1 py-5 bg-gray-800 text-white rounded-3xl font-black uppercase tracking-widest text-xs hover:bg-gray-700 transition-all"
                    >
                      Болих
                    </button>
                    <button
                      onClick={() => {
                        const newSchedules = { ...schedules };
                        const {
                          dateKey,
                          id,
                          segment,
                          employmentType,
                          totalSlots,
                        } = editingShiftData;
                        const time = normalizeShiftTime(editingShiftData.time);
                        const targetDateKeys =
                          bulkShiftDateKeys.length > 0 && !id
                            ? bulkShiftDateKeys
                            : [dateKey];

                        if (
                          targetDateKeys.some((targetDateKey) =>
                            isPastScheduleDate(targetDateKey),
                          )
                        ) {
                          alert("Өнгөрсөн өдрийн хуваарь засах боломжгүй.");
                          return;
                        }

                        if (!isValidShiftTemplateValue(time)) {
                          alert("Зөвхөн HH-HH формат эсвэл \"Амралт\" оруулна уу.");
                          return;
                        }

                        const cleanTotalSlots = Math.max(
                          1,
                          Number(totalSlots) || 1,
                        );
                        const cleanWaves = (
                          editingShiftData.bookingWaves?.length
                            ? editingShiftData.bookingWaves
                            : createDefaultBookingWaves(
                                cleanTotalSlots,
                                false,
                                bookingOpenAtInput,
                              )
                        )
                          .map((wave) => ({
                            ...wave,
                            id:
                              wave.id ||
                              Math.random().toString(36).substr(2, 9),
                            name: (wave.name || "").trim() || "Захиалах эрх",
                            slotLimit: Math.max(0, Number(wave.slotLimit) || 0),
                            bookingOpen: Boolean(wave.bookingOpen),
                            bookingOpenAt: wave.bookingOpenAt || "",
                          }))
                          .filter((wave) => wave.slotLimit > 0);

                        if (cleanWaves.length === 0) {
                          alert(
                            "Захиалга нээх эрхийн slot хамгийн багадаа 1 байх ёстой.",
                          );
                          return;
                        }

                        const allocatedSlots = sumWaveSlots(cleanWaves);
                        if (allocatedSlots > cleanTotalSlots) {
                          alert(
                            `Захиалга нээх бүлгийн нийт slot (${allocatedSlots}) нь shift-ийн нийт квот (${cleanTotalSlots})-оос их байна.`,
                          );
                          return;
                        }

                        const duplicateDate = targetDateKeys.find(
                          (targetDateKey) =>
                            newSchedules[targetDateKey]?.shifts?.some(
                              (s: any) =>
                                normalizeShiftTime(s.time) === time &&
                                s.segment === segment &&
                                s.employmentType === employmentType &&
                                s.id !== id,
                            ),
                        );
                        if (duplicateDate) {
                          alert(
                            `${duplicateDate} өдөр ${segment} ${employmentType} зориулалттай ${time} цагийн ээлж аль хэдийн нэмэгдсэн байна.`,
                          );
                          return;
                        }

                        targetDateKeys.forEach((targetDateKey) => {
                          if (!newSchedules[targetDateKey])
                            newSchedules[targetDateKey] = { shifts: [] };
                          const updatedShifts = [
                            ...(newSchedules[targetDateKey].shifts || []),
                          ];

                          if (id && targetDateKey === dateKey) {
                            const idx = updatedShifts.findIndex(
                              (s: any) => s.id === id,
                            );
                            if (idx !== -1) {
                              updatedShifts[idx] = {
                                ...updatedShifts[idx],
                                time,
                                isRest: time === REST_SHIFT_LABEL,
                                segment,
                                employmentType,
                                totalSlots: cleanTotalSlots,
                                bookingWaves: cleanWaves,
                              };
                            }
                          } else {
                            updatedShifts.push({
                              id: Math.random().toString(36).substr(2, 9),
                              time,
                              isRest: time === REST_SHIFT_LABEL,
                              totalSlots: cleanTotalSlots,
                              bookedSlots: 0,
                              segment,
                              employmentType,
                              bookingWaves: cleanWaves.map((wave) => ({
                                ...wave,
                                id: Math.random().toString(36).substr(2, 9),
                              })),
                              bookedBy: [],
                            });
                          }

                          newSchedules[targetDateKey] = {
                            ...newSchedules[targetDateKey],
                            shifts: updatedShifts,
                          };
                        });

                        // Auto-add new time pattern to templates if not exists
                        if (
                          time &&
                          !shiftTemplates.some(
                            (st) => normalizeShiftTime(st.time) === time,
                          )
                        ) {
                          const newTemplates = [
                            ...shiftTemplates,
                            {
                              id: Math.random().toString(36).substr(2, 9),
                              time,
                              label: time,
                            },
                          ];
                          setShiftTemplates(newTemplates);
                          setLocalData("shiftTemplates", newTemplates);
                        }

                        void persistSchedules(newSchedules, targetDateKeys);
                        setBulkShiftDateKeys([]);
                        setIsEditingShiftModal(false);
                      }}
                      className="flex-1 py-5 bg-blue-600 text-white rounded-3xl font-black uppercase tracking-widest text-xs hover:bg-blue-500 transition-all shadow-2xl shadow-blue-500/20"
                    >
                      Хадгалах
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
