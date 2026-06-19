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
import { groupNotificationsByDay, groupTrainingMaterialsByDay } from '../../utils/notificationGroups';

type NewUserFormRow = Partial<CSR> & { formId: string };
const VALID_LOCATIONS = ['Ulaanbaatar', 'Darkhan'] as const;

const normalizeUserLocation = (value: unknown) => {
  const normalized = String(value ?? '').trim();
  return VALID_LOCATIONS.find(location => location.toLowerCase() === normalized.toLowerCase()) || '';
};

const createNewUserFormRow = (): NewUserFormRow => ({
  formId: Math.random().toString(36).slice(2, 11),
  code: '',
  name: '',
  email: '',
  role: undefined,
  location: '',
  supervisorName: '',
  lineType: '',
  employmentType: 'Full Time',
  status: 'offline',
  photoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=default',
});

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const { logout, profile } = useAuth();
  const [activeTab, setActiveTab] = useState('logs');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [collapsedRoles, setCollapsedRoles] = useState<Record<string, boolean>>({
    superadmin: false,
    admin: false,
    csr: false,
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
  const userAddModalScrollRef = useRef<HTMLDivElement | null>(null);

  const getDisplaySegment = (user: Partial<CSR>) => {
    if (user.role === 'superadmin') return 'System Control';
    if (user.lineType === 'Full Time' || user.lineType === 'Part Time') return '';
    return user.lineType || '';
  };

  const getDisplayTimeType = (user: Partial<CSR>) => {
    if (user.role === 'superadmin' || user.role === 'admin') return user.role || '';
    return user.employmentType || 'Full Time';
  };

  const getSegmentForRole = (role?: CSR['role'], currentSegment = '') => {
    if (role === 'superadmin') return 'System Control';
    if (role === 'admin' || role === 'csr') {
      return currentSegment && currentSegment !== 'System Control' ? currentSegment : '';
    }
    return '';
  };

  const fetchUsers = async () => {
    if (!profile?.role) return;

    try {
      const endpoint = profile.role === 'admin' ? '/users/csr' : '/users';
      const response = await apiClient.get(endpoint);
      const users = response.data.map((user: any) => {
        const rawSegment = user.lineType || user.segment || (user.role === 'superadmin' ? 'System Control' : '');
        return {
          ...user,
          lineType: rawSegment === 'Full Time' || rawSegment === 'Part Time' ? '' : rawSegment,
          location: normalizeUserLocation(user.location),
          supervisorName: user.supervisorName || user.supervisor_name || '',
          status: user.status || 'active',
        };
      });
      setCsrs(users);
      setLocalData('users', users);
    } catch (error) {
      console.error('Error fetching users from API:', error);
      const cachedUsers = getLocalData('users', []).map((user: any) => {
        const rawSegment = user.lineType || user.segment || (user.role === 'superadmin' ? 'System Control' : '');
        return {
          ...user,
          lineType: rawSegment === 'Full Time' || rawSegment === 'Part Time' ? '' : rawSegment,
          location: normalizeUserLocation(user.location),
          supervisorName: user.supervisorName || user.supervisor_name || '',
        };
      });
      if (cachedUsers.length > 0) {
        setCsrs(cachedUsers);
      }
    }
  };

  const fetchLogs = async () => {
    try {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 3);
      const response = await apiClient.get('/audit', {
        params: {
          startDate: startDate.toISOString(),
        },
      });
      const backendLogs = response.data.map((log: any) => ({
        id: log.id,
        timestamp: log.created_at || log.createdAt || log.timestamp,
        userId: log.user_id,
        userName: log.user_name || log.userName || 'Unknown',
        userRole: log.user_role || log.userRole || 'unknown',
        action: log.action,
        details: log.details || ''
      }));
      setLogs(backendLogs);
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      const fallbackLogs = getLocalData('activity_logs', []);
      setLogs(fallbackLogs);
    }
  };

  const fetchNotifications = async () => {
    try {
      const response = await apiClient.get('/broadcasts/notifications');
      const localNotifications: Notification[] = getLocalData('notifications', []);
      const notificationsData: Notification[] = response.data.map((n: any) => {
        const localMatch = localNotifications.find(local => String(local.id) === String(n.id));
        return {
        id: n.id,
        title: n.title,
        content: n.content,
        imageUrl: n.image_url || n.imageUrl,
        deadline: n.deadline,
        createdAt: n.created_at || n.createdAt,
        authorId: n.author_id || n.authorId,
        authorName: n.author_name || n.authorName || 'Unknown',
        type: n.type || 'general',
        seenBy: localMatch?.seenBy?.length ? localMatch.seenBy : n.notification_read_receipts ? n.notification_read_receipts.map((r: any) => ({
          userId: r.user_id,
          userName: r.user_name || 'Unknown',
          seenAt: r.read_at
        })) : (n.readAt ? [{ userId: profile?.id, userName: profile?.name, seenAt: n.readAt }] : [])
      };
      });
      const localOnly = localNotifications.filter(local => (
        !notificationsData.some(remote => String(remote.id) === String(local.id))
      ));
      setNotifications([...notificationsData, ...localOnly]);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      setNotifications(getLocalData('notifications', []));
    }
  };

  useEffect(() => {
    if (!profile) return;
    fetchUsers();
  }, [profile]);

  useEffect(() => {
    const defaultSegments = ['Postpaid', 'Prepaid', 'Hybrid', 'Corporate'];
    const initialSegments = getLocalData('segments', defaultSegments);
    if (!localStorage.getItem('segments')) {
      setLocalData('segments', defaultSegments);
    }
    setSegments(initialSegments);
    setTrainingMaterials(getLocalData('trainingMaterials', []));

    fetchLogs();
    fetchNotifications();

    const interval = setInterval(() => {
      fetchUsers();
      fetchLogs();
      fetchNotifications();
      setTrainingMaterials(getLocalData('trainingMaterials', []));
    }, 2000);

    return () => clearInterval(interval);
  }, [profile]);

  useEffect(() => {
    if (!showSeenDetails) return;

    const currentView = (showSeenDetails as any)._view;
    const source = 'authorId' in showSeenDetails ? notifications : trainingMaterials;
    const latest = source.find(item => String(item.id) === String(showSeenDetails.id));

    if (!latest) return;

    setShowSeenDetails({
      ...latest,
      ...(currentView ? { _view: currentView } : {})
    } as any);
  }, [notifications, trainingMaterials, showSeenDetails?.id]);

  const [editingUser, setEditingUser] = useState<CSR | null>(null);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUserRows, setNewUserRows] = useState<NewUserFormRow[]>([createNewUserFormRow()]);
  const [selectedMaterial, setSelectedMaterial] = useState<TrainingMaterial | null>(null);
  const [newNotification, setNewNotification] = useState<Partial<Notification>>({
    type: 'general',
    deadline: new Date(Date.now() + 86400000).toISOString().slice(0, 16)
  });
  const [isAddingNotification, setIsAddingNotification] = useState(false);
  const [isUploadingBulk, setIsUploadingBulk] = useState(false);

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

        setTrainingMaterials(prev =>
          prev.map(m =>
            m.id === materialId
              ? { ...m, seenBy: newSeenBy }
              : m
          )
        );
        setShowSeenDetails(prev => (
          prev?.id === materialId ? { ...prev, seenBy: newSeenBy } as any : prev
        ));

        logAction('Material Viewed', `Viewed training material: ${material.title}`);
      }
    }
  };

  const markNotificationAsRead = async (notifId: string) => {
    try {
      await apiClient.post('/broadcasts/notifications/read', {
        notification_id: notifId,
      });
      const notification = notifications.find(n => n.id === notifId);
      if (notification) {
        const seenBy = notification.seenBy?.some(seen => String(seen.userId) === 'superadmin')
          ? notification.seenBy
          : [...(notification.seenBy || []), {
              userId: 'superadmin',
              userName: profile?.name || 'Super Admin',
              seenAt: new Date().toISOString()
            }];
        updateLocalItem('notifications', notifId, { seenBy });
        setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, seenBy } : n));
        setShowSeenDetails(prev => (
          prev?.id === notifId ? { ...prev, seenBy } as any : prev
        ));
      }
      fetchNotifications();
      logAction('Notification Viewed', `Viewed notification: ${notifId}`);
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const triggerSuccess = () => {
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const requestConfirmation = (title: string, onConfirm: () => void) => {
    setConfirmAction({ title, onConfirm });
  };

  const generateRandomPassword = (length = 10) => {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
    let retVal = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
      retVal += charset.charAt(Math.floor(Math.random() * n));
    }
    return retVal;
  };

  const resetNewUserRows = () => {
    setNewUserRows([createNewUserFormRow()]);
  };

  const openAddUserModal = () => {
    resetNewUserRows();
    setIsAddingUser(true);
  };

  const closeAddUserModal = () => {
    setIsAddingUser(false);
    resetNewUserRows();
  };

  const addNewUserRow = () => {
    setNewUserRows(prev => (prev.length >= 5 ? prev : [...prev, createNewUserFormRow()]));
    requestAnimationFrame(() => {
      userAddModalScrollRef.current?.scrollTo({
        top: userAddModalScrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    });
  };

  const removeLastNewUserRow = () => {
    setNewUserRows(prev => (prev.length <= 1 ? prev : prev.slice(0, -1)));
  };

  const updateNewUserRow = (index: number, updates: Partial<CSR>) => {
    setNewUserRows(prev => prev.map((row, rowIndex) => {
      if (rowIndex !== index) return row;

      const next = { ...row, ...updates };
      if (updates.role !== undefined) {
        next.lineType = getSegmentForRole(updates.role as CSR['role'], row.lineType);
        next.employmentType = 'Full Time';
        if (updates.role === 'csr') {
          next.location = normalizeUserLocation(next.location) || 'Ulaanbaatar';
          next.supervisorName = next.supervisorName || '';
        } else {
          next.location = '';
          next.supervisorName = '';
        }
      }

      return next;
    }));
  };

  const handleUserAddModalKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    event.currentTarget.scrollBy({
      top: event.key === 'ArrowDown' ? 72 : -72,
      behavior: 'smooth',
    });
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
      const segment = getSegmentForRole(editingUser.role, editingUser.lineType);
      const employmentType = editingUser.role === 'csr'
        ? (editingUser.employmentType || 'Full Time')
        : 'Full Time';
      const location = normalizeUserLocation(editingUser.location);
      const supervisorName = String(editingUser.supervisorName || '').trim();

      if (editingUser.role === 'csr' && !location) {
        alert('CSR location must be Ulaanbaatar or Darkhan.');
        return;
      }

      if (editingUser.role === 'csr' && !supervisorName) {
        alert('CSR supervisor name is required.');
        return;
      }

      try {
        await apiClient.put(`/users/${editingUser.id}`, {
          name: editingUser.name,
          status: editingUser.status,
          role: editingUser.role,
          employmentType,
          segment,
          lineType: segment,
          code: editingUser.code,
          location: editingUser.role === 'csr' ? location : '',
          supervisorName: editingUser.role === 'csr' ? supervisorName : '',
        });
        setCsrs(prev => prev.map(u => u.id === editingUser.id ? { ...editingUser, lineType: segment, employmentType, location, supervisorName } : u));
        await fetchUsers();
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

    const preparedRows = newUserRows.map((row, index) => {
      const role = row.role as CSR['role'] | undefined;
      const code = String(row.code || '').trim();
      const name = String(row.name || '').trim();
      const email = String(row.email || '').trim();
      const segment = getSegmentForRole(role, row.lineType);
      const employmentType = role === 'csr' ? (row.employmentType || 'Full Time') : 'Full Time';
      const location = role === 'csr' ? normalizeUserLocation(row.location) : '';
      const supervisorName = role === 'csr' ? String(row.supervisorName || '').trim() : '';

      return { index, role, code, name, email, segment, employmentType, location, supervisorName, row };
    });

    for (const row of preparedRows) {
      if (!row.code || !row.name || !row.email || !row.role) {
        alert(`${row.index + 1}-р мөр дээр код, нэр, и-мэйл, эрхийг бүрэн бөглөнө үү.`);
        return;
      }

      if ((row.role === 'admin' || row.role === 'csr') && !row.segment) {
        alert(`${row.index + 1}-р мөр дээр segment сонгоно уу.`);
        return;
      }

      if (row.role === 'csr' && !row.employmentType) {
        alert(`${row.index + 1}-р мөр дээр цагийн төрөл сонгоно уу.`);
        return;
      }

      if (row.role === 'csr' && !row.location) {
        alert(`${row.index + 1}-r mur deer CSR location songono uu.`);
        return;
      }

      if (row.role === 'csr' && !row.supervisorName) {
        alert(`${row.index + 1}-r mur deer CSR supervisor name oruulna uu.`);
        return;
      }

      if (csrs.some(u => u.email?.toLowerCase() === row.email.toLowerCase())) {
        alert(`${row.email} и-мэйл аль хэдийн бүртгэлтэй байна.`);
        return;
      }
    }

    const formEmails = preparedRows.map(row => row.email.toLowerCase());
    if (new Set(formEmails).size !== formEmails.length) {
      alert('Нэг form дотор ижил и-мэйл давхардаж байна.');
      return;
    }

    try {
      const createdUsers: CSR[] = [];
      const passwordLines: string[] = [];

      for (const row of preparedRows) {
        const randomPassword = generateRandomPassword();
        const response = await apiClient.post('/users', {
          email: row.email,
          password: randomPassword,
          name: row.name,
          role: row.role,
          status: 'active',
          segment: row.segment,
          lineType: row.segment,
          employmentType: row.employmentType,
          code: row.code,
          location: row.location,
          supervisorName: row.supervisorName,
        });

        createdUsers.push({
          ...response.data,
          code: row.code,
          lineType: row.segment,
          employmentType: row.employmentType,
          location: row.location,
          supervisorName: row.supervisorName,
          photoUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${row.name}`,
          status: 'active',
        });
        passwordLines.push(`${row.email}: ${randomPassword}`);
        logAction('User Creation', `Created new user: ${row.name} (${row.role}). Password sent to ${row.email}`);
      }

      setCsrs(prev => [...prev, ...createdUsers]);
      alert(`Хэрэглэгч амжилттай үүсгэгдлээ.\n\n${passwordLines.join('\n')}`);

      closeAddUserModal();
      await fetchUsers();
      await fetchLogs();
      triggerSuccess();
    } catch (error: any) {
      console.error('Error adding users:', error);
      alert(error.response?.data?.error || 'Хэрэглэгч нэмэхэд алдаа гарлаа.');
    }
  };

  const handleDeleteUser = (userId: string) => {
    const user = csrs.find(u => u.id === userId);
    if (!user) return;

    requestConfirmation(`'${user.name}' ажилтныг устгахдаа итгэлтэй байна уу?`, async () => {
      try {
        await apiClient.delete(`/users/${userId}`);
        setCsrs(prev => prev.filter(u => u.id !== userId));
        logAction('User Deleted', `Deleted user: ${user.name} (${user.role})`);
        await fetchUsers();
        await fetchLogs();
        triggerSuccess();
      } catch (error: any) {
        console.error('Error deleting user:', error);
        alert(error.response?.data?.error || 'Хэрэглэгч устгахад алдаа гарлаа.');
      }
    });
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsUploadingBulk(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws) as any[];

      const newUsers: Array<Partial<CSR> & { password: string }> = [];
      let duplicates = 0;
      let invalidRows = 0;

      data.forEach(row => {
        const email = row['И-мэйл'] || row['Email'] || '';
        const name = row['Нэр'] || row['Name'] || '';
        const role = ((row['Эрх'] || row['Role'] || 'csr') as string).toLowerCase();
        const code = row['Код'] || row['Code'] || '';
        const segment = row['Сегмент'] || row['Segment'] || segments[0] || 'Postpaid';
        const employmentType = row['Цагийн төрөл'] || row['EmploymentType'] || row['Employment Type'] || 'Full Time';
        const location = normalizeUserLocation(row['Байршил'] || row['Хот'] || row['Location'] || row['City'] || row['Bayrshil'] || '');
        const supervisorName = String(row['Ахлах'] || row['Ахлах ажилтан'] || row['Supervisor'] || row['Supervisor Name'] || row['SupervisorName'] || '').trim();

        if (!email || !name || !role) {
          invalidRows++;
          return;
        }

        if (role === 'csr' && (!location || !supervisorName)) {
          invalidRows++;
          return;
        }

        if (csrs.some(u => u.email?.toLowerCase() === email.toLowerCase())) {
          duplicates++;
          return;
        }

        const randomPassword = generateRandomPassword();
        newUsers.push({
          code,
          name,
          email,
          role: role as any,
          lineType: segment,
          employmentType,
          location,
          supervisorName,
          status: 'active',
          photoUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
          password: randomPassword,
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
              employmentType: rowUser.employmentType,
              segment: rowUser.lineType,
              lineType: rowUser.lineType,
              code: rowUser.code,
              location: rowUser.location,
              supervisorName: rowUser.supervisorName,
            });
            createdUsers.push({
              ...response.data,
              lineType: rowUser.lineType,
              employmentType: rowUser.employmentType,
              code: rowUser.code,
              location: rowUser.location,
              supervisorName: rowUser.supervisorName,
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
          await fetchUsers();
          await fetchLogs();
          logAction('Bulk User Creation', `Uploaded ${createdUsers.length} users via Excel. ${duplicates} duplicates skipped.`);
          alert(`${createdUsers.length} хэрэглэгч амжилттай нэмэгдлээ. ${duplicates} давхардсан, ${invalidRows} форматын алдаатай мөрүүд алгасагдлаа.`);
          triggerSuccess();
        } else {
          alert(`Файл доторх мөрүүдийн аль нь ч шинээр нэмэгдсэнгүй. ${duplicates} давхардсан, ${invalidRows} алдаатай мөр.`);
        }
      } else {
        alert(`Файлд тохирох мөр олдсонгүй. Формат: Код | Нэр | И-мэйл | Эрх | Сегмент | Цагийн төрөл`);
      }
      setIsUploadingBulk(false);
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
        const updatedMaterials = updateLocalItem('trainingMaterials', editingMaterial.id, updates);
        setTrainingMaterials(updatedMaterials);
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
        const updatedMaterials = addLocalItem('trainingMaterials', material);
        setTrainingMaterials(updatedMaterials);
        setShowSeenDetails(material);
        
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

  const handleResetUserPassword = async (user: CSR) => {
    const newPass = Math.random().toString(36).substr(2, 8);
    try {
      await apiClient.post(`/users/${user.id}/reset-password`, { password: newPass });
      logAction('Password Reset', `Reset password for ${user.name}. New password sent to ${user.email}`);
      alert(`Шинэ нууц үг ${user.email} хаяг руу илгээгдлээ: ${newPass}`);
      triggerSuccess();
      fetchLogs();
    } catch (error: any) {
      console.error('Error resetting password:', error);
      alert(error.response?.data?.error || 'Нууц үг сэргээхэд алдаа гарлаа.');
    }
  };

  const handleChangeMyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (myPasswordForm.new !== myPasswordForm.confirm) {
      alert('Нууц үг зөрүүтэй байна!');
      return;
    }
    try {
      await apiClient.post('/auth/change-password', {
        oldPassword: myPasswordForm.old,
        newPassword: myPasswordForm.new,
      });
      logAction('Admin Password Change', 'Super Admin changed their own password');
      setIsChangingMyPassword(false);
      setMyPasswordForm({ old: '', new: '', confirm: '' });
      triggerSuccess();
      return;
    } catch (error: any) {
      console.error('Error changing password:', error);
      alert(error.response?.data?.error || 'Нууц үг солиход алдаа гарлаа.');
      return;
    }
  };

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNotification.title || !newNotification.content) {
      alert('Гарчиг болон агуулга шаардлагатай');
      return;
    }

    try {
      const response = await apiClient.post('/broadcasts/notifications', {
        title: newNotification.title,
        content: newNotification.content,
        deadline: newNotification.deadline || '',
        type: newNotification.type || 'general'
      });
      const notification: Notification = {
        id: response.data?.id || Math.random().toString(36).substr(2, 9),
        title: newNotification.title,
        content: newNotification.content,
        deadline: newNotification.deadline || '',
        createdAt: new Date().toISOString(),
        authorId: profile?.id || 'superadmin',
        authorName: profile?.name || 'Super Admin',
        type: newNotification.type || 'general',
        seenBy: []
      };
      addLocalItem('notifications', notification);
      setShowSeenDetails(notification);
      logAction('Notification Sent', `Sent ${newNotification.type} notification: ${newNotification.title}`);
      setIsAddingNotification(false);
      setNewNotification({ type: 'general', deadline: new Date(Date.now() + 86400000).toISOString().split('T')[0] });
      fetchNotifications();
      triggerSuccess();
    } catch (error: any) {
      console.error('Error sending notification:', error);
      alert(error.response?.data?.error || 'Мэдэгдэл явуулахад алдаа гарлаа.');
    }
  };

  const exportToExcel = () => {
    const data = csrs.map(u => ({
      'Код': u.code || '',
      'Нэр': u.name,
      'И-мэйл': u.email || '',
      'Эрх': u.role,
      'Байршил': u.location || '',
      'Ахлах': u.supervisorName || '',
      'Сегмент': getDisplaySegment(u),
      'Цагийн төрөл': getDisplayTimeType(u)
    }));

    const ws = XLSX.utils.json_to_sheet(data, {
      header: ['Код', 'Нэр', 'И-мэйл', 'Эрх', 'Байршил', 'Ахлах', 'Сегмент', 'Цагийн төрөл']
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Users");
    XLSX.writeFile(wb, "system_users_data.xlsx");
    logAction('Data Export', 'Exported user data to Excel');
  };

  const downloadBulkUploadTemplate = () => {
    const templateRows = [
      {
        'Код': '',
        'Нэр': '',
        'И-мэйл': '',
        'Эрх': 'csr',
        'Байршил': 'Ulaanbaatar',
        'Ахлах': '',
        'Сегмент': 'Postpaid',
        'Цагийн төрөл': 'Full Time'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateRows, {
      header: ['Код', 'Нэр', 'И-мэйл', 'Эрх', 'Байршил', 'Ахлах', 'Сегмент', 'Цагийн төрөл']
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "BulkUploadTemplate");
    XLSX.writeFile(wb, "user_bulk_upload_template.xlsx");
    logAction('Bulk Template Download', 'Downloaded bulk upload template Excel');
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

  const getSafeExcelFileName = (name: string) => {
    return name
      .replace(/[\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80);
  };

  const buildSeenStatusRows = (
    item: Notification | TrainingMaterial,
    status: 'seen' | 'unseen'
  ) => {
    const seenMap = new Map(
      (item.seenBy ?? []).map(seen => [String(seen.userId), seen])
    );

    return csrs
      .filter(user => {
        const hasSeen = seenMap.has(String(user.id));
        return status === 'seen' ? hasSeen : !hasSeen;
      })
      .map(user => {
        const seen = seenMap.get(String(user.id));

        return {
          'Код': user.code || '',
          'Нэр': user.name,
          'И-мэйл': user.email || '',
          'Эрх': user.role,
          'Сегмент': getDisplaySegment(user),
          'Цагийн төрөл': getDisplayTimeType(user),
          'Үзсэн эсэх': seen ? 'Тийм' : 'Үгүй',
          'Үзсэн хугацаа': seen ? new Date(seen.seenAt).toLocaleString() : '-',
          'Гарчиг': item.title,
          'Хугацаа/Огноо': (item as any).deadline || (item as any).date || ''
        };
      });
  };

  const writeSeenStatusExcel = (
    item: Notification | TrainingMaterial,
    rows: ReturnType<typeof buildSeenStatusRows>,
    status: 'seen' | 'unseen'
  ) => {
    const headers = [
      'Код',
      'Нэр',
      'И-мэйл',
      'Эрх',
      'Сегмент',
      'Цагийн төрөл',
      'Үзсэн эсэх',
      'Үзсэн хугацаа',
      'Гарчиг',
      'Хугацаа/Огноо'
    ];

    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    ws['!cols'] = [
      { wch: 14 },
      { wch: 24 },
      { wch: 30 },
      { wch: 14 },
      { wch: 18 },
      { wch: 18 },
      { wch: 14 },
      { wch: 24 },
      { wch: 35 },
      { wch: 24 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      ws,
      status === 'seen' ? 'Seen Users' : 'Unseen Users'
    );

    const safeTitle = getSafeExcelFileName(item.title);
    XLSX.writeFile(
      wb,
      `${safeTitle}_${status === 'seen' ? 'seen_users' : 'unseen_users'}.xlsx`
    );
  };

  const exportNotificationSeenToExcel = (item: Notification | TrainingMaterial) => {
    const rows = buildSeenStatusRows(item, 'seen');

    if (rows.length === 0) {
      alert('Одоогоор үзсэн хэрэглэгч байхгүй байна.');
      return;
    }

    writeSeenStatusExcel(item, rows, 'seen');
    logAction('Export Seen Users', `Exported seen users for: ${item.title}`);
  };

  const exportNotificationUnseenToExcel = (item: Notification | TrainingMaterial) => {
    const rows = buildSeenStatusRows(item, 'unseen');

    if (rows.length === 0) {
      alert('Бүх хэрэглэгч үзсэн байна.');
      return;
    }

    writeSeenStatusExcel(item, rows, 'unseen');
    logAction('Export Unseen Users', `Exported unseen users for: ${item.title}`);
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
    const userActions = ['User Creation', 'User Update', 'Bulk User Creation', 'Password Reset', 'Admin Password Change', 'CSR Updated', 'CSR Added', 'Bulk CSR Added', 'Bulk CSR Deleted', 'Bulk CSR Moved', 'CREATE_USER', 'UPDATE_USER', 'DELETE_USER', 'RESET_PASSWORD', 'LOGIN_SUCCESS', 'CHANGE_PASSWORD'];
    const contentActions = ['Material Added', 'Material Updated', 'Training Upload', 'Notification Sent', 'Notification Sent (Admin)', 'CREATE_NOTIFICATION', 'DELETE_NOTIFICATION', 'CREATE_TRAINING', 'DELETE_TRAINING'];
    const systemActions = ['Data Export', 'Log Export', 'Export Seen Status', 'Material Viewed', 'Notification Viewed', 'Notification Read'];
    const scheduleActions = ['Vacation Approved', 'Vacation Rejected', 'Shift Added', 'Shift Deleted', 'Shift Updated', 'Segment Added', 'Segment Updated', 'Segment Deleted', 'REJECT_TRADE', 'APPROVE_TRADE'];

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
      return [u.code, u.name, u.email, u.role, u.lineType, u.employmentType, u.location, u.supervisorName]
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
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="w-full xl:max-w-sm">
            <div className="relative w-full">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                placeholder="Хайх..."
                className="w-full pl-11 pr-4 py-3 bg-gray-900/70 border border-gray-800 rounded-2xl text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex flex-wrap sm:flex-nowrap gap-3 items-center">
            <button
              type="button"
              onClick={openAddUserModal}
              className="flex items-center gap-3 bg-white text-black border border-gray-300 px-5 py-3 rounded-2xl font-bold text-base transition-all hover:bg-gray-100"
            >
              <UserPlus size={20} />
              Хэрэглэгч нэмэх
            </button>
            <button 
              onClick={exportToExcel}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-2xl font-bold transition-all"
            >
              <Download size={18} />
              Excel Татах
            </button>
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
                            {user.role === 'csr' && (
                              <p className="text-[10px] text-gray-500 mt-0.5">
                                {[user.location, user.supervisorName].filter(Boolean).join(' / ')}
                              </p>
                            )}
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

  const renderNotifications = () => {
    const notificationGroups = groupNotificationsByDay(
      notifications.filter(n => n.type === 'general' || n.type === 'important')
    );

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <button 
            onClick={() => setIsAddingNotification(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20"
          >
            <Plus size={20} />
            Мэдэгдэл илгээх
          </button>
        </div>

        <div className="space-y-8">
          {notificationGroups.length > 0 ? (
            notificationGroups.map(group => (
              <section key={group.key} className="space-y-4">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-black text-gray-300 uppercase tracking-widest">{group.title}</h3>
                  <span className="rounded-full border border-gray-800 bg-gray-900 px-2.5 py-1 text-[10px] font-black text-gray-500">
                    {group.notifications.length}
                  </span>
                </div>
                <div className="space-y-4">
                  {group.notifications.map((notif, idx) => {
                    const isDeadlinePassed = notif.deadline && new Date(notif.deadline) < new Date();
                    const seenBy = notif.seenBy ?? [];
                    const seenUserIds = new Set(seenBy.map(seen => String(seen.userId)));
                    const seenCount = csrs.filter(user => seenUserIds.has(String(user.id))).length;

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
                            <span className="text-sm font-bold text-blue-400">{seenCount} / {csrs.length}</span>
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
                    );
                  })}
                </div>
              </section>
            ))
          ) : (
            <div className="text-center py-20 bg-gray-900/20 rounded-3xl border border-dashed border-gray-800">
              <Bell size={48} className="mx-auto text-gray-800 mb-4 opacity-20" />
              <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Мэдэгдэл байхгүй байна</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderTraining = () => {
    const trainingGroups = groupTrainingMaterialsByDay(trainingMaterials);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <button 
            onClick={() => {
              setEditingMaterial(null);
              setNewMaterial({ 
                type: 'PDF',
                deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16)
              });
              setIsAddingMaterial(true);
            }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20"
          >
            <Plus size={20} />
            Материал нэмэх
          </button>
        </div>

        <div className="space-y-8">
          {trainingGroups.length > 0 ? (
            trainingGroups.map(group => (
              <section key={group.key} className="space-y-4">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-black text-gray-300 uppercase tracking-widest">{group.title}</h3>
                  <span className="rounded-full border border-gray-800 bg-gray-900 px-2.5 py-1 text-[10px] font-black text-gray-500">
                    {group.materials.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {group.materials.map((material, idx) => (
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
              </section>
            ))
          ) : (
            <div className="text-center py-20 bg-gray-900/20 rounded-3xl border border-dashed border-gray-800">
              <BookOpen size={48} className="mx-auto text-gray-800 mb-4 opacity-20" />
              <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Сургалтын материал байхгүй байна</p>
            </div>
          )}
        </div>
      </div>
    );
  };

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
                {!isSidebarCollapsed && (item as any).badge !== undefined && (item as any).badge > 0 && (
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full min-w-[20px] text-center ${
                    item.id === 'notifications' ? 'bg-red-500 text-white' : 'bg-purple-500 text-white'
                  }`}>
                    {(item as any).badge}
                  </span>
                )}
                {isSidebarCollapsed && (item as any).badge !== undefined && (item as any).badge > 0 && (
                  <span className={`absolute top-1 right-1 w-4 h-4 text-[8px] font-black flex items-center justify-center rounded-full border-2 border-[#0a0a0a] ${
                    item.id === 'notifications' ? 'bg-red-500 text-white' : 'bg-purple-500 text-white'
                  }`}>
                    {(item as any).badge}
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
                 activeTab === 'users' ? 'Хэрэглэгчийн удирдлага' : 'Тохиргоо'}
              </h2>
              <p className="text-xs sm:text-sm text-gray-500">Тавтай морил, {profile?.name || 'Super Admin'}. Системийн бүх үйл ажиллагааг эндээс хянана уу.</p>
            </div>
            <div className="flex items-center gap-4">
              <DigitalClock />
            </div>
          </div>

          {activeTab === 'logs' && renderLogs()}
          {activeTab === 'users' && renderUsers()}
        </div>
      </div>

      {/* Add/Edit Material Modal */}
      <AnimatePresence>
        {isAddingMaterial && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 overflow-hidden">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setIsAddingMaterial(false); setEditingMaterial(null); }} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
              }}
              className="relative w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain custom-scrollbar bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl"
            >
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
                  <h2 className="text-2xl font-black text-white">Үзсэн / Үзээгүй ажилтнууд</h2>
                  <p className="text-gray-400 text-sm">{showSeenDetails.title}</p>
                  <div className="mt-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-green-400">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    Шууд шинэчлэгдэж байна
                  </div>
                </div>
                <button onClick={() => setShowSeenDetails(null)} className="text-gray-500 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <div className="flex gap-4 mb-4 border-b border-gray-800">
                <button 
                  onClick={() => setShowSeenDetails({ ...showSeenDetails, _view: 'seen' } as any)}
                  className={`px-4 py-2 font-bold text-sm transition-all ${ 
                    (showSeenDetails as any)._view !== 'unseen' 
                      ? 'text-blue-400 border-b-2 border-blue-400' 
                      : 'text-gray-500 hover:text-white'
                  }`}
                >
                  Үзсэн ({(showSeenDetails.seenBy ?? []).length})
                </button>
                <button 
                  onClick={() => setShowSeenDetails({ ...showSeenDetails, _view: 'unseen' } as any)}
                  className={`px-4 py-2 font-bold text-sm transition-all ${
                    (showSeenDetails as any)._view === 'unseen' 
                      ? 'text-red-400 border-b-2 border-red-400' 
                      : 'text-gray-500 hover:text-white'
                  }`}
                >
                  Үзээгүй ({Math.max(csrs.filter(c => c.role === 'csr').length - (showSeenDetails.seenBy ?? []).length, 0)})
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                {(showSeenDetails as any)._view === 'unseen' ? (
                  (() => {
                    const seenUserIds = new Set((showSeenDetails.seenBy ?? []).map(s => String(s.userId)));
                    const unseenUsers = csrs.filter(u => u.role === 'csr' && !seenUserIds.has(String(u.id)));
                    
                    return unseenUsers.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                        <CheckCircle2 size={48} className="mb-4 opacity-20" />
                        <p className="font-bold">Бүх CSR ажилтнууд үзсэн байна!</p>
                      </div>
                    ) : (
                      unseenUsers.map((user, idx) => (
                        <div key={`unseen-detail-${user.id}-${idx}`} className="flex items-center justify-between p-4 bg-gray-800/30 rounded-xl border border-gray-800">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-xs font-bold text-red-400">
                              {user.name.charAt(0)}
                            </div>
                            <div>
                              <p className="font-bold text-white">{user.name}</p>
                              <div className="flex items-center gap-2">
                                <p className="text-[10px] text-gray-500 uppercase font-black">{user.email}</p>
                                <span className="w-1 h-1 bg-gray-700 rounded-full"></span>
                                <p className="text-[10px] text-gray-500 uppercase font-black">{user.lineType || 'N/A'}</p>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="flex items-center gap-1.5 text-red-500 text-xs font-bold mb-0.5">
                              <XCircle size={14} />
                              Үзээгүй
                            </div>
                            <p className="text-[10px] text-gray-500">Одоог хүртэл</p>
                          </div>
                        </div>
                      ))
                    );
                  })()
                ) : (
                  (showSeenDetails.seenBy ?? []).length === 0 ? (
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
                  )
                )}
              </div>

              <div className="mt-6 pt-6 border-t border-gray-800 flex gap-3">
                <button 
                  onClick={() => exportNotificationSeenToExcel(showSeenDetails)}
                  className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold flex items-center justify-center gap-2"
                >
                  <Download size={20} />
                  Үзсэнийг татах
                </button>
                <button 
                  onClick={() => exportNotificationUnseenToExcel(showSeenDetails)}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold flex items-center justify-center gap-2"
                >
                  <Download size={20} />
                  Үзээгүйг татах
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeAddUserModal} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div
              ref={userAddModalScrollRef}
              tabIndex={0}
              onKeyDown={handleUserAddModalKeyDown}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-2xl max-h-[88vh] overflow-y-auto bg-gray-900 border border-gray-800 rounded-3xl p-6 sm:p-8 shadow-2xl focus:outline-none"
            >
              <div className="relative mb-6 flex items-center justify-center">
                <h2 className="px-12 text-center text-2xl font-black text-white">Шинэ хэрэглэгч нэмэх</h2>
              </div>

              <form onSubmit={handleAddUser} className="space-y-5">
                {newUserRows.map((row, index) => {
                  const role = row.role as CSR['role'] | undefined;
                  const showSegment = role === 'admin' || role === 'csr';
                  const showEmploymentType = role === 'csr';
                  const showCsrDetails = role === 'csr';
                  const isLastRow = index === newUserRows.length - 1;

                  return (
                    <div key={row.formId} className="space-y-4 rounded-2xl border border-gray-800 bg-gray-950/40 p-4">
                      {isLastRow && (
                        <div className="flex items-center justify-between">
                          {newUserRows.length < 5 ? (
                            <button
                              type="button"
                              onClick={addNewUserRow}
                              className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white transition-all hover:bg-blue-500"
                              title="Мөр нэмэх"
                              aria-label="Мөр нэмэх"
                            >
                              <Plus size={20} />
                            </button>
                          ) : (
                            <span className="h-9 w-9" />
                          )}

                          {newUserRows.length > 1 ? (
                            <button
                              type="button"
                              onClick={removeLastNewUserRow}
                              className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white transition-all hover:bg-red-500"
                              title="Сүүлийн мөр хасах"
                              aria-label="Сүүлийн мөр хасах"
                            >
                              <X size={20} />
                            </button>
                          ) : (
                            <span className="h-9 w-9" />
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Код</label>
                          <input
                            type="text"
                            value={row.code || ''}
                            onChange={(e) => updateNewUserRow(index, { code: e.target.value })}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                            placeholder="Ажилтны код..."
                            required
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Нэр</label>
                          <input
                            type="text"
                            value={row.name || ''}
                            onChange={(e) => updateNewUserRow(index, { name: e.target.value })}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                            placeholder="Ажилтны нэр..."
                            required
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">И-мэйл хаяг</label>
                          <input
                            type="email"
                            value={row.email || ''}
                            onChange={(e) => updateNewUserRow(index, { email: e.target.value })}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                            placeholder="example@mail.com"
                            required
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Эрх (Role)</label>
                          <select
                            value={row.role || ''}
                            onChange={(e) => updateNewUserRow(index, { role: (e.target.value || undefined) as CSR['role'] | undefined })}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                            required
                          >
                            <option value="">Сонгох</option>
                            <option value="superadmin">Superadmin</option>
                            <option value="admin">Admin</option>
                            <option value="csr">CSR</option>
                          </select>
                        </div>
                      </div>

                      {(showSegment || showEmploymentType) && (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          {showSegment && (
                            <div>
                              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Сегмент</label>
                              <select
                                value={row.lineType || ''}
                                onChange={(e) => updateNewUserRow(index, { lineType: e.target.value })}
                                className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                                required
                              >
                                <option value="">Сонгох</option>
                                {segments.map((s, idx) => <option key={`${s}-${idx}`} value={s}>{s}</option>)}
                              </select>
                            </div>
                          )}

                          {showEmploymentType && (
                            <div>
                              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Цагийн төрөл</label>
                              <select
                                value={row.employmentType || 'Full Time'}
                                onChange={(e) => updateNewUserRow(index, { employmentType: e.target.value })}
                                className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                                required
                              >
                                <option value="Full Time">Full Time</option>
                                <option value="Part Time">Part Time</option>
                              </select>
                            </div>
                          )}
                        </div>
                      )}

                      {showCsrDetails && (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Байршил</label>
                            <select
                              value={row.location || ''}
                              onChange={(e) => updateNewUserRow(index, { location: e.target.value })}
                              className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                              required
                            >
                              <option value="">Сонгох</option>
                              {VALID_LOCATIONS.map(location => <option key={location} value={location}>{location}</option>)}
                            </select>
                          </div>

                          <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Ахлах</label>
                            <input
                              type="text"
                              value={row.supervisorName || ''}
                              onChange={(e) => updateNewUserRow(index, { supervisorName: e.target.value })}
                              className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                              placeholder="Ахлахын нэр..."
                              required
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={closeAddUserModal} className="flex-1 py-3 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-700 transition-all">Цуцлах</button>
                  <button type="submit" className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-500 transition-all">Нэмэх</button>
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
                  <select
                    value={editingUser.role}
                    onChange={(e) => {
                      const role = e.target.value as CSR['role'];
                      setEditingUser({
                        ...editingUser,
                        role,
                        lineType: getSegmentForRole(role, editingUser.lineType),
                        employmentType: 'Full Time',
                        location: role === 'csr' ? normalizeUserLocation(editingUser.location) || 'Ulaanbaatar' : '',
                        supervisorName: role === 'csr' ? editingUser.supervisorName || '' : '',
                      });
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="csr">CSR</option>
                    <option value="admin">Admin</option>
                    <option value="superadmin">Super Admin</option>
                  </select>
                </div>
                {(editingUser.role === 'admin' || editingUser.role === 'csr') && (
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Сегмент</label>
                    <select value={editingUser.lineType || ''} onChange={(e) => setEditingUser({...editingUser, lineType: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500">
                      <option value="">Сонгох</option>
                      {segments.map((s, idx) => <option key={`${s}-${idx}`} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
                {editingUser.role === 'csr' && (
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Цагийн төрөл</label>
                    <select value={editingUser.employmentType || 'Full Time'} onChange={(e) => setEditingUser({...editingUser, employmentType: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500">
                      <option value="Full Time">Full Time</option>
                      <option value="Part Time">Part Time</option>
                    </select>
                  </div>
                )}
                {editingUser.role === 'csr' && (
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Байршил</label>
                    <select value={editingUser.location || ''} onChange={(e) => setEditingUser({...editingUser, location: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500">
                      <option value="">Сонгох</option>
                      {VALID_LOCATIONS.map(location => <option key={location} value={location}>{location}</option>)}
                    </select>
                  </div>
                )}
                {editingUser.role === 'csr' && (
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Ахлах</label>
                    <input
                      type="text"
                      value={editingUser.supervisorName || ''}
                      onChange={(e) => setEditingUser({...editingUser, supervisorName: e.target.value})}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                      placeholder="Ахлахын нэр..."
                    />
                  </div>
                )}
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
              <h2 className="text-2xl font-black text-white mb-6">Мэдэгдэл илгээх</h2>
              <form onSubmit={handleSendNotification} className="space-y-4">
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
