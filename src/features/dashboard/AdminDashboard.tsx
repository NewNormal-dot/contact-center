import { useState, useEffect } from 'react';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Calendar, 
  Clock, 
  Bell, 
  BookOpen, 
  Sparkles, 
  Plus, 
  Search, 
  LogOut, 
  CheckCircle, 
  XCircle, 
  ChevronRight,
  Settings,
  Palmtree,
  ArrowLeftRight,
  UserPlus,
  RefreshCw,
  Download,
  Trash2,
  Edit2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/api-client';
import Sidebar from '../../components/Sidebar';
import SettingsModal from '../../components/SettingsModal';
import { User, WorkSlot, LeaveRequest, VacationRequest, TradeRequest } from '../../types';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { logout, user: authUser } = useAuth();
  const [activeTab, setActiveTab] = useState('users');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // States
  const [csrs, setCsrs] = useState<User[]>([]);
  const [slots, setSlots] = useState<WorkSlot[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [vacationRequests, setVacationRequests] = useState<VacationRequest[]>([]);
  const [tradeRequests, setTradeRequests] = useState<TradeRequest[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [trainings, setTrainings] = useState<any[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [noticeForm, setNoticeForm] = useState({ title: '', content: '', deadline: '' });
  const [trainingForm, setTrainingForm] = useState({ title: '', description: '', attachmentUrl: '', attachmentName: '', deadline: '' });

  // Modals
  const [isAddingSlot, setIsAddingSlot] = useState(false);
  const [newSlot, setNewSlot] = useState<Partial<WorkSlot>>({
    date: new Date().toISOString().split('T')[0],
    startTime: '09:00',
    endTime: '17:00',
    capacity: 10,
    bookingDeadline: new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 16)
  });

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'users') {
        const res = await apiClient.get('/users/csr');
        setCsrs(res.data);
      } else if (activeTab === 'schedule') {
        const res = await apiClient.get('/slots');
        setSlots(res.data);
      } else if (activeTab === 'hourlyLeave' || activeTab === 'vacation') {
         const leaveRes = await apiClient.get('/requests/leave');
         setLeaveRequests(leaveRes.data);
         const vacres = await apiClient.get('/requests/vacation');
         setVacationRequests(vacres.data);
      } else if (activeTab === 'trades') {
          const res = await apiClient.get('/trades');
          setTradeRequests(res.data);
      } else if (activeTab === 'notifications') {
          const res = await apiClient.get('/broadcasts/notifications');
          setNotifications(res.data);
      } else if (activeTab === 'training') {
          const res = await apiClient.get('/broadcasts/trainings');
          setTrainings(res.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
       await apiClient.post('/slots', newSlot);
       setIsAddingSlot(false);
       fetchData();
       alert('Слот амжилттай үүсгэгдлээ');
    } catch (err) {
       alert('Алдаа гарлаа');
    }
  };

  const handleApproveLeave = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await apiClient.patch(`/requests/leave/${id}`, { status });
      fetchData();
    } catch (err) {
      alert('Алдаа гарлаа');
    }
  };

  const handleApproveTrade = async (id: string) => {
    try {
      await apiClient.patch(`/trades/${id}/approve`);
      fetchData();
      alert('Арилжаа амжилттай батлагдлаа');
    } catch (err) {
      alert('Алдаа гарлаа');
    }
  };

  const handleDeleteUser = async (userId: string, targetEmail: string) => {
    if (!confirm(`${targetEmail} хэрэглэгчийг устгахдаа итгэлтэй байна уу?`)) return;
    try {
      await apiClient.delete(`/users/${userId}`);
      fetchData();
      alert('Ажилтан устгагдлаа');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Алдаа гарлаа');
    }
  };



  const handleAddNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/broadcasts/notifications', noticeForm);
      setNoticeForm({ title: '', content: '', deadline: '' });
      fetchData();
      alert('Мэдэгдэл амжилттай үүсгэгдлээ');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Мэдэгдэл үүсгэхэд алдаа гарлаа');
    }
  };

  const handleAddTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/broadcasts/trainings', trainingForm);
      setTrainingForm({ title: '', description: '', attachmentUrl: '', attachmentName: '', deadline: '' });
      fetchData();
      alert('Сургалт амжилттай үүсгэгдлээ');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Сургалт үүсгэхэд алдаа гарлаа');
    }
  };

  const handleDeleteBroadcast = async (type: 'notifications' | 'trainings', id: string) => {
    if (!confirm('Устгах уу?')) return;
    try {
      await apiClient.delete(`/broadcasts/${type}/${id}`);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Устгахад алдаа гарлаа');
    }
  };

  const renderCsrs = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Ажилтнууд (CSR)</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {csrs.map(user => (
          <div key={user.id} className="bg-white dark:bg-gray-900/60 backdrop-blur-md border border-black/5 dark:border-white/5 rounded-2xl p-6 hover:border-blue-500/30 transition-all group shadow-sm dark:shadow-none">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full border border-black/5 dark:border-gray-800 overflow-hidden shadow-inner">
                <img src={user.photoUrl || `https://ui-avatars.com/api/?name=${user.name}&background=random`} alt={user.name} />
              </div>
              <div>
                <h4 className="font-bold text-gray-900 dark:text-white group-hover:text-blue-500 transition-colors uppercase tracking-tight">{user.name}</h4>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold">{user.email}</p>
              </div>
            </div>
            <div className="flex gap-2">
               <button 
                onClick={() => handleDeleteUser(user.id, user.email)}
                className="flex-1 bg-red-600/5 dark:bg-red-600/10 hover:bg-red-600/10 dark:hover:bg-red-600/20 text-red-500 py-2.5 rounded-xl text-[10px] font-black transition-all flex items-center justify-center gap-1 border border-red-500/10 dark:border-red-500/20 uppercase tracking-widest"
               >
                 <Trash2 size={12} /> Устгах
               </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderSlots = () => (
    <div className="space-y-6">
       <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Слот төлөвлөлт</h2>
        <button 
          onClick={() => setIsAddingSlot(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-black transition-all shadow-lg shadow-blue-500/20 hover:scale-105 active:scale-95 text-[10px] uppercase tracking-wider"
        >
          <Plus size={18} /> Слот нэмэх
        </button>
      </div>

       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {slots.map(slot => (
           <div key={slot.id} className="bg-white dark:bg-gray-900/40 border border-black/5 dark:border-white/5 rounded-2xl p-6 hover:border-blue-500/20 transition-all shadow-sm dark:shadow-none hover:shadow-lg dark:hover:shadow-blue-500/5">
              <div className="flex items-center justify-between mb-4">
                 <div className="bg-blue-500/10 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 p-2.5 rounded-xl">
                    <Calendar size={18} />
                 </div>
                 <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">{slot.date}</span>
              </div>
              <h4 className="text-xl font-black text-gray-900 dark:text-white mb-1 tracking-tight">{slot.startTime} - {slot.endTime}</h4>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase mb-6 tracking-widest">{slot.duration} цаг</p>
              
              <div className="flex items-center justify-between text-xs mb-3 font-bold">
                 <span className="text-gray-400 uppercase tracking-wider">Захиалга:</span>
                 <span className="text-blue-600 dark:text-blue-400">{(slot as any).current_bookings} / {slot.capacity}</span>
              </div>

              <div className="w-full bg-gray-100 dark:bg-gray-800 h-2 rounded-full overflow-hidden mb-6">
                 <div 
                   className="bg-gradient-to-r from-blue-600 to-blue-400 h-full transition-all duration-700" 
                   style={{ width: `${((slot as any).current_bookings / slot.capacity) * 100}%` }}
                 />
              </div>

              <div className="pt-4 border-t border-black/5 dark:border-white/5 text-[10px] text-gray-400 dark:text-gray-500 font-bold flex items-center gap-2">
                 <Clock size={12} /> Deadline: {new Date(slot.bookingDeadline).toLocaleString()}
              </div>
           </div>
        ))}
       </div>
    </div>
  );

  const renderRequests = () => (
    <div className="space-y-12">
       <section>
          <h3 className="text-xl font-black text-gray-900 dark:text-white mb-6 uppercase tracking-tight flex items-center gap-2">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Clock size={20} className="text-blue-600 dark:text-blue-500" />
            </div>
            Чөлөөний хүсэлтүүд
          </h3>
          <div className="bg-white dark:bg-gray-900/40 border border-black/5 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
             <table className="w-full text-left">
                <thead className="bg-gray-50 dark:bg-white/5 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                  <tr>
                    <th className="px-6 py-5">Ажилтан</th>
                    <th className="px-6 py-5">Огноо</th>
                    <th className="px-6 py-5">Цаг</th>
                    <th className="px-6 py-5">Шалтгаан</th>
                    <th className="px-6 py-5">Төлөв</th>
                    <th className="px-6 py-5">Үйлдэл</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                   {leaveRequests.map(req => (
                     <tr key={req.id} className="text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50/50 dark:hover:bg-white/5 transition-colors">
                        <td className="px-6 py-5 font-bold text-gray-900 dark:text-white">{(req as any).user_name}</td>
                        <td className="px-6 py-5 font-medium">{req.date}</td>
                        <td className="px-6 py-5 font-medium">{req.startTime} - {req.endTime}</td>
                        <td className="px-6 py-5 italic text-gray-400 dark:text-gray-500">{req.reason}</td>
                        <td className="px-6 py-5">
                           <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider ${
                             req.status === 'pending' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400' :
                             req.status === 'approved' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'
                           }`}>
                             {req.status}
                           </span>
                        </td>
                        <td className="px-6 py-5">
                           {req.status === 'pending' && (
                             <div className="flex gap-2">
                                <button onClick={() => handleApproveLeave(req.id, 'approved')} className="p-2 text-green-600 dark:text-green-400 hover:bg-green-500/10 rounded-xl transition-all hover:scale-110"><CheckCircle size={18} /></button>
                                <button onClick={() => handleApproveLeave(req.id, 'rejected')} className="p-2 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-xl transition-all hover:scale-110"><XCircle size={18} /></button>
                             </div>
                           )}
                        </td>
                     </tr>
                   ))}
                </tbody>
             </table>
          </div>
       </section>
    </div>
  );



  const renderNotifications = () => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <section className="bg-white dark:bg-gray-900/40 border border-black/5 dark:border-white/5 rounded-2xl p-6 shadow-sm">
        <h2 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight mb-5 flex items-center gap-2"><Bell size={20} className="text-blue-500" /> Мэдэгдэл нэмэх</h2>
        <form onSubmit={handleAddNotification} className="space-y-3">
          <input required placeholder="Гарчиг" value={noticeForm.title} onChange={e => setNoticeForm({...noticeForm, title: e.target.value})} className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          <textarea required placeholder="Агуулга" value={noticeForm.content} onChange={e => setNoticeForm({...noticeForm, content: e.target.value})} className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          <input type="datetime-local" value={noticeForm.deadline} onChange={e => setNoticeForm({...noticeForm, deadline: e.target.value})} className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-black text-xs uppercase tracking-wider">Хадгалах</button>
        </form>
      </section>
      <section className="bg-white dark:bg-gray-900/40 border border-black/5 dark:border-white/5 rounded-2xl p-6 shadow-sm">
        <h2 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight mb-5">Идэвхтэй мэдэгдлүүд</h2>
        <div className="space-y-3">
          {notifications.map(item => <div key={item.id} className="bg-gray-50 dark:bg-black/20 border border-black/5 dark:border-white/5 rounded-xl p-4"><div className="flex justify-between gap-3"><div><h4 className="font-black text-gray-900 dark:text-white">{item.title}</h4><p className="text-xs text-gray-500 whitespace-pre-line mt-1">{item.content}</p></div><button onClick={() => handleDeleteBroadcast('notifications', item.id)} className="text-red-500 hover:bg-red-500/10 p-2 rounded-lg"><Trash2 size={16} /></button></div></div>)}
          {notifications.length === 0 && <p className="text-sm text-gray-400 font-bold text-center py-8">Мэдэгдэл алга</p>}
        </div>
      </section>
    </div>
  );

  const renderTraining = () => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <section className="bg-white dark:bg-gray-900/40 border border-black/5 dark:border-white/5 rounded-2xl p-6 shadow-sm">
        <h2 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight mb-5 flex items-center gap-2"><BookOpen size={20} className="text-purple-500" /> Сургалт нэмэх</h2>
        <form onSubmit={handleAddTraining} className="space-y-3">
          <input required placeholder="Гарчиг" value={trainingForm.title} onChange={e => setTrainingForm({...trainingForm, title: e.target.value})} className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          <textarea required placeholder="Тайлбар" value={trainingForm.description} onChange={e => setTrainingForm({...trainingForm, description: e.target.value})} className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          <input placeholder="Файлын холбоос" value={trainingForm.attachmentUrl} onChange={e => setTrainingForm({...trainingForm, attachmentUrl: e.target.value})} className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          <input type="datetime-local" value={trainingForm.deadline} onChange={e => setTrainingForm({...trainingForm, deadline: e.target.value})} className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          <button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl font-black text-xs uppercase tracking-wider">Хадгалах</button>
        </form>
      </section>
      <section className="bg-white dark:bg-gray-900/40 border border-black/5 dark:border-white/5 rounded-2xl p-6 shadow-sm">
        <h2 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight mb-5">Идэвхтэй сургалтууд</h2>
        <div className="space-y-3">
          {trainings.map(item => <div key={item.id} className="bg-gray-50 dark:bg-black/20 border border-black/5 dark:border-white/5 rounded-xl p-4"><div className="flex justify-between gap-3"><div><h4 className="font-black text-gray-900 dark:text-white">{item.title}</h4><p className="text-xs text-gray-500 whitespace-pre-line mt-1">{item.description}</p>{item.attachmentUrl && <a href={item.attachmentUrl} target="_blank" className="text-xs text-blue-500 font-bold mt-2 inline-block">Материал нээх</a>}</div><button onClick={() => handleDeleteBroadcast('trainings', item.id)} className="text-red-500 hover:bg-red-500/10 p-2 rounded-lg"><Trash2 size={16} /></button></div></div>)}
          {trainings.length === 0 && <p className="text-sm text-gray-400 font-bold text-center py-8">Сургалт алга</p>}
        </div>
      </section>
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
           <div>
              <h1 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight">Admin Dashboard</h1>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold italic">Contact Center Management</p>
           </div>
           <button onClick={logout} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
              <LogOut size={20} />
            </button>
         </header>

         <div className="p-8">
            <AnimatePresence mode="wait">
              {isLoading ? (
                <div className="flex items-center justify-center py-40">
                   <RefreshCw className="animate-spin text-blue-500" size={40} />
                </div>
              ) : (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                   {activeTab === 'users' && renderCsrs()}
                   {activeTab === 'schedule' && renderSlots()}
                   {activeTab === 'hourlyLeave' && renderRequests()}
                   {activeTab === 'trades' && (
                      <div className="space-y-6">
                         <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Ээлж арилжаа</h2>
                         <div className="bg-white dark:bg-gray-900/40 border border-black/5 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
                             <table className="w-full text-left">
                                <thead className="bg-gray-50 dark:bg-white/5 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                                  <tr>
                                    <th className="px-6 py-4">Илгээгч</th>
                                    <th className="px-6 py-4">Хүлээн авагч</th>
                                    <th className="px-6 py-4">Төлөв</th>
                                    <th className="px-6 py-4">Үйлдэл</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                                   {tradeRequests.map(trade => (
                                      <tr key={trade.id} className="text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50/50 dark:hover:bg-white/5 transition-colors">
                                         <td className="px-6 py-4 font-bold text-gray-900 dark:text-white">{(trade as any).sender_name}</td>
                                         <td className="px-6 py-4 font-bold text-gray-900 dark:text-white">{(trade as any).receiver_name}</td>
                                         <td className="px-6 py-4 uppercase font-bold text-[9px]">{trade.status}</td>
                                         <td className="px-6 py-4">
                                            {trade.status === 'accepted' && (
                                              <button 
                                                onClick={() => handleApproveTrade(trade.id)}
                                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-bold shadow-lg shadow-blue-500/20 transition-all hover:scale-105 active:scale-95"
                                              >
                                                Батлах
                                              </button>
                                            )}
                                         </td>
                                      </tr>
                                   ))}
                                </tbody>
                             </table>
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

       {/* Add Slot Modal */}
       <AnimatePresence>
        {isAddingSlot && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
             <motion.div 
               initial={{ opacity: 0 }} 
               animate={{ opacity: 1 }} 
               exit={{ opacity: 0 }}
               className="absolute inset-0 bg-black/40 dark:bg-black/80 backdrop-blur-sm" 
               onClick={() => setIsAddingSlot(false)} 
             />
             <motion.div 
               initial={{ scale: 0.95, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               exit={{ scale: 0.95, opacity: 0 }}
               className="relative w-full max-w-md bg-white dark:bg-gray-900 border border-black/5 dark:border-white/10 rounded-2xl p-8 shadow-2xl"
             >
                <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-6 uppercase tracking-tight">Шинэ Слот үүсгэх</h3>
                <form onSubmit={handleAddSlot} className="space-y-4">
                   <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider ml-1">Огноо</label>
                        <input type="date" className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" value={newSlot.date} onChange={e => setNewSlot({...newSlot, date: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider ml-1">Багтаамж</label>
                        <input type="number" className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" value={newSlot.capacity} onChange={e => setNewSlot({...newSlot, capacity: parseInt(e.target.value)})} />
                      </div>
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider ml-1">Эхлэх</label>
                        <input type="time" className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" value={newSlot.startTime} onChange={e => setNewSlot({...newSlot, startTime: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider ml-1">Дуусах</label>
                        <input type="time" className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" value={newSlot.endTime} onChange={e => setNewSlot({...newSlot, endTime: e.target.value})} />
                      </div>
                   </div>
                   <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider ml-1">Захиалгын Deadline</label>
                      <input type="datetime-local" className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" value={newSlot.bookingDeadline} onChange={e => setNewSlot({...newSlot, bookingDeadline: e.target.value})} />
                   </div>
                   <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-black mt-4 shadow-lg shadow-blue-500/20 transition-all uppercase text-[10px] tracking-[0.2em]">Хадгалах</button>
                </form>
             </motion.div>
          </div>
        )}
       </AnimatePresence>
       <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
