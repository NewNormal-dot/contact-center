import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { LazyMedia } from '../../components/LazyMedia';
import { DigitalClock } from '../../components/DigitalClock';
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
  Lock,
  ShieldCheck,
  Layers,
  UserPlus,
  FileText,
  Download,
  Bell,
  BookOpen,
  Eye,
  EyeOff,
  Calendar,
  Clock,
  Key,
  XCircle,
  ShieldAlert,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Camera
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAuth } from '../../contexts/AuthContext';
import { CSR, ActivityLog, Notification, TrainingMaterial } from '../../types';
import { logAction } from '../../utils/logger';
import apiClient from '../../lib/api-client';
import { getLocalData, setLocalData, addLocalItem, updateLocalItem, deleteLocalItem } from '../../utils/localStorage';

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const { logout, profile } = useAuth();
  const [activeTab, setActiveTab] = useState('logs');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [showUserAddMenu, setShowUserAddMenu] = useState(false);
  const [collapsedRoles, setCollapsedRoles] = useState<Record<string, boolean>>({
    superadmin: true,
    admin: true,
    csr: true,
  });
  const [selectedActionFilter, setSelectedActionFilter] = useState('all');
  const [showSuccess, setShowSuccess] = useState(false);

  // States
  const [csrs, setCsrs] = useState<CSR[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [segments, setSegments] = useState<string[]>([]);
  const [trainingMaterials, setTrainingMaterials] = useState<TrainingMaterial[]>([]);
  const lastDataRef = useRef<string>('');

  const [showSeenDetails, setShowSeenDetails] = useState<Notification | TrainingMaterial | null>(null);
  const [isAddingMaterial, setIsAddingMaterial] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<TrainingMaterial | null>(null);
  const [newMaterial, setNewMaterial] = useState<Partial<TrainingMaterial>>({ 
    type: 'PDF',
    deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16)
  });
  const [isChangingMyPassword, setIsChangingMyPassword] = useState(false);
  const [myPasswordForm, setMyPasswordForm] = useState({ old: '', new: '', confirm: '' });

  const [confirmAction, setConfirmAction] = useState<{ title: string, onConfirm: () => void } | null>(null);
  const userAddMenuRef = useRef<HTMLDivElement | null>(null);

  const fetchUsers = async () => {
    if (!profile?.role) return;

    try {
      const endpoint = profile.role === 'admin' ? '/users/csr' : '/users';
      const response = await apiClient.get(endpoint);
      const users = response.data.map((user: any) => ({
        ...user,
        lineType: user.lineType || user.employmentType || user.employment_type || 'Full Time',
        status: user.status || 'active',
      }));
      setCsrs(users);
    } catch (error) {
      console.error('Error fetching users from API:', error);
      const cachedUsers = getLocalData('users', []);
      if (cachedUsers.length > 0) {
        setCsrs(cachedUsers);
      }
    }
  };

  useEffect(() => {
    if (!profile) return;
    fetchUsers();
  }, [profile]);

  useEffect(() => {
    if (!showUserAddMenu) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (userAddMenuRef.current && !userAddMenuRef.current.contains(event.target as Node)) {
        setShowUserAddMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserAddMenu]);

  useEffect(() => {
    // User list is loaded from the backend via fetchUsers().
    setLogs(getLocalData('activityLogs', []));
    setNotifications(getLocalData('notifications', []));
    
    const defaultSegments = ['Postpaid', 'Prepaid', 'Hybrid', 'Corporate'];
    const initialSegments = getLocalData('segments', defaultSegments);
    if (!localStorage.getItem('segments')) {
      setLocalData('segments', defaultSegments);
    }
    setSegments(initialSegments);
    
    setTrainingMaterials(getLocalData('trainingMaterials', []));

    // Polling for "real-time" feel in test mode
    const interval = setInterval(() => {
      const newLogs = getLocalData('activityLogs', []);
      const newNotifs = getLocalData('notifications', []);
      const newSegs = getLocalData('segments', []);
      const newMaterials = getLocalData('trainingMaterials', []);

      const dataHash = JSON.stringify({
        newLogs,
        newNotifs,
        newSegs,
        newMaterials
      });

      if (dataHash === lastDataRef.current) return;
      lastDataRef.current = dataHash;

      const deduplicateSeenBy = (items: any[]) => {
        return items.map(item => ({
          ...item,
          seenBy: item.seenBy ? Array.from(new Map(item.seenBy.map((s: any) => [s.userId, s])).values()) : []
        }));
      };

      setLogs(newLogs);
      setNotifications(deduplicateSeenBy(newNotifs));
      setSegments(newSegs);
      setTrainingMaterials(deduplicateSeenBy(newMaterials));
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const [editingUser, setEditingUser] = useState<CSR | null>(null);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUser, setNewUser] = useState<Partial<CSR>>({
    role: 'csr',
    lineType: segments[0] || 'Postpaid',
    status: 'offline',
    photoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=default'
  });
  const [selectedMaterial, setSelectedMaterial] = useState<TrainingMaterial | null>(null);
  const [newNotification, setNewNotification] = useState<Partial<Notification>>({
    type: 'general',
    deadline: new Date(Date.now() + 86400000).toISOString().slice(0, 16)
  });
  const [isAddingNotification, setIsAddingNotification] = useState(false);

  const unreadCount = notifications.filter(n => (n.type === 'general' || n.type === 'important') && !n.seenBy?.some(s => s.userId === 'superadmin')).length;
  const unreadTrainingCount = trainingMaterials.filter(m => !m.seenBy?.some(s => s.userId === 'superadmin')).length;

  const markMaterialAsRead = (materialId: string) => {
    const material = trainingMaterials.find(m => m.id === materialId);
    if (material) {
      const alreadySeen = material.seenBy?.some(s => s.userId === 'superadmin');
      if (!alreadySeen) {
        const newSeenBy = [...(material.seenBy || []), {
          userId: 'superadmin',
          userName: 'Super Admin',
          seenAt: new Date().toISOString()
        }];
        updateLocalItem('trainingMaterials', materialId, { seenBy: newSeenBy });
        logAction('Material Viewed', `Viewed training material: ${material.title}`);
      }
    }
  };

  const markNotificationAsRead = (notifId: string) => {
    const notification = notifications.find(n => n.id === notifId);
    if (notification) {
      const alreadySeen = notification.seenBy?.some(s => s.userId === 'superadmin');
      if (!alreadySeen) {
        const newSeenBy = [...(notification.seenBy || []), {
          userId: 'superadmin',
          userName: 'Super Admin',
          seenAt: new Date().toISOString()
        }];
        updateLocalItem('notifications', notifId, { seenBy: newSeenBy });
        logAction('Notification Viewed', `Viewed notification: ${notification.title}`);
      }
    }
  };

  const triggerSuccess = () => {
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const generateRandomPassword = (length = 10) => {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
    let retVal = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
      retVal += charset.charAt(Math.floor(Math.random() * n));
    }
    return retVal;
  };

  // Handlers
  const handleMyPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (myPasswordForm.new !== myPasswordForm.confirm) {
      alert('Шинэ нууц үгнүүд зөрүүтэй байна!');
      return;
    }

    if (myPasswordForm.new.length < 6) {
      alert('Шинэ нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой!');
      return;
    }

    try {
      await apiClient.post('/auth/change-password', {
        oldPassword: myPasswordForm.old,
        newPassword: myPasswordForm.new,
      });
      logAction('Password Changed', `Changed password for ${profile?.name || 'current user'}`);
      alert('Нууц үг амжилттай солигдлоо!');
      setIsChangingMyPassword(false);
      setMyPasswordForm({ old: '', new: '', confirm: '' });
    } catch (error: any) {
      console.error('Error changing password:', error);
      alert(error.response?.data?.error || 'Нууц үг солихад алдаа гарлаа.');
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser) {
      try {
        await apiClient.put(`/users/${editingUser.id}`, {
          name: editingUser.name,
          status: editingUser.status,
          role: editingUser.role,
          employmentType: editingUser.lineType,
          code: editingUser.code,
        });
        setCsrs(prev => prev.map(u => u.id === editingUser.id ? editingUser : u));
        logAction('User Update', `Updated user ${editingUser.name} (${editingUser.role})`);
        setEditingUser(null);
        triggerSuccess();
      } catch (error: any) {
        console.error('Error updating user:', error);
        alert(error.response?.data?.error || 'Хэрэглэгч шинэчлэхэд алдаа гарлаа.');
      }
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newUser.name && newUser.role && newUser.lineType) {
      if (newUser.email && csrs.some(u => u.email?.toLowerCase() === newUser.email?.toLowerCase())) {
        alert('Энэ и-мэйл хаяг аль хэдийн бүртгэгдсэн байна!');
        return;
      }

      const randomPassword = generateRandomPassword();
      const payload = {
        email: newUser.email,
        password: randomPassword,
        name: newUser.name,
        role: newUser.role,
        status: 'active',
        employmentType: newUser.lineType,
      };

      try {
        const response = await apiClient.post('/users', payload);
        const createdUser = response.data;

        setCsrs(prev => [...prev, { ...createdUser, lineType: newUser.lineType, photoUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${newUser.name}`, status: 'active' }]);
        logAction('User Creation', `Created new user: ${newUser.name} (${newUser.role}). Password sent to ${newUser.email}`);

        console.log(`Sending email to ${newUser.email} with password: ${randomPassword}`);
        alert(`Хэрэглэгч амжилттай үүсгэгдлээ. Нууц үг (${randomPassword}) ${newUser.email} хаяг руу илгээгдлээ.`);

        setIsAddingUser(false);
        setShowUserAddMenu(false);
        setNewUser({
          role: 'csr',
          lineType: segments[0] || 'Postpaid',
          status: 'offline',
          photoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=default'
        });
        triggerSuccess();
      } catch (error: any) {
        console.error('Error adding user:', error);
        alert(error.response?.data?.error || 'Хэрэглэгч нэмэхэд алдаа гарлаа.');
      }
    }
  };

  const requestConfirmation = (title: string, onConfirm: () => void) => {
    setConfirmAction({ title, onConfirm });
  };

  const handleDeleteUser = (userId: string) => {
    const user = csrs.find(u => u.id === userId);
    if (!user) return;

    requestConfirmation(`'${user.name}' ажилтныг устгахдаа итгэлтэй байна уу?`, async () => {
      try {
        await apiClient.delete(`/users/${userId}`);
        setCsrs(prev => prev.filter(u => u.id !== userId));
        logAction('User Deleted', `Deleted user: ${user.name} (${user.role})`);
        triggerSuccess();
      } catch (error: any) {
        console.error('Error deleting user:', error);
        alert(error.response?.data?.error || 'Хэрэглэгч устгахад алдаа гарлаа.');
      }
    });
  };

  const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws) as any[];

      const newUsers: CSR[] = [];
      let duplicates = 0;

      data.forEach(row => {
        const email = row['И-мэйл'] || row['Email'] || '';
        if (email && csrs.some(u => u.email?.toLowerCase() === email.toLowerCase())) {
          duplicates++;
          return;
        }

        const randomPassword = generateRandomPassword();
        newUsers.push({
          id: Math.random().toString(36).substr(2, 9),
          name: row['Нэр'] || row['Name'] || 'Unknown',
          email: email,
          role: (row['Эрх'] || row['Role'] || 'csr').toLowerCase() as any,
          lineType: row['Сегмент'] || row['Segment'] || segments[0] || 'Postpaid',
          status: 'offline',
          photoUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${row['Нэр'] || row['Name'] || Math.random()}`,
          password: row['Нууц үг'] || row['Password'] || randomPassword
        });
      });

      if (newUsers.length > 0) {
        const createdUsers: CSR[] = [];
        for (const rowUser of newUsers) {
          try {
            const response = await apiClient.post('/users', {
              email: rowUser.email,
              password: rowUser.password,
              name: rowUser.name,
              role: rowUser.role,
              status: rowUser.status,
              employmentType: rowUser.lineType,
            });
            createdUsers.push({
              ...response.data,
              lineType: rowUser.lineType,
              photoUrl: rowUser.photoUrl,
              status: rowUser.status,
              password: rowUser.password,
            });
          } catch (err: any) {
            duplicates++;
          }
        }

        if (createdUsers.length > 0) {
          setCsrs(prev => [...prev, ...createdUsers]);
          setShowUserAddMenu(false);
          logAction('Bulk User Creation', `Uploaded ${createdUsers.length} users via Excel. ${duplicates} duplicates skipped.`);
          alert(`${createdUsers.length} хэрэглэгч амжилттай нэмэгдлээ. ${duplicates} давхардсан болон алдаа гарсан мөрүүд алгасагдлаа.`);
          triggerSuccess();
        } else {
          alert(`Бүх хэрэглэгчид аль хэдийн бүртгэгдсэн байна (${duplicates} давхардал).`);
        }
      } else if (duplicates > 0) {
        alert(`Бүх хэрэглэгчид аль хэдийн бүртгэгдсэн байна (${duplicates} давхардал).`);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleAddMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newMaterial.title && newMaterial.type) {
      if (editingMaterial) {
        // Update existing
        const updates = {
          title: newMaterial.title!,
          description: newMaterial.description || '',
          type: newMaterial.type as any,
          url: newMaterial.url || editingMaterial.url,
          thumbnailUrl: newMaterial.thumbnailUrl || editingMaterial.thumbnailUrl,
          deadline: newMaterial.deadline || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
          seenBy: []
        };
        updateLocalItem('trainingMaterials', editingMaterial.id, updates);
        logAction('Material Updated', `Updated training material: ${newMaterial.title}`);
        setEditingMaterial(null);
      } else {
        // Add new
        const material: TrainingMaterial = {
          id: Math.random().toString(36).substr(2, 9),
          title: newMaterial.title!,
          description: newMaterial.description || '',
          type: newMaterial.type as any,
          url: newMaterial.url || '#',
          date: new Date().toISOString().split('T')[0],
          thumbnailUrl: newMaterial.thumbnailUrl,
          deadline: newMaterial.deadline || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
          seenBy: []
        };
        addLocalItem('trainingMaterials', material);
        
        // Create a notification for the new training material
        const notification: Notification = {
          id: Math.random().toString(36).substr(2, 9),
          title: 'Шинэ сургалт: ' + material.title,
          content: `Шинэ сургалтын материал нэмэгдлээ. ${material.description}`,
          deadline: material.deadline,
          createdAt: new Date().toISOString(),
          authorId: 'superadmin',
          authorName: 'Super Admin',
          type: 'training',
          seenBy: []
        };
        addLocalItem('notifications', notification);
        
        logAction('Material Added', `Added training material: ${material.title}`);
      }
      setIsAddingMaterial(false);
      setNewMaterial({ 
        type: 'PDF',
        deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16)
      });
      triggerSuccess();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const base64 = evt.target?.result as string;
      let type: 'PDF' | 'Video' | 'Image' | 'Link' = 'Link';
      
      if (file.type.startsWith('image/')) type = 'Image';
      else if (file.type.startsWith('video/')) type = 'Video';
      else if (file.type === 'application/pdf') type = 'PDF';

      setNewMaterial(prev => ({
        ...prev,
        url: base64,
        type,
        title: prev.title || file.name.split('.')[0],
        description: prev.description || `Файл: ${file.name}`
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleResetUserPassword = (user: CSR) => {
    const newPass = Math.random().toString(36).substr(2, 8);
    updateLocalItem('users', user.id, { password: newPass });
    logAction('Password Reset', `Reset password for ${user.name}. New password sent to ${user.email}`);
    alert(`Шинэ нууц үг ${user.email} хаяг руу илгээгдлээ: ${newPass}`);
    triggerSuccess();
  };

  const handleChangeMyPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (myPasswordForm.new !== myPasswordForm.confirm) {
      alert('Нууц үг зөрүүтэй байна!');
      return;
    }
    updateLocalItem('users', 'superadmin', { password: myPasswordForm.new });
    logAction('Admin Password Change', 'Super Admin changed their own password');
    setIsChangingMyPassword(false);
    setMyPasswordForm({ old: '', new: '', confirm: '' });
    triggerSuccess();
  };

  const handleSendNotification = (e: React.FormEvent) => {
    e.preventDefault();
    if (newNotification.title && newNotification.content) {
      const notification: Notification = {
        id: Math.random().toString(36).substr(2, 9),
        title: newNotification.title,
        content: newNotification.content,
        deadline: newNotification.deadline || '',
        createdAt: new Date().toISOString(),
        authorId: 'superadmin',
        authorName: 'Super Admin',
        type: newNotification.type as any,
        seenBy: []
      };
      addLocalItem('notifications', notification);
      logAction('Notification Sent', `Sent ${notification.type} notification: ${notification.title}`);
      setIsAddingNotification(false);
      setNewNotification({ type: 'general', deadline: new Date(Date.now() + 86400000).toISOString().split('T')[0] });
      triggerSuccess();
    }
  };

  const exportToExcel = () => {
    const data = csrs.map(u => ({
      'ID': u.id,
      'Нэр': u.name,
      'Email': u.email || 'N/A',
      'Сегмент': u.lineType,
      'Эрх': u.role,
      'Төлөв': u.status,
      'Нууц үг': u.password || 'N/A'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Users");
    XLSX.writeFile(wb, "system_users_data.xlsx");
    logAction('Data Export', 'Exported user data to Excel');
  };

  const exportLogsToExcel = () => {
    const data = logs.map(l => ({
      'Цаг': new Date(l.timestamp).toLocaleString(),
      'Хэрэглэгч': l.userName,
      'Эрх': l.userRole,
      'Үйлдэл': l.action,
      'Дэлгэрэнгүй': l.details
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Activity Logs");
    XLSX.writeFile(wb, "activity_logs.xlsx");
    logAction('Log Export', 'Exported activity logs to Excel');
  };

  const exportNotificationSeenToExcel = (item: Notification | TrainingMaterial) => {
    const data = csrs.map(u => {
      const seen = (item.seenBy ?? []).find(s => s.userId === u.id);
      return {
        'Ажилтны нэр': u.name,
        'Сегмент': u.lineType,
        'Эрх': u.role,
        'Үзсэн эсэх': seen ? 'Тийм' : 'Үгүй',
        'Үзсэн хугацаа': seen ? new Date(seen.seenAt).toLocaleString() : '-',
        'Хугацаа/Огноо': (item as any).deadline || (item as any).date
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Seen Status");
    XLSX.writeFile(wb, `${item.title}_seen_status.xlsx`);
    logAction('Export Seen Status', `Exported seen status for: ${item.title}`);
  };

  const handleUploadTraining = () => {
    const title = prompt('Сургалтын материалын нэр:');
    if (title) {
      const newMaterial: TrainingMaterial = {
        id: Math.random().toString(36).substr(2, 9),
        title,
        description: '',
        type: 'PDF',
        url: '#',
        date: new Date().toISOString().split('T')[0],
        seenBy: []
      };
      setTrainingMaterials(prev => [newMaterial, ...prev]);
      logAction('Training Upload', `Uploaded training material: ${title}`);
      triggerSuccess();
    }
  };

  const handleLogout = () => {
    try {
      logout();
      navigate('/');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const getActionCategory = (action: string) => {
    const userActions = ['User Creation', 'User Update', 'Bulk User Creation', 'Password Reset', 'Admin Password Change', 'CSR Updated', 'CSR Added', 'Bulk CSR Added', 'Bulk CSR Deleted', 'Bulk CSR Moved'];
    const contentActions = ['Material Added', 'Material Updated', 'Training Upload', 'Notification Sent', 'Notification Sent (Admin)'];
    const systemActions = ['Data Export', 'Log Export', 'Export Seen Status', 'Material Viewed', 'Notification Viewed', 'Notification Read'];
    const scheduleActions = ['Vacation Approved', 'Vacation Rejected', 'Shift Added', 'Shift Deleted', 'Shift Updated', 'Segment Added', 'Segment Updated', 'Segment Deleted'];

    if (userActions.includes(action)) return { label: 'Хэрэглэгч', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' };
    if (contentActions.includes(action)) return { label: 'Агуулга', color: 'text-green-400 bg-green-500/10 border-green-500/20' };
    if (systemActions.includes(action)) return { label: 'Систем', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' };
    if (scheduleActions.includes(action)) return { label: 'Хуваарь', color: 'text-orange-400 bg-orange-500/10 border-orange-500/20' };
    return { label: 'Бусад', color: 'text-gray-400 bg-gray-500/10 border-gray-500/20' };
  };

  const renderLogs = () => {
    const actionTypes = Array.from(new Set(logs.map(l => l.action))).sort();
    const filteredLogs = logs.filter(l => {
      const matchesSearch = l.userName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           l.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           l.details.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesAction = selectedActionFilter === 'all' || l.action === selectedActionFilter;
      return matchesSearch && matchesAction;
    });

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-xl sm:text-2xl font-black text-white">Үйлдэлүүдийн бүртгэл</h2>
            <div className="flex bg-gray-900/50 border border-gray-800 p-1 rounded-xl">
              <select 
                value={selectedActionFilter}
                onChange={(e) => setSelectedActionFilter(e.target.value)}
                className="bg-transparent text-[10px] font-bold text-gray-400 px-2 py-1 focus:outline-none cursor-pointer"
              >
                <option value="all" className="bg-gray-900">Бүх үйлдэл</option>
                {actionTypes.map(type => (
                  <option key={type} value={type} className="bg-gray-900">{type}</option>
                ))}
              </select>
            </div>
          </div>
          <button 
            onClick={exportLogsToExcel}
            className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-900/20"
          >
            <Download size={16} />
            Excel Татах
          </button>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-800/50 text-gray-400 text-[10px] font-black uppercase tracking-widest">
                  <th className="px-6 py-4">Цаг хугацаа</th>
                  <th className="px-6 py-4">Хэрэглэгч</th>
                  <th className="px-6 py-4">Ангилал</th>
                  <th className="px-6 py-4">Үйлдэл</th>
                  <th className="px-6 py-4">Дэлгэрэнгүй</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredLogs.map(log => {
                  const category = getActionCategory(log.action);
                  return (
                    <tr key={log.id} className="hover:bg-gray-800/30 transition-colors group">
                      <td className="px-6 py-4 text-xs text-gray-500 font-medium">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-gray-200 text-sm">{log.userName}</span>
                          <span className="text-[9px] text-gray-500 font-black uppercase tracking-tighter">{log.userRole}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${category.color}`}>
                          {category.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold text-blue-400 group-hover:text-blue-300 transition-colors">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-400 max-w-xs truncate" title={log.details}>
                        {log.details}
                      </td>
                    </tr>
                  );
                })}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-20 text-center text-gray-600 font-bold italic">
                      Илэрц олдсонгүй
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderUsers = () => {
    const filteredUsers = csrs.filter(u => {
      const q = userSearchQuery.trim().toLowerCase();
      if (!q) return true;
      return [u.name, u.email, u.role, u.lineType]
        .filter(Boolean)
        .some(field => field!.toLowerCase().includes(q));
    });

    const groupedRoles = [
      { key: 'superadmin', title: 'Superadmin', users: filteredUsers.filter(u => u.role === 'superadmin') },
      { key: 'admin', title: 'Admin', users: filteredUsers.filter(u => u.role === 'admin') },
      { key: 'csr', title: 'CSR', users: filteredUsers.filter(u => u.role === 'csr') },
    ];

    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="w-full lg:w-1/2">
            <div className="relative w-full max-w-lg">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                placeholder="Хайх..."
                className="w-full pl-11 pr-4 py-3 bg-gray-900/70 border border-gray-800 rounded-2xl text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="relative flex flex-wrap gap-3 items-center">
            <button
              onClick={() => setShowUserAddMenu(prev => !prev)}
              className="flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-2xl font-bold text-base transition-all shadow-lg shadow-blue-900/20"
              aria-expanded={showUserAddMenu}
            >
              <UserPlus size={20} />
              Хэрэглэгч нэмэх
              <ChevronDown size={18} className={`${showUserAddMenu ? 'rotate-180' : ''} transition-transform`} />
            </button>
            <button 
              onClick={exportToExcel}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-2xl font-bold transition-all"
            >
              <Download size={18} />
              Excel Татах
            </button>

            {showUserAddMenu && (
              <div ref={userAddMenuRef} className="absolute top-full right-0 z-50 mt-3 w-full max-w-xs rounded-3xl border border-gray-800 bg-black/95 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
                <button
                  onClick={() => {
                    setShowUserAddMenu(false);
                    setIsAddingUser(true);
                  }}
                  className="w-full text-left rounded-2xl px-4 py-3 bg-gray-900/80 hover:bg-gray-800 text-white font-bold transition-all"
                >
                  Нэгээр нэмэх
                </button>
                <label className="w-full mt-2 rounded-2xl bg-gray-900/80 hover:bg-gray-800 text-white font-bold transition-all cursor-pointer px-4 py-3 flex items-center justify-between gap-2">
                  <span>Олноор нэмэх</span>
                  <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={(e) => { handleBulkUpload(e); }} />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-8">
          {groupedRoles.map(group => (
            <div key={group.key} className="space-y-4">
              <button
                type="button"
                onClick={() => setCollapsedRoles(prev => ({ ...prev, [group.key]: !prev[group.key] }))}
                className="w-full flex items-center justify-between gap-3 rounded-3xl border border-gray-800 bg-gray-900/60 px-5 py-4 hover:border-blue-500/50 transition-all"
              >
                <div>
                  <h3 className="text-xl font-black text-white">{group.title}</h3>
                  <p className="text-xs text-gray-500">{group.users.length} хэрэглэгч</p>
                </div>
                <ChevronDown size={20} className={`${collapsedRoles[group.key] ? '' : 'rotate-180'} transition-transform text-gray-400`} />
              </button>
              {group.users.length === 0 && (
                <div className="rounded-3xl border border-dashed border-gray-800 bg-gray-900/40 p-5 text-center text-sm text-gray-400">
                  Одоогоор бүртгэлгүй
                </div>
              )}

              {!collapsedRoles[group.key] && group.users.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.users.map(user => (
                    <div key={user.id} className="bg-gray-900/40 border border-gray-800 p-6 rounded-2xl space-y-4 hover:border-blue-500/30 transition-all">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <img src={user.photoUrl} alt={user.name} className="w-12 h-12 rounded-full border-2 border-gray-800" />
                          <div>
                            <h4 className="font-bold text-white">{user.name}</h4>
                            <p className="text-xs text-gray-500">{user.email || 'И-мэйл байхгүй'}</p>
                            <p className="text-[10px] text-blue-500 font-black uppercase mt-0.5">{user.lineType}</p>
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                          user.role === 'superadmin' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                          user.role === 'admin' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                          'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                        }`}>
                          {user.role}
                        </span>
                      </div>
                      <div className="pt-4 border-t border-gray-800 space-y-3">
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setEditingUser(user)}
                            className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2"
                          >
                            <Edit2 size={14} />
                            Засах
                          </button>
                          <button 
                            onClick={() => handleResetUserPassword(user)}
                            className="flex-1 py-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 text-xs font-bold rounded-lg border border-blue-500/20 transition-all flex items-center justify-center gap-2"
                          >
                            <Key size={14} />
                            Reset
                          </button>
                          <button 
                            onClick={() => handleDeleteUser(user.id)}
                            className="p-2 bg-red-600/10 hover:bg-red-600/20 text-red-400 rounded-lg border border-red-500/20 transition-all"
                            title="Устгах"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderNotifications = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black text-white">Мэдэгдэлүүд</h2>
        <button 
          onClick={() => setIsAddingNotification(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20"
        >
          <Plus size={20} />
          Шинэ мэдэгдэл
        </button>
      </div>

      <div className="space-y-4">
        {notifications.filter(n => n.type === 'general' || n.type === 'important').map((notif, idx) => {
          const isDeadlinePassed = notif.deadline && new Date(notif.deadline) < new Date();
          const seenBy = notif.seenBy ?? [];
          return (
            <div key={`notif-${notif.id}-${idx}`} className="bg-gray-900/40 border border-gray-800 p-6 rounded-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  notif.type === 'training' ? 'bg-purple-500/10 text-purple-400' : 'bg-blue-500/10 text-blue-400'
                }`}>
                  {notif.type === 'training' ? <BookOpen size={20} /> : <Bell size={20} />}
                </div>
                <div>
                  <h4 className="font-bold text-white">{notif.title}</h4>
                  <p className="text-xs text-gray-500">Хугацаа: {notif.deadline}</p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-black text-gray-600 uppercase block mb-1">Уншсан байдал</span>
                <span className="text-sm font-bold text-blue-400">{seenBy.length} / {csrs.length}</span>
              </div>
            </div>
            
            <p className="text-gray-400 text-sm mb-6 line-clamp-2">{notif.content}</p>
            
            <div className="flex items-center justify-between pt-4 border-t border-gray-800">
              <div className="flex -space-x-2">
                {seenBy.slice(0, 5).map((seen, idx) => (
                  <div key={`seen-${notif.id}-${seen.userId}-${idx}`} className="w-8 h-8 rounded-full border-2 border-gray-900 bg-gray-800 flex items-center justify-center text-[10px] font-bold text-gray-400" title={seen.userName}>
                    {seen.userName.charAt(0)}
                  </div>
                ))}
                {seenBy.length > 5 && (
                  <div className="w-8 h-8 rounded-full border-2 border-gray-900 bg-gray-800 flex items-center justify-center text-[10px] font-bold text-gray-400">
                    +{seenBy.length - 5}
                  </div>
                )}
              </div>
              <div className="flex gap-4">
                <button 
                  onClick={() => exportNotificationSeenToExcel(notif)}
                  className="text-xs text-green-500 font-bold hover:underline flex items-center gap-1"
                >
                  <Download size={12} />
                  Excel Татах
                </button>
                <button 
                  onClick={() => setShowSeenDetails(notif)}
                  className="text-xs text-blue-500 font-bold hover:underline"
                >
                  Дэлгэрэнгүй харах
                </button>
                {!notif.seenBy?.some(s => s.userId === 'superadmin') && !isDeadlinePassed && (
                  <button 
                    onClick={() => markNotificationAsRead(notif.id)}
                    className="text-xs text-green-500 font-bold hover:underline flex items-center gap-1"
                  >
                    <CheckCircle2 size={12} />
                    Би үзсэн
                  </button>
                )}
              </div>
            </div>
          </div>
        )})}
      </div>
    </div>
  );

  const renderTraining = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black text-white">Сургалтын материалууд</h2>
        <button 
          onClick={() => {
            setEditingMaterial(null);
            setNewMaterial({ 
              type: 'PDF',
              deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16)
            });
            setIsAddingMaterial(true);
          }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold transition-all"
        >
          <Plus size={18} />
          Материал нэмэх
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {trainingMaterials.map((material, idx) => (
          <div 
            key={`training-${material.id}-${idx}`} 
            onClick={() => setSelectedMaterial(material)}
            className="bg-gray-900/40 border border-gray-800 p-6 rounded-2xl space-y-4 hover:border-blue-500/30 transition-all group cursor-pointer"
          >
            <div className="aspect-video bg-gray-800 rounded-xl overflow-hidden relative border border-gray-700/50">
              {material.thumbnailUrl ? (
                <LazyMedia 
                  src={material.thumbnailUrl} 
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
              <div className="absolute top-3 right-3 px-2 py-1 bg-black/60 backdrop-blur-md rounded text-[10px] font-black text-white uppercase border border-white/10">
                {material.type}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <h4 className="font-bold text-white text-lg group-hover:text-blue-400 transition-colors">{material.title}</h4>
                <div className="text-right">
                  <span className="text-[10px] font-black text-blue-400">{material.seenBy?.length || 0} / {csrs.length}</span>
                </div>
              </div>
              <p className="text-sm text-gray-500 mt-1 line-clamp-2">{material.description}</p>
              <div className="flex items-center justify-between mt-3">
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] text-gray-600 font-bold uppercase">{material.date}</p>
                  {material.deadline && (
                    <p className={`text-[10px] font-bold uppercase ${new Date(material.deadline) < new Date() ? 'text-red-500' : 'text-gray-500'}`}>
                      Хугацаа: {material.deadline}
                    </p>
                  )}
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSeenDetails(material);
                  }}
                  className="text-[10px] text-blue-500 font-bold hover:underline"
                >
                  Дэлгэрэнгүй
                </button>
              </div>
            </div>
            <div className="pt-4 border-t border-gray-800 flex gap-2">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingMaterial(material);
                  setNewMaterial({
                    title: material.title,
                    description: material.description,
                    type: material.type,
                    url: material.url,
                    thumbnailUrl: material.thumbnailUrl,
                    deadline: material.deadline
                  });
                  setIsAddingMaterial(true);
                }}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-white text-xs font-bold rounded-lg transition-all"
              >
                Засах
              </button>
              <button 
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const updatedMaterials = deleteLocalItem('trainingMaterials', material.id);
                    setTrainingMaterials(updatedMaterials);
                    logAction('Training Deleted', `Deleted material: ${material.title}`);
                    triggerSuccess();
                  } catch (error) {
                    console.error('Error deleting material:', error);
                    alert('Устгахад алдаа гарлаа.');
                  }
                }}
                className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-white overflow-hidden font-sans">
      {/* Sidebar */}
      <div className={`${isSidebarCollapsed ? 'w-20' : 'w-72'} bg-gray-900/50 border-r border-gray-800 flex flex-col transition-all duration-300 relative z-50`}>
        <button 
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="absolute -right-3 top-10 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg z-30 hover:scale-110 transition-transform"
        >
          {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        <div className={isSidebarCollapsed ? 'p-4' : 'p-8'}>
          <div className={`flex items-center gap-3 mb-8 ${isSidebarCollapsed ? 'justify-center' : ''}`}>
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20 shrink-0">
              <ShieldAlert size={24} className="text-white" />
            </div>
            {!isSidebarCollapsed && (
              <div>
                <h1 className="text-xl font-black tracking-tighter">{profile?.name || 'Super Admin'}</h1>
                <p className="text-[10px] text-blue-500 font-black uppercase tracking-widest">{profile?.lineType || 'System Control'}</p>
              </div>
            )}
          </div>

          <nav className="space-y-2">
            {[
              { id: 'logs', label: 'Үйлдэлүүд', icon: FileText },
              { id: 'users', label: 'Хэрэглэгчид', icon: Users },
              { id: 'notifications', label: 'Мэдэгдэлүүд', icon: Bell, badge: unreadCount },
              { id: 'training', label: 'Сургалт', icon: BookOpen, badge: unreadTrainingCount },
            ].map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-bold transition-all ${
                  activeTab === item.id 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                } ${isSidebarCollapsed ? 'justify-center' : ''}`}
                title={isSidebarCollapsed ? item.label : ''}
              >
                <div className="flex items-center gap-3">
                  <item.icon size={20} />
                  {!isSidebarCollapsed && <span>{item.label}</span>}
                </div>
                {!isSidebarCollapsed && item.badge !== undefined && item.badge > 0 && (
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full min-w-[20px] text-center ${
                    item.id === 'notifications' ? 'bg-red-500 text-white' : 'bg-purple-500 text-white'
                  }`}>
                    {item.badge}
                  </span>
                )}
                {isSidebarCollapsed && item.badge !== undefined && item.badge > 0 && (
                  <span className={`absolute top-1 right-1 w-4 h-4 text-[8px] font-black flex items-center justify-center rounded-full border-2 border-[#0a0a0a] ${
                    item.id === 'notifications' ? 'bg-red-500 text-white' : 'bg-purple-500 text-white'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
            <div className="pt-4 mt-4 border-t border-gray-800">
            </div>
          </nav>
        </div>

        <div className={`mt-auto p-8 border-t border-gray-800 ${isSidebarCollapsed ? 'p-4 flex flex-col items-center gap-2' : ''}`}>
          <button 
            onClick={() => setIsChangingMyPassword(true)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-gray-400 hover:bg-gray-800 transition-all mb-2 ${isSidebarCollapsed ? 'justify-center' : ''}`}
            title={isSidebarCollapsed ? 'Нууц үг солих' : ''}
          >
            <Settings size={20} />
            {!isSidebarCollapsed && <span>Нууц үг солих</span>}
          </button>
          <button 
            onClick={handleLogout}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-red-500 hover:bg-red-500/10 transition-all ${isSidebarCollapsed ? 'justify-center' : ''}`}
            title={isSidebarCollapsed ? 'Системээс гарах' : ''}
          >
            <LogOut size={20} />
            {!isSidebarCollapsed && <span>Системээс гарах</span>}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-12">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-8 sm:mb-12">
            <div>
              <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight mb-2">
                {activeTab === 'logs' ? 'Системийн бүртгэл' : 
                 activeTab === 'users' ? 'Хэрэглэгчийн удирдлага' : 
                 activeTab === 'notifications' ? 'Мэдэгдэл & Сургалт' : 'Тохиргоо'}
              </h2>
              <p className="text-xs sm:text-sm text-gray-500">Тавтай морил, {profile?.name || 'Super Admin'}. Системийн бүх үйл ажиллагааг эндээс хянана уу.</p>
            </div>
            <div className="flex items-center gap-4">
              <DigitalClock />
            </div>
          </div>

          {activeTab === 'logs' && renderLogs()}
          {activeTab === 'users' && renderUsers()}
          {activeTab === 'notifications' && renderNotifications()}
          {activeTab === 'training' && renderTraining()}
        </div>
      </div>

      {/* Add/Edit Material Modal */}
      <AnimatePresence>
        {isAddingMaterial && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setIsAddingMaterial(false); setEditingMaterial(null); }} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
              <h2 className="text-2xl font-black text-white mb-6">{editingMaterial ? 'Материал засах' : 'Сургалтын материал нэмэх'}</h2>
              <form onSubmit={handleAddMaterial} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Гарчиг</label>
                  <input 
                    type="text" 
                    required
                    value={newMaterial.title || ''}
                    onChange={e => setNewMaterial(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                    placeholder="Материалын гарчиг"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Тайлбар</label>
                  <textarea 
                    value={newMaterial.description || ''}
                    onChange={e => setNewMaterial(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 h-24 resize-none"
                    placeholder="Материалын дэлгэрэнгүй тайлбар"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Нүүр зураг (Thumbnail)</label>
                  <div className="relative group">
                    <input 
                      type="file" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setNewMaterial(prev => ({ ...prev, thumbnailUrl: reader.result as string }));
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      accept="image/*"
                    />
                    <div className="w-full bg-gray-800 border border-gray-700 rounded-xl py-4 px-4 text-center group-hover:border-blue-500/50 transition-all flex items-center justify-center gap-3">
                      {newMaterial.thumbnailUrl ? (
                        <div className="flex items-center gap-3">
                          <img src={newMaterial.thumbnailUrl} className="w-10 h-10 rounded-lg object-cover border border-gray-600" alt="Thumbnail" />
                          <p className="text-xs text-green-400 font-bold">Зураг сонгогдлоо</p>
                        </div>
                      ) : (
                        <>
                          <Camera size={20} className="text-gray-500 group-hover:text-blue-400" />
                          <p className="text-xs text-gray-400 font-bold">Зураг оруулах (Заавал биш)</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Файл оруулах</label>
                  <div className="relative group">
                    <input 
                      type="file" 
                      onChange={handleFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="w-full bg-gray-800 border-2 border-dashed border-gray-700 rounded-xl py-8 px-4 text-center group-hover:border-blue-500/50 transition-all">
                      <Plus size={24} className="mx-auto text-gray-500 mb-2 group-hover:text-blue-400" />
                      <p className="text-sm text-gray-400 font-bold">Файл сонгох эсвэл чирж авчирна уу</p>
                      <p className="text-[10px] text-gray-600 mt-1 uppercase font-black">PDF, Image, Video</p>
                    </div>
                  </div>
                  {newMaterial.url && newMaterial.url.startsWith('data:') && (
                    <div className="flex items-center justify-between mt-2 px-2">
                      <p className="text-[10px] text-green-500 font-bold flex items-center gap-1">
                        <CheckCircle2 size={12} /> Файл амжилттай сонгогдлоо
                      </p>
                      <span className="text-[10px] text-gray-500 font-mono truncate max-w-[200px]">
                        {newMaterial.description?.startsWith('Файл: ') ? newMaterial.description : 'Шинэ файл'}
                      </span>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">URL эсвэл Зургийн URL (Заавал биш)</label>
                  <input 
                    type="text" 
                    value={newMaterial.url && !newMaterial.url.startsWith('data:') ? newMaterial.url : (newMaterial.thumbnailUrl || '')}
                    onChange={e => {
                      if (newMaterial.type === 'Link') {
                        setNewMaterial(prev => ({ ...prev, url: e.target.value }));
                      } else {
                        setNewMaterial(prev => ({ ...prev, thumbnailUrl: e.target.value }));
                      }
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Дуусах хугацаа (Deadline)</label>
                  <input 
                    type="datetime-local" 
                    required
                    value={newMaterial.deadline || ''}
                    onChange={e => setNewMaterial(prev => ({ ...prev, deadline: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => { setIsAddingMaterial(false); setEditingMaterial(null); }} className="flex-1 py-3 bg-gray-800 text-white font-bold rounded-xl hover:bg-gray-700 transition-all">Цуцлах</button>
                  <button type="submit" className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/20">
                    {editingMaterial ? 'Хадгалах' : 'Нэмэх'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {isChangingMyPassword && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsChangingMyPassword(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
              <h2 className="text-2xl font-black text-white mb-6">Нууц үг солих</h2>
              <form onSubmit={handleChangeMyPassword} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Хуучин нууц үг</label>
                  <input 
                    type="password" 
                    required
                    value={myPasswordForm.old}
                    onChange={e => setMyPasswordForm(prev => ({ ...prev, old: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Шинэ нууц үг</label>
                  <input 
                    type="password" 
                    required
                    value={myPasswordForm.new}
                    onChange={e => setMyPasswordForm(prev => ({ ...prev, new: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Шинэ нууц үг давтах</label>
                  <input 
                    type="password" 
                    required
                    value={myPasswordForm.confirm}
                    onChange={e => setMyPasswordForm(prev => ({ ...prev, confirm: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setIsChangingMyPassword(false)} className="flex-1 py-3 bg-gray-800 text-white font-bold rounded-xl hover:bg-gray-700 transition-all">Цуцлах</button>
                  <button type="submit" className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/20">Хадгалах</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Material Viewer Modal */}
        <AnimatePresence>
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
                      const alreadySeen = selectedMaterial.seenBy?.some(s => s.userId === 'superadmin');
                      
                      if (!alreadySeen && !isDeadlinePassed) {
                        return (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedMaterial(null);
                      }} 
                      className="p-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                    >
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
                        <BookOpen size={40} className="text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white mb-2">Гадна холбоос</h3>
                        <p className="text-gray-400 max-w-md mx-auto">Энэ материал нь гадны вэбсайт дээр байрлаж байна. Та доорх товчийг дарж шинэ цонхонд нээнэ үү.</p>
                      </div>
                      <a 
                        href={selectedMaterial.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-8 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/20"
                      >
                        Холбоосыг нээх
                        <ChevronDown size={20} className="-rotate-90" />
                      </a>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {showSeenDetails && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSeenDetails(null)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl flex flex-col max-h-[80vh]">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-black text-white">Үзсэн ажилтнууд</h2>
                  <p className="text-gray-400 text-sm">{showSeenDetails.title}</p>
                </div>
                <button onClick={() => setShowSeenDetails(null)} className="text-gray-500 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                {(showSeenDetails.seenBy ?? []).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <AlertCircle size={48} className="mb-4 opacity-20" />
                    <p className="font-bold">Одоогоор үзсэн хэрэглэгч байхгүй байна.</p>
                  </div>
                ) : (
                  (showSeenDetails.seenBy ?? []).map((seen, idx) => {
                    const user = csrs.find(u => u.id === seen.userId);
                    return (
                      <div key={`seen-detail-${seen.userId}-${idx}`} className="flex items-center justify-between p-4 bg-gray-800/30 rounded-xl border border-gray-800">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-400">
                            {seen.userName.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-white">{seen.userName}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-[10px] text-blue-500 uppercase font-black">
                                {user?.role === 'superadmin' ? 'Super Admin' : user?.role === 'admin' ? 'Admin' : 'CSR'}
                              </p>
                              <span className="w-1 h-1 bg-gray-700 rounded-full"></span>
                              <p className="text-[10px] text-gray-500 uppercase font-black">{user?.lineType || 'N/A'}</p>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="flex items-center gap-1.5 text-green-500 text-xs font-bold mb-0.5">
                            <CheckCircle2 size={14} />
                            Үзсэн
                          </div>
                          <p className="text-[10px] text-gray-500">{new Date(seen.seenAt).toLocaleString()}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-6 pt-6 border-t border-gray-800">
                <button 
                  onClick={() => exportNotificationSeenToExcel(showSeenDetails)}
                  className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold flex items-center justify-center gap-2"
                >
                  <Download size={20} />
                  Excel Татах
                </button>
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

      {/* Change Password Modal */}
      <AnimatePresence>
        {isChangingMyPassword && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsChangingMyPassword(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
              <button onClick={() => setIsChangingMyPassword(false)} className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors">
                <X size={24} />
              </button>
              <h2 className="text-2xl font-black text-white mb-6">Нууц үг солих</h2>
              <form onSubmit={handleMyPasswordChange} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1 block mb-2">Хуучин нууц үг</label>
                  <input type="password" value={myPasswordForm.old} onChange={(e) => setMyPasswordForm({...myPasswordForm, old: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3.5 px-5 text-white focus:outline-none focus:border-blue-500 font-bold" required />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1 block mb-2">Шинэ нууц үг</label>
                  <input type="password" value={myPasswordForm.new} onChange={(e) => setMyPasswordForm({...myPasswordForm, new: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3.5 px-5 text-white focus:outline-none focus:border-blue-500 font-bold" required />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1 block mb-2">Шинэ нууц үг давтах</label>
                  <input type="password" value={myPasswordForm.confirm} onChange={(e) => setMyPasswordForm({...myPasswordForm, confirm: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3.5 px-5 text-white focus:outline-none focus:border-blue-500 font-bold" required />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setIsChangingMyPassword(false)} className="flex-1 py-3.5 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-700 transition-all">Цуцлах</button>
                  <button type="submit" className="flex-1 py-3.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20">Хадгалах</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit User Modal */}
      <AnimatePresence>
        {isAddingUser && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAddingUser(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
              <h2 className="text-2xl font-black text-white mb-6">Шинэ хэрэглэгч нэмэх</h2>
              <form onSubmit={handleAddUser} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Нэр</label>
                  <input type="text" value={newUser.name || ''} onChange={(e) => setNewUser({...newUser, name: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" placeholder="Ажилтны нэр..." required />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">И-мэйл хаяг</label>
                  <input type="email" value={newUser.email || ''} onChange={(e) => setNewUser({...newUser, email: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" placeholder="example@mail.com" required />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Эрх (Role)</label>
                  <select value={newUser.role} onChange={(e) => setNewUser({...newUser, role: e.target.value as any})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500">
                    <option value="csr">CSR</option>
                    <option value="admin">Admin</option>
                    <option value="superadmin">Super Admin</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Сегмент</label>
                  <select value={newUser.lineType} onChange={(e) => setNewUser({...newUser, lineType: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500">
                    {segments.map((s, idx) => <option key={`${s}-${idx}`} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setIsAddingUser(false)} className="flex-1 py-3 bg-gray-800 text-white rounded-xl font-bold">Цуцлах</button>
                  <button type="submit" className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold">Нэмэх</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit User Modal */}
      <AnimatePresence>
        {editingUser && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingUser(null)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
              <h2 className="text-2xl font-black text-white mb-6">Хэрэглэгч засах</h2>
              <form onSubmit={handleUpdateUser} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Нэр</label>
                  <input type="text" value={editingUser.name} onChange={(e) => setEditingUser({...editingUser, name: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" />
                </div>
                {editingUser.role !== 'superadmin' && (
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">И-мэйл хаяг</label>
                    <input 
                      type="email" 
                      value={editingUser.email || ''} 
                      onChange={(e) => setEditingUser({...editingUser, email: e.target.value})} 
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" 
                      placeholder="example@mail.com"
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Эрх (Role)</label>
                  <select value={editingUser.role} onChange={(e) => setEditingUser({...editingUser, role: e.target.value as any})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500">
                    <option value="csr">CSR</option>
                    <option value="admin">Admin</option>
                    <option value="superadmin">Super Admin</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Сегмент</label>
                  <select value={editingUser.lineType} onChange={(e) => setEditingUser({...editingUser, lineType: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500">
                    {segments.map((s, idx) => <option key={`${s}-${idx}`} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setEditingUser(null)} className="flex-1 py-3 bg-gray-800 text-white rounded-xl font-bold">Цуцлах</button>
                  <button type="submit" className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold">Хадгалах</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Notification Modal */}
      <AnimatePresence>
        {isAddingNotification && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAddingNotification(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
              <h2 className="text-2xl font-black text-white mb-6">Шинэ мэдэгдэл илгээх</h2>
              <form onSubmit={handleSendNotification} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Төрөл</label>
                  <div className="flex bg-gray-800 p-1 rounded-xl">
                    <button type="button" onClick={() => setNewNotification({...newNotification, type: 'general'})} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${newNotification.type === 'general' ? 'bg-blue-600 text-white' : 'text-gray-500'}`}>Ерөнхий</button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Гарчиг</label>
                  <input type="text" value={newNotification.title || ''} onChange={(e) => setNewNotification({...newNotification, title: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" placeholder="Мэдэгдлийн гарчиг..." required />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Агуулга</label>
                  <textarea value={newNotification.content || ''} onChange={(e) => setNewNotification({...newNotification, content: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 h-32 resize-none" placeholder="Мэдэгдлийн дэлгэрэнгүй агуулга..." required />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Дуусах хугацаа (Deadline)</label>
                  <input type="datetime-local" value={newNotification.deadline} onChange={(e) => setNewNotification({...newNotification, deadline: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" required />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setIsAddingNotification(false)} className="flex-1 py-3 bg-gray-800 text-white rounded-xl font-bold">Цуцлах</button>
                  <button type="submit" className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold">Илгээх</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmAction && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setConfirmAction(null)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-sm bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
              <div className="w-16 h-16 bg-red-600/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-500/20">
                <ShieldAlert size={32} className="text-red-400" />
              </div>
              <h2 className="text-xl font-black text-white text-center mb-2">{confirmAction.title}</h2>
              <p className="text-gray-400 text-center text-sm mb-6">Та энэ үйлдлийг хийхдээ итгэлтэй байна уу?</p>
              
              <div className="flex gap-3">
                <button onClick={() => setConfirmAction(null)} className="flex-1 py-3 bg-gray-800 text-white rounded-xl font-bold">Цуцлах</button>
                <button 
                  onClick={() => {
                    confirmAction.onConfirm();
                    setConfirmAction(null);
                  }} 
                  className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold"
                >
                  Тийм, устга
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
