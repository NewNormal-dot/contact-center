import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar, 
  Clock, 
  Bell, 
  BookOpen, 
  MessageCircle, 
  Sparkles, 
  Search, 
  LogOut, 
  CheckCircle, 
  X,
  AlertCircle,
  ArrowLeftRight,
  History,
  Palmtree,
  Plus,
  RefreshCw,
  FileText,
  ChevronDown
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/api-client';
import Sidebar from '../../components/Sidebar';
import SettingsModal from '../../components/SettingsModal';
import { User, WorkSlot, LeaveRequest, VacationRequest, TradeRequest } from '../../types';

export default function CsrDashboard() {
  const navigate = useNavigate();
  const { logout, user: authUser } = useAuth();
  const [activeTab, setActiveTab] = useState('schedule');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // States
  const [slots, setSlots] = useState<WorkSlot[]>([]);
  const [myBookings, setMyBookings] = useState<any[]>([]);
  const [trades, setTrades] = useState<TradeRequest[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [trainings, setTrainings] = useState<any[]>([]);
  const [activeMonth, setActiveMonth] = useState(new Date().toISOString().slice(0, 7));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    fetchData();
  }, [activeTab, activeMonth]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const slotsRes = await apiClient.get('/slots');
      setSlots(slotsRes.data);
      
      const bookingsRes = await apiClient.get('/slots/my-bookings');
      setMyBookings(bookingsRes.data);

      const tradesRes = await apiClient.get('/trades');
      setTrades(tradesRes.data);
      const notificationRes = await apiClient.get('/broadcasts/notifications');
      setNotifications(notificationRes.data);
      const trainingRes = await apiClient.get('/broadcasts/trainings');
      setTrainings(trainingRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBookSlot = async (slotId: string) => {
    try {
      await apiClient.post(`/slots/${slotId}/book`);
      fetchData();
      alert('Амжилттай захиаллаа');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Захиалга амжилтгүй');
    }
  };

  const handleCancelBooking = async (slotId: string) => {
    try {
       await apiClient.post(`/slots/${slotId}/cancel`);
       fetchData();
    } catch (err) {
       alert('Цуцлах боломжгүй эсвэл алдаа гарлаа');
    }
  };



  const markNotificationRead = async (id: string) => {
    try {
      await apiClient.post('/broadcasts/notifications/read', { notificationId: id });
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Мэдэгдэл шинэчлэхэд алдаа гарлаа');
    }
  };

  const completeTraining = async (id: string) => {
    try {
      await apiClient.post('/broadcasts/trainings/complete', { trainingId: id });
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Сургалт дуусгахад алдаа гарлаа');
    }
  };

  const renderSchedule = () => (
    <div className="space-y-6">
       <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Хуваарь захиалга</h2>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest mt-1">Available shifts for booking</p>
          </div>
          <div className="flex gap-2">
             <input 
               type="month" 
               value={activeMonth}
               onChange={(e) => setActiveMonth(e.target.value)}
               className="bg-white dark:bg-gray-900 border border-black/5 dark:border-white/5 rounded-xl px-4 py-2.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm"
             />
          </div>
       </div>

       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {slots.filter(s => s.date.startsWith(activeMonth)).map(slot => {
            const isBooked = myBookings.some(b => b.slot_id === slot.id);
            const isFull = (slot as any).current_bookings >= slot.capacity;
            const deadlinePassed = new Date(slot.bookingDeadline) < new Date();

            return (
              <div key={slot.id} className={`bg-white dark:bg-gray-900/40 border rounded-2xl p-6 transition-all shadow-sm dark:shadow-none hover:shadow-lg dark:hover:shadow-blue-500/5 ${isBooked ? 'border-blue-500/50 dark:border-blue-500/50 bg-blue-500/5' : 'border-black/5 dark:border-white/5'}`}>
                 <div className="flex items-center justify-between mb-4 text-[10px] font-black uppercase text-gray-400 dark:text-gray-500 tracking-widest">
                    <span>{slot.date}</span>
                    {isBooked && <span className="text-blue-600 dark:text-blue-400">Таны ээлж</span>}
                 </div>
                 <h4 className="text-xl font-black text-gray-900 dark:text-white mb-1 tracking-tight">{slot.startTime} - {slot.endTime}</h4>
                 <p className="text-[10px] text-gray-400 dark:text-gray-500 font-black uppercase mb-6 tracking-widest">{slot.duration} цаг</p>
                 
                 <div className="flex items-center justify-between text-xs mb-4 font-bold uppercase tracking-wider">
                    <span className="text-gray-400">Багтаамж:</span>
                    <span className="text-gray-900 dark:text-white">{(slot as any).current_bookings} / {slot.capacity}</span>
                 </div>

                 {isBooked ? (
                   <button 
                     onClick={() => handleCancelBooking(slot.id)}
                     className="w-full bg-red-600/5 dark:bg-red-600/10 text-red-600 dark:text-red-500 hover:bg-red-600/10 dark:hover:bg-red-600/20 py-3 rounded-xl text-[10px] font-black transition-all border border-red-500/10 dark:border-red-500/20 uppercase tracking-[0.2em]"
                   >
                     Цуцлах
                   </button>
                 ) : (
                   <button 
                     disabled={isFull || deadlinePassed}
                     onClick={() => handleBookSlot(slot.id)}
                     className={`w-full py-3 rounded-xl text-[10px] font-black transition-all uppercase tracking-[0.2em] ${
                       isFull || deadlinePassed 
                       ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed shadow-inner' 
                       : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/20 hover:scale-[1.02] active:scale-[0.98]'
                     }`}
                   >
                     {deadlinePassed ? 'Deadline өнгөрсөн' : isFull ? 'Дүүрсэн' : 'Захиалах'}
                   </button>
                 )}
              </div>
            );
          })}
       </div>
    </div>
  );



  const renderNotifications = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Мэдэгдэл</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {notifications.map(item => (
          <div key={item.id} className="bg-white dark:bg-gray-900/40 border border-black/5 dark:border-white/5 rounded-2xl p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="font-black text-gray-900 dark:text-white">{item.title}</h4>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 whitespace-pre-line">{item.content}</p>
              </div>
              {!item.readAt && <button onClick={() => markNotificationRead(item.id)} className="bg-blue-600 text-white px-3 py-2 rounded-xl text-[10px] font-black uppercase">Уншсан</button>}
            </div>
          </div>
        ))}
        {notifications.length === 0 && <div className="col-span-full py-20 text-center border-2 border-dashed border-black/5 dark:border-white/5 rounded-3xl text-gray-400 font-bold">Мэдэгдэл алга</div>}
      </div>
    </div>
  );

  const renderTraining = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Сургалт</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {trainings.map(item => (
          <div key={item.id} className="bg-white dark:bg-gray-900/40 border border-black/5 dark:border-white/5 rounded-2xl p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="font-black text-gray-900 dark:text-white">{item.title}</h4>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 whitespace-pre-line">{item.description}</p>
                {item.attachmentUrl && <a href={item.attachmentUrl} target="_blank" className="text-xs text-blue-500 font-black mt-3 inline-block">Материал нээх</a>}
              </div>
              {item.completedAt ? <span className="text-green-500 text-[10px] font-black uppercase">Дууссан</span> : <button onClick={() => completeTraining(item.id)} className="bg-purple-600 text-white px-3 py-2 rounded-xl text-[10px] font-black uppercase">Дуусгах</button>}
            </div>
          </div>
        ))}
        {trainings.length === 0 && <div className="col-span-full py-20 text-center border-2 border-dashed border-black/5 dark:border-white/5 rounded-3xl text-gray-400 font-bold">Сургалт алга</div>}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] flex font-sans transition-colors duration-300">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onSettingsClick={() => setIsSettingsOpen(true)}
        isCollapsed={isSidebarCollapsed} 
        setIsCollapsed={setIsSidebarCollapsed} 
      />

      <main className="flex-1 overflow-y-auto custom-scrollbar">
         <header className="sticky top-0 z-30 bg-white/80 dark:bg-gray-900/50 backdrop-blur-xl border-b border-black/5 dark:border-white/5 px-8 py-4 flex items-center justify-between transition-all">
            <div className="flex items-center gap-4">
               <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                  <Sparkles size={24} />
               </div>
               <div>
                  <h1 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight">CSR Dashboard</h1>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold">{authUser?.name} | {authUser?.employmentType}</p>
               </div>
            </div>

            <div className="flex items-center gap-6">
               <div className="flex items-center gap-3 bg-white dark:bg-gray-900/40 px-4 py-2 rounded-xl border border-black/5 dark:border-white/5 shadow-sm">
                  <div className="text-right">
                     <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider">Энэ долоо хоног</p>
                     <p className="text-sm font-black text-gray-900 dark:text-white">32 / 40 цаг</p>
                  </div>
                  <div className="w-px h-8 bg-black/5 dark:bg-white/5" />
                  <div className="text-left">
                     <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider">Амралт</p>
                     <p className="text-sm font-black text-gray-900 dark:text-white">1 өдөр</p>
                  </div>
               </div>
               <button onClick={logout} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
                 <LogOut size={20} />
               </button>
            </div>
         </header>

         <div className="p-8">
            <AnimatePresence mode="wait">
               {isLoading ? (
                  <div className="flex items-center justify-center py-40">
                    <RefreshCw className="animate-spin text-blue-500" size={40} />
                  </div>
               ) : (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                     {activeTab === 'schedule' && renderSchedule()}
                     {activeTab === 'mySchedule' && (
                        <div className="space-y-6">
                           <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Миний хуваарь</h2>
                           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                              {myBookings.map(booking => (
                                 <div key={booking.id} className="bg-white dark:bg-gray-900/60 border border-black/5 dark:border-blue-500/20 rounded-2xl p-6 relative overflow-hidden group shadow-sm hover:shadow-lg dark:shadow-none transition-all">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-blue-500/10 transition-all" />
                                    <div className="flex items-center justify-between mb-4">
                                       <div className="bg-blue-500/10 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 p-2.5 rounded-xl">
                                          <Calendar size={18} />
                                       </div>
                                       <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">{booking.date}</span>
                                    </div>
                                    <h4 className="text-xl font-black text-gray-900 dark:text-white mb-1 tracking-tight">{booking.startTime} - {booking.endTime}</h4>
                                    <p className="text-xs text-gray-400 dark:text-gray-500 font-bold mb-6">Батлагдсан ээлж</p>
                                    <button className="flex items-center gap-2 text-[10px] font-black uppercase text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-all tracking-widest">
                                       <ArrowLeftRight size={14} /> Ээлж солих санал болгох
                                    </button>
                                 </div>
                              ))}
                              {myBookings.length === 0 && (
                                 <div className="col-span-full py-20 text-center border-2 border-dashed border-black/5 dark:border-white/5 rounded-3xl">
                                    <Calendar size={48} className="mx-auto text-gray-200 dark:text-gray-800 mb-4" />
                                    <p className="text-gray-400 dark:text-gray-500 font-bold">Одоогоор захиалсан ээлж алга</p>
                                 </div>
                              )}
                           </div>
                        </div>
                     )}
                     {activeTab === 'notifications' && renderNotifications()}
                     {activeTab === 'training' && renderTraining()}
                  </motion.div>
               )}
            </AnimatePresence>
         </div>
      </main>
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
