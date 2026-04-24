import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

const DEFAULT_WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DEFAULT_MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];

interface DigitalClockProps {
  months?: string[];
  weekdays?: string[];
}

export const DigitalClock: React.FC<DigitalClockProps> = ({ 
  months = DEFAULT_MONTHS, 
  weekdays = DEFAULT_WEEKDAYS 
}) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const currentHour = String(time.getHours()).padStart(2, '0');
  const currentMinute = String(time.getMinutes()).padStart(2, '0');
  const currentSecond = String(time.getSeconds()).padStart(2, '0');
  const currentDay = time.getDate();
  const currentDayName = weekdays[time.getDay()];
  const currentMonth = months[time.getMonth()];

  return (
    <div className="flex items-center gap-5">
      <div className="flex flex-col items-center">
        <span className="text-[11px] font-black text-[#00a3ff] uppercase tracking-[0.1em] leading-none mb-1.5">Өнөөдөр</span>
        <span className="text-[14px] font-black text-white whitespace-nowrap uppercase tracking-tight">{currentMonth} {currentDay}, {currentDayName}</span>
      </div>
      
      <div className="w-px h-7 bg-white/10"></div>
      
      <div className="flex items-center gap-4 bg-[#111418] border border-white/5 px-6 py-2.5 rounded-[1.2rem] shadow-2xl relative group">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500/10 border border-green-500/20 mr-1">
          <Clock size={18} className="text-[#00e676]" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-2xl font-black tracking-tighter text-white tabular-nums leading-none">{currentHour}</span>
          <span className="text-gray-600 font-bold text-lg leading-none">:</span>
          <span className="text-2xl font-black tracking-tighter text-white tabular-nums leading-none">{currentMinute}</span>
          <span className="text-gray-600 font-bold text-lg leading-none">:</span>
          <span className="text-2xl font-black tracking-tighter text-[#00a3ff] tabular-nums leading-none">{currentSecond}</span>
        </div>
      </div>
    </div>
  );
};
