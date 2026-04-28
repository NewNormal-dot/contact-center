import { useState, useEffect } from 'react';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Settings, 
  LogOut, 
  Search, 
  Plus, 
  Edit2, 
  Trash2, 
  CheckCircle2, 
  X,
  AlertCircle,
  ShieldCheck,
  UserPlus,
  FileText,
  Download,
  Bell,
  BookOpen,
  Key,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Sparkles,
  User as UserIcon,
  CircleAlert,
  MoreVertical,
  MoreHorizontal,
  XCircle,
  CheckCircle,
  Sun,
  Moon,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { User, AuditLog, Notification, Training, WeeklyRuleTemplate } from '../../types';
import apiClient from '../../lib/api-client';
import Sidebar from '../../components/Sidebar';
import SettingsModal from '../../components/SettingsModal';

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const { user: authUser, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('users');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // States
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Modals
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [resetingUser, setResetingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('Password@123');
  const [newUser, setNewUser] = useState<Partial<User>>({
    name: '',
    email: '',
    role: 'csr',
    employmentType: 'Full Time',
    status: 'active'
  });
  const [noticeForm, setNoticeForm] = useState({ title: '', content: '', deadline: '' });
  const [trainingForm, setTrainingForm] = useState({ title: '', description: '', attachmentUrl: '', attachmentName: '', deadline: '' });

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'users') {
        const res = await apiClient.get('/users');
        setUsers(res.data);
      } else if (activeTab === 'audit') {
        const res = await apiClient.get('/audit');
        setLogs(res.data);
      } else if (activeTab === 'notifications') {
        const res = await apiClient.get('/broadcasts/notifications');
        setNotifications(res.data);
      } else if (activeTab === 'training') {
        const res = await apiClient.get('/broadcasts/trainings');
        setTrainings(res.data);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/users', newUser);
      setIsAddingUser(false);
      setNewUser({ name: '', email: '', role: 'csr', employmentType: 'Full Time', status: 'active' });
      fetchData();
      alert('Хэрэглэгч амжилттай үүсгэгдлээ. Анхны нууц үг: Password@123');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Алдаа гарлаа');
    }
  };

  const handleUpdateStatus = async (userId: string, status: 'active' | 'inactive') => {
    try {
      await apiClient.put(`/users/${userId}`, { status });
      fetchData();
    } catch (err) {
      alert('Алдаа гарлаа');
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await apiClient.put(`/users/${editingUser.id}`, editingUser);
      setEditingUser(null);
      fetchData();
      setToast({ message: 'Хэрэглэгчийн мэдээлэл шинэчлэгдлээ', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || 'Алдаа гарлаа', type: 'error' });
    }
  };

  const handleResetPassword = async () => {
    if (!resetingUser) return;
    try {
      await apiClient.post(`/users/${resetingUser.id}/reset-password`, { password: resetPasswordValue || 'Password@123' });
      setResetingUser(null);
      setResetPasswordValue('Password@123');
      setToast({ message: 'Нууц үг амжилттай шинэчлэгдлээ', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || 'Алдаа гарлаа', type: 'error' });
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    
    try {
      await apiClient.delete(`/users/${deletingUser.id}`);
      fetchData();
      setDeletingUser(null);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Алдаа гарлаа');
    }
  };

  const checkDeletePermission = (user: User) => {
    const isRootUser = 
      authUser?.email?.toLowerCase() === 'enkhtur.a@mobicom.mn' || 
      authUser?.email?.toLowerCase() === 'enkhtur040607@gmail.com';
    
    if (isRootUser) return true;
    
    if (authUser?.role === 'admin' && user.role !== 'csr') {
      alert('Та зөвхөн ажилтан устгах эрхтэй');
      return false;
    }
    if (authUser?.role === 'superadmin' && user.role === 'superadmin') {
      alert('Та өөр супер админыг устгах эрхгүй');
      return false;
    }
    if (authUser?.id === user.id) {
      alert('Өөрийгөө устгах боломжгүй');
      return false;
    }
    return true;
  };



  const handleAddNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/broadcasts/notifications', noticeForm);
      setNoticeForm({ title: '', content: '', deadline: '' });
      fetchData();
      setToast({ message: 'Мэдэгдэл үүсгэгдлээ', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || 'Мэдэгдэл үүсгэхэд алдаа гарлаа', type: 'error' });
    }
  };

  const handleAddTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/broadcasts/trainings', trainingForm);
      setTrainingForm({ title: '', description: '', attachmentUrl: '', attachmentName: '', deadline: '' });
      fetchData();
      setToast({ message: 'Сургалт үүсгэгдлээ', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || 'Сургалт үүсгэхэд алдаа гарлаа', type: 'error' });
    }
  };

  const handleDeleteBroadcast = async (type: 'notifications' | 'trainings', id: string) => {
    try {
      await apiClient.delete(`/broadcasts/${type}/${id}`);
      fetchData();
      setToast({ message: 'Устгагдлаа', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || 'Устгахад алдаа гарлаа', type: 'error' });
    }
  };

  const renderUsers = () => {
    const isRootUser = 
      authUser?.email?.toLowerCase() === 'enkhtur.a@mobicom.mn' || 
      authUser?.email?.toLowerCase() === 'enkhtur040607@gmail.com';

    const filteredUsers = users.filter(u => 
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      u.email.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const categories = [
      { id: 'superadmin', title: 'Super Admins', color: 'text-purple-400', icon: ShieldCheck },
      { id: 'admin', title: 'Admins', color: 'text-blue-400', icon: ShieldCheck },
      { id: 'csr', title: 'Ажилтнууд (CSR)', color: 'text-green-400', icon: Users }
    ];

    const renderUserCard = (user: User) => (
      <div key={user.id} className="bg-white dark:bg-gray-900/60 backdrop-blur-md border border-black/5 dark:border-white/5 rounded-2xl p-6 hover:border-blue-500/30 transition-all group shadow-sm shadow-black/5 dark:shadow-none">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full border-2 border-gray-100 dark:border-gray-800 overflow-hidden">
               <img src={user.photoUrl || `https://ui-avatars.com/api/?name=${user.name}&background=random`} alt={user.name} className="w-full h-full object-cover" />
            </div>
            <div>
              <h4 className="font-bold text-gray-900 dark:text-white group-hover:text-blue-500 transition-colors uppercase tracking-tight">{user.name}</h4>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold">{user.email}</p>
            </div>
          </div>
          <div className="relative">
            <button 
              onClick={() => setActiveMenuId(activeMenuId === user.id ? null : user.id)}
              className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg hover:scale-110 active:scale-95 transition-all z-10"
            >
              <ChevronDown size={16} className={`transition-transform duration-300 ${activeMenuId === user.id ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {activeMenuId === user.id && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setActiveMenuId(null)} />
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-900 border border-black/10 dark:border-white/10 rounded-xl shadow-2xl p-1 z-50 overflow-hidden"
                  >
                    <div className="px-3 py-2 border-b border-black/5 dark:border-white/5 mb-1">
                      <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Үйлдэл</p>
                    </div>
                    <button 
                      onClick={() => { handleUpdateStatus(user.id, user.status === 'active' ? 'inactive' : 'active'); setActiveMenuId(null); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-[10px] font-bold rounded-lg transition-colors border border-transparent ${
                        user.status === 'active' 
                          ? 'text-orange-400 hover:bg-orange-500/10 hover:border-orange-500/20' 
                          : 'text-green-400 hover:bg-green-500/10 hover:border-green-500/20'
                      }`}
                    >
                      {user.status === 'active' ? <XCircle size={12} /> : <CheckCircle size={12} />}
                      {user.status === 'active' ? 'Идэвхгүй болгох' : 'Идэвхжүүлэх'}
                    </button>
                    <button 
                      onClick={() => { 
                        if (checkDeletePermission(user)) {
                          setDeletingUser(user);
                        }
                        setActiveMenuId(null); 
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-bold text-red-500 hover:bg-red-500/10 rounded-lg transition-colors border border-transparent hover:border-red-500/20"
                    >
                      <Trash2 size={12} /> Устгах
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[10px] mb-4">
           <div className="bg-gray-50 dark:bg-gray-800/20 p-2 rounded-lg border border-black/5 dark:border-white/5 border-dashed">
              <p className="text-[8px] text-gray-400 dark:text-gray-500 font-bold mb-1 uppercase tracking-tighter">Төлөв</p>
              <p className={`font-bold ${user.status === 'active' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {user.status === 'active' ? 'Идэвхтэй' : 'Идэвхгүй'}
              </p>
           </div>
           <div className="bg-gray-50 dark:bg-gray-800/20 p-2 rounded-lg border border-black/5 dark:border-white/5 border-dashed">
              <p className="text-[8px] text-gray-400 dark:text-gray-500 font-bold mb-1 uppercase tracking-tighter">Төрөл</p>
              <p className="font-bold text-gray-500 dark:text-gray-400">{user.employmentType}</p>
           </div>
        </div>

        <div className="grid grid-cols-2 gap-2 relative z-10">
           <button 
            onClick={() => setEditingUser(user)}
            className="bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white py-2.5 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-2 border border-black/5 dark:border-white/5 hover:border-blue-500/30 shadow-sm"
           >
             <Edit2 size={12} /> Засах
           </button>
           <button 
            onClick={() => setResetingUser(user)}
            className="bg-blue-600/10 hover:bg-blue-600/20 text-blue-600 dark:text-blue-400 py-2.5 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-2 border border-blue-500/20 shadow-sm"
           >
             <Key size={12} /> Нууц үг
           </button>
        </div>
      </div>
    );

    return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
           <h2 className="text-3xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Хэрэглэгчид</h2>
           <p className="text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest mt-1">Нийт {users.length} хэрэглэгч бүртгэлтэй байна</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={16} />
            <input 
              type="text"
              placeholder="Хайх..."
              className="bg-white dark:bg-gray-900/40 border border-black/5 dark:border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all w-64 shadow-sm shadow-black/5 dark:shadow-none"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button 
            onClick={() => setIsAddingUser(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-black transition-all shadow-lg shadow-blue-500/20 hover:scale-105 active:scale-95 text-[10px] uppercase tracking-wider"
          >
            <UserPlus size={16} /> Хэрэглэгч нэмэх
          </button>
        </div>
      </div>

      <div className="space-y-12">
        {categories.map(cat => {
          const catUsers = filteredUsers.filter(u => u.role === cat.id);
          if (catUsers.length === 0) return null;

          return (
            <div key={cat.id} className="space-y-6">
              <div className="flex items-center gap-3 border-b border-black/5 dark:border-white/5 pb-3">
                <cat.icon size={20} className={cat.color} />
                <h3 className={`text-sm font-black uppercase tracking-[0.2em] ${cat.color}`}>{cat.title}</h3>
                <span className="bg-gray-100 dark:bg-white/5 text-[10px] px-3 py-1 rounded-full text-gray-400 dark:text-gray-500 font-black">{catUsers.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {catUsers.map(user => renderUserCard(user))}
              </div>
            </div>
          );
        })}
      </div>
        <AnimatePresence>
          {/* Add User Modal */}
        {isAddingUser && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => setIsAddingUser(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white dark:bg-[#0d0d0d] border border-black/10 dark:border-white/10 rounded-2xl p-8 shadow-2xl"
            >
              <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-6 uppercase tracking-tight">Шинэ хэрэглэгч бүртгэх</h3>
              <form onSubmit={handleAddUser} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase ml-1 tracking-wider">Нэр</label>
                  <input 
                    type="text" required
                    className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                    value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase ml-1 tracking-wider">И-мэйл</label>
                  <input 
                    type="email" required
                    className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                    value={newUser.email || ''} onChange={e => setNewUser({...newUser, email: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase ml-1 tracking-wider">Эрх</label>
                    <select 
                      className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                      value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value as any})}
                    >
                      <option value="csr" className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">CSR</option>
                      <option value="admin" className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">Admin</option>
                      <option value="superadmin" className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">Superadmin</option>
                    </select>
                  </div>
                   <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase ml-1 tracking-wider">Төрөл</label>
                    <select 
                      className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                      value={newUser.employmentType} onChange={e => setNewUser({...newUser, employmentType: e.target.value as any})}
                    >
                      <option value="Full Time" className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">Full Time</option>
                      <option value="Part Time" className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">Part Time</option>
                    </select>
                  </div>
                </div>
                <button 
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-xl font-black mt-4 shadow-lg shadow-blue-500/20 transition-all uppercase text-[10px] tracking-[0.2em]"
                >
                  Хадгалах
                </button>
              </form>
            </motion.div>
          </div>
        )}

          {resetingUser && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/60 backdrop-blur-md"
                onClick={() => setResetingUser(null)}
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-sm bg-white dark:bg-[#0d0d0d] border border-black/10 dark:border-white/10 rounded-2xl p-8 shadow-2xl"
              >
                <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400 mb-4">
                  <Key size={24} />
                  <h3 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Нууц үг шинэчлэх</h3>
                </div>
                <p className="text-gray-500 dark:text-gray-400 text-[10px] mb-6">
                  <span className="text-gray-900 dark:text-white font-bold">{resetingUser.name}</span> хэрэглэгчийн нэвтрэх шинэ нууц үгийг оруулна уу.
                </p>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase ml-1">Шинэ нууц үг</label>
                    <input 
                      type="text"
                      className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                      value={resetPasswordValue}
                      onChange={e => setResetPasswordValue(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button 
                      onClick={() => setResetingUser(null)}
                      className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-white font-bold py-3 rounded-xl transition-colors text-sm"
                    >
                      Болих
                    </button>
                    <button 
                      onClick={handleResetPassword}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-500/20 text-sm"
                    >
                      Шинэчлэх
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}

          {deletingUser && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-red-950/10 dark:bg-black/60 backdrop-blur-md"
                onClick={() => setDeletingUser(null)}
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-sm bg-white dark:bg-[#0d0d0d] border border-red-500/20 rounded-2xl p-8 shadow-2xl"
              >
                <div className="flex items-center gap-3 text-red-500 mb-4">
                  <AlertCircle size={24} />
                  <h3 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Устгах уу?</h3>
                </div>
                <p className="text-gray-500 dark:text-gray-400 text-xs mb-6 leading-relaxed">
                  Та <span className="text-gray-900 dark:text-white font-bold">{deletingUser.email}</span> хэрэглэгчийг устгахдаа итгэлтэй байна уу? Энэ үйлдлийг буцаах боломжгүй.
                </p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setDeletingUser(null)}
                    className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-white font-bold py-3 rounded-xl transition-colors text-sm"
                  >
                    Болих
                  </button>
                  <button 
                    onClick={handleDeleteUser}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-red-500/20 text-sm"
                  >
                    Устгах
                  </button>
                </div>
              </motion.div>
            </div>
          )}

        {editingUser && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => setEditingUser(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white dark:bg-[#0d0d0d] border border-black/10 dark:border-white/10 rounded-2xl p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Засах: {editingUser.name}</h3>
                <button onClick={() => setEditingUser(null)} className="text-gray-400 hover:text-red-500 transition-colors p-2 hover:bg-red-500/10 rounded-xl">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleUpdateUser} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase ml-1 tracking-wider">Нэр</label>
                  <input 
                    type="text" required
                    className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                    value={editingUser.name} onChange={e => setEditingUser({...editingUser, name: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase ml-1 tracking-wider">Эрх</label>
                    <select 
                      className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                      value={editingUser.role} onChange={e => setEditingUser({...editingUser, role: e.target.value as any})}
                      disabled={!isRootUser && editingUser.role === 'superadmin'}
                    >
                      <option value="csr" className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">CSR</option>
                      <option value="admin" className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">Admin</option>
                      <option value="superadmin" className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">Superadmin</option>
                    </select>
                  </div>
                   <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase ml-1 tracking-wider">Төрөл</label>
                    <select 
                      className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                      value={editingUser.employmentType} onChange={e => setEditingUser({...editingUser, employmentType: e.target.value as any})}
                    >
                      <option value="Full Time" className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">Full Time</option>
                      <option value="Part Time" className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">Part Time</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase ml-1 tracking-wider">Төлөв</label>
                  <select 
                    className="w-full bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                    value={editingUser.status} onChange={e => setEditingUser({...editingUser, status: e.target.value as any})}
                  >
                    <option value="active" className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">Active</option>
                    <option value="inactive" className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">Inactive</option>
                  </select>
                </div>
                <button 
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-xl font-black mt-4 shadow-lg shadow-blue-500/20 transition-all uppercase text-[10px] tracking-[0.2em]"
                >
                  Шинэчлэх
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border backdrop-blur-xl ${
              toast.type === 'success' 
                ? 'bg-green-500/10 border-green-500/20 text-green-500' 
                : 'bg-red-500/10 border-red-500/20 text-red-500'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
            <span className="text-sm font-black uppercase tracking-wider">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
    );
  };

  const renderAuditLogs = () => (
    <div className="space-y-6">
       <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Аудит бүртгэл</h2>
        <button className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-white px-4 py-2 rounded-xl font-bold transition-all text-sm border border-black/5 dark:border-white/5 shadow-sm">
           <Download size={16} /> Excel татах
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900/40 border border-black/5 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
             <thead>
               <tr className="bg-gray-50 dark:bg-white/5 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-black/5 dark:border-white/5">
                 <th className="px-6 py-4">Хугацаа</th>
                 <th className="px-6 py-4">Хэрэглэгч</th>
                 <th className="px-6 py-4">Үйлдэл</th>
                 <th className="px-6 py-4">Объект</th>
                 <th className="px-6 py-4">Дэлгэрэнгүй</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-black/5 dark:divide-white/5">
               {logs.map(log => (
                 <tr key={log.id} className="text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 font-medium">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="px-6 py-4 font-bold text-gray-900 dark:text-white">{log.userId}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 font-bold border border-blue-500/20 text-[10px] uppercase">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-medium">{log.entityType}</td>
                    <td className="px-6 py-4 max-w-xs truncate" title={log.details}>{log.details}</td>
                 </tr>
               ))}
             </tbody>
          </table>
        </div>
      </div>
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

  const renderForecast = () => (
    <div className="flex flex-col items-center justify-center py-20 bg-gray-100 dark:bg-gray-900/40 border border-black/5 dark:border-white/5 rounded-2xl border-dashed rgb-border">
       <Sparkles size={64} className="text-blue-500 mb-6 opacity-50" />
       <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-2">Дуудлагын Forecast</h3>
       <p className="text-gray-500 max-w-md text-center text-sm font-medium">Энэ модуль нь дуудлагын урсгал болон ажилтны хэрэгцээг тооцоолох зориулалттай бөгөөд одоогоор хөгжүүлэлтийн шатанд байна.</p>
       <div className="mt-8 flex gap-4">
          <button className="bg-gray-200 dark:bg-gray-800 px-6 py-3 rounded-xl text-gray-400 font-bold text-sm cursor-not-allowed">Excel загвар татах</button>
          <button className="bg-gray-200 dark:bg-gray-800 px-6 py-3 rounded-xl text-gray-400 font-bold text-sm cursor-not-allowed">Импорт хийх</button>
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
        <header className="sticky top-0 z-30 bg-white/80 dark:bg-gray-900/50 backdrop-blur-xl border-b border-black/5 dark:border-white/5 px-8 py-4 flex items-center justify-between transition-all duration-300">
          <div className="flex items-center gap-4">
             <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
                <ShieldCheck size={24} />
             </div>
             <div>
                <h1 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight">Superadmin Dashboard</h1>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold">System Management & Audit</p>
             </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={16} />
              <input 
                type="text"
                placeholder="Хайх..."
                className="bg-gray-100 dark:bg-black/40 border border-black/5 dark:border-white/5 rounded-xl pl-10 pr-4 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all w-64 shadow-inner"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button onClick={logout} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all" title="Гарах">
              <LogOut size={20} />
            </button>
          </div>
        </header>

        <div className="p-8">
           <AnimatePresence mode="wait">
              {isLoading ? (
                <motion.div 
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex items-center justify-center py-40"
                >
                  <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                </motion.div>
              ) : (
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {activeTab === 'users' && renderUsers()}
                  {activeTab === 'audit' && renderAuditLogs()}
                  {activeTab === 'forecast' && renderForecast()}
                  {activeTab === 'notifications' && renderNotifications()}
                  {activeTab === 'training' && renderTraining()}
                </motion.div>
              )}
           </AnimatePresence>
        </div>
      </main>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border backdrop-blur-xl ${
              toast.type === 'success' 
                ? 'bg-green-500/10 border-green-500/20 text-green-500' 
                : 'bg-red-500/10 border-red-500/20 text-red-500'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
            <span className="text-sm font-black uppercase tracking-wider">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
