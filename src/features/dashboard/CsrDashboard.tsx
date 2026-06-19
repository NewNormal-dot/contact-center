import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LazyMedia } from '../../components/LazyMedia';
import Sidebar from '../../components/Sidebar';
import ChatWindow from '../chat/ChatWindow';
import { DigitalClock } from '../../components/DigitalClock';
import { MessageCircle, Bell, Search, Calendar, Clock, CheckCircle2, ChevronDown, Sparkles, ArrowRightLeft, Edit, History, Palmtree, X, BookOpen, AlertCircle, FileText, Download, ExternalLink, Plus, Filter, Lock } from 'lucide-react';
import { Notification as AppNotification, TrainingMaterial, VacationQuota, VacationRequest, TradeRequest, HourlyLeaveRequest } from '../../types';
import { logAction } from '../../utils/logger';
import { getLocalData, setLocalData, addLocalItem, updateLocalItem, deleteLocalItem } from '../../utils/localStorage';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/api-client';
import { SHOW_VACATION_FEATURE } from '../../config/features';

const WEEKDAYS = ['Ням', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба'];
const MONTHS = [
  '1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар',
  '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар'
];
const ENG_MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];

function formatMonthEng(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  return `${ENG_MONTHS[month - 1]} ${year}`;
}

function formatDateDisplay(date: Date) {
  const month = ENG_MONTHS[date.getMonth()];
  const day = date.getDate();
  const dayName = WEEKDAYS[date.getDay()];
  return `${month} ${day}, ${dayName}`;
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMonthKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

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
  `${segment || 'All'}|${employmentType || 'Full Time'}`;

const makeMonthlyFontHourKey = (monthKey: string, segment: string, employmentType: string) =>
  `${monthKey}|${makeSegmentTypeKey(segment, employmentType)}`;

const normalizeWeeklyShiftRule = (value: any): WeeklyShiftRule => {
  const rawHourCounts = value?.hourCounts && typeof value.hourCounts === 'object' ? value.hourCounts : {};
  const hourCounts: Record<string, number> = {};

  Object.entries(rawHourCounts).forEach(([hour, count]) => {
    const normalizedHour = String(hour);
    if (!/^(?:[4-9]|rest)$/.test(normalizedHour)) return;
    hourCounts[normalizedHour] = Math.max(0, Math.min(31, Number(count) || 0));
  });

  if (value?.sixHourShifts !== undefined && hourCounts['6'] === undefined) {
    hourCounts['6'] = Math.max(0, Math.min(31, Number(value.sixHourShifts) || 0));
  }
  if (value?.sevenHourShifts !== undefined && hourCounts['7'] === undefined) {
    hourCounts['7'] = Math.max(0, Math.min(31, Number(value.sevenHourShifts) || 0));
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

const getWeekStartDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setDate(date.getDate() + diffToMonday);
  return formatDateKey(date);
};

const getWeekDateKeys = (dateKey: string) => {
  const [year, month, day] = getWeekStartDateKey(dateKey).split('-').map(Number);
  const start = new Date(year, month - 1, day);
  return Array.from({ length: 7 }, (_, index) => {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    return formatDateKey(current);
  });
};

// Generate display days: 7 days past, Today, and until the Sunday of the next week
function generateFullScheduleWindow(referenceDate: Date) {
  const days = [];
  const refStartOfDay = new Date(referenceDate);
  refStartOfDay.setHours(0, 0, 0, 0);

  // Calculate days until the Sunday of the next week
  const dayOfWeek = refStartOfDay.getDay(); // 0 (Sun) to 6 (Sat)
  const daysToThisSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const totalFutureDays = daysToThisSunday + 7;

  // Start from 7 days ago
  for (let i = -7; i <= totalFutureDays; i++) {
    const date = new Date(refStartOfDay);
    date.setDate(refStartOfDay.getDate() + i);
    
    const isToday = i === 0;
    const isYesterday = i === -1;
    const isTomorrow = i === 1;
    const isPast = i < 0;

    days.push({ date, isToday, isTomorrow, isYesterday, isPast });
  }
  return days;
}

interface Shift {
  id: string;
  time: string;
  totalSlots: number;
  bookedSlots: number;
  isBookedByMe: boolean;
  bookedBy?: { userId: string, userName: string, userCode?: string, bookedAt?: string, bookedByAdmin?: string, bookingWaveId?: string, bookingWaveName?: string }[];
  segment: string;
  employmentType?: string;
  bookingWaves?: BookingWave[];
}

interface BookingWave {
  id: string;
  name: string;
  slotLimit: number;
  bookingOpen: boolean;
  bookingOpenAt?: string;
  bookingCloseAt?: string;
}

interface DayData {
  shifts: Shift[];
  holidayName?: string;
  bookingOpen?: boolean;
  bookingOpenAt?: string;
  bookingCloseAt?: string;
}


const getBookingWavesForShift = (
  shift: Shift | any,
  dayBookingOpen = false,
  dayBookingOpenAt = '',
  dayBookingCloseAt = '',
): BookingWave[] => {
  const existing = Array.isArray(shift?.bookingWaves) ? shift.bookingWaves : [];
  const normalized = existing
    .map((wave: any, index: number) => ({
      id: String(wave.id || `wave-${index + 1}`),
      name: String(wave.name || `Эрх ${index + 1}`),
      slotLimit: Math.max(0, Number(wave.slotLimit ?? wave.slots ?? wave.capacity ?? 0) || 0),
      bookingOpen: Boolean(wave.bookingOpen),
      bookingOpenAt: wave.bookingOpenAt || '',
      bookingCloseAt: wave.bookingCloseAt || '',
    }))
    .filter((wave: BookingWave) => wave.slotLimit > 0);

  if (normalized.length > 0) return normalized;

  return [{
    id: 'default',
    name: 'Нийт захиалах эрх',
    slotLimit: Math.max(1, Number(shift?.totalSlots) || 1),
    bookingOpen: Boolean(dayBookingOpen),
    bookingOpenAt: dayBookingOpenAt || '',
    bookingCloseAt: dayBookingCloseAt || '',
  }];
};

const getTimestamp = (value?: string) => {
  if (!value) return NaN;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? NaN : time;
};

const formatCountdown = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} өдөр`);
  if (hours > 0) parts.push(`${hours} цаг`);
  if (minutes > 0) parts.push(`${minutes} минут`);
  parts.push(`${seconds} секунд`);
  return parts.join(' ');
};

const getWaveAccessState = (wave: BookingWave, now = Date.now()) => {
  if (!wave.bookingOpen) {
    return { state: 'closed' as const, label: 'Хаалттай', countdown: '' };
  }

  const openAt = getTimestamp(wave.bookingOpenAt);
  const closeAt = getTimestamp(wave.bookingCloseAt);

  if (!Number.isNaN(closeAt) && closeAt <= now) {
    return { state: 'expired' as const, label: 'Хаагдсан', countdown: '' };
  }

  if (!Number.isNaN(openAt) && openAt > now) {
    const countdown = formatCountdown(openAt - now);
    return {
      state: 'scheduled' as const,
      label: `Нээгдэхэд ${countdown}`,
      countdown,
      targetTime: openAt,
    };
  }

  if (!Number.isNaN(closeAt)) {
    const countdown = formatCountdown(closeAt - now);
    return {
      state: 'open' as const,
      label: `Хаагдахад ${countdown}`,
      countdown,
      targetTime: closeAt,
    };
  }

  return { state: 'open' as const, label: 'Нээлттэй', countdown: '' };
};

const isWaveCurrentlyOpen = (wave: BookingWave, now = Date.now()) => {
  if (!wave.bookingOpen) return false;
  return getWaveAccessState(wave, now).state === 'open';
};

const getWaveBookedCount = (shift: Shift | any, waveId: string) => {
  const bookedBy = Array.isArray(shift?.bookedBy) ? shift.bookedBy : [];
  if (waveId === 'default') return bookedBy.length;
  return bookedBy.filter((booking: any) => booking.bookingWaveId === waveId).length;
};

const getOpenBookingWaves = (shift: Shift | any, dayData?: DayData, now = Date.now()) =>
  getBookingWavesForShift(shift, !!dayData?.bookingOpen, dayData?.bookingOpenAt || '', dayData?.bookingCloseAt || '')
    .filter(wave => isWaveCurrentlyOpen(wave, now) && getWaveBookedCount(shift, wave.id) < wave.slotLimit);

const getDayBookingAccess = (dayData?: DayData, now = Date.now()) => {
  const shifts = dayData?.shifts || [];
  let scheduledCountdown = '';
  let scheduledTarget = Number.POSITIVE_INFINITY;
  let closeCountdown = '';
  let closeTarget = Number.POSITIVE_INFINITY;
  let hasOpenWave = false;
  let hasBookableWave = false;
  let hasExpiredWave = false;

  shifts.forEach((shift: Shift) => {
    getBookingWavesForShift(shift, !!dayData?.bookingOpen, dayData?.bookingOpenAt || '', dayData?.bookingCloseAt || '')
      .forEach((wave) => {
        const access = getWaveAccessState(wave, now);
        if (access.state === 'open') {
          hasOpenWave = true;
          if (getWaveBookedCount(shift, wave.id) < wave.slotLimit) {
            hasBookableWave = true;
          }
          if (access.targetTime && access.targetTime < closeTarget) {
            closeTarget = access.targetTime;
            closeCountdown = access.countdown;
          }
          return;
        }

        if (access.state === 'scheduled' && access.targetTime && access.targetTime < scheduledTarget) {
          scheduledTarget = access.targetTime;
          scheduledCountdown = access.countdown;
        }
        if (access.state === 'expired') {
          hasExpiredWave = true;
        }
      });
  });

  if (hasBookableWave) {
    return {
      state: 'open' as const,
      canBook: true,
      label: closeCountdown ? `Хаагдахад ${closeCountdown}` : 'Нээлттэй',
      countdown: closeCountdown,
    };
  }

  if (hasOpenWave) {
    return {
      state: 'full' as const,
      canBook: false,
      label: closeCountdown ? `Хаагдахад ${closeCountdown}` : 'Нээлттэй',
      countdown: closeCountdown,
    };
  }

  if (scheduledCountdown) {
    return {
      state: 'scheduled' as const,
      canBook: false,
      label: `Нээгдэхэд ${scheduledCountdown}`,
      countdown: scheduledCountdown,
    };
  }

  if (hasExpiredWave) {
    return { state: 'expired' as const, canBook: false, label: 'Хаагдсан', countdown: '' };
  }

  return { state: 'closed' as const, canBook: false, label: 'Хаалттай', countdown: '' };
};

const formatShiftTimeForDisplay = (timeStr?: string) => {
  if (!timeStr) return '';
  const compactMatch = timeStr.trim().match(/^(\d{1,2})-+(\d{1,2})$/);
  if (!compactMatch) return timeStr;
  return `${compactMatch[1].padStart(2, '0')}-${compactMatch[2].padStart(2, '0')}`;
};

const getShiftEndTime = (timeStr: string) => {
  const regularMatch = timeStr.match(/\d{1,2}:\d{2}\s*-\s*(\d{1,2}):(\d{2})/);
  if (regularMatch) {
    return { hours: Number(regularMatch[1]), minutes: Number(regularMatch[2]) };
  }

  const compactMatch = formatShiftTimeForDisplay(timeStr).match(/^\d{2}-(\d{2})$/);
  if (compactMatch) {
    return { hours: Number(compactMatch[1]), minutes: 0 };
  }

  return null;
};

// Function to generate mock schedule based on a reference date
function generateInitialSchedule(referenceDate: Date) {
  const schedule: Record<string, DayData> = {};
  const refStart = new Date(referenceDate);
  refStart.setHours(0, 0, 0, 0);

  // Range: 7 days past to end of next week
  const dayOfWeek = refStart.getDay();
  const daysToThisSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const totalFutureDays = daysToThisSunday + 7;
  
  const start = new Date(refStart);
  start.setDate(start.getDate() - 7);
  
  const end = new Date(refStart);
  end.setDate(end.getDate() + totalFutureDays);
  
  const current = new Date(start);
  while (current <= end) {
    const key = formatDateKey(current);
    const isPast = current.getTime() < refStart.getTime();
    const isToday = current.getTime() === refStart.getTime();
    const isTomorrow = current.getTime() === refStart.getTime() + (24 * 60 * 60 * 1000);
    
    // Simulate admin uploads: 
    // Past, Today, and Tomorrow always have data.
    // Future (beyond tomorrow) has data for the next 2 days only.
    const diffDays = Math.floor((current.getTime() - refStart.getTime()) / (1000 * 60 * 60 * 24));
    const hasSupervisorData = isPast || isToday || isTomorrow || (diffDays > 1 && diffDays <= 3);
    
    if (hasSupervisorData) {
      // Deterministic booking for mock:
      // Past: 70% chance
      // Today: 100% chance
      // Future: 0% chance (user must book)
      let isBookedByMe = false;
      if (isPast) isBookedByMe = (current.getDate() % 3) !== 0;
      if (isToday) isBookedByMe = true;

      const mockEmployees = [
        { userId: '2', userName: 'Дорж' },
        { userId: '3', userName: 'Болд' },
        { userId: '4', userName: 'Сараа' },
        { userId: '5', userName: 'Гэрэл' }
      ];

      schedule[key] = {
        shifts: [
          { 
            id: `s-${key}-1`, 
            time: '09:00 - 15:00', 
            totalSlots: 5, 
            bookedSlots: isBookedByMe ? 3 : 2, 
            isBookedByMe,
            bookedBy: isBookedByMe 
              ? [{ userId: '1', userName: 'Бат-Эрдэнэ' }, ...mockEmployees.slice(0, 2)]
              : mockEmployees.slice(0, 2),
            segment: 'Postpaid'
          },
          { 
            id: `s-${key}-2`, 
            time: '15:00 - 21:00', 
            totalSlots: 5, 
            bookedSlots: 1, 
            isBookedByMe: false,
            bookedBy: mockEmployees.slice(2, 3),
            segment: 'Prepaid'
          }
        ],
        holidayName: undefined
      };
    } else {
      schedule[key] = { shifts: [] };
    }
    
    current.setDate(current.getDate() + 1);
  }
  
  return schedule;
}

interface Notification {
  id: number;
  title: string;
  desc: string;
  time: string;
  unread: boolean;
}

function formatDateHeader(date: Date) {
  const month = ENG_MONTHS[date.getMonth()];
  const day = date.getDate();
  const dayName = WEEKDAYS[date.getDay()];
  return `${month} ${day}, ${dayName}`;
}

const DayRow = React.memo(({ 
  date, isToday, isTomorrow, isYesterday, isPast, 
  dayData, csrProfile, isSubmitted, 
  onBookShift, onTradeShift, nowTick,
}: any) => {
  const dateKey = formatDateKey(date);
  const myBookedShift = dayData.shifts.find((s: any) => s.bookedBy?.some((b: any) => b.userId === csrProfile.id));
  const isHoliday = !!dayData.holidayName;
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const shouldBeRed = isHoliday || isWeekend;
  const hasData = dayData.shifts.length > 0;
  const bookingAccess = getDayBookingAccess(dayData, nowTick);
  const isBookingOpen = bookingAccess.canBook;
  const bookingStatusText = bookingAccess.state === 'scheduled'
    ? `Захиалга ${bookingAccess.label.toLowerCase()}`
    : bookingAccess.state === 'open' || bookingAccess.state === 'full'
      ? `Захиалга ${bookingAccess.label.toLowerCase()}`
      : bookingAccess.state === 'expired'
        ? 'Захиалга хаагдсан'
        : '';
  const disabledBookingLabel = bookingAccess.state === 'scheduled'
    ? bookingAccess.label
    : bookingAccess.state === 'expired'
      ? 'Хаагдсан'
      : bookingAccess.state === 'full'
        ? 'Дүүрсэн'
        : 'Захиалах';

  return (
    <div 
      id={isYesterday ? 'yesterday-row' : undefined}
      className={`relative rounded-3xl transition-all duration-500 ${
        isToday 
          ? 'rgb-border p-[1px] shadow-[0_0_30px_rgba(59,130,246,0.2)]' 
          : isTomorrow || isYesterday
            ? 'p-[1px] scale-[1.005] z-10'
            : ''
      }`}
    >
      <div className={`relative rounded-3xl p-3 md:p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6 ${
        isPast 
          ? 'bg-gray-900/20 border border-gray-800/50 opacity-40' 
          : isToday
            ? 'bg-gray-900/95 backdrop-blur-xl border border-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,0.1)]'
            : isTomorrow
              ? 'bg-gray-900/95 backdrop-blur-xl border border-purple-500/30'
              : isYesterday
                ? 'bg-gray-900/95 backdrop-blur-xl border border-orange-500/30'
                : !hasData
                  ? 'bg-gray-900/40 border border-gray-800'
                  : 'bg-gray-900/40 border border-gray-800'
      }`}>
        <div className="flex items-center gap-4 md:gap-8">
          <div className={`w-16 h-16 md:w-24 md:h-24 flex-shrink-0 rounded-3xl flex flex-col items-center justify-center border transition-all duration-500 shadow-2xl ${
            isToday 
              ? 'bg-gradient-to-br from-blue-500 to-blue-700 border-blue-400 shadow-blue-900/40 scale-105' 
              : isTomorrow
                ? 'bg-gradient-to-br from-purple-500/20 to-purple-600/5 border-purple-500/30 text-purple-500 shadow-purple-900/10'
                : isYesterday
                  ? 'bg-gradient-to-br from-orange-500/20 to-orange-600/5 border-orange-500/30 text-orange-500 shadow-orange-900/10'
                  : shouldBeRed 
                    ? 'bg-gradient-to-br from-red-500/20 to-red-600/5 border-red-500/30 text-red-500 shadow-red-900/10' 
                    : 'bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700 text-gray-400 shadow-black/20'
          }`}>
            <span className={`text-[8px] md:text-[12px] font-black uppercase tracking-[0.2em] opacity-80 mb-0.5 md:mb-1 ${isToday ? 'text-blue-100' : ''}`}>
              {ENG_MONTHS[date.getMonth()]}
            </span>
            <span className={`text-2xl md:text-4xl font-black leading-none mb-0.5 md:mb-1 ${isToday ? 'text-white' : ''}`}>
              {date.getDate()}
            </span>
            <span className={`text-[8px] md:text-[12px] font-black uppercase tracking-tight ${isToday ? 'text-blue-200' : ''}`}>
              {WEEKDAYS[date.getDay()]}
            </span>
          </div>

          <div>
            <div className="flex items-center gap-3">
              {(isToday || isTomorrow || isYesterday) && (
                <h3 className={`text-lg font-black ${
                  isTomorrow ? 'text-purple-400' : isToday ? 'text-blue-400' : 'text-gray-400'
                }`}>
                  {isToday ? 'Өнөөдөр' : isTomorrow ? 'Маргааш' : 'Өчигдөр'}
                </h3>
              )}
              {isTomorrow && <Sparkles size={18} className="text-purple-400 animate-pulse" />}
              {shouldBeRed ? (
                <span className={`text-xs font-bold px-3 py-1 rounded-xl ${
                  isPast ? 'bg-red-900/10 text-red-900/50' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                }`}>
                  {dayData.holidayName || 'Амралтын өдөр'}
                </span>
              ) : (
                <span className="text-xs font-bold px-3 py-1 rounded-xl bg-gray-800 text-gray-400 border border-gray-700">
                  Ажлын өдөр
                </span>
              )}
            </div>
            <p className="text-gray-500 text-sm font-medium mt-1">
              {isPast 
                ? 'Ажиллаж дууссан' 
                : !hasData 
                  ? 'Уучлаарай, хуваарь одоогоор ороогүй байна' 
                  : !myBookedShift
                    ? bookingStatusText
                  : isToday 
                    ? (() => {
                        const endTime = getShiftEndTime(myBookedShift.time);
                        if (!endTime) return 'Батлагдсан хуваарь';
                        const now = new Date();
                        const shiftEndDate = new Date(now);
                        shiftEndDate.setHours(endTime.hours, endTime.minutes, 0, 0);
                        return now > shiftEndDate ? 'Ажиллаж дууссан' : 'Батлагдсан хуваарь';
                      })()
                    : 'Батлагдсан хуваарь'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {hasData ? (
            <div className="flex flex-wrap items-center gap-2">
              {isPast ? (
                myBookedShift && (
                  <div className="px-4 py-2 rounded-xl border bg-green-500/10 border-green-500/30 text-green-400 flex items-center gap-3">
                    <Clock size={16} />
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] font-black uppercase tracking-wider opacity-60">Таны ээлж</p>
                        <span className="text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/30 font-black uppercase">
                          {myBookedShift.segment}
                        </span>
                        <span className="text-[8px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/30 font-black uppercase">
                          {myBookedShift.employmentType || 'Full Time'}
                        </span>
                        {myBookedShift.bookedBy?.find((b: any) => b.userId === csrProfile.id)?.bookedByAdmin && (
                          <span className="text-[8px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/30 font-black uppercase">
                            {myBookedShift.bookedBy.find((b: any) => b.userId === csrProfile.id)?.bookedByAdmin} нэмсэн
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-bold text-white">{formatShiftTimeForDisplay(myBookedShift.time)}</p>
                    </div>
                  </div>
                )
              ) : (
                <>
                  {myBookedShift ? (
                    <>
                      <div className="px-4 py-2 rounded-xl border bg-green-500/10 border-green-500/30 text-green-400 flex items-center gap-3">
                        <Clock size={16} />
                        <div className="text-left">
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] font-black uppercase tracking-wider opacity-60">Таны ээлж</p>
                            <span className="text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/30 font-black uppercase">
                              {myBookedShift.segment}
                            </span>
                            <span className="text-[8px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/30 font-black uppercase">
                              {myBookedShift.employmentType || 'Full Time'}
                            </span>
                            {myBookedShift.bookedBy?.find((b: any) => b.userId === csrProfile.id)?.bookedByAdmin && (
                              <span className="text-[8px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/30 font-black uppercase">
                                {myBookedShift.bookedBy.find((b: any) => b.userId === csrProfile.id)?.bookedByAdmin} нэмсэн
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-bold text-white">{formatShiftTimeForDisplay(myBookedShift.time)}</p>
                        </div>
                      </div>
                      {!isSubmitted && isBookingOpen && (
                        <button 
                          onClick={() => onBookShift(dateKey)}
                          className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/20 flex items-center gap-2"
                        >
                          <Edit size={18} />
                          Edit
                        </button>
                      )}
                      {!isSubmitted && !isBookingOpen && bookingAccess.state === 'expired' && (
                        <button 
                          onClick={() => onTradeShift(dateKey)}
                          className="px-6 py-2.5 rounded-xl bg-purple-600 text-white font-bold hover:bg-purple-700 transition-all shadow-lg shadow-purple-900/20 flex items-center gap-2"
                        >
                          <ArrowRightLeft size={18} />
                          Trade
                        </button>
                      )}
                    </>
                  ) : (
                    !isSubmitted && (
                      isBookingOpen ? (
                        <button
                          onClick={() => onBookShift(dateKey)}
                          className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/20 flex items-center gap-2"
                        >
                          <Calendar size={18} />
                          Захиалах
                        </button>
                      ) : (
                        <button
                          disabled
                          className="px-6 py-2.5 rounded-xl bg-gray-800/50 text-gray-500 font-bold border border-gray-800 flex items-center gap-2 cursor-not-allowed opacity-70"
                        >
                          <Lock size={18} />
                          {disabledBookingLabel}
                        </button>
                      )
                    )
                  )}
                </>
              )}
            </div>
          ) : (
            !isPast && !isSubmitted && (
              <button 
                disabled
                className="px-6 py-2.5 rounded-xl bg-gray-800/50 text-gray-600 font-bold border border-gray-800 flex items-center gap-2 cursor-not-allowed opacity-50"
              >
                <Calendar size={18} />
                Захиалах
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
});

export default function CsrDashboard() {
  const { profile: csrProfile } = useAuth();
  const [activeTab, setActiveTab] = useState('schedule');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [schedule, setSchedule] = useState<Record<string, DayData>>({});
  const [selectedMonth, setSelectedMonth] = useState(formatMonthKey(new Date()));
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterStep, setFilterStep] = useState<'year' | 'month'>('year');
  const [tempYear, setTempYear] = useState(new Date().getFullYear());
  const [nowTick, setNowTick] = useState(Date.now());
  
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [tradeRequests, setTradeRequests] = useState<TradeRequest[]>([]);
  const [hourlyLeaveRequests, setHourlyLeaveRequests] = useState<HourlyLeaveRequest[]>([]);
  const lastDataRef = useRef<string>('');
  const [vacationRequests, setVacationRequests] = useState<VacationRequest[]>([]);
  const [vacationQuotas, setVacationQuotas] = useState<VacationQuota[]>([]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const [trainingMaterials, setTrainingMaterials] = useState<TrainingMaterial[]>([]);
  const [isStatsExpanded, setIsStatsExpanded] = useState(false);
  const [submittedMonths, setSubmittedMonths] = useState<string[]>([]);
  const [vacationYear, setVacationYear] = useState(new Date().getFullYear());
  const [isVacationFilterOpen, setIsVacationFilterOpen] = useState(false);
  const [holidays, setHolidays] = useState<{date: string, name: string}[]>([]);
  const [monthlyFontHourRules, setMonthlyFontHourRules] = useState<Record<string, number>>({});
  const [weeklyShiftRules, setWeeklyShiftRules] = useState<Record<string, WeeklyShiftRule>>({});
  const unreadTrainingCount = trainingMaterials.filter(m => !m.seenBy?.some(s => s.userId === csrProfile?.id)).length;

  useEffect(() => {
    setIsStatsExpanded(false);
  }, [activeTab, selectedMonth]);

  const calculateHours = (timeStr: string) => {
    if (!timeStr || timeStr === 'Амралт') return 0;
    
    // Regular format 09:00 - 18:00
    if (timeStr.includes(' - ')) {
      const [start, end] = timeStr.split(' - ');
      const [sH, sM] = start.split(':').map(Number);
      const [eH, eM] = end.split(':').map(Number);
      let diff = (eH * 60 + (eM || 0)) - (sH * 60 + (sM || 0));
      if (diff < 0) diff += 24 * 60;
      return diff / 60;
    }

    // Custom compact format like 09-17 or 09-01
    const parts = timeStr.split(/[-:]+/).filter(Boolean);
    if (parts.length >= 2) {
      const sH = parseInt(parts[0]);
      const sM = parts.length > 2 ? parseInt(parts[1]) : 0;
      const eH = parts.length > 2 ? parseInt(parts[parts.length - 2]) : parseInt(parts[parts.length - 1]);
      const eM = parts.length > 2 ? parseInt(parts[parts.length - 1]) : 0;

      let diff = (eH * 60 + (eM || 0)) - (sH * 60 + (sM || 0));
      if (diff < 0) diff += 24 * 60;
      return diff / 60;
    }

    return 0;
  };

  const currentMonthKey = selectedMonth;
  const csrSegment = csrProfile?.lineType || '';
  const csrEmploymentType = csrProfile?.employmentType || 'Full Time';
  const monthlyFontTime = Math.max(
    0,
    Number(monthlyFontHourRules[makeMonthlyFontHourKey(currentMonthKey, csrSegment, csrEmploymentType)] ?? csrProfile?.monthlyFontTime?.[currentMonthKey] ?? 0) || 0,
  );
  const activeWeeklyRule = normalizeWeeklyShiftRule(
    weeklyShiftRules[makeSegmentTypeKey(csrSegment, csrEmploymentType)],
  );

  const holidayDates = React.useMemo(() => {
    return new Set((holidays as any[]).filter(h => h?.date).map(h => h.date));
  }, [holidays]);

  const { monthlyBookedHours, regularWorkedHours, holidayWorkedHours, totalAvailableHours } = React.useMemo(() => {
    let monthlyBookedHours = 0;
    let regularWorkedHours = 0;
    let holidayWorkedHours = 0;
    let totalAvailableHours = 0;
    
    Object.entries(schedule).forEach(([dateKey, dayData]: [string, DayData]) => {
      if (dateKey.startsWith(currentMonthKey)) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const isPastDate = new Date(dateKey) < now;
        const isHoliday = holidayDates.has(dateKey);
        
        dayData.shifts.forEach(shift => {
          const hours = calculateHours(shift.time);
          totalAvailableHours += isHoliday ? 0 : hours;
          if (shift.bookedBy?.some(b => b.userId === csrProfile?.id)) {
            if (isHoliday) {
              holidayWorkedHours += hours;
            } else {
              monthlyBookedHours += hours;
              if (isPastDate) {
                regularWorkedHours += hours;
              }
            }
          }
        });
      }
    });
    return { monthlyBookedHours, regularWorkedHours, holidayWorkedHours, totalAvailableHours };
  }, [schedule, currentMonthKey, csrProfile?.id, holidayDates]);

  const { sickHours, leaveHours } = React.useMemo(() => {
    const approvedVacations = vacationRequests.filter(r => r.month === currentMonthKey && r.status === 'approved');
    const sickHours = approvedVacations.filter(r => r.type === 'sick').reduce((acc, r) => {
      const start = new Date(r.startDate);
      const end = new Date(r.endDate);
      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return acc + (days * 8);
    }, 0);
    
    const leaveHours = approvedVacations.filter(r => r.type === 'leave' || r.type === 'vacation').reduce((acc, r) => {
      const start = new Date(r.startDate);
      const end = new Date(r.endDate);
      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return acc + (days * 8);
    }, 0);
    return { sickHours, leaveHours };
  }, [vacationRequests, currentMonthKey]);

  const totalExecutionHours = regularWorkedHours + sickHours + leaveHours;
  const effectiveMonthlyFontTime = Math.max(monthlyFontTime, monthlyBookedHours);
  const progressBaseHours = Math.max(effectiveMonthlyFontTime, totalExecutionHours, 1);
  const executionPointerPercent = Math.min((totalExecutionHours / progressBaseHours) * 100, 100);
  const getProgressWidth = (hours: number) => `${Math.max(0, Math.min((hours / progressBaseHours) * 100, 100))}%`;
  const overtimeHours = Math.max(0, totalExecutionHours - effectiveMonthlyFontTime);
  const executionPercentage = Math.min(Math.round((totalExecutionHours / progressBaseHours) * 100), 100);

  const hasMonthData = React.useMemo(() => {
    return Object.keys(schedule).some(key => key.startsWith(currentMonthKey) && schedule[key].shifts.length > 0);
  }, [schedule, currentMonthKey]);

  const displayDays = React.useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    const days = [];
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const current = new Date(startDate);
    
    while (current <= endDate) {
      const date = new Date(current);
      const isToday = date.toDateString() === now.toDateString();
      const isPast = date < now;
      const isTomorrow = new Date(date.getTime() - 24*60*60*1000).toDateString() === now.toDateString();
      const isYesterday = new Date(date.getTime() + 24*60*60*1000).toDateString() === now.toDateString();
      
      days.push({ date, isToday, isPast, isTomorrow, isYesterday });
      current.setDate(current.getDate() + 1);
    }

    return days;
  }, [selectedMonth]);


  const mapNotificationForUi = (raw: any): AppNotification => {
    const readAt = raw.readAt || raw.read_at;
    return {
      id: String(raw.id),
      title: raw.title || '',
      content: raw.content || '',
      type: raw.type || 'general',
      imageUrl: raw.imageUrl || raw.image_url || '',
      deadline: raw.deadline || '',
      createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
      authorId: raw.authorId || raw.author_id || '',
      authorName: raw.authorName || raw.author_name || 'System',
      seenBy: readAt && csrProfile
        ? [{ userId: csrProfile.id, userName: csrProfile.name, seenAt: readAt }]
        : [],
    } as AppNotification;
  };

  const fetchNotifications = async () => {
    if (!csrProfile) return [];

    try {
      const response = await apiClient.get('/broadcasts/notifications');
      const data = (response.data || []).map(mapNotificationForUi);
      setNotifications(data);
      setLocalData('notifications', data);
      return data;
    } catch (error) {
      console.error('Error fetching CSR notifications:', error);
      const local = getLocalData('notifications', []);
      const filtered = local.filter((n: any) => !n.targetUserId || n.targetUserId === csrProfile.id);
      setNotifications(filtered);
      return filtered;
    }
  };

  const mapVacationRequestForUi = (raw: any): VacationRequest => {
    const startDate = raw.startDate || raw.start_date || '';
    const endDate = raw.endDate || raw.end_date || startDate;
    return {
      id: String(raw.id),
      csrId: raw.userId || raw.user_id || csrProfile?.id || '',
      csrName: raw.userName || raw.user_name || csrProfile?.name || 'CSR',
      csrPhoto: csrProfile?.photoUrl || '',
      month: String(startDate).slice(0, 7),
      startDate,
      endDate,
      reason: raw.reason || '',
      type: 'vacation',
      status: raw.status || 'pending',
      createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
      approvedBy: raw.approvedBy || raw.approved_by,
    };
  };

  const fetchVacationRequests = async () => {
    if (!csrProfile) return [];

    try {
      const response = await apiClient.get('/requests/vacation');
      const data = (response.data || []).map(mapVacationRequestForUi);
      setVacationRequests(data);
      setLocalData('vacationRequests', data);
      return data;
    } catch (error) {
      console.error('Error fetching CSR vacation requests:', error);
      const local = getLocalData('vacationRequests', []).filter((r: any) => r.csrId === csrProfile.id);
      setVacationRequests(local);
      return local;
    }
  };





  const mapSlotsToSchedule = React.useCallback((slots: any[]): Record<string, DayData> => {
    const next: Record<string, DayData> = {};
    (slots || []).forEach((slot: any) => {
      const dateKey = String(slot.date || '').slice(0, 10);
      if (!dateKey) return;
      const matchesSegment = (slot.segment === 'All') || (slot.segment === csrProfile.lineType) || (csrProfile.lineType === 'VIP' && slot.segment === 'Premium');
      const matchesEmployment = (slot.employmentType || slot.employment_type || 'Full Time') === csrProfile.employmentType;
      if (!matchesSegment || !matchesEmployment) return;
      const time = slot.isRest || slot.is_rest ? 'Амралт' : `${String(slot.startTime || '').slice(0,5)}-${String(slot.endTime || '').slice(0,5)}`;
      const bookingOpen = Boolean(slot.bookingOpen ?? slot.booking_is_open);
      const bookingOpenAt = slot.bookingOpenAt || slot.booking_open_at || '';
      const bookingCloseAt = slot.bookingDeadline || slot.booking_deadline || '';
      const bookedBy = (slot.bookings || []).map((b: any) => ({
        userId: b.userId || b.user_id,
        userName: b.userName || b.user_name || 'CSR',
        userCode: b.userCode || b.user_code,
        bookedAt: b.bookedAt || b.booked_at,
      }));
      const shift: Shift = {
        id: String(slot.id),
        time,
        totalSlots: Number(slot.capacity || slot.totalSlots || 1),
        bookedSlots: Number(slot.currentBookings ?? slot.current_bookings ?? bookedBy.length),
        isBookedByMe: bookedBy.some((b: any) => b.userId === csrProfile.id),
        bookedBy,
        segment: slot.segment || csrProfile.lineType,
        employmentType: slot.employmentType || slot.employment_type || csrProfile.employmentType,
        bookingWaves: [{
          id: 'default',
          name: 'Нийт захиалах эрх',
          slotLimit: Number(slot.capacity || 1),
          bookingOpen,
          bookingOpenAt,
          bookingCloseAt,
        }],
      };
      next[dateKey] = {
        ...(next[dateKey] || { shifts: [] }),
        bookingOpen: (next[dateKey]?.bookingOpen || bookingOpen),
        bookingOpenAt: next[dateKey]?.bookingOpenAt || bookingOpenAt,
        bookingCloseAt: next[dateKey]?.bookingCloseAt || bookingCloseAt,
        shifts: [...(next[dateKey]?.shifts || []), shift],
      };
    });
    return next;
  }, [csrProfile]);

  const fetchDbSchedule = React.useCallback(async () => {
    try {
      const response = await apiClient.get('/slots');
      const dbSchedule = mapSlotsToSchedule(response.data || []);
      if (Object.keys(dbSchedule).length > 0) {
        setSchedule(dbSchedule);
        return dbSchedule;
      }
    } catch (error) {
      console.error('Error fetching DB schedule:', error);
    }
    return null;
  }, [mapSlotsToSchedule]);

  const fetchTradeRequests = React.useCallback(async () => {
    try {
      const response = await apiClient.get('/trades');
      const mapped = (response.data || []).map((t: any) => ({
        ...t,
        senderId: t.senderId || t.sender_id,
        receiverId: t.receiverId || t.receiver_id,
        senderName: t.senderName || t.sender_name,
        receiverName: t.receiverName || t.receiver_name,
        senderShiftId: t.senderSlotId || t.sender_slot_id || t.senderShiftId,
        receiverShiftId: t.receiverSlotId || t.receiver_slot_id || t.receiverShiftId,
        senderSlotId: t.senderSlotId || t.sender_slot_id,
        receiverSlotId: t.receiverSlotId || t.receiver_slot_id,
        senderShiftTime: t.senderShiftTime || t.sender_shift_time,
        receiverShiftTime: t.receiverShiftTime || t.receiver_shift_time,
        createdAt: t.createdAt || t.created_at,
      }));
      setTradeRequests(mapped);
      return mapped;
    } catch (error) {
      console.error('Error fetching trade requests:', error);
      return [];
    }
  }, []);

  const fetchShiftRules = async () => {
    try {
      const response = await apiClient.get('/rules');
      setMonthlyFontHourRules(response.data?.monthlyFontHourRules || {});
      setWeeklyShiftRules(response.data?.weeklyShiftRules || {});
    } catch (error) {
      console.error('Error fetching shift rules:', error);
    }
  };

  // Real-time listeners (Mocked with Polling)
  useEffect(() => {
    if (!csrProfile) return;

    const loadData = () => {
      const rawSchedule = getLocalData('schedules', {}) as Record<string, DayData>;
      const allNotifs = getLocalData('notifications', []);
      const allTradeRequests = getLocalData('tradeRequests', []);
      const allVacationRequests = getLocalData('vacationRequests', []);
      const allQuotas = getLocalData('vacationQuotas', []);
      const allTraining = getLocalData('trainingMaterials', []);
      const allHourlyLeave = getLocalData('hourlyLeaveRequests', []);
      const allRestDays = getLocalData('csrRestDays', {});
      const allSubmitted = getLocalData('csrSubmittedMonths', {});
      const allHolidays = getLocalData('holidays', []);

      // Create a hash of the data to prevent unnecessary re-renders
      const dataHash = JSON.stringify({
        rawSchedule,
        allNotifs,
        allTradeRequests,
        allVacationRequests,
        allQuotas,
        allTraining,
        allRestDays,
        allSubmitted,
        allHolidays,
        profileId: csrProfile.id
      });

      if (dataHash === lastDataRef.current) return;
      lastDataRef.current = dataHash;

      const filteredSchedule: Record<string, DayData> = {};
      
      // Get all dates from rawSchedule and allHolidays
      const allDates = Array.from(new Set([
        ...Object.keys(rawSchedule),
        ...allHolidays.map((h: any) => h.date)
      ]));

      allDates.forEach(dateKey => {
        const holiday = allHolidays.find((h: any) => h.date === dateKey);
        const dayData = rawSchedule[dateKey] || { shifts: [], holidayName: undefined };

        filteredSchedule[dateKey] = {
          ...dayData,
          holidayName: holiday ? holiday.name : dayData.holidayName,
          bookingOpen: !!dayData.bookingOpen,
          bookingOpenAt: dayData.bookingOpenAt || '',
          bookingCloseAt: dayData.bookingCloseAt || '',
          shifts: (dayData.shifts || []).filter((s: any) => {
            const matchesSegment = (s.segment === 'All') || 
                                  (s.segment === csrProfile.lineType) || 
                                  (csrProfile.lineType === 'VIP' && s.segment === 'Premium');
            
            const matchesEmployment = s.employmentType === csrProfile.employmentType;
            
            return matchesSegment && matchesEmployment;
          })
        };
      });
      
      setSchedule(filteredSchedule);
      // Notifications are loaded from DB by fetchNotifications().
      setTradeRequests(allTradeRequests.filter((r: any) => r.senderId === csrProfile.id || r.receiverId === csrProfile.id));
      setVacationRequests(allVacationRequests.filter((r: any) => r.csrId === csrProfile.id));
      setHourlyLeaveRequests(allHourlyLeave.filter((r: any) => r.csrId === csrProfile.id));
      setVacationQuotas(allQuotas);
      setTrainingMaterials(allTraining);
      setSubmittedMonths(allSubmitted[csrProfile.id] || []);
      setHolidays(allHolidays);
    };

    loadData();
    fetchNotifications();
    fetchVacationRequests();
    fetchShiftRules();
    fetchDbSchedule();
    fetchTradeRequests();
    const interval = setInterval(() => { loadData(); fetchDbSchedule(); }, 5000);
    const notificationInterval = setInterval(fetchNotifications, 10000);
    const vacationInterval = setInterval(fetchVacationRequests, 10000);
    const shiftRuleInterval = setInterval(fetchShiftRules, 5000);
    const tradeInterval = setInterval(fetchTradeRequests, 5000);
    
    const handleStorageUpdate = (event: StorageEvent) => {
      if (event.key === 'notifications') {
        loadData();
      }
    };

    window.addEventListener('storage', handleStorageUpdate);
    return () => {
      clearInterval(interval);
      clearInterval(notificationInterval);
      clearInterval(vacationInterval);
      clearInterval(shiftRuleInterval);
      clearInterval(tradeInterval);
      window.removeEventListener('storage', handleStorageUpdate);
    };
  }, [csrProfile]);

  const [bookingModal, setBookingModal] = useState<{
    isOpen: boolean;
    dateKey: string;
  } | null>(null);

  const [tradingModal, setTradingModal] = useState<{
    isOpen: boolean;
    dateKey: string;
    step: 'times' | 'employees';
    shift?: Shift;
  } | null>(null);

  const [incomingTradeModal, setIncomingTradeModal] = useState<TradeRequest | null>(null);

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ old: '', new: '', confirm: '' });
  const [showSuccess, setShowSuccess] = useState(false);

  const triggerSuccess = () => {
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csrProfile) return;

    if (passwordForm.new !== passwordForm.confirm) {
      alert('Шинэ нууц үгнүүд зөрүүтэй байна!');
      return;
    }

    if (passwordForm.new.length < 6) {
      alert('Шинэ нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой!');
      return;
    }

    try {
      await apiClient.post('/auth/change-password', {
        oldPassword: passwordForm.old,
        newPassword: passwordForm.new,
      });

      logAction('Password Changed', `Changed password for ${csrProfile.name}`);
      alert('Нууц үг амжилттай солигдлоо!');
      setIsChangingPassword(false);
      setPasswordForm({ old: '', new: '', confirm: '' });
      return;
    } catch (error: any) {
      console.error('Error changing password:', error);
      alert(error.response?.data?.error || 'Нууц үг солиход алдаа гарлаа.');
      return;
    }
  };

  const handleSendTradeRequest = async (receiverId: string, receiverName: string, receiverShiftId: string, receiverShiftTime: string, dateKey: string) => {
    let myShift: { date: string, shift: Shift } | null = null;
    Object.entries(schedule).forEach(([date, data]) => {
      const dayData = data as DayData;
      const s = dayData.shifts.find(sh => sh.bookedBy?.some(b => b.userId === csrProfile.id));
      if (s) myShift = { date, shift: s };
    });

    if (!myShift) {
      alert('Танд солих ээлж байхгүй байна. Эхлээд ээлж захиална уу.');
      return;
    }

    try {
      await apiClient.post('/trades', {
        receiver_id: receiverId,
        sender_slot_id: myShift.shift.id,
        receiver_slot_id: receiverShiftId,
      });
      await fetchTradeRequests();
      await fetchNotifications();
      setTradingModal(null);
      triggerSuccess();
      logAction('Trade Requested', `Sent trade request to ${receiverName}`);
    } catch (error: any) {
      console.error('Error sending trade request:', error);
      alert(error.response?.data?.error || 'Хүсэлт илгээхэд алдаа гарлаа.');
    }
  };

  const handleAcceptTrade = async (request: TradeRequest) => {
    try {
      await apiClient.patch(`/trades/${request.id}/respond`, { status: 'accepted' });
      await fetchTradeRequests();
      await fetchNotifications();
      setIncomingTradeModal(null);
      triggerSuccess();
      logAction('Trade Accepted', `Accepted trade from ${request.senderName}`);
    } catch (error: any) {
      console.error('Error accepting trade:', error);
      alert(error.response?.data?.error || 'Хүсэлт зөвшөөрөхөд алдаа гарлаа.');
    }
  };

  const handleDeclineTrade = async (request: TradeRequest) => {
    try {
      await apiClient.patch(`/trades/${request.id}/respond`, { status: 'rejected' });
      await fetchTradeRequests();
      await fetchNotifications();
      setIncomingTradeModal(null);
      logAction('Trade Declined', `Declined trade from ${request.senderName}`);
    } catch (error: any) {
      console.error('Error declining trade:', error);
      alert(error.response?.data?.error || 'Хүсэлт татгалзахад алдаа гарлаа.');
    }
  };

  const isUnread = (notif: AppNotification) => {
    return !notif.seenBy.some(s => s.userId === csrProfile.id);
  };

  const unreadCount = notifications.filter(n => (n.type === 'general' || n.type === 'important') && isUnread(n)).length;

  // Scroll to yesterday on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      const container = document.getElementById('schedule-container');
      const yesterdayRow = document.getElementById('yesterday-row');
      if (container && yesterdayRow) {
        container.scrollTop = yesterdayRow.offsetTop;
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [activeTab]);

  const markAsRead = async (id: string) => {
    const notif = notifications.find(n => n.id === id);
    if (!notif || !csrProfile) return;

    const alreadySeen = notif.seenBy?.some(s => s.userId === csrProfile.id);
    if (!alreadySeen) {
      try {
        await apiClient.post('/broadcasts/notifications/read', { notification_id: id });

        const updatedSeenBy = [...(notif.seenBy || []), {
          userId: csrProfile.id,
          userName: csrProfile.name,
          seenAt: new Date().toISOString()
        }];

        updateLocalItem('notifications', id, { seenBy: updatedSeenBy });
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, seenBy: updatedSeenBy } : n));

        logAction('Notification Read', `Read notification: ${notif.title}`);
      } catch (error) {
        console.error('Error marking as read:', error);
      }
    }
  };

  const markAllAsRead = () => {
    if (!csrProfile) return;
    const unreadNotifs = notifications.filter(n => isUnread(n));
    if (unreadNotifs.length === 0) return;

    try {
      unreadNotifs.forEach(notif => {
        const updatedSeenBy = [...(notif.seenBy || []), {
          userId: csrProfile.id,
          userName: csrProfile.name,
          seenAt: new Date().toISOString()
        }];
        updateLocalItem('notifications', notif.id, { seenBy: updatedSeenBy });
      });
      
      // Update local state
      setNotifications(prev => prev.map(n => {
        if (unreadNotifs.some(un => un.id === n.id)) {
          return {
            ...n,
            seenBy: [...(n.seenBy || []), {
              userId: csrProfile.id,
              userName: csrProfile.name,
              seenAt: new Date().toISOString()
            }]
          };
        }
        return n;
      }));
      
      logAction('All Notifications Read', 'Marked all notifications as read');
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  useEffect(() => {
    if (activeTab === 'notifications') {
      markAllAsRead();
    }
  }, [activeTab]);

  const getShiftRuleHourKey = React.useCallback((shift: Shift) => {
    if (shift.time === 'Амралт') return 'rest';
    const roundedHours = String(Math.round(calculateHours(shift.time)));
    return /^[4-9]$/.test(roundedHours) ? roundedHours : '';
  }, []);

  const getMyWeeklyBookingStats = React.useCallback((dateKey: string, sourceSchedule: Record<string, DayData>) => {
    const weekDateKeys = getWeekDateKeys(dateKey);
    const hourCounts: Record<string, number> = {};
    let bookedDays = 0;
    let hours = 0;

    weekDateKeys.forEach((weekDateKey) => {
      const bookedShift = sourceSchedule[weekDateKey]?.shifts?.find((shift) =>
        shift.bookedBy?.some((booking) => booking.userId === csrProfile.id),
      );
      if (!bookedShift) return;
      const hourKey = getShiftRuleHourKey(bookedShift);
      const shiftHours = calculateHours(bookedShift.time);
      hours += shiftHours;
      bookedDays += 1;
      if (hourKey) hourCounts[hourKey] = (hourCounts[hourKey] || 0) + 1;
    });

    return { hourCounts, bookedDays, hours };
  }, [csrProfile.id, getShiftRuleHourKey]);

  const validateShiftRuleBeforeBooking = React.useCallback((dateKey: string, targetShift: Shift, sourceSchedule: Record<string, DayData>) => {
    const weekStats = getMyWeeklyBookingStats(dateKey, sourceSchedule);
    const targetHourKey = getShiftRuleHourKey(targetShift);
    const maxSelectedDays = Number(activeWeeklyRule.selectedDays) || 0;

    if (maxSelectedDays > 0 && weekStats.bookedDays + 1 > maxSelectedDays) {
      return `Энэ 7 хоногт нийт ${maxSelectedDays} өдөр сонгох тохиргоотой.`;
    }

    if (targetHourKey) {
      const maxForHour = Number((activeWeeklyRule.hourCounts || {})[targetHourKey] || 0);
      if (maxForHour > 0 && (weekStats.hourCounts[targetHourKey] || 0) + 1 > maxForHour) {
        return targetHourKey === 'rest'
          ? `Энэ 7 хоногт амралтын өдөр хамгийн ихдээ ${maxForHour} удаа сонгоно.`
          : `Энэ 7 хоногт ${targetHourKey} цагтай shift хамгийн ихдээ ${maxForHour} удаа сонгоно.`;
      }
      if (maxForHour === 0 && Object.keys(activeWeeklyRule.hourCounts || {}).length > 0) {
        return targetHourKey === 'rest'
          ? 'Энэ 7 хоногт амралтын өдөр сонгох боломжгүй.'
          : `Энэ 7 хоногт ${targetHourKey} цагтай shift сонгох боломжгүй.`;
      }
    }

    return '';
  }, [activeWeeklyRule, getMyWeeklyBookingStats, getShiftRuleHourKey]);

  const handleBookShift = React.useCallback(async (dateKey: string, shiftId?: string, bookingWaveId?: string) => {
    const dayData = schedule[dateKey];
    if (!dayData) return;

    if (submittedMonths.includes(currentMonthKey)) {
      alert('Таны энэ сарын хуваарь баталгаажсан тул өөрчлөх боломжгүй.');
      return;
    }

    const dayAccess = getDayBookingAccess(dayData, nowTick);
    if (!dayAccess.canBook) {
      return;
      return;
    }

    if (dayData.shifts.some(s => s.bookedBy?.some(b => b.userId === csrProfile.id))) {
      alert('Та энэ өдөр аль хэдийн ээлж захиалсан байна.');
      return;
    }

    if (!shiftId) {
      setBookingModal({ isOpen: true, dateKey });
      return;
    }

    const targetShift = dayData.shifts.find(s => s.id === shiftId);

    if (!targetShift) {
      alert('Энэ ээлж дүүрсэн эсвэл байхгүй байна.');
      return;
    }

    const ruleError = validateShiftRuleBeforeBooking(dateKey, targetShift, schedule);
    if (ruleError) {
      alert(ruleError);
      return;
    }

    const availableWaves = getOpenBookingWaves(targetShift, dayData, nowTick);
    const targetWave = bookingWaveId
      ? getBookingWavesForShift(targetShift, !!dayData.bookingOpen, dayData.bookingOpenAt || '', dayData.bookingCloseAt || '').find(wave => wave.id === bookingWaveId)
      : availableWaves[0];

    if (!targetWave || !isWaveCurrentlyOpen(targetWave, nowTick)) {
      return;
      return;
    }

    if (getWaveBookedCount(targetShift, targetWave.id) >= targetWave.slotLimit) {
      alert('Энэ захиалах эрхийн slot дүүрсэн байна.');
      return;
    }

    if (targetShift.bookedSlots >= targetShift.totalSlots) {
      alert('Энэ ээлж дүүрсэн байна.');
      return;
    }

    const bookedAt = new Date().toISOString();
    const bookingInfo = {
      userId: csrProfile.id,
      userName: csrProfile.name,
      userCode: csrProfile.code,
      bookedAt,
      bookingWaveId: targetWave.id,
      bookingWaveName: targetWave.name,
    };

    const updatedShifts = dayData.shifts.map(s => {
      if (s.id === targetShift.id) {
        return {
          ...s,
          bookedSlots: s.bookedSlots + 1,
          bookedBy: [...(s.bookedBy || []), bookingInfo]
        };
      }
      return s;
    });

    try {
      await apiClient.post('/slots/book', {
        slotId: targetShift.id,
        bookingWaveId: targetWave.id,
      });
      await fetchDbSchedule();
      logAction('Shift Booked', `Booked shift on ${dateKey} / ${targetWave.name}`);
      triggerSuccess();
    } catch (error: any) {
      console.error('Error booking shift:', error);
      alert(error.response?.data?.error || 'Ээлж захиалахад алдаа гарлаа.');
    }
  }, [schedule, submittedMonths, currentMonthKey, csrProfile, nowTick, validateShiftRuleBeforeBooking, fetchDbSchedule]);

  const handleCancelShift = React.useCallback(async (dateKey: string, shiftId: string) => {
    const dayData = schedule[dateKey];
    if (!dayData) return;

    if (submittedMonths.includes(currentMonthKey)) {
      alert('Таны энэ сарын хуваарь баталгаажсан тул өөрчлөх боломжгүй.');
      return;
    }

    try {
      await apiClient.post(`/slots/${shiftId}/cancel`, { slotId: shiftId });
      await fetchDbSchedule();
      logAction('Shift Cancelled', `Cancelled shift for ${dateKey}`);
      triggerSuccess();
    } catch (error: any) {
      console.error('Error cancelling shift:', error);
      alert(error.response?.data?.error || 'Ээлж цуцлахад алдаа гарлаа.');
    }
  }, [schedule, submittedMonths, currentMonthKey, csrProfile, fetchDbSchedule]);

  const handleTradeShift = React.useCallback((dateKey: string) => {
    setTradingModal({ isOpen: true, dateKey, step: 'times' });
  }, []);

  const handleSubmitSchedule = () => {
    if (!csrProfile) return;

    if (schedule && Object.keys(schedule).filter(d => d.startsWith(currentMonthKey) && schedule[d].shifts.some(s => s.bookedBy?.some(b => b.userId === csrProfile.id))).length === 0) {
      alert('Та дор хаяж нэг өдөр ээлж захиалах ёстой.');
      return;
    }

    const monthWeekKeys = Array.from(new Set(
      Object.keys(schedule)
        .filter((dateKey) => dateKey.startsWith(currentMonthKey))
        .map((dateKey) => getWeekStartDateKey(dateKey)),
    ));

    for (const weekStartKey of monthWeekKeys) {
      const weekStats = getMyWeeklyBookingStats(weekStartKey, schedule);
      if (weekStats.bookedDays === 0) continue;
      const maxSelectedDays = Number(activeWeeklyRule.selectedDays) || 0;
      if (maxSelectedDays > 0 && weekStats.bookedDays > maxSelectedDays) {
        alert(`${weekStartKey}-с эхлэх 7 хоногт нийт сонгох өдөр ${maxSelectedDays}-аас их байна.`);
        return;
      }
      for (const [hourKey, maxCount] of Object.entries(activeWeeklyRule.hourCounts || {})) {
        const currentCount = weekStats.hourCounts[hourKey] || 0;
        if (Number(maxCount) > 0 && currentCount > Number(maxCount)) {
          alert(hourKey === 'rest'
            ? `${weekStartKey}-с эхлэх 7 хоногт амралтын өдөр ${maxCount}-аас их байна.`
            : `${weekStartKey}-с эхлэх 7 хоногт ${hourKey} цагтай shift ${maxCount}-аас их байна.`);
          return;
        }
      }
    }

    try {
      const allSubmitted = getLocalData('csrSubmittedMonths', {});
      const userSubmitted = allSubmitted[csrProfile.id] || [];
      
      if (!userSubmitted.includes(currentMonthKey)) {
        const updatedSubmitted = [...userSubmitted, currentMonthKey];
        allSubmitted[csrProfile.id] = updatedSubmitted;
        setLocalData('csrSubmittedMonths', allSubmitted);
        setSubmittedMonths(updatedSubmitted);
        logAction('Schedule Submitted', `Submitted schedule for ${currentMonthKey}`);
        triggerSuccess();
      }
    } catch (error) {
      console.error('Error submitting schedule:', error);
    }
  };

  const renderScheduleView = () => {
    const isSubmitted = submittedMonths.includes(currentMonthKey);
    const [year, month] = selectedMonth.split('-').map(Number);
    const currentMonthName = ENG_MONTHS[month - 1];

    return (
      <div className="w-full space-y-4">
        <div className="relative">
          <div className="bg-gray-900/40 border border-gray-800 p-4 md:p-5 rounded-2xl backdrop-blur-md space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-black text-white">
                  {month}-р сарын фонт цаг: <span className="text-blue-400">{effectiveMonthlyFontTime} ц</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-black text-white">
                  Гүйцэтгэл: <span className="text-blue-400">{totalExecutionHours}ц</span>
                </p>
              </div>
            </div>
            
            <div className="relative pt-7 pb-1">
              <div 
                className="absolute top-0 transition-all duration-1000 flex flex-col items-center"
                style={{ 
                  left: `${executionPointerPercent}%`,
                  transform: 'translateX(-50%)'
                }}
              >
                <div className="bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 rounded-md backdrop-blur-sm mb-1">
                  <span className="text-xs font-black text-white">{executionPercentage}%</span>
                </div>
                <div className="w-px h-3 bg-gradient-to-b from-blue-500 to-transparent"></div>
              </div>

              <div className="h-2.5 bg-gray-800/50 rounded-full overflow-hidden flex border border-gray-700/30">
                <div 
                  className="h-full bg-white transition-all duration-1000 shadow-[0_0_10px_rgba(255,255,255,0.2)]"
                  style={{ width: getProgressWidth(regularWorkedHours) }}
                />
                <div 
                  className="h-full bg-red-500 transition-all duration-1000 shadow-[0_0_10px_rgba(239,68,68,0.2)]"
                  style={{ width: getProgressWidth(sickHours) }}
                />
                <div 
                  className="h-full bg-orange-500 transition-all duration-1000 shadow-[0_0_10px_rgba(249,115,22,0.2)]"
                  style={{ width: getProgressWidth(leaveHours) }}
                />
              </div>
            </div>

            <AnimatePresence>
              {isStatsExpanded && (
                <motion.div 
                  initial={{ height: 0, opacity: 0, marginTop: 0 }}
                  animate={{ height: 'auto', opacity: 1, marginTop: 12 }}
                  exit={{ height: 0, opacity: 0, marginTop: 0 }}
                  transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div className="bg-gray-800/20 p-3 rounded-xl border border-gray-800/50 flex flex-col items-center justify-center gap-0.5">
                      <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">АЖИЛЛАСАН</p>
                      <p className="text-lg font-black text-white">{regularWorkedHours}ц</p>
                    </div>
                    <div className="bg-gray-800/20 p-3 rounded-xl border border-gray-800/50 flex flex-col items-center justify-center gap-0.5">
                      <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">өвчтэй</p>
                      <p className="text-lg font-black text-red-500">{sickHours}ц</p>
                    </div>
                    <div className="bg-gray-800/20 p-3 rounded-xl border border-gray-800/50 flex flex-col items-center justify-center gap-0.5">
                      <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">чөлөө</p>
                      <p className="text-lg font-black text-orange-500">{leaveHours}ц</p>
                    </div>
                    <div className="bg-gray-800/20 p-3 rounded-xl border border-gray-800/50 flex flex-col items-center justify-center gap-0.5">
                      <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">БАЯРЫН ӨДӨР</p>
                      <p className="text-lg font-black text-blue-500">{holidayWorkedHours}ц</p>
                    </div>
                    <div className="bg-gray-800/20 p-3 rounded-xl border border-gray-800/50 flex flex-col items-center justify-center gap-0.5">
                      <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">ИЛҮҮ ЦАГ</p>
                      <p className="text-lg font-black text-green-500">{overtimeHours}ц</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button 
            onClick={() => setIsStatsExpanded(!isStatsExpanded)}
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 p-1.5 rounded-full bg-gray-900 border border-gray-800 text-gray-500 hover:text-white hover:border-gray-600 transition-all duration-300 shadow-xl z-10"
          >
            <ChevronDown 
              size={16} 
              className={`transition-transform duration-500 ${isStatsExpanded ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        <div 
          id="schedule-container"
          className="relative grid grid-cols-1 gap-3 max-h-[calc(100vh-320px)] overflow-y-auto pr-2 custom-scrollbar scroll-smooth"
        >
          {displayDays.map(({ date, isToday, isTomorrow, isYesterday, isPast }, idx) => {
            const dateKey = formatDateKey(date);
            const dayData = schedule[dateKey] || { shifts: [] };
            const isSubmitted = submittedMonths.includes(currentMonthKey);

            return (
              <DayRow 
                key={`day-${dateKey}-${idx}`}
                date={date}
                isToday={isToday}
                isTomorrow={isTomorrow}
                isYesterday={isYesterday}
                isPast={isPast}
                dayData={dayData}
                csrProfile={csrProfile}
                isSubmitted={isSubmitted}
                onBookShift={handleBookShift}
                onTradeShift={handleTradeShift}
                nowTick={nowTick}
              />
            );
          })}
        </div>
      </div>
    );
  };

  const renderNotificationsView = () => {
    const sortedNotifications = [...notifications]
      .filter(n => {
        // Only show general notifications in this view
        if (n.type !== 'general' && n.type !== 'important') return false;
        
        // If it's a targeted notification, only show if it matches current user
        if (n.targetUserId) {
          return n.targetUserId === csrProfile.id;
        }
        // If it's an old notification or general one without targetUserId, show to everyone (fallback)
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="space-y-4">
          {sortedNotifications.map((notif, index) => {
            const seen = notif.seenBy?.find(s => s.userId === csrProfile.id);
            const isDeadlinePassed = notif.deadline && new Date(notif.deadline) < new Date();
            const isLatest = index === 0;
            
            return (
              <div 
                key={`notif-${notif.id}-${index}`} 
                onClick={() => !seen && markAsRead(notif.id)}
                className={`p-6 rounded-2xl border transition-all cursor-pointer ${
                  !seen 
                    ? 'bg-blue-600/5 border-blue-500/20 shadow-lg shadow-blue-900/5' 
                    : 'bg-gray-900/40 border-gray-800 opacity-60'
                } ${isLatest ? 'p-8 border-blue-500/40 bg-blue-600/10 opacity-100' : ''}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-4 flex-1">
                    <div className={`${isLatest ? 'w-16 h-16' : 'w-12 h-12'} rounded-xl flex items-center justify-center shrink-0 ${
                      !seen ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
                    }`}>
                      {notif.type === 'training' ? <BookOpen size={isLatest ? 32 : 24} /> : <Bell size={isLatest ? 32 : 24} />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <h4 className={`font-bold ${isLatest ? 'text-2xl' : 'text-lg'} ${!seen ? 'text-white' : 'text-gray-300'}`}>{notif.title}</h4>
                        {notif.type === 'training' && (
                          <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 text-[10px] font-black rounded uppercase border border-purple-500/20">
                            Сургалт
                          </span>
                        )}
                      </div>
                      <p className={`${isLatest ? 'text-lg' : 'text-sm'} text-gray-400 leading-relaxed mb-4`}>{notif.content}</p>
                      
                      <div className="flex flex-wrap items-center gap-6">
                        {notif.deadline && (
                          <div className="flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                            <Calendar size={12} />
                            Хугацаа: <span className={isDeadlinePassed && !seen ? 'text-red-400' : 'text-gray-400'}>
                              {new Date(notif.deadline).toLocaleString()}
                              {isDeadlinePassed && !seen && ' (Хугацаа дууссан)'}
                            </span>
                          </div>
                        )}
                        {seen && (
                          <div className="flex items-center gap-2 text-[10px] font-bold text-green-500 uppercase tracking-wider">
                            <CheckCircle2 size={12} />
                            Үзсэн: {new Date(seen.seenAt).toLocaleString()}
                          </div>
                        )}
                      </div>

                      {notif.tradeRequestId && (
                        <div className="mt-4 p-4 bg-gray-800/50 border border-gray-700 rounded-2xl">
                          {(() => {
                            const request = tradeRequests.find(r => r.id === notif.tradeRequestId);
                            if (!request) return <p className="text-xs text-gray-500 italic">Хүсэлт олдохгүй байна.</p>;
                            
                            if (request.status === 'approved') {
                              return <p className="text-xs text-green-400 font-bold flex items-center gap-2"><CheckCircle2 size={14} /> Зөвшөөрөгдсөн</p>;
                            }
                            if (request.status === 'rejected') {
                              return <p className="text-xs text-red-400 font-bold flex items-center gap-2"><X size={14} /> Татгалзсан</p>;
                            }
                            
                            // If pending and I am the receiver
                            if (request.receiverId === csrProfile.id) {
                              return (
                                <div className="flex gap-2">
                                  <button 
                                    onClick={() => handleDeclineTrade(request)}
                                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold rounded-xl transition-all"
                                  >Татгалзах</button>
                                  <button 
                                    onClick={() => handleAcceptTrade(request)}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all"
                                  >Зөвшөөрөх</button>
                                </div>
                              );
                            }
                            return <p className="text-xs text-blue-400 font-bold italic">Хүлээгдэж байна...</p>;
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {!seen && !isDeadlinePassed && (
                    <button 
                      onClick={() => markAsRead(notif.id)}
                      className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-blue-900/20 flex items-center gap-2 shrink-0"
                    >
                      <CheckCircle2 size={18} />
                      Би үзсэн
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          
          {notifications.length === 0 && (
            <div className="text-center py-20 bg-gray-900/20 border border-dashed border-gray-800 rounded-3xl">
              <Bell size={48} className="mx-auto text-gray-700 mb-4" />
              <p className="text-gray-500 font-bold">Одоогоор мэдэгдэл байхгүй байна.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const [isRequestingVacation, setIsRequestingVacation] = useState(false);
  const [isRequestingHourlyLeave, setIsRequestingHourlyLeave] = useState(false);

  useEffect(() => {
    if (!SHOW_VACATION_FEATURE && activeTab === 'vacation') {
      setActiveTab('schedule');
    }
    if (!SHOW_VACATION_FEATURE && isRequestingVacation) {
      setIsRequestingVacation(false);
    }
  }, [activeTab, isRequestingVacation]);

  const [vacationForm, setVacationForm] = useState<{
    month: string;
    startDate: string;
    endDate: string;
    reason: string;
    type: 'vacation' | 'sick' | 'leave';
  }>({ month: formatMonthKey(new Date()), startDate: '', endDate: '', reason: '', type: 'vacation' });

  const handleRequestVacation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csrProfile) return;
    
    const quota = vacationQuotas.find(q => q.month === vacationForm.month);
    const currentRequests = vacationRequests.filter(r => r.month === vacationForm.month && r.status === 'approved').length;

    if (quota && currentRequests >= quota.limit) {
      alert(`${vacationForm.month} сард амралт авах хүний тоо хэтэрсэн байна. (Квот: ${quota.limit})`);
      return;
    }

    let requestId = Math.random().toString(36).substr(2, 9);

    try {
      const response = await apiClient.post('/requests/vacation', {
        startDate: vacationForm.startDate,
        endDate: vacationForm.endDate,
        reason: vacationForm.reason,
      });
      requestId = response.data?.id || requestId;
    } catch (error: any) {
      console.error('Error requesting vacation:', error);
      alert(error.response?.data?.error || 'Амралтын хүсэлт илгээхэд алдаа гарлаа.');
      return;
    }

    const newRequest: VacationRequest = {
      id: requestId,
      csrId: csrProfile.id,
      csrName: csrProfile.name,
      csrPhoto: csrProfile.photoUrl || '',
      month: vacationForm.month,
      startDate: vacationForm.startDate,
      endDate: vacationForm.endDate,
      reason: vacationForm.reason,
      type: vacationForm.type,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    try {
      addLocalItem('vacationRequests', newRequest);
      logAction('Vacation Requested', `Requested vacation for ${vacationForm.month}`);
      setIsRequestingVacation(false);
      setVacationForm({ month: formatMonthKey(new Date()), startDate: '', endDate: '', reason: '', type: 'vacation' });
    } catch (error) {
      console.error('Error requesting vacation:', error);
    }
  };

  const [hourlyLeaveForm, setHourlyLeaveForm] = useState({
    type: 'hourly',
    date: '',
    endDate: '',
    startTime: '',
    endTime: '',
    reason: ''
  });

  const handleRequestHourlyLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csrProfile) return;

    try {
      const response = await apiClient.post('/requests/leave', {
        type: hourlyLeaveForm.type,
        date: hourlyLeaveForm.date,
        endDate: hourlyLeaveForm.endDate || hourlyLeaveForm.date,
        startTime: hourlyLeaveForm.startTime,
        endTime: hourlyLeaveForm.endTime,
        reason: hourlyLeaveForm.reason,
      });

      const newRequest: HourlyLeaveRequest = {
        id: response.data?.id || Math.random().toString(36).substr(2, 9),
        csrId: csrProfile.id,
        csrName: csrProfile.name,
        type: hourlyLeaveForm.type as 'hourly' | 'daily',
        date: hourlyLeaveForm.date,
        endDate: hourlyLeaveForm.endDate,
        startTime: hourlyLeaveForm.startTime,
        endTime: hourlyLeaveForm.endTime,
        reason: hourlyLeaveForm.reason,
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      const updated = addLocalItem('hourlyLeaveRequests', newRequest);
      setHourlyLeaveRequests(updated);
      logAction('Leave Requested', `Requested ${hourlyLeaveForm.type} leave for ${hourlyLeaveForm.date}`);
      setIsRequestingHourlyLeave(false);
      setHourlyLeaveForm({
        type: 'hourly',
        date: '',
        endDate: '',
        startTime: '',
        endTime: '',
        reason: ''
      });
      triggerSuccess();
    } catch (error: any) {
      console.error('Error requesting hourly leave:', error);
      alert(error.response?.data?.error || 'Чөлөөний хүсэлт илгээхэд алдаа гарлаа.');
    }
  };

  const [selectedMaterial, setSelectedMaterial] = useState<TrainingMaterial | null>(null);

  const markMaterialAsRead = (id: string) => {
    if (!csrProfile) return;
    const material = trainingMaterials.find(m => m.id === id);
    if (material) {
      const alreadySeen = material.seenBy?.some(s => s.userId === csrProfile.id);
      if (!alreadySeen) {
        try {
          const updatedSeenBy = [...(material.seenBy || []), {
            userId: csrProfile.id,
            userName: csrProfile.name,
            seenAt: new Date().toISOString()
          }];
          
          updateLocalItem('trainingMaterials', id, { seenBy: updatedSeenBy });
          
          // Update local state immediately
          setTrainingMaterials(prev => prev.map(m => m.id === id ? { ...m, seenBy: updatedSeenBy } : m));
          
          logAction('Training Material Viewed', `Viewed training material: ${material.title}`);
        } catch (error) {
          console.error('Error marking material as read:', error);
        }
      }
    }
  };

  const renderTrainingView = () => (
    <div className="space-y-8 max-w-6xl mx-auto py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tight">Сургалтын материалууд</h2>
          <p className="text-gray-400 mt-1">Таны мэдлэг чадварыг дээшлүүлэх материалууд.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {trainingMaterials.map((material, idx) => {
          const seen = material.seenBy?.find(s => s.userId === csrProfile.id);
          const isDeadlinePassed = material.deadline && new Date(material.deadline) < new Date();
          
          return (
            <div 
              key={`training-card-${material.id}-${idx}`} 
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
                ) : material.type === 'Image' && material.url.startsWith('data:') ? (
                  <LazyMedia 
                    src={material.url} 
                    alt={material.title} 
                    type="Image" 
                    className="w-full h-full" 
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-gray-600 bg-gray-800/50">
                    {material.type === 'Video' ? <Clock size={40} /> : material.type === 'PDF' ? <FileText size={40} /> : <BookOpen size={40} />}
                    <span className="text-[10px] font-black uppercase mt-2">Зураггүй</span>
                  </div>
                )}
                <div className="absolute top-4 right-4 px-3 py-1 bg-black/60 backdrop-blur-md rounded-full text-[10px] font-black text-white uppercase border border-white/10">
                  {material.type}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h4 className="font-bold text-white text-xl group-hover:text-blue-400 transition-colors">{material.title}</h4>
                  {seen && <CheckCircle2 size={18} className="text-green-500" />}
                </div>
                <p className="text-sm text-gray-500 mt-2 line-clamp-2 leading-relaxed">{material.description}</p>
                <div className="space-y-2 mt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px] font-black text-gray-600 uppercase tracking-widest">
                      <Calendar size={12} />
                      {material.date}
                    </div>
                    {material.deadline && (
                      <div className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${isDeadlinePassed && !seen ? 'text-red-500' : 'text-gray-500'}`}>
                        <Clock size={12} />
                        Хугацаа: {new Date(material.deadline).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {trainingMaterials.length === 0 && (
          <div className="col-span-full text-center py-20 bg-gray-900/20 border border-dashed border-gray-800 rounded-3xl">
            <BookOpen size={48} className="mx-auto text-gray-700 mb-4" />
            <p className="text-gray-500 font-bold">Одоогоор сургалтын материал байхгүй байна.</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderVacationView = () => {
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    return (
      <div className="max-w-6xl mx-auto py-4 sm:py-8 space-y-6 sm:space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl sm:text-3xl font-outfit font-black text-white tracking-tight">Ээлжийн амралт</h2>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">{vacationYear} оны амралт захиалах хэсэг.</p>
          </div>
          
          <div className="relative">
            <button 
              onClick={() => setIsVacationFilterOpen(!isVacationFilterOpen)}
              className="flex items-center gap-2 bg-gray-800 border border-gray-700 text-white px-4 py-2.5 rounded-xl font-bold hover:border-blue-500 transition-all"
            >
              <Filter size={18} className="text-blue-400" />
              <span className="text-sm">{vacationYear} он</span>
            </button>

            <AnimatePresence>
              {isVacationFilterOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute right-0 mt-2 w-48 bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-2 z-50"
                >
                  {[2026, 2027, 2028].map(year => (
                    <button
                      key={year}
                      onClick={() => {
                        setVacationYear(year);
                        setIsVacationFilterOpen(false);
                      }}
                      className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                        vacationYear === year ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                      }`}
                    >
                      {year} он
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
          {months.map(m => {
            const monthStr = `${vacationYear}-${String(m).padStart(2, '0')}`;
            const isPast = vacationYear < currentYear || (vacationYear === currentYear && m < currentMonth);
            const quota = vacationQuotas.find(q => q.month === monthStr) || { month: monthStr, limit: 5 };
            const approved = vacationRequests.filter(r => r.month === monthStr && r.status === 'approved').length;
            const pending = vacationRequests.filter(r => r.month === monthStr && r.status === 'pending').length;
            const totalRequested = approved + pending;
            const isFull = totalRequested >= quota.limit;
            const alreadyRequested = vacationRequests.some(r => r.month === monthStr && r.csrId === csrProfile.id);

            return (
              <div 
                key={monthStr}
                className={`relative p-6 rounded-3xl border transition-all duration-500 ${
                  isPast 
                    ? 'bg-gray-900/20 border-gray-800/50 opacity-40 grayscale' 
                    : 'bg-gray-900/40 border-gray-800 hover:border-blue-500/30 group'
                }`}
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-1">
                      {vacationYear}
                    </span>
                    <h3 className="text-2xl font-outfit font-black text-white">
                      {ENG_MONTHS[m-1]}
                    </h3>
                  </div>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    isPast ? 'bg-gray-800 text-gray-600' : 'bg-blue-500/10 text-blue-400'
                  }`}>
                    <Palmtree size={20} />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Квот</span>
                    <span className={`text-xs font-black ${isFull ? 'text-red-400' : 'text-blue-400'}`}>
                      {totalRequested} / {quota.limit}
                    </span>
                  </div>
                  
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-1000 ${isFull ? 'bg-red-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.min((totalRequested / quota.limit) * 100, 100)}%` }}
                    />
                  </div>

                  <button
                    disabled={isPast || isFull || alreadyRequested}
                    onClick={() => {
                      setVacationForm(prev => ({ ...prev, month: monthStr }));
                      setIsRequestingVacation(true);
                    }}
                    className={`w-full py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                      isPast || isFull || alreadyRequested
                        ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-900/20 active:scale-95'
                    }`}
                  >
                    {alreadyRequested ? 'Захиалсан' : isPast ? 'Хугацаа дууссан' : isFull ? 'Дүүрсэн' : 'Захиалах'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderHourlyLeaveView = () => (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tight">Чөлөө</h2>
          <p className="text-gray-400 mt-1">Чөлөө авах хүсэлт илгээх болон хянах.</p>
        </div>
        <button 
          onClick={() => setIsRequestingHourlyLeave(true)}
          className="flex items-center gap-3 px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-2xl transition-all shadow-xl shadow-blue-900/20 uppercase tracking-widest text-xs"
        >
          <Plus size={18} />
          Шинэ хүсэлт
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-900/40 border border-gray-800 rounded-3xl p-8 backdrop-blur-xl">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500">
              <History size={20} />
            </div>
            <h3 className="text-xl font-black text-white">Миний хүсэлтүүд</h3>
          </div>

          <div className="space-y-4">
            {hourlyLeaveRequests.length > 0 ? (
              hourlyLeaveRequests.map((req) => (
                <div key={req.id} className="p-5 bg-black/30 border border-white/5 rounded-2xl flex items-center justify-between group hover:border-white/10 transition-all">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                       <span className="text-sm font-black text-white">{req.date}</span>
                       <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${
                         req.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                         req.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                         'bg-orange-500/20 text-orange-400'
                       }`}>
                         {req.status === 'approved' ? 'Зөвшөөрсөн' :
                          req.status === 'rejected' ? 'Татгалзсан' :
                          'Хүлээгдэж байна'}
                       </span>
                    </div>
                    <p className="text-xs text-gray-500 flex items-center gap-2">
                      {req.type === 'daily' ? (
                        <>
                          <Calendar size={12} /> {req.date} {req.endDate && req.endDate !== req.date ? `- ${req.endDate}` : ''}
                        </>
                      ) : (
                        <>
                          <Clock size={12} /> {req.startTime} - {req.endTime}
                        </>
                      )}
                    </p>
                    <p className="text-[10px] text-gray-600 italic">"{req.reason}"</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12 opacity-50">
                <Clock size={40} className="mx-auto text-gray-700 mb-3" />
                <p className="text-xs font-bold text-gray-500">Хүсэлт одоогоор байхгүй байна</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-600/10 to-purple-600/10 border border-blue-500/20 rounded-3xl p-8 backdrop-blur-xl">
           <h3 className="text-xl font-black text-white mb-4">Санамж</h3>
           <ul className="space-y-4">
             {[
               'Чөлөө авах хүсэлтийг 24 цагийн өмнө илгээнэ үү.',
               'Чөлөө авсан тохиолдолд тухайн цагийн квот нөхөгдөх болно.',
               'Яаралтай тохиолдолд шууд ахлах ажилтантайгаа холбогдоно уу.'
             ].map((item, i) => (
               <li key={i} className="flex gap-4 text-sm text-gray-400 leading-relaxed font-medium">
                 <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 shrink-0 text-[10px] font-black">{i+1}</div>
                 {item}
               </li>
             ))}
           </ul>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-white overflow-hidden font-sans">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        unreadCount={unreadCount} 
        unreadTrainingCount={unreadTrainingCount}
        onChangePassword={() => setIsChangingPassword(true)}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        role="csr"
      />
      
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <header className="h-16 sm:h-20 border-b border-gray-800 flex items-center justify-between px-4 sm:px-8 bg-gray-900/30 backdrop-blur-md z-40 relative">
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            {activeTab === 'schedule' ? 'Ажлын хуваарь' : SHOW_VACATION_FEATURE && activeTab === 'vacation' ? 'Ээлжийн амралт' : activeTab === 'hourlyLeave' ? 'Чөлөө' : activeTab === 'training' ? 'Сургалт' : 'Мэдэгдэл'}
          </h1>
          
          <div className="flex items-center gap-6">
            {activeTab === 'schedule' && (
              <div className="relative">
                <button 
                  onClick={() => {
                    setIsFilterOpen(!isFilterOpen);
                    setFilterStep('year');
                  }}
                  className="flex items-center gap-2 bg-gray-800 border border-gray-700 text-white px-4 py-2.5 rounded-xl font-bold hover:border-blue-500 transition-all"
                >
                  <Filter size={18} className="text-blue-400" />
                  <span className="text-sm">Шүүлтүүр</span>
                </button>

                <AnimatePresence>
                  {isFilterOpen && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-64 bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl z-50 p-4 backdrop-blur-xl"
                    >
                      {filterStep === 'year' ? (
                        <div className="space-y-4">
                          <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.3em] mb-4 text-center">Он сонгох</p>
                          <div className="grid grid-cols-1 gap-2">
                            {[2025, 2026, 2027].map(y => (
                              <button
                                key={`year-filter-${y}`}
                                onClick={() => {
                                  setTempYear(y);
                                  setFilterStep('month');
                                }}
                                className={`py-4 rounded-2xl font-black text-xl transition-all border ${
                                  tempYear === y 
                                    ? 'bg-blue-600 border-blue-400 text-white shadow-xl shadow-blue-900/40 scale-[1.02]' 
                                    : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:bg-gray-800 hover:border-gray-600'
                                }`}
                              >
                                {y}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between mb-4 px-1">
                            <h4 className="text-2xl font-black text-white tracking-tight">{tempYear} он</h4>
                            <button 
                              onClick={() => setFilterStep('year')}
                              className="text-xs font-black text-blue-400 uppercase tracking-widest hover:text-blue-300 transition-colors"
                            >
                              Буцах
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {ENG_MONTHS.map((m, idx) => {
                              const monthVal = (idx + 1).toString().padStart(2, '0');
                              const fullVal = `${tempYear}-${monthVal}`;
                              const isSelected = selectedMonth === fullVal;
                              return (
                                <button
                                  key={`month-filter-${m}-${idx}`}
                                  onClick={() => {
                                    setSelectedMonth(fullVal);
                                    setIsFilterOpen(false);
                                  }}
                                  className={`py-3 rounded-xl text-sm font-black transition-all border ${
                                    isSelected 
                                      ? 'bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-900/20' 
                                      : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:bg-gray-800 hover:border-gray-600'
                                  }`}
                                >
                                  {m}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <DigitalClock months={ENG_MONTHS} weekdays={['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']} />

            <button 
              onClick={() => setActiveTab('notifications')}
              className="relative p-2.5 text-gray-400 hover:text-white transition-all hover:bg-white/5 rounded-xl border border-transparent hover:border-white/10"
            >
              <Bell size={22} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full border-2 border-[#0a0a0a] shadow-lg">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <div className="flex-1 p-4 sm:p-8 overflow-y-auto">
          {activeTab === 'schedule' && renderScheduleView()}
          {activeTab === 'notifications' && renderNotificationsView()}
          {SHOW_VACATION_FEATURE && activeTab === 'vacation' && renderVacationView()}
          {activeTab === 'hourlyLeave' && renderHourlyLeaveView()}
          {activeTab === 'training' && renderTrainingView()}
        </div>

        <ChatWindow isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
        <button 
          onClick={() => setIsChatOpen(!isChatOpen)}
          className="absolute bottom-6 right-6 sm:bottom-8 sm:right-8 p-3.5 sm:p-4 rounded-full bg-pink-500 text-white shadow-2xl hover:shadow-pink-500/40 transform hover:-translate-y-1 hover:scale-105 transition-all duration-300 z-50"
          aria-label="Open Chat"
        >
          <MessageCircle size={24} />
        </button>
      </main>

      {/* Vacation Request Modal */}
      <AnimatePresence>
        {SHOW_VACATION_FEATURE && isRequestingVacation && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsRequestingVacation(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
              <h2 className="text-2xl font-black text-white mb-6">Ээлжийн амралт</h2>
              <form onSubmit={handleRequestVacation} className="space-y-4">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 mb-4">
                  <div className="flex items-center gap-3 text-blue-400">
                    <Calendar size={20} />
                    <span className="font-bold">{formatMonthEng(vacationForm.month)}</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Эхлэх</label>
                    <input 
                      type="date" 
                      required
                      value={vacationForm.startDate}
                      onChange={e => setVacationForm(prev => ({ ...prev, startDate: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Дуусах</label>
                    <input 
                      type="date" 
                      required
                      value={vacationForm.endDate}
                      onChange={e => setVacationForm(prev => ({ ...prev, endDate: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Шалтгаан</label>
                  <textarea 
                    required
                    value={vacationForm.reason}
                    onChange={e => setVacationForm(prev => ({ ...prev, reason: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 h-24 resize-none"
                    placeholder="Амралт авах шалтгаан..."
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setIsRequestingVacation(false)} className="flex-1 py-3 bg-gray-800 text-white font-bold rounded-xl hover:bg-gray-700 transition-all">Цуцлах</button>
                  <button type="submit" className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/20">Илгээх</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Change Password Modal */}
      <AnimatePresence>
        {isChangingPassword && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsChangingPassword(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
              <button onClick={() => setIsChangingPassword(false)} className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors">
                <X size={24} />
              </button>
              <h2 className="text-2xl font-black text-white mb-6">Нууц үг солих</h2>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Хуучин нууц үг</label>
                  <input type="password" value={passwordForm.old} onChange={(e) => setPasswordForm({...passwordForm, old: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" required />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Шинэ нууц үг</label>
                  <input type="password" value={passwordForm.new} onChange={(e) => setPasswordForm({...passwordForm, new: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" required />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Шинэ нууц үг давтах</label>
                  <input type="password" value={passwordForm.confirm} onChange={(e) => setPasswordForm({...passwordForm, confirm: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" required />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setIsChangingPassword(false)} className="flex-1 py-3 bg-gray-800 text-white rounded-xl font-bold">Цуцлах</button>
                  <button type="submit" className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold">Хадгалах</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Material Viewer Modal */}
        {selectedMaterial && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedMaterial(null)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-5xl bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
              <div className="p-6 border-b border-gray-800 flex items-center justify-between bg-gray-900/50 backdrop-blur-xl">
                <div className="flex-1">
                  <h2 className="text-xl font-black text-white">{selectedMaterial.title}</h2>
                  <p className="text-xs text-gray-500 mt-1">{selectedMaterial.description}</p>
                </div>
                <div className="flex items-center gap-3">
                  {(() => {
                    const isDeadlinePassed = selectedMaterial.deadline && new Date(selectedMaterial.deadline) < new Date();
                    const alreadySeen = selectedMaterial.seenBy?.some(s => s.userId === csrProfile.id);
                    
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
                  <button onClick={() => setSelectedMaterial(null)} className="p-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-xl transition-all">
                    <X size={24} />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-auto bg-black flex items-center justify-center p-4">
                {selectedMaterial.type === 'Image' ? (
                  <LazyMedia 
                    src={selectedMaterial.url} 
                    alt={selectedMaterial.title} 
                    type="Image" 
                    className="max-w-full max-h-full rounded-xl" 
                    objectFit="contain"
                  />
                ) : selectedMaterial.type === 'Video' ? (
                  <LazyMedia 
                    src={selectedMaterial.url} 
                    type="Video" 
                    className="max-w-full max-h-full rounded-xl" 
                    objectFit="contain"
                  />
                ) : selectedMaterial.type === 'PDF' ? (
                  <iframe src={selectedMaterial.url} className="w-full h-full min-h-[60vh] rounded-xl border-none" title={selectedMaterial.title} />
                ) : (
                  <div className="text-center space-y-6 p-12">
                    <div className="w-20 h-20 bg-blue-600/10 rounded-3xl flex items-center justify-center mx-auto border border-blue-500/20">
                      <FileText size={40} className="text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white mb-2">{selectedMaterial.type === 'File' ? 'Файл татах' : 'Гадна холбоос'}</h3>
                      <p className="text-gray-400 max-w-md mx-auto">
                        {selectedMaterial.type === 'File' 
                          ? 'Энэ материалыг шууд үзэх боломжгүй тул татаж авч үзнэ үү.' 
                          : 'Энэ материал нь гадны вэбсайт дээр байрлаж байна. Та доорх товчийг дарж шинэ цонхонд нээнэ үү.'}
                      </p>
                    </div>
                    <a 
                      href={selectedMaterial.url} 
                      download={selectedMaterial.type === 'File' ? selectedMaterial.title : undefined}
                      target={selectedMaterial.type === 'File' ? undefined : "_blank"} 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-8 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/20"
                    >
                      {selectedMaterial.type === 'File' ? 'Файлыг татах' : 'Холбоосыг нээх'}
                      {selectedMaterial.type === 'File' ? <Download size={20} /> : <ExternalLink size={20} />}
                    </a>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
        {/* Booking Modal */}
        <AnimatePresence>
          {bookingModal?.isOpen && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setBookingModal(null)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-black text-white">Ээлж захиалах</h2>
                    <p className="text-gray-400 text-sm mt-1">{bookingModal.dateKey}</p>
                  </div>
                  <button onClick={() => setBookingModal(null)} className="p-2 hover:bg-gray-800 rounded-full transition-colors">
                    <X size={24} className="text-gray-500" />
                  </button>
                </div>

                <div className="space-y-4 mb-8">
                  {(schedule[bookingModal.dateKey]?.shifts || []).map((shift, idx) => {
                    const isFull = shift.bookedSlots >= shift.totalSlots;
                    const dayData = schedule[bookingModal.dateKey];
                    const waves = getBookingWavesForShift(shift, !!dayData?.bookingOpen, dayData?.bookingOpenAt || '', dayData?.bookingCloseAt || '');
                    return (
                      <div
                        key={`booking-shift-${shift.id}-${idx}`}
                        className={`p-5 rounded-2xl border transition-all ${
                          isFull
                            ? 'bg-gray-800/20 border-gray-800 opacity-70'
                            : 'bg-gray-800/40 border-gray-700 hover:border-blue-500/50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-3">
                              <Clock size={20} className={isFull ? 'text-gray-600' : 'text-blue-400'} />
                              <span className="text-lg font-bold text-white">{formatShiftTimeForDisplay(shift.time)}</span>
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Нийт: {shift.bookedSlots}/{shift.totalSlots}</p>
                          </div>
                          {isFull && (
                            <span className="px-2 py-0.5 bg-red-500/10 text-red-500 text-[10px] font-black rounded uppercase">Дүүрсэн</span>
                          )}
                        </div>

                        <div className="mt-4 border-t border-white/5 pt-4 space-y-3">
                          <div className="w-full relative h-10 px-1 mt-2">
                            <div className="absolute top-1/2 left-0 right-14 h-1.5 -translate-y-1/2 bg-gray-800 rounded-full" />
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min(100, (shift.bookedSlots / Math.max(1, shift.totalSlots)) * 100)}%` }}
                              className={`absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full z-10 ${isFull ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]' : 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.4)]'}`}
                              style={{ maxWidth: 'calc(100% - 3.5rem)' }}
                            />
                            <motion.div
                              animate={{ left: `${Math.min(100, (shift.bookedSlots / Math.max(1, shift.totalSlots)) * 100)}%` }}
                              transition={{ type: "spring", stiffness: 100, damping: 20 }}
                              className="absolute top-0 -translate-x-1/2 flex flex-col items-center z-20"
                              style={{ maxWidth: 'calc(100% - 3.5rem)' }}
                            >
                              <div className={`text-[12px] font-outfit font-black text-white min-w-[30px] h-[30px] flex items-center justify-center rounded-full shadow-2xl ${isFull ? 'bg-red-600' : 'bg-blue-600'} border-2 border-gray-900`}>
                                {shift.bookedSlots}
                              </div>
                              <div className={`w-0.5 h-1.5 ${isFull ? 'bg-red-600' : 'bg-blue-600'} mt-0.5`} />
                            </motion.div>
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-4">
                              <span className="text-[14px] font-outfit font-black text-gray-500">{shift.totalSlots}</span>
                            </div>
                          </div>

                          <div className="space-y-2">
                            {waves.map(wave => {
                              const booked = getWaveBookedCount(shift, wave.id);
                              const waveFull = booked >= wave.slotLimit;
                              const waveAccess = getWaveAccessState(wave, nowTick);
                              const waveOpen = waveAccess.state === 'open';
                              const canBook = !isFull && !waveFull && waveOpen;
                              const statusLabel = waveFull
                                ? 'Дүүрсэн'
                                : waveAccess.label;
                              return (
                                <div key={wave.id} className={`rounded-2xl border p-3 ${canBook ? 'border-blue-500/30 bg-blue-500/5' : 'border-white/5 bg-black/20 opacity-70'}`}>
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <p className="text-xs font-black text-white">{wave.name}</p>
                                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                                        {booked}/{wave.slotLimit} {statusLabel}
                                      </p>
                                    </div>
                                    {canBook ? (
                                      <button
                                        onClick={() => {
                                          handleBookShift(bookingModal.dateKey, shift.id, wave.id);
                                          setBookingModal(null);
                                        }}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-blue-500/20"
                                      >
                                        Сонгох
                                      </button>
                                    ) : (
                                      <span className="rounded-xl bg-gray-800 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-500">
                                        {waveFull ? 'Дүүрсэн' : waveAccess.state === 'expired' ? 'Хаагдсан' : waveAccess.state === 'scheduled' ? 'Хүлээгдэж байна' : 'Хаалттай'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                       </div>
                    );
                  })}
                </div>

                <button 
                  onClick={() => setBookingModal(null)}
                  className="w-full py-4 bg-gray-800 text-white font-bold rounded-2xl hover:bg-gray-700 transition-all"
                >
                  Болих
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Trade Request Modal */}
        <AnimatePresence>
          {tradingModal?.isOpen && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setTradingModal(null)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
                <h2 className="text-2xl font-black text-white mb-2">Ээлж солих</h2>
                
                {tradingModal.step === 'times' ? (
                  <>
                    <p className="text-gray-400 text-sm mb-6">{tradingModal.dateKey} өдрийн боломжит ээлжүүд:</p>
                    <div className="space-y-3 mb-8">
                      {(schedule[tradingModal.dateKey]?.shifts || [])
                        .filter(s => !s.isBookedByMe)
                        .map((shift, idx) => (
                          <button 
                            key={`trade-shift-${shift.id}-${idx}`}
                            onClick={() => setTradingModal({ ...tradingModal, step: 'employees', shift })}
                            className="w-full flex items-center justify-between p-4 bg-gray-800/50 border border-gray-700 rounded-2xl hover:border-blue-500/50 transition-all group"
                          >
                            <div className="flex items-center gap-3">
                              <Clock size={18} className="text-blue-400" />
                              <span className="font-bold text-white">{formatShiftTimeForDisplay(shift.time)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">{shift.bookedSlots} ажилтан</span>
                              <ChevronDown size={16} className="text-gray-600 group-hover:text-blue-400 -rotate-90" />
                            </div>
                          </button>
                        ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-4">
                      <button 
                        onClick={() => setTradingModal({ ...tradingModal, step: 'times', shift: undefined })}
                        className="p-1 text-gray-500 hover:text-white transition-colors"
                      >
                        <ChevronDown size={20} className="rotate-90" />
                      </button>
                      <p className="text-gray-400 text-sm">{formatShiftTimeForDisplay(tradingModal.shift?.time)} ээлжинд байгаа ажилтнууд:</p>
                    </div>
                    
                    <div className="space-y-3 mb-8">
                      {tradingModal.shift?.bookedBy?.filter(u => u.userId !== csrProfile.id).length ? (
                        tradingModal.shift.bookedBy
                          .filter(u => u.userId !== csrProfile.id)
                          .map((user, idx) => (
                            <div key={`trade-user-${user.userId}-${idx}`} className="flex items-center justify-between p-4 bg-gray-800/50 border border-gray-700 rounded-2xl">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center font-bold text-white">
                                  {user.userName[0]}
                                </div>
                                <span className="font-bold text-white">{user.userName}</span>
                              </div>
                              <button 
                                onClick={() => handleSendTradeRequest(user.userId, user.userName, tradingModal.shift!.id, tradingModal.shift!.time, tradingModal.dateKey)}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all"
                              >
                                Солих хүсэлт
                              </button>
                            </div>
                          ))
                      ) : (
                        <div className="text-center py-8 text-gray-500 italic text-sm">
                          Энэ ээлжинд өөр ажилтан байхгүй байна.
                        </div>
                      )}
                    </div>
                  </>
                )}

                <button onClick={() => setTradingModal(null)} className="w-full py-3 bg-gray-800 text-white font-bold rounded-xl hover:bg-gray-700 transition-all">Хаах</button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Incoming Trade Requests */}
        {(() => {
          const incoming = tradeRequests.find(r => r.receiverId === csrProfile.id && r.status === 'pending');
          if (!incoming) return null;

          return (
            <div className="fixed bottom-24 right-8 z-[120]">
              <motion.div 
                initial={{ opacity: 0, x: 50 }} 
                animate={{ opacity: 1, x: 0 }} 
                className="bg-gray-900 border border-blue-500/30 p-6 rounded-3xl shadow-2xl w-80"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center">
                    <ArrowRightLeft size={20} className="text-white" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white">Ээлж солих хүсэлт</h4>
                    <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Шинэ хүсэлт</p>
                  </div>
                </div>
                <p className="text-sm text-gray-300 mb-6">
                  <span className="font-bold text-white">{incoming.senderName}</span> таны <span className="text-blue-400 font-bold">{formatShiftTimeForDisplay(incoming.receiverShiftTime)}</span> ээлжийг өөрийн <span className="text-purple-400 font-bold">{formatShiftTimeForDisplay(incoming.senderShiftTime)}</span> ээлжээр солих хүсэлт ирүүллээ.
                </p>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleDeclineTrade(incoming)}
                    className="flex-1 py-2.5 bg-gray-800 text-white text-xs font-bold rounded-xl hover:bg-gray-700 transition-all"
                  >Татгалзах</button>
                  <button 
                    onClick={() => handleAcceptTrade(incoming)}
                    className="flex-1 py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition-all"
                  >Зөвшөөрөх</button>
                </div>
              </motion.div>
            </div>
          );
        })()}

        {/* Hourly Leave Request Modal */}
        <AnimatePresence>
          {isRequestingHourlyLeave && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsRequestingHourlyLeave(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                  <Clock size={120} className="text-blue-500" />
                </div>

                <div className="relative">
                  <h2 className="text-2xl font-black text-white mb-6 tracking-tight">Чөлөө авах</h2>
                  <form onSubmit={handleRequestHourlyLeave} className="space-y-4">
                    <div className="flex bg-gray-800 p-1 rounded-xl mb-4">
                      <button
                        type="button"
                        onClick={() => setHourlyLeaveForm(prev => ({ ...prev, type: 'hourly' }))}
                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                          hourlyLeaveForm.type === 'hourly' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'
                        }`}
                      >
                        Цагаар
                      </button>
                      <button
                        type="button"
                        onClick={() => setHourlyLeaveForm(prev => ({ ...prev, type: 'daily' }))}
                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                          hourlyLeaveForm.type === 'daily' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'
                        }`}
                      >
                        Өдрөөр
                      </button>
                    </div>

                    <div className={hourlyLeaveForm.type === 'daily' ? 'grid grid-cols-2 gap-4' : ''}>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">
                          {hourlyLeaveForm.type === 'daily' ? 'Эхлэх огноо' : 'Огноо'}
                        </label>
                        <input 
                          type="date" 
                          required
                          value={hourlyLeaveForm.date}
                          onChange={e => setHourlyLeaveForm(prev => ({ ...prev, date: e.target.value }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 transition-all shadow-inner"
                        />
                      </div>
                      
                      {hourlyLeaveForm.type === 'daily' && (
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Дуусах огноо</label>
                          <input 
                            type="date" 
                            required
                            value={hourlyLeaveForm.endDate}
                            onChange={e => setHourlyLeaveForm(prev => ({ ...prev, endDate: e.target.value }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 transition-all shadow-inner"
                          />
                        </div>
                      )}
                    </div>
                    
                    {hourlyLeaveForm.type === 'hourly' && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Эхлэх цаг</label>
                          <input 
                            type="time" 
                            required
                            value={hourlyLeaveForm.startTime}
                            onChange={e => setHourlyLeaveForm(prev => ({ ...prev, startTime: e.target.value }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 transition-all shadow-inner"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Дуусах цаг</label>
                          <input 
                            type="time" 
                            required
                            value={hourlyLeaveForm.endTime}
                            onChange={e => setHourlyLeaveForm(prev => ({ ...prev, endTime: e.target.value }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 transition-all shadow-inner"
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Шалтгаан</label>
                      <textarea 
                        required
                        value={hourlyLeaveForm.reason}
                        onChange={e => setHourlyLeaveForm(prev => ({ ...prev, reason: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 h-24 resize-none transition-all shadow-inner"
                        placeholder="Чөлөө авах шалтгаанаа тодорхой бичнэ үү..."
                      />
                    </div>

                    <div className="pt-4 flex gap-3">
                      <button type="button" onClick={() => setIsRequestingHourlyLeave(false)} className="flex-1 py-4 bg-gray-800 text-white font-black rounded-xl hover:bg-gray-700 transition-all uppercase tracking-widest text-xs">Цуцлах</button>
                      <button type="submit" className="flex-1 py-4 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-900/20 uppercase tracking-widest text-xs">Илгээх</button>
                    </div>
                  </form>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Success Toast */}
        <AnimatePresence>
          {showSuccess && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-green-600 text-white px-6 py-3 rounded-xl font-bold shadow-2xl flex items-center gap-3 border border-green-400/30"
            >
              <CheckCircle2 size={20} />
              Амжилттай!
            </motion.div>
          )}
        </AnimatePresence>
      </AnimatePresence>
    </div>
  );
}
