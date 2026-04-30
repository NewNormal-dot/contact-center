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
  ArrowDownLeft
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAuth } from '../../contexts/AuthContext';
import { CSR, Notification, TrainingMaterial, VacationRequest, HourlyLeaveRequest } from '../../types';
import { logAction } from '../../utils/logger';
import { getLocalData, setLocalData, addLocalItem, updateLocalItem, deleteLocalItem } from '../../utils/localStorage';

const ENG_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { logout, profile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trainingFileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState('users');
  const [notifSubTab, setNotifSubTab] = useState<'inbox' | 'send'>('inbox');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Data States
  const [csrs, setCsrs] = useState<CSR[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [trainingMaterials, setTrainingMaterials] = useState<TrainingMaterial[]>([]);
  const [vacationRequests, setVacationRequests] = useState<VacationRequest[]>([]);
  const [segments, setSegments] = useState<string[]>([]);
  const [monthlyQuotas, setMonthlyQuotas] = useState<Record<number, number>>({});
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const lastDataRef = useRef<string>('');

  // UI States
  const [selectedMaterial, setSelectedMaterial] = useState<TrainingMaterial | null>(null);
  const [isAddingMaterial, setIsAddingMaterial] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<TrainingMaterial | null>(null);
  const [newMaterial, setNewMaterial] = useState<Partial<TrainingMaterial>>({ 
    type: 'PDF',
    deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16)
  });

  const [newNotification, setNewNotification] = useState<Partial<Notification>>({
    type: 'general',
    deadline: new Date(Date.now() + 86400000).toISOString().slice(0, 16)
  });

  const [confirmAction, setConfirmAction] = useState<{ title: string, onConfirm: () => void } | null>(null);
  const [secureConfirmAction, setSecureConfirmAction] = useState<{ 
    title: string, 
    description: string,
    onConfirm: () => void,
    username?: string,
    password?: string,
    error?: string
  } | null>(null);
  const [isAddingHoliday, setIsAddingHoliday] = useState(false);
  const [holidayData, setHolidayData] = useState({ id: '', date: '', name: '', hours: 8 });
  const [holidays, setHolidays] = useState<any[]>([]);

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [schedules, setSchedules] = useState<Record<string, any>>({});
  const [selectedDateSchedule, setSelectedDateSchedule] = useState<string | null>(null);
  const [scheduleViewMode, setScheduleViewMode] = useState<'cards' | 'grid'>('grid');
  const [hourlyLeaveRequests, setHourlyLeaveRequests] = useState<HourlyLeaveRequest[]>([]);
  const [shiftTemplates, setShiftTemplates] = useState<any[]>([]);
  const [selectedYearCalendar, setSelectedYearCalendar] = useState<number>(new Date().getFullYear());
  const [selectedMonthCalendar, setSelectedMonthCalendar] = useState<number>(new Date().getMonth());
  const [isManagingShiftTemplates, setIsManagingShiftTemplates] = useState(false);
  const [newTemplateTime, setNewTemplateTime] = useState('');
  const [isAddingTemplate, setIsAddingTemplate] = useState(false);
  const [isEditingShiftModal, setIsEditingShiftModal] = useState(false);
  const [isCopyingSchedule, setIsCopyingSchedule] = useState(false);
  const [editingShiftData, setEditingShiftData] = useState<{
    id?: string,
    time: string,
    segment: string,
    employmentType: 'Full Time' | 'Part Time',
    totalSlots: number,
    dateKey: string
  } | null>(null);
  const [filters, setFilters] = useState({
    segment: 'All',
    email: '',
    code: ''
  });

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ old: '', new: '', confirm: '' });
  const [vacationSegmentFilter, setVacationSegmentFilter] = useState('All');

  // Notifications Count
  const unreadCount = notifications.filter(n => (n.type === 'general' || n.type === 'important') && !n.seenBy?.some(s => s.userId === 'admin')).length;
  const unreadTrainingCount = trainingMaterials.filter(m => !m.seenBy?.some(s => s.userId === 'admin')).length;

  const [activeEmploymentView, setActiveEmploymentView] = useState<'Full Time' | 'Part Time'>('Full Time');
  const [activeSegmentView, setActiveSegmentView] = useState<string>('');

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
    const loadedCsrs = getLocalData('users', []);
    const loadedSegments = getLocalData('segments', []);
    
    setCsrs(loadedCsrs);
    setSegments(loadedSegments);
    if (loadedSegments.length > 0 && !activeSegmentView) {
      setActiveSegmentView(loadedSegments[0]);
    }
    
    setNotifications(getLocalData('notifications', []));
    setTrainingMaterials(getLocalData('trainingMaterials', []));
    setVacationRequests(getLocalData('vacationRequests', []));
    setSegments(getLocalData('segments', []));
    setMonthlyQuotas(getLocalData('monthlyQuotas', {
      0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5, 9: 5, 10: 5, 11: 5
    }));
    setSchedules(getLocalData('schedules', {}));
    setHourlyLeaveRequests(getLocalData('hourlyLeaveRequests', []));
    setHolidays(getLocalData('holidays', []).map((h: any) => ({
      ...h,
      id: h.id || Math.random().toString(36).substr(2, 9)
    })));
    setShiftTemplates(getLocalData('shiftTemplates', [
      { id: '1', time: '09--14', label: '09--14' },
      { id: '2', time: '09--15', label: '09--15' },
      { id: '3', time: '09--16', label: '09--16' },
      { id: '4', time: '09--17', label: '09--17' },
      { id: '5', time: '10--15', label: '10--15' },
      { id: '6', time: '10--16', label: '10--16' },
      { id: '7', time: '10--17', label: '10--17' },
      { id: '8', time: '10--18', label: '10--18' },
      { id: '9', time: '11--16', label: '11--16' },
      { id: '10', time: '11--17', label: '11--17' },
      { id: '11', time: '11--18', label: '11--18' },
      { id: '12', time: '11--19', label: '11--19' },
      { id: '13', time: '12--17', label: '12--17' },
      { id: '14', time: '12--18', label: '12--18' },
      { id: '15', time: '12--19', label: '12--19' },
      { id: '16', time: '12--20', label: '12--20' },
      { id: '17', time: '13--18', label: '13--18' },
      { id: '18', time: '13--19', label: '13--19' },
      { id: '19', time: '13--20', label: '13--20' },
      { id: '20', time: '13--21', label: '13--21' },
      { id: '21', time: '14--19', label: '14--19' },
      { id: '22', time: '14--20', label: '14--20' },
      { id: '23', time: '14--21', label: '14--21' },
      { id: '24', time: '14--22', label: '14--22' },
      { id: '25', time: '18--01', label: '18--01' },
      { id: '26', time: '19--01', label: '19--01' },
      { id: '27', time: '20--01', label: '20--01' }
    ]));

    // Real-time polling
    const interval = setInterval(() => {
      const u = getLocalData('users', []);
      const n = getLocalData('notifications', []);
      const tm = getLocalData('trainingMaterials', []);
      const vr = getLocalData('vacationRequests', []);
      const segs = getLocalData('segments', []);
      const mq = getLocalData('monthlyQuotas', {
        0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5, 9: 5, 10: 5, 11: 5
      });
      const sd = getLocalData('schedules', {});
      
      // Sanitize schedules data to ensure consistency
      const sanitizedSd: Record<string, any> = {};
      Object.entries(sd).forEach(([dateKey, data]: [string, any]) => {
        if (data && data.shifts) {
          sanitizedSd[dateKey] = {
            ...data,
            shifts: data.shifts.map((s: any) => ({
              ...s,
              segment: s.segment || 'All',
              employmentType: s.employmentType || 'Full Time'
            }))
          };
        } else {
          sanitizedSd[dateKey] = data;
        }
      });

      const hl = getLocalData('hourlyLeaveRequests', []);
      const hls = getLocalData('holidays', []).map((h: any) => ({
        ...h,
        id: h.id || Math.random().toString(36).substr(2, 9)
      }));

      const currentHash = JSON.stringify({ u, n, tm, vr, segs, mq, sd: sanitizedSd, hl, hls });
      if (currentHash !== lastDataRef.current) {
        lastDataRef.current = currentHash;
        setCsrs(u);
        setNotifications(n);
        setTrainingMaterials(tm);
        setVacationRequests(vr);
        setSegments(segs);
        setMonthlyQuotas(mq);
        setSchedules(sanitizedSd);
        setHourlyLeaveRequests(hl);
        setHolidays(hls);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const handleApproveHourlyLeave = (id: string) => {
    updateLocalItem('hourlyLeaveRequests', id, { status: 'approved' });
    logAction('Hourly Leave Approved', `Approved request ${id}`);
  };

  const handleRejectHourlyLeave = (id: string, comment: string) => {
    updateLocalItem('hourlyLeaveRequests', id, { status: 'rejected', comment });
    logAction('Hourly Leave Rejected', `Rejected request ${id}`);
  };

  const handleRemoveUserFromShift = (dateKey: string, shiftId: string, userId: string) => {
    const currentSchedules = getLocalData('schedules', {});
    if (currentSchedules[dateKey]) {
      currentSchedules[dateKey].shifts = currentSchedules[dateKey].shifts.map((s: any) => {
        if (s.id === shiftId) {
          return {
            ...s,
            bookedSlots: Math.max(0, s.bookedSlots - 1),
            bookedBy: s.bookedBy.filter((b: any) => b.userId !== userId)
          };
        }
        return s;
      });
      setLocalData('schedules', currentSchedules);
      setSchedules(currentSchedules);
      logAction('Member Removed from Shift', `Removed user ${userId} from shift ${shiftId} on ${dateKey}`);
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (isFilterOpen && filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isFilterOpen]);

  const handleLogout = () => {
    logout();
    navigate('/');
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
          updateLocalItem('users', profile.id, { photoUrl: base64 });
        } catch (error) {
          console.error('Error updating admin photo:', error);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleConfirm = (title: string, onConfirm: () => void) => {
    setConfirmAction({ title, onConfirm });
  };

  const handleSecureConfirm = (title: string, description: string, onConfirm: () => void) => {
    setSecureConfirmAction({ title, description, onConfirm, username: 'admin', password: '' });
  };

  const handleApproveVacation = (requestId: string) => {
    const request = vacationRequests.find(r => r.id === requestId);
    if (!request) return;

    updateLocalItem('vacationRequests', requestId, { status: 'approved' });
    logAction('Vacation Approved', `Approved vacation for ${request.csrName}: ${request.startDate} - ${request.endDate}`);
    
    // Auto-Notification
    const notification: Notification = {
      id: Math.random().toString(36).substr(2, 9),
      title: 'Амралт зөвшөөрөгдлөө',
      content: `Таны ээлжийн амралтын хүсэлт (${request.startDate} - ${request.endDate}) зөвшөөрөгдлөө.`,
      createdAt: new Date().toISOString(),
      deadline: '',
      authorId: 'admin',
      authorName: 'Admin',
      type: 'general',
      targetUserId: request.csrId,
      seenBy: []
    };
    addLocalItem('notifications', notification);
  };

  const handleRejectVacation = (requestId: string) => {
    const request = vacationRequests.find(r => r.id === requestId);
    if (!request) return;

    updateLocalItem('vacationRequests', requestId, { status: 'rejected' });
    logAction('Vacation Rejected', `Rejected vacation for ${request.csrName}`);
    
    // Auto-Notification
    const notification: Notification = {
      id: Math.random().toString(36).substr(2, 9),
      title: 'Амралт татгалзагдлаа',
      content: `Таны ээлжийн амралтын хүсэлт (${request.startDate} - ${request.endDate}) татгалзагдлаа. Админтай холбогдоно уу.`,
      createdAt: new Date().toISOString(),
      deadline: '',
      authorId: 'admin',
      authorName: 'Admin',
      type: 'general',
      targetUserId: request.csrId,
      seenBy: []
    };
    addLocalItem('notifications', notification);
  };

  const handleUpdateQuota = (monthIndex: number, newQuota: number) => {
    const currentQuotas = getLocalData('monthlyQuotas', {
      0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5, 9: 5, 10: 5, 11: 5
    });
    const updated = { ...currentQuotas, [monthIndex]: newQuota };
    setLocalData('monthlyQuotas', updated);
    setMonthlyQuotas(updated);
  };

  const handleExportVacations = (monthIndex: number, requests: VacationRequest[]) => {
    const months = [
      '1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар',
      '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар'
    ];
    
    const rows = requests.map(req => {
      const requester = csrs.find(c => c.id === req.csrId);
      return {
        'Код': requester?.code || '---',
        'Ажилтан': req.csrName,
        'Имэйл': requester?.email || '---',
        'Сегмент': requester?.lineType || '---',
        'Төрөл': requester?.employmentType || '---',
        'Эхлэх': req.startDate,
        'Дуусах': req.endDate,
        'Төлөв': req.status === 'pending' ? 'Хүлээгдэж буй' : (req.status === 'approved' ? 'Зөвшөөрсөн' : 'Татгалзсан'),
        'Илгээсэн': new Date(req.createdAt || 0).toLocaleString()
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Амралтын хүсэлтүүд");
    XLSX.writeFile(wb, `Vacation_Requests_${months[monthIndex]}_${vacationSegmentFilter}.xlsx`);
    logAction('Export Vacations', `Exported vacations for ${months[monthIndex]}`);
  };

  const handleExportExcel = () => {
    const filteredCsrs = csrs.filter(c => {
      const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSegment = filters.segment === 'All' || c.lineType === filters.segment;
      const matchesEmail = !filters.email || (c.email || '').toLowerCase().includes(filters.email.toLowerCase());
      const matchesCode = !filters.code || (c.code || '').toLowerCase().includes(filters.code.toLowerCase());
      return matchesSearch && matchesSegment && matchesEmail && matchesCode;
    });

    const rows = filteredCsrs.map(c => ({
      'Ажилтны код': c.code || c.id.slice(0, 6).toUpperCase(),
      'Нэр': c.name,
      'Имэйл': c.email || `${c.name.toLowerCase().replace(/\s/g, '.')}@example.com`,
      'Сегмент': c.lineType,
      'Ажлын төрөл': c.employmentType || 'Full Time',
      'Төлөв': c.status || 'offline'
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Ажилтнууд");
    XLSX.writeFile(wb, `Employees_Export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    logAction('Export Employees', `Exported ${filteredCsrs.length} employees to Excel`);
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    if (passwordForm.new !== passwordForm.confirm) {
      alert('Шинэ нууц үгнүүд зөрүүтэй байна!');
      return;
    }

    if (passwordForm.new.length < 6) {
      alert('Шинэ нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой!');
      return;
    }

    const users = getLocalData('users', []);
    const currentUserIndex = users.findIndex((u: any) => u.id === profile.id);

    if (currentUserIndex === -1) {
      alert('Хэрэглэгч олдсонгүй!');
      return;
    }

    const currentUser = users[currentUserIndex];
    if (currentUser.password && currentUser.password !== passwordForm.old) {
      alert('Хуучин нууц үг буруу байна!');
      return;
    }

    // Update password
    users[currentUserIndex].password = passwordForm.new;
    setLocalData('users', users);
    
    // Update local profile
    const savedProfile = JSON.parse(localStorage.getItem('test_profile') || '{}');
    if (savedProfile.id === profile.id) {
       savedProfile.password = passwordForm.new;
       localStorage.setItem('test_profile', JSON.stringify(savedProfile));
    }

    logAction('Password Changed', `Changed password for ${profile.name}`);
    alert('Нууц үг амжилттай солигдлоо!');
    setIsChangingPassword(false);
    setPasswordForm({ old: '', new: '', confirm: '' });
  };

  const handleAddMaterial = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMaterial.title) {
      const processSubmission = (url: string = '', type: string = 'Link') => {
        if (editingMaterial) {
          updateLocalItem('trainingMaterials', editingMaterial.id, { 
            ...newMaterial, 
            id: editingMaterial.id,
            url: url || newMaterial.url || '',
            type: type || newMaterial.type || 'Link'
          });
          logAction('Material Updated', `Updated training material: ${newMaterial.title}`);
        } else {
          const material: TrainingMaterial = {
            id: Math.random().toString(36).substr(2, 9),
            title: newMaterial.title!,
            description: newMaterial.description || '',
            url: url,
            type: type,
            date: new Date().toISOString().split('T')[0],
            deadline: newMaterial.deadline,
            seenBy: []
          };
          addLocalItem('trainingMaterials', material);
          logAction('Material Added', `Added training material: ${material.title}`);
          
          const notification: Notification = {
            id: Math.random().toString(36).substr(2, 9),
            title: 'Шинэ сургалтын материал',
            content: `"${material.title}" нэртэй шинэ сургалтын материал нэмэгдлээ. Дуусах хугацаа: ${material.deadline}`,
            createdAt: new Date().toISOString(),
            deadline: material.deadline || '',
            authorId: 'admin',
            authorName: 'Admin',
            type: 'training',
            seenBy: []
          };
          addLocalItem('notifications', notification);
        }
        setIsAddingMaterial(false);
        setEditingMaterial(null);
        setSelectedFile(null);
        setNewMaterial({ type: 'Article', deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16) });
      };

      if (selectedFile) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          let fileType = 'File';
          if (selectedFile.type.startsWith('image/')) fileType = 'Image';
          else if (selectedFile.type.startsWith('video/')) fileType = 'Video';
          else if (selectedFile.type === 'application/pdf') fileType = 'PDF';
          processSubmission(base64, fileType);
        };
        reader.readAsDataURL(selectedFile);
      } else {
        processSubmission(newMaterial.url || '', newMaterial.type || 'Article');
      }
    }
  };

  const handleDeleteMaterial = (id: string) => {
    const updatedMaterials = deleteLocalItem('trainingMaterials', id);
    setTrainingMaterials(updatedMaterials);
    logAction('Material Deleted', `Deleted material with ID: ${id}`);
  };

  const handleSendNotification = (e: React.FormEvent) => {
    e.preventDefault();
    if (newNotification.title && newNotification.content) {
      const notification: Notification = {
        id: Math.random().toString(36).substr(2, 9),
        title: newNotification.title,
        content: newNotification.content,
        type: newNotification.type as any,
        deadline: newNotification.deadline || '',
        createdAt: new Date().toISOString(),
        authorId: 'admin',
        authorName: 'Admin',
        seenBy: []
      };
      addLocalItem('notifications', notification);
      logAction('Notification Sent', `Sent notification: ${notification.title}`);
      setNewNotification({ type: 'general', deadline: new Date(Date.now() + 86400000).toISOString().slice(0, 16) });
      setNotifSubTab('inbox');
    }
  };

  const markMaterialAsRead = (id: string) => {
    const mat = trainingMaterials.find(m => m.id === id);
    if (mat && !mat.seenBy?.some(s => s.userId === 'admin')) {
      const seenBy = [...(mat.seenBy || []), { userId: 'admin', userName: 'Admin', seenAt: new Date().toISOString() }];
      updateLocalItem('trainingMaterials', id, { seenBy });
    }
  };

  const markNotificationAsRead = (id: string) => {
    const n = notifications.find(notif => notif.id === id);
    if (n && !n.seenBy?.some(s => s.userId === 'admin')) {
      const seenBy = [...(n.seenBy || []), { userId: 'admin', userName: 'Admin', seenAt: new Date().toISOString() }];
      updateLocalItem('notifications', id, { seenBy });
    }
  };

  const handleDeleteNotification = (id: string) => {
    const updatedNotifications = deleteLocalItem('notifications', id);
    setNotifications(updatedNotifications);
    logAction('Notification Deleted', `Deleted notification: ${id}`);
  };

  const handleDeleteUser = (id: string) => {
    const userToDelete = csrs.find(u => u.id === id);
    if (!userToDelete) return;

    const updatedUsers = csrs.filter(u => u.id !== id);
    setLocalData('users', updatedUsers);
    setCsrs(updatedUsers);
    logAction('Employee Deleted', `Deleted employee: ${userToDelete.name}`);
  };

  const exportNotificationSeenList = (notif: Notification) => {
    const data = csrs.map(csr => {
      const seenInfo = notif.seenBy?.find(s => s.userId === csr.id);
      return {
        'Ажилтан': csr.name,
        'Имэйл': csr.email || '-',
        'Сегмент': csr.lineType,
        'Төлөв': seenInfo ? 'Үзсэн' : 'Үзээгүй',
        'Үзсэн хугацаа': seenInfo ? new Date(seenInfo.seenAt).toLocaleString() : '-'
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Seen Status");
    XLSX.writeFile(workbook, `Notification_Report_${notif.id}.xlsx`);
    logAction('Export Notification Report', `Exported seen report for: ${notif.title}`);
  };

  const handleAddHoliday = () => {
    if (holidayData.date && holidayData.name) {
      const existingHolidays = getLocalData('holidays', []);
      let updated;
      
      // Migration/Safety: Ensure all existing holidays have IDs if they don't already
      const normalizedHolidays = existingHolidays.map((h: any) => ({
        ...h,
        id: h.id || Math.random().toString(36).substr(2, 9)
      }));

      const isExisting = normalizedHolidays.find((h: any) => h.id === holidayData.id);

      if (holidayData.id && isExisting) {
        updated = normalizedHolidays.map((h: any) => h.id === holidayData.id ? { ...holidayData, hours: Number(holidayData.hours) } : h);
        logAction('Holiday Updated', `Updated holiday: ${holidayData.name}`);
      } else {
        const newHoliday = { 
          id: Math.random().toString(36).substr(2, 9),
          date: holidayData.date,
          name: holidayData.name,
          hours: Number(holidayData.hours) || 0 
        };
        updated = [...normalizedHolidays, newHoliday];
        logAction('Holiday Added', `Added holiday: ${holidayData.name} on ${holidayData.date}`);
      }
      
      setLocalData('holidays', updated);
      setHolidays(updated);
      setHolidayData({ id: '', date: '', name: '', hours: 8 });
    }
  };

  const [isAddingUser, setIsAddingUser] = useState(false);
  const [isEditingUser, setIsEditingUser] = useState(false);
  const [editingUser, setEditingUser] = useState<CSR | null>(null);
  const [userAddTab, setUserAddTab] = useState<'single' | 'bulk'>('single');
  const [bulkUsers, setBulkUsers] = useState<Partial<CSR>[]>([
    { code: '', name: '', email: '', lineType: '', employmentType: 'Full Time' }
  ]);
  const [isAddingSegment, setIsAddingSegment] = useState(false);
  const [newSegment, setNewSegment] = useState('');
  const [newUser, setNewUser] = useState<Partial<CSR>>({
    role: 'csr',
    lineType: '',
    code: '',
    employmentType: 'Full Time',
    status: 'offline',
    photoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + Math.random()
  });

  const handleAddUser = () => {
    if (newUser.name && newUser.lineType) {
      const users = getLocalData('users', []);
      const userToAdd = {
        ...newUser,
        id: Math.random().toString(36).substr(2, 9),
        code: newUser.code || `EMP${Math.floor(1000 + Math.random() * 9000)}`,
        email: newUser.email || `${newUser.name?.toLowerCase().replace(/\s/g, '.')}@example.com`,
        password: 'password123'
      } as CSR;
      setLocalData('users', [...users, userToAdd]);
      setCsrs([...users, userToAdd]);
      setIsAddingUser(false);
      setNewUser({
        role: 'csr',
        lineType: '',
        code: '',
        employmentType: 'Full Time',
        status: 'offline',
        photoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + Math.random()
      });
      logAction('Employee Added', `Added employee: ${newUser.name}`);
    }
  };

  const handleEditUserClick = (user: CSR) => {
    setEditingUser(user);
    setIsEditingUser(true);
  };

  const handleUpdateUser = () => {
    if (editingUser) {
      const users = getLocalData('users', []);
      const updatedUsers = users.map((u: CSR) => u.id === editingUser.id ? editingUser : u);
      setLocalData('users', updatedUsers);
      setCsrs(updatedUsers);
      setIsEditingUser(false);
      setEditingUser(null);
      logAction('User Updated', `Updated user: ${editingUser.name}`);
    }
  };

  const handleBulkAdd = () => {
    const validUsers = bulkUsers.filter(u => u.name && u.lineType);
    if (validUsers.length === 0) return;

    const existingUsers = getLocalData('users', []);
    const usersToAdd: CSR[] = validUsers.map(u => ({
      id: Math.random().toString(36).substr(2, 9),
      code: u.code || `EMP${Math.floor(1000 + Math.random() * 9000)}`,
      name: u.name!,
      email: u.email || `${u.name!.toLowerCase().replace(/\s/g, '.')}@example.com`,
      lineType: u.lineType!,
      employmentType: (u.employmentType as any) || 'Full Time',
      role: 'csr',
      status: 'offline',
      password: 'password123',
      photoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + Math.random()
    }));

    const updatedUsers = [...existingUsers, ...usersToAdd];
    setLocalData('users', updatedUsers);
    setCsrs(updatedUsers);
    setIsAddingUser(false);
    setBulkUsers([{ code: '', name: '', email: '', lineType: '', employmentType: 'Full Time' }]);
    logAction('Bulk Employees Added', `${usersToAdd.length} ажилтан олноор нэмэгдлээ.`);
  };

  const addBulkRow = () => {
    setBulkUsers(prev => [...prev, { code: '', name: '', email: '', lineType: '', employmentType: 'Full Time' }]);
  };

  const removeBulkRow = (index: number) => {
    if (bulkUsers.length <= 1) return;
    setBulkUsers(prev => prev.filter((_, i) => i !== index));
  };

  const updateBulkUser = (index: number, updates: Partial<CSR>) => {
    setBulkUsers(prev => prev.map((u, i) => i === index ? { ...u, ...updates } : u));
  };

  const handleAddSegment = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSegment && !segments.includes(newSegment)) {
      const updatedSegments = [...segments, newSegment];
      setLocalData('segments', updatedSegments);
      setSegments(updatedSegments);
      setIsAddingSegment(false);
      setNewSegment('');
      logAction('Segment Added', `Added segment: ${newSegment}`);
    }
  };

  const handleDeleteSegment = (segmentName: string) => {
    const updatedSegments = segments.filter(s => s !== segmentName);
    setLocalData('segments', updatedSegments);
    setSegments(updatedSegments);
    logAction('Segment Deleted', `Deleted segment: ${segmentName}`);
  };

  const renderUsersView = () => {
    const filteredCsrs = csrs.filter(c => {
      const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSegment = filters.segment === 'All' || c.lineType === filters.segment;
      const matchesEmail = !filters.email || (c.email || '').toLowerCase().includes(filters.email.toLowerCase());
      const matchesCode = !filters.code || (c.code || '').toLowerCase().includes(filters.code.toLowerCase());
      return matchesSearch && matchesSegment && matchesEmail && matchesCode;
    });

    const segmentsToDisplay = filters.segment === 'All' ? segments : segments.filter(s => s === filters.segment);

    const groupedCsrs = segmentsToDisplay.reduce((acc, segment) => {
      acc[segment] = filteredCsrs.filter(c => c.lineType === segment);
      return acc;
    }, {} as Record<string, CSR[]>);

    if (filters.segment === 'All') {
      const otherCsrs = filteredCsrs.filter(c => !segments.includes(c.lineType));
      if (otherCsrs.length > 0) groupedCsrs['Бусад'] = otherCsrs;
    }

    return (
      <div className="space-y-12">
        <div className="flex items-center justify-between gap-4">
          {/* Action buttons and search in one row */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAddingUser(true)}
              className="flex items-center gap-2.5 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white bg-blue-600 shadow-xl shadow-blue-900/50 hover:scale-[1.02] hover:bg-blue-500 active:scale-95 transition-all"
            >
              <UserPlus size={18} />
              Нэгээр нэмэх
            </button>
            <button
              onClick={() => setIsAddingSegment(true)}
              className="flex items-center gap-2.5 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
            >
              <Plus size={18} />
              Олноор нэмэх
            </button>
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-2.5 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white bg-green-500 hover:bg-green-600 transition-all"
            >
              <Download size={18} />
              Excel татах
            </button>
          </div>
          <div className="relative group overflow-hidden rounded-[2rem] ml-4">
            <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-gray-500 group-focus-within:text-blue-500 transition-colors z-10">
              <Search size={20} />
            </div>
            <input
              type="text"
              placeholder="Ажилтан хайх..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-14 pr-8 py-4 bg-gray-900/40 border border-gray-800 rounded-[2rem] text-sm focus:outline-none focus:border-blue-500/50 focus:bg-gray-900/60 transition-all w-56 text-white backdrop-blur-xl shadow-inner scroll-smooth"
            />
          </div>
        </div>

        {(Object.entries(groupedCsrs) as [string, CSR[]][]).map(([segment, members]) => (
          <div key={`segment-group-${segment}`} className="space-y-6">
            <div className="flex items-center gap-4">
              <h3 className="text-xl font-outfit font-black text-white uppercase tracking-widest">{segment}</h3>
              <div className="flex-1 h-px bg-gradient-to-r from-gray-800 to-transparent" />
              <div className="flex items-center gap-4">
                <span className="text-xs font-outfit font-black text-gray-500 uppercase tracking-widest">{members.length} ажилтан</span>
                {members.length === 0 && segments.includes(segment) && (
                  <button 
                    onClick={() => handleDeleteSegment(segment)}
                    className="p-1.5 text-gray-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                    title="Хоосон сегмент устгах"
                  >
                    <Trash size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="bg-gray-900/40 border border-gray-800 rounded-3xl overflow-hidden backdrop-blur-md shadow-2xl">
              {members.length > 0 ? (
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-800/30">
                      <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest w-40">Ажилтны код</th>
                      <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">Ажилтан</th>
                      <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">Имэйл хаяг</th>
                      <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">Ажлын төрөл</th>
                      <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest text-right">Үйлдэл</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {members.map((csr) => (
                      <tr key={csr.id} className="hover:bg-blue-600/5 transition-all group">
                        <td className="px-8 py-5">
                          <span className="text-sm font-black text-blue-500 group-hover:scale-110 transition-transform inline-block lowercase">{csr.code || csr.id.slice(0,6).toUpperCase()}</span>
                        </td>
                        <td className="px-8 py-5">
                          <div className="text-lg font-black text-white group-hover:translate-x-1 transition-transform inline-block cursor-default tracking-wide uppercase">{csr.name}</div>
                        </td>
                        <td className="px-8 py-5">
                          <div className="text-sm font-black text-white flex items-center gap-2">
                            <Mail size={14} className="text-blue-500" />
                            {csr.email || `${csr.name.toLowerCase().replace(/\s/g, '.')}@example.com`}
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          <div className="flex items-center gap-2">
                            <Clock size={14} className="text-blue-500" />
                            <span className="text-sm font-black uppercase tracking-widest text-white">
                              {csr.employmentType || 'Full Time'}
                            </span>
                          </div>
                        </td>
                        <td className="px-8 py-5 text-right flex items-center justify-end gap-1">
                          <button 
                            onClick={() => handleEditUserClick(csr)}
                            className="p-2.5 text-gray-600 hover:text-blue-500 hover:bg-blue-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Edit size={20} />
                          </button>
                          <button 
                            onClick={() => handleSecureConfirm(
                              `Ажилтан хасах баталгаажуулалт`,
                              `'${csr.name}' ажилтныг бүртгэлээс хасахын тулд өөрийн нэвтрэх нэр болон нууц үгээ оруулна уу.`,
                              () => handleDeleteUser(csr.id)
                            )}
                            className="p-2.5 text-gray-600 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={20} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="py-12 text-center">
                  <p className="text-gray-500 text-sm font-medium">Энэ сегментэд ажилтан бүртгэгдээгүй байна.</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderVacationView = () => {
    const months = [
      '1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар',
      '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар'
    ];

    if (selectedMonth !== null) {
      const monthRequests = vacationRequests.filter(req => {
        const date = new Date(req.startDate);
        const isMonth = date.getMonth() === selectedMonth;
        
        if (!isMonth) return false;
        if (vacationSegmentFilter === 'All') return true;
        
        const requester = csrs.find(c => c.id === req.csrId);
        return requester?.lineType === vacationSegmentFilter;
      }).sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

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
                <h2 className="text-3xl font-outfit font-black text-white tracking-tight">{months[selectedMonth]}</h2>
                <p className="text-gray-400 mt-1">Нийт {monthRequests.length} хүсэлт ирсэн байна.</p>
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
                  {segments.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                  <Filter size={14} />
                </div>
              </div>

              <button 
                onClick={() => handleExportVacations(selectedMonth!, monthRequests)}
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
                  <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest w-40">Код</th>
                  <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">Ажилтан</th>
                  <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">Имэйл хаяг</th>
                  <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">Хугацаа</th>
                  <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest text-right">Үйлдэл</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {monthRequests.map((req) => {
                  const requester = csrs.find(c => c.id === req.csrId);
                  return (
                    <tr key={req.id} className="hover:bg-gray-800/10 transition-colors group">
                      <td className="px-8 py-6">
                        <span className="text-sm font-black text-blue-500">{requester?.code || '---'}</span>
                      </td>
                      <td className="px-8 py-6">
                        <div className="font-bold text-white uppercase tracking-wide">{req.csrName}</div>
                      </td>
                      <td className="px-8 py-6 text-sm text-gray-400">
                        {requester?.email || '---'}
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-2 text-sm text-gray-300">
                          <Calendar size={14} className="text-blue-400" />
                          {req.startDate} - {req.endDate}
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right">
                        {req.status === 'pending' && (
                          <div className="flex items-center justify-end gap-2">
                             <button onClick={() => handleConfirm(`'${req.csrName}'-ийн хүсэлтийг зөвшөөрөх үү?`, () => handleApproveVacation(req.id))} className="p-2 text-green-500 hover:bg-green-500/10 rounded-xl transition-all" title="Зөвшөөрөх"><CheckCircle2 size={20} /></button>
                             <button onClick={() => handleConfirm(`'${req.csrName}'-ийн хүсэлтээс татгалзах уу?`, () => handleRejectVacation(req.id))} className="p-2 text-red-500 hover:bg-red-500/10 rounded-xl transition-all" title="Татгалзах"><XCircle size={20} /></button>
                          </div>
                        )}
                        {req.status !== 'pending' && (
                          <span className={`text-[10px] font-black uppercase tracking-widest ${req.status === 'approved' ? 'text-green-500' : 'text-red-500'}`}>
                            {req.status === 'approved' ? 'Зөвшөөрсөн' : 'Татгалзсан'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {monthRequests.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-20 text-center text-gray-500 font-bold uppercase tracking-widest text-xs opacity-50">
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
            <h2 className="text-3xl font-black text-white tracking-tight">Ээлжийн амралт</h2>
            <p className="text-gray-400 mt-1">Сар бүрийн амралтын квот болон захиалгын мэдээлэл.</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative group">
              <select 
                value={vacationSegmentFilter}
                onChange={(e) => setVacationSegmentFilter(e.target.value)}
                className="appearance-none bg-gray-900 border border-gray-800 rounded-2xl px-6 py-3 pr-10 text-xs font-black text-white uppercase tracking-widest focus:outline-none focus:border-blue-500 transition-all cursor-pointer min-w-[160px]"
              >
                <option value="All">Бүх сегмент</option>
                {segments.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                <Filter size={14} />
              </div>
            </div>

            <button 
              onClick={() => {
                const allFiltered = vacationRequests.filter(req => {
                  if (vacationSegmentFilter === 'All') return true;
                  const requester = csrs.find(c => c.id === req.csrId);
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
            const monthRequests = vacationRequests.filter(req => {
              const date = new Date(req.startDate);
              const isMonth = date.getMonth() === index;
              if (!isMonth) return false;
              if (vacationSegmentFilter === 'All') return true;
              const requester = csrs.find(c => c.id === req.csrId);
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
                      <span className="text-2xl font-black text-white">{monthRequests.length} <span className="text-gray-600">/</span> {quota}</span>
                      <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest bg-gray-800 px-2 py-0.5 rounded-lg">Захиалсан</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Квот:</span>
                      <input 
                        type="number"
                        value={quota}
                        onChange={(e) => handleUpdateQuota(index, parseInt(e.target.value) || 0)}
                        className="w-16 bg-gray-800 border border-gray-700 rounded-xl px-2 py-1.5 text-sm text-center font-bold text-white focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-700 ease-out ${
                        monthRequests.length >= quota ? 'bg-red-500' : 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]'
                      }`}
                      style={{ width: `${Math.min((monthRequests.length / quota) * 100, 100)}%` }}
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

  const renderNotificationsView = () => (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tight">Мэдэгдэл</h2>
          <p className="text-gray-400 mt-1">Системийн мэдэгдэл илгээх болон хянах.</p>
        </div>
        <div className="flex bg-gray-900 border border-gray-800 p-1.5 rounded-2xl shadow-xl">
          <button 
            onClick={() => setNotifSubTab('inbox')}
            className={`flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${notifSubTab === 'inbox' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Inbox size={16} />
            Ирсэн
          </button>
          <button 
            onClick={() => setNotifSubTab('send')}
            className={`flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${notifSubTab === 'send' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Send size={16} />
            Илгээх
          </button>
        </div>
      </div>

      {notifSubTab === 'inbox' ? (
        <div className="space-y-4">
          {notifications.filter(n => n.type === 'general' || n.type === 'important').length > 0 ? (
            notifications.filter(n => n.type === 'general' || n.type === 'important').map((notif, idx) => {
              const isUnread = !notif.seenBy?.some(s => s.userId === 'admin');
              return (
                <div 
                  key={`notif-${notif.id}-${idx}`} 
                  className={`relative p-6 rounded-3xl border transition-all ${isUnread ? 'bg-blue-600/5 border-blue-500/30 ring-1 ring-blue-500/20' : 'bg-gray-900/30 border-gray-800 hover:border-gray-700'}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-4">
                      <div className={`mt-1 p-3 rounded-2xl ${notif.type === 'important' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                        {notif.type === 'important' ? <AlertCircle size={20} /> : <Info size={20} />}
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <h3 className="font-black text-white">{notif.title}</h3>
                          {isUnread && <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shadow-glow shadow-blue-500" />}
                        </div>
                        <p className="text-sm text-gray-400 leading-relaxed">{notif.content}</p>
                        <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-gray-500">
                          <span className="flex items-center gap-1.5"><Clock size={12} /> {new Date(notif.createdAt).toLocaleTimeString()}</span>
                          <span className="flex items-center gap-1.5"><Calendar size={12} /> {new Date(notif.createdAt).toLocaleDateString()}</span>
                          <button 
                            onClick={() => exportNotificationSeenList(notif)}
                            className="flex items-center gap-1.5 text-blue-400/80 hover:text-blue-400 transition-colors"
                          >
                            <Download size={12} /> 
                            {notif.seenBy?.length || 0} хүн үзсэн
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isUnread && (
                        <button onClick={() => handleDeleteNotification(notif.id)} className="p-2 text-gray-600 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all">
                          <Trash2 size={20} />
                        </button>
                      )}
                      {isUnread && (
                        <button onClick={() => markNotificationAsRead(notif.id)} className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-xl transition-all">
                          <CheckCircle2 size={24} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-20 bg-gray-900/20 rounded-3xl border border-dashed border-gray-800">
              <Mail size={48} className="mx-auto text-gray-800 mb-4 opacity-20" />
              <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Мэдэгдэл байхгүй байна</p>
            </div>
          )}
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-900/40 border border-gray-800 p-8 rounded-3xl shadow-2xl backdrop-blur-md">
          <form onSubmit={handleSendNotification} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Мэдэгдэлийн төрөл</label>
                <div className="flex p-1 bg-gray-800 rounded-2xl border border-gray-700">
                  <button type="button" onClick={() => setNewNotification(prev => ({ ...prev, type: 'general' }))} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${newNotification.type === 'general' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-gray-500 hover:text-gray-300'}`}>Ерөнхий</button>
                  <button type="button" onClick={() => setNewNotification(prev => ({ ...prev, type: 'important' }))} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${newNotification.type === 'important' ? 'bg-red-600 text-white shadow-lg shadow-red-900/40' : 'text-gray-500 hover:text-gray-300'}`}>Чухал</button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Дуусах хугацаа</label>
                <input 
                  type="datetime-local" 
                  value={newNotification.deadline}
                  onChange={e => setNewNotification(prev => ({ ...prev, deadline: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-2xl py-3.5 px-5 text-white focus:outline-none focus:border-blue-500 transition-all font-bold" 
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Гарчиг</label>
              <input 
                type="text" 
                placeholder="Мэдэгдэлийн гарчиг..." 
                value={newNotification.title || ''}
                onChange={e => setNewNotification(prev => ({ ...prev, title: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-2xl py-4 px-6 text-white focus:outline-none focus:border-blue-500 transition-all text-lg font-black" 
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Агуулга</label>
              <textarea 
                placeholder="Мэдэгдэлийн дэлгэрэнгүй агуулга..." 
                value={newNotification.content || ''}
                onChange={e => setNewNotification(prev => ({ ...prev, content: e.target.value }))}
                className="w-full h-40 bg-gray-800 border border-gray-700 rounded-2xl py-4 px-6 text-white focus:outline-none focus:border-blue-500 transition-all resize-none leading-relaxed" 
                required
              />
            </div>

            <button type="submit" className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-blue-900/40 active:scale-[0.98] transition-all flex items-center justify-center gap-3">
              <Send size={24} strokeWidth={3} />
              Мэдэгдэл Илгээх
            </button>
          </form>
        </motion.div>
      )}
    </div>
  );

  const renderTrainingView = () => (
    <div className="space-y-8 max-w-6xl mx-auto py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tight">Сургалтын материалууд</h2>
          <p className="text-gray-400 mt-1">Ажилтнуудад зориулсан сургалтын материалууд.</p>
        </div>
        <button 
          onClick={() => {
            setEditingMaterial(null);
            setNewMaterial({ 
              type: 'PDF',
              deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16)
            });
            setIsAddingMaterial(true);
          }}
          className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-2xl font-black text-sm uppercase tracking-wider flex items-center gap-2 transition-all shadow-lg shadow-blue-500/20 active:scale-95"
        >
          <Plus size={20} />
          Материал нэмэх
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {trainingMaterials.map((material, idx) => {
          const alreadySeen = material.seenBy?.some(s => s.userId === 'admin');
          return (
            <div key={`training-${material.id}-${idx}`} className="bg-gray-900/40 border border-gray-800 p-6 rounded-3xl space-y-4 hover:border-blue-500/30 transition-all group relative">
              <div 
                onClick={() => setSelectedMaterial(material)}
                className="aspect-video bg-gray-800 rounded-2xl overflow-hidden relative cursor-pointer"
              >
                {material.thumbnailUrl ? (
                  <LazyMedia src={material.thumbnailUrl} alt={material.title} type="Image" className="w-full h-full" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-gray-600">
                    <BookOpen size={40} />
                    <span className="text-[10px] font-black uppercase mt-2">Зураггүй</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-xs font-black uppercase tracking-widest bg-blue-600 px-4 py-2 rounded-full">Нээх</span>
                </div>
              </div>

              <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <button 
                  onClick={(e) => { e.stopPropagation(); setEditingMaterial(material); setNewMaterial(material); setIsAddingMaterial(true); }}
                  className="p-2 bg-gray-800/80 backdrop-blur-md text-blue-400 rounded-xl hover:bg-blue-600 hover:text-white transition-all shadow-xl"
                >
                  <Edit size={16} />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleConfirm('Устгах уу?', () => handleDeleteMaterial(material.id || '')); }}
                  className="p-2 bg-gray-800/80 backdrop-blur-md text-red-400 rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-xl"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 bg-blue-600/10 text-blue-400 text-[10px] font-black uppercase border border-blue-500/20 rounded-md">{material.type}</span>
                  <span className="text-[10px] font-bold text-gray-500">{new Date(material.date).toLocaleDateString()}</span>
                </div>
                <h3 className="text-lg font-black text-white truncate">{material.title}</h3>
                <p className="text-sm text-gray-400 line-clamp-2 h-10">{material.description}</p>
                <div className="pt-4 border-t border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Eye size={14} className="text-blue-500" />
                    <span className="font-bold">{material.seenBy?.length || 0} үзсэн</span>
                  </div>
                  <div className={`text-[10px] font-black uppercase ${new Date(material.deadline || '') < new Date() ? 'text-red-500' : 'text-gray-500'}`}>
                    Хугацаа: {material.deadline ? new Date(material.deadline).toLocaleDateString() : 'Байхгүй'}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const SHIFT_HOURS_MAP: Record<string, number> = {
    '09:00 - 14:00': 5, '09--14': 5, '09:00 - 15:00': 6, '09--15': 6,
    '09:00 - 16:00': 7, '09--16': 7, '09:00 - 17:00': 8, '09--17': 8,
    '10:00 - 15:00': 5, '10--15': 5, '10:00 - 16:00': 6, '10--16': 6,
    '10:00 - 17:00': 7, '10--17': 7, '10:00 - 18:00': 8, '10--18': 8,
    '11:00 - 16:00': 5, '11--16': 5, '11:00 - 17:00': 6, '11--17': 6,
    '11:00 - 18:00': 7, '11--18': 7, '11:00 - 19:00': 8, '11--19': 8,
    '12:00 - 17:00': 5, '12--17': 5, '12:00 - 18:00': 6, '12--18': 6,
    '12:00 - 19:00': 7, '12--19': 7, '12:00 - 20:00': 8, '12--20': 8,
    '13:00 - 18:00': 5, '13--18': 5, '13:00 - 19:00': 6, '13--19': 6,
    '13:00 - 20:00': 7, '13--20': 7, '13:00 - 21:00': 8, '13--21': 8,
    '14:00 - 19:00': 5, '14--19': 5, '14:00 - 20:00': 6, '14--20': 6,
    '14:00 - 21:00': 7, '14--21': 7, '14:00 - 22:00': 8, '14--22': 8,
    '15:00 - 20:00': 5, '15--20': 5, '15:00 - 21:00': 6, '15--21': 6,
    '15:00 - 22:00': 7, '15--22': 7, '16:00 - 21:00': 5, '16--21': 5,
    '16:00 - 22:00': 6, '16--22': 6, '17:00 - 22:00': 5, '17--22': 5,
    '18:00 - 01:00': 7, '18--01': 7, '19:00 - 01:00': 6, '19--01': 6,
    '20:00 - 01:00': 5, '20--01': 5, 'Амралт': 0
  };

  const getHoursForShift = (time: string) => {
    if (SHIFT_HOURS_MAP[time]) return SHIFT_HOURS_MAP[time];
    
    // Dynamic calculation for formats like "09--17", "09:00 - 17:00", "09-17"
    const match = time.match(/(\d{1,2})[:.-]*(\d{0,2})\s*[-–—]+\s*(\d{1,2})[:.-]*(\d{0,2})/);
    if (match) {
      const startH = parseInt(match[1]);
      const startM = parseInt(match[2] || '0');
      const endH = parseInt(match[3]);
      const endM = parseInt(match[4] || '0');
      
      let startDecimal = startH + (startM / 60);
      let endDecimal = endH + (endM / 60);
      
      let diff = endDecimal - startDecimal;
      if (diff < 0) diff += 24; // Handle overnight shifts (e.g., 22--06)
      
      return Math.round(diff * 10) / 10;
    }
    
    return 0;
  };

  const getStartTimeValue = (time: string) => {
    if (!time || time === 'Амралт') return 9999;
    const match = time.match(/(\d{1,2})[:.-]*(\d{0,2})/);
    if (match) {
      const h = parseInt(match[1]);
      const m = parseInt(match[2] || '0');
      return h * 60 + m;
    }
    return 9999;
  };

  const renderScheduleView = () => {
    const years = [2024, 2025, 2026];
    const monthNames = [
      '1-р сар', '2-р сар', '3-р сар', '4-р сар', '5-р сар', '6-р сар',
      '7-р сар', '8-р сар', '9-р сар', '10-р сар', '11-р сар', '12-р сар'
    ];
    const dayNames = ['Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя', 'Ня'];
    
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
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const getCSRCount = (segment: string, type: 'Full Time' | 'Part Time') => {
      return csrs.filter(c => c.lineType === segment && c.employmentType === type).length;
    };

    const hasAnyCSR = (segment: string) => {
      return csrs.some(c => c.lineType === segment);
    };

    const monthDates = getDatesInMonth(selectedYearCalendar, selectedMonthCalendar);

    const handleCopyPreviousDay = (currentDateKey: string) => {
      const [y, m, d] = currentDateKey.split('-').map(Number);
      const current = new Date(y, m - 1, d);
      current.setDate(current.getDate() - 1);
      const prevKey = formatDateKey(current);
      
      if (schedules[prevKey]) {
        const newSchedules = { ...schedules };
        const currentShifts = newSchedules[currentDateKey]?.shifts || [];
        
        // Only copy shifts that match current filters from prev day
        const shiftsToCopy = schedules[prevKey].shifts
          .filter((s: any) => s.employmentType === activeEmploymentView && s.segment === activeSegmentView)
          .map((s: any) => ({
            ...s,
            id: Math.random().toString(36).substr(2, 9),
            bookedBy: [],
            bookedSlots: 0
          }));

        if (shiftsToCopy.length === 0) {
          alert('Өмнөх өдөр энэ төрлийн ээлж байхгүй байна.');
          return;
        }

        // Merge with existing shifts on current day (preventing duplicates of time WITHIN SAME VIEW)
        const existingTimes = new Set(currentShifts
          .filter((s: any) => s.employmentType === activeEmploymentView && s.segment === activeSegmentView)
          .map((s: any) => s.time)
        );
        const uniqueCopies = shiftsToCopy.filter((s: any) => !existingTimes.has(s.time));

        newSchedules[currentDateKey] = {
          ...newSchedules[currentDateKey],
          shifts: [...currentShifts, ...uniqueCopies]
        };
        
        setSchedules(newSchedules);
        setLocalData('schedules', newSchedules);
        logAction('Schedule Copied', `Copied ${uniqueCopies.length} ${activeEmploymentView} shifts for ${activeSegmentView} to ${currentDateKey}`);
      }
    };

    const handleExportScheduleReport = () => {
      const scheduleRows: any[] = [];
      const bookedUserIds = new Set<string>();

      monthDates.forEach(date => {
        if (!date) return;
        const dateKey = formatDateKey(date);
        const daySchedule = schedules[dateKey];
        if (daySchedule && daySchedule.shifts.length > 0) {
          daySchedule.shifts.forEach((shift: any) => {
            if (shift.bookedBy && shift.bookedBy.length > 0) {
              shift.bookedBy.forEach((booking: any) => {
                bookedUserIds.add(booking.userId);
                scheduleRows.push({
                  'Огноо': dateKey,
                  'Гараг': date.toLocaleDateString('mn-MN', { weekday: 'long' }),
                  'Ээлжийн цаг': shift.time,
                  'Сегмент': shift.segment,
                  'Төрөл': shift.employmentType || 'Full Time',
                  'Ажилтан код': booking.userCode || '---',
                  'Ажилтан нэр': booking.userName,
                  'Захиалсан огноо': new Date(booking.bookedAt).toLocaleString()
                });
              });
            }
          });
        }
      });

      const unbookedCSRs = csrs.filter(csr => csr.role === 'csr' && !bookedUserIds.has(csr.id)).map(csr => ({
        'Код': csr.code,
        'Нэр': csr.name,
        'Имэйл': csr.email,
        'Сегмент': csr.lineType,
        'Төлөв': 'Захиалаагүй'
      }));

      const wb = XLSX.utils.book_new();
      
      const wsSchedule = XLSX.utils.json_to_sheet(scheduleRows);
      XLSX.utils.book_append_sheet(wb, wsSchedule, "Хуваарь");

      const wsUnbooked = XLSX.utils.json_to_sheet(unbookedCSRs);
      XLSX.utils.book_append_sheet(wb, wsUnbooked, "Захиалаагүй ажилтнууд");

      XLSX.writeFile(wb, `Schedule_Report_${monthNames[selectedMonthCalendar]}_${selectedYearCalendar}.xlsx`);
      logAction('Export Schedule Report', `Exported full report for ${monthNames[selectedMonthCalendar]}`);
    };

    return (
      <div className="flex flex-col h-full space-y-6">
        {/* Top Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-gray-900/40 p-6 rounded-[2rem] border border-gray-800 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <h2 className="text-3xl font-black text-white tracking-tight">Хуваарь</h2>
            <div className="flex bg-black/40 rounded-2xl p-1 border border-white/5">
              <button 
                onClick={() => setSelectedMonthCalendar(prev => prev === 0 ? 11 : prev - 1)}
                className="p-2 text-gray-500 hover:text-white transition-colors"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="px-4 flex items-center font-black text-blue-500 text-sm uppercase tracking-widest min-w-[120px] justify-center">
                {monthNames[selectedMonthCalendar]} {selectedYearCalendar}
              </div>
              <button 
                onClick={() => setSelectedMonthCalendar(prev => prev === 11 ? 0 : prev + 1)}
                className="p-2 text-gray-500 hover:text-white transition-colors"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={handleExportScheduleReport}
              className="px-6 py-3 bg-green-600/10 hover:bg-green-600 text-green-500 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border border-green-500/20 flex items-center gap-2"
            >
              <Download size={14} /> Татах (Excel)
            </button>
            <button 
              onClick={() => setIsManagingShiftTemplates(true)}
              className="px-6 py-3 bg-gray-800/60 hover:bg-gray-800 text-gray-300 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border border-white/5"
            >
              Shift Загвар
            </button>
            <button 
              onClick={() => setIsAddingHoliday(true)}
              className="px-6 py-3 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border border-red-500/20"
            >
              Баяр ёслол
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 bg-gray-900/40 p-6 rounded-[2.5rem] border border-gray-800 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col gap-2 min-w-[260px]">
            <label className="text-[11px] font-black text-blue-500/60 uppercase tracking-[0.2em] ml-2 flex items-center gap-2">
              <Shield size={10} /> Сегмент сонгох
            </label>
            <div className="relative group">
              <select
                value={activeSegmentView}
                onChange={(e) => setActiveSegmentView(e.target.value)}
                className="w-full bg-black/60 border border-white/10 rounded-2xl py-4 pl-6 pr-12 text-[11px] font-black uppercase tracking-widest text-white focus:outline-none focus:border-blue-500/50 cursor-pointer appearance-none shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] transition-all hover:bg-black/80"
              >
                {segments.map((seg) => {
                  const count = csrs.filter(c => c.lineType === seg).length;
                  return (
                    <option key={seg} value={seg} className="bg-gray-900 text-white font-bold py-4">
                      {seg} ({count} ажилтан)
                    </option>
                  );
                })}
              </select>
              <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-blue-500/50 group-hover:text-blue-400 transition-colors">
                <ChevronDown size={14} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 min-w-[220px]">
            <label className="text-[11px] font-black text-blue-500/60 uppercase tracking-[0.2em] ml-2 flex items-center gap-2">
              <Clock size={10} /> Төрөл сонгох
            </label>
            <div className="relative group">
              <select
                value={activeEmploymentView}
                onChange={(e) => setActiveEmploymentView(e.target.value as any)}
                className="w-full bg-black/60 border border-white/10 rounded-2xl py-4 pl-6 pr-12 text-[11px] font-black uppercase tracking-widest text-white focus:outline-none focus:border-blue-500/50 cursor-pointer appearance-none shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] transition-all hover:bg-black/80"
              >
                {['Full Time', 'Part Time'].map((type) => {
                  const count = getCSRCount(activeSegmentView, type as any);
                  return (
                    <option key={type} value={type} className="bg-gray-900 text-white font-bold">
                      {type} ({count})
                    </option>
                  );
                })}
              </select>
              <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-blue-500/50 group-hover:text-blue-400 transition-colors">
                <ChevronDown size={14} />
              </div>
            </div>
          </div>
          
          <div className="ml-auto flex items-center gap-6">
             {getCSRCount(activeSegmentView, activeEmploymentView) === 0 && (
               <div className="flex items-center gap-3 px-5 py-3 bg-red-500/5 border border-red-500/20 rounded-2xl backdrop-blur-md">
                 <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shadow-[0_0_10px_#ef4444]" />
                 <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">Ажилтан бүртгэгдээгүй</span>
               </div>
             )}
             <div className="flex flex-col items-end gap-1 px-6 py-3 bg-blue-600/5 rounded-2xl border border-blue-500/10 shadow-inner">
               <span className="text-[9px] font-outfit font-black text-blue-500/40 uppercase tracking-[0.2em]">Одоогийн харагдац</span>
               <span className="text-[11px] font-outfit font-black text-white uppercase tracking-widest flex items-center gap-2">
                 {activeSegmentView} <span className="w-1 h-1 bg-gray-700 rounded-full" /> <span className="text-blue-400">{activeEmploymentView}</span>
               </span>
             </div>
          </div>
        </div>

        <div className="flex gap-8 items-start">
          {/* Calendar Grid */}
          <div className="w-full max-w-[480px] bg-black/40 rounded-[2rem] border border-white/5 p-5">
            <div className="grid grid-cols-7 gap-1">
              {dayNames.map((day, idx) => (
                <div key={day} className={`text-center text-[9px] font-outfit font-black uppercase tracking-[0.2em] mb-4 ${idx >= 5 ? 'text-red-500' : 'text-gray-500'}`}>
                  {day}
                </div>
              ))}
              {monthDates.map((date, idx) => {
                if (!date) return <div key={`empty-${idx}`} className="aspect-square" />;
                
                const dateKey = formatDateKey(date);
                const holiday = holidays.find(h => h.date === dateKey);
                const isWeekend = idx % 7 >= 5;
                const hasShifts = schedules[dateKey] && (schedules[dateKey].shifts || []).some((s: any) => 
                  s.employmentType === activeEmploymentView && s.segment === activeSegmentView
                );
                const isSelected = selectedDateSchedule === dateKey;
                const today = new Date();
                today.setHours(0,0,0,0);
                const isToday = formatDateKey(new Date()) === dateKey;
                const isPast = date.getTime() < today.getTime();
                
                return (
                  <button
                    key={dateKey}
                    onClick={() => setSelectedDateSchedule(dateKey)}
                    className={`group aspect-square relative rounded-2xl border-2 transition-all duration-300 flex flex-col items-center justify-center ${
                      isSelected 
                        ? 'bg-blue-600 border-blue-400 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)] z-10 scale-105' 
                        : holiday
                          ? 'bg-red-500 border-red-400 text-white shadow-[0_5px_15px_rgba(239,68,68,0.2)] z-10'
                          : isPast
                            ? 'bg-white/[0.03] border-white/5 text-gray-700 opacity-40 grayscale-[0.5] scale-95'
                            : hasShifts 
                              ? 'bg-blue-600/60 border-blue-500/50 text-white hover:bg-blue-600/80 shadow-lg shadow-blue-500/10' 
                              : isWeekend
                                ? 'bg-red-950/20 border-red-500/10 text-gray-500 hover:bg-red-500/5'
                                : 'bg-[#111] border-white/5 text-gray-400 hover:bg-white/5'
                    }`}
                  >
                    <span className={`text-xl font-outfit font-black tracking-tighter transition-transform group-hover:scale-110 ${
                      isSelected 
                        ? 'text-white' 
                        : holiday 
                          ? 'text-white' 
                          : isToday 
                            ? 'text-blue-500' 
                            : isWeekend 
                              ? 'text-red-500/70' 
                              : isPast 
                                ? 'text-gray-700' 
                                : 'text-white'
                    }`}>
                      {date.getDate()}
                    </span>
                    {holiday && !isSelected && (
                      <div className="absolute bottom-1 inset-x-0 flex flex-col items-center justify-center pointer-events-none px-1">
                        <span className="text-[7px] font-black text-white bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded-full uppercase tracking-tight truncate max-w-[90%] shadow-lg border border-white/10">
                          {holiday.name}
                        </span>
                      </div>
                    )}
                    {isToday && !isSelected && (
                      <div className="absolute top-1 right-1 w-1 h-1 bg-blue-400 rounded-full shadow-[0_0_8px_#3b82f6] animate-pulse" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Side Detail Panel */}
          <AnimatePresence mode="wait">
            {selectedDateSchedule && (
              <motion.div
                key={`${selectedDateSchedule}-${activeSegmentView}-${activeEmploymentView}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="w-full max-w-[400px] bg-gray-900 border border-gray-800 rounded-[2.5rem] p-8 shadow-2xl flex flex-col h-[calc(100vh-300px)] sticky top-32"
              >
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-2xl font-black text-white">{selectedDateSchedule}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-gray-500 text-[10px] font-black uppercase tracking-widest">
                        {(() => {
                          const [y, m, d] = selectedDateSchedule.split('-').map(Number);
                          return new Date(y, m - 1, d).toLocaleDateString('mn-MN', { weekday: 'long' });
                        })()}
                      </p>
                      {(() => {
                        const holiday = holidays.find(h => h.date === selectedDateSchedule);
                        return holiday ? (
                          <span className="px-2 py-0.5 bg-red-500 text-white text-[8px] font-black rounded-full uppercase tracking-tighter">
                            {holiday.name}
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </div>
                  <button onClick={() => setSelectedDateSchedule(null)} className="p-2 text-gray-500 hover:text-white"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4">
                  {(() => {
                    const filteredShifts = (schedules[selectedDateSchedule]?.shifts || []).filter((s: any) => 
                      s.employmentType === activeEmploymentView && s.segment === activeSegmentView
                    );
                    
                    return filteredShifts.length > 0 ? (
                      [...filteredShifts]
                        .sort((a: any, b: any) => getStartTimeValue(a.time) - getStartTimeValue(b.time))
                        .map((shift: any, idx: number) => (
                          <div key={shift.id || idx} className="bg-white/5 border border-white/5 rounded-3xl p-6 group hover:border-blue-500/20 transition-all">
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-blue-500/10 rounded-xl text-blue-400">
                                <Clock size={16} />
                              </div>
                              <span className="font-black text-white">{shift.time}</span>
                            </div>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => {
                                  setEditingShiftData({ ...shift, dateKey: selectedDateSchedule });
                                  setIsEditingShiftModal(true);
                                }}
                                className="p-2 text-gray-500 hover:text-blue-500 transition-colors"
                              >
                                <Edit size={14} />
                              </button>
                              <button 
                                onClick={() => handleConfirm('Ээлжийг устгах уу?', () => {
                                  const newSchedules = { ...schedules };
                                  if (newSchedules[selectedDateSchedule]) {
                                    const originalIdx = newSchedules[selectedDateSchedule].shifts.findIndex((s: any) => s.id === shift.id);
                                    if (originalIdx !== -1) {
                                      const updatedShifts = [...newSchedules[selectedDateSchedule].shifts];
                                      updatedShifts.splice(originalIdx, 1);
                                      if (updatedShifts.length === 0) {
                                        delete newSchedules[selectedDateSchedule];
                                      } else {
                                        newSchedules[selectedDateSchedule] = { ...newSchedules[selectedDateSchedule], shifts: updatedShifts };
                                      }
                                      setLocalData('schedules', newSchedules);
                                      setSchedules(newSchedules);
                                    }
                                  }
                                })}
                                className="p-2 text-gray-500 hover:text-red-500 transition-colors"
                              >
                                <Trash size={14} />
                              </button>
                            </div>
                          </div>

                          <div className="mt-4 border-t border-white/5 pt-4">
                            {/* Refined Quota Graphic - Clean & Minimal */}
                            <div className="w-full relative h-10 px-1 mt-2">
                              {/* Background Line */}
                              <div className="absolute top-1/2 left-0 right-8 h-1.5 -translate-y-1/2 bg-white/5 rounded-full" />
                              
                              {/* Progress Line */}
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, (shift.bookedSlots / shift.totalSlots) * 100)}%` }}
                                className={`absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full z-10 ${
                                  shift.bookedSlots >= shift.totalSlots ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]' : 'bg-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.4)]'
                                }`}
                                style={{ maxWidth: 'calc(100% - 2rem)' }}
                              />

                              {/* Moving Performance Indicator */}
                              <motion.div
                                initial={{ left: 0 }}
                                animate={{ left: `${Math.min(100, (shift.bookedSlots / shift.totalSlots) * 100)}%` }}
                                transition={{ type: "spring", stiffness: 100, damping: 20 }}
                                className="absolute top-0 -translate-x-1/2 flex flex-col items-center z-20"
                                style={{ maxWidth: 'calc(100% - 2rem)' }}
                              >
                                <div className={`text-[10px] font-black text-white min-w-[24px] h-[24px] flex items-center justify-center rounded-full shadow-2xl ${
                                  shift.bookedSlots >= shift.totalSlots ? 'bg-green-600' : 'bg-blue-600'
                                } border-2 border-gray-900`}>
                                  {shift.bookedSlots}
                                </div>
                                <div className={`w-0.5 h-1.5 ${shift.bookedSlots >= shift.totalSlots ? 'bg-green-600' : 'bg-blue-600'}`} />
                              </motion.div>

                              {/* Total Target at the end */}
                              <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center">
                                <span className="text-[12px] font-black text-gray-500">{shift.totalSlots}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="h-44 flex flex-col items-center justify-center text-center opacity-50 border-2 border-dashed border-gray-800 rounded-3xl p-8">
                        <p className="text-xs font-bold text-gray-500">Хуваарь байхгүй</p>
                        <p className="text-[10px] uppercase mt-1 text-blue-500/50">{activeSegmentView} | {activeEmploymentView}</p>
                      </div>
                    );
                  })()}
                </div>

                <div className="mt-8 pt-8 border-t border-gray-800 space-y-4">
                  <button 
                    onClick={() => {
                      setEditingShiftData({ 
                        dateKey: selectedDateSchedule, 
                        time: '09--18', 
                        segment: activeSegmentView, 
                        employmentType: activeEmploymentView,
                        totalSlots: 5 
                      });
                      setIsEditingShiftModal(true);
                    }}
                    className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-blue-500 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                  >
                    <Plus size={16} /> Ээлж нэмэх
                  </button>
                  
                  <button 
                    onClick={() => {
                      handleConfirm(`${selectedDateSchedule} өдрийн бүх ээлжийг устгах уу?`, () => {
                        const newSchedules = { ...schedules };
                        delete newSchedules[selectedDateSchedule];
                        
                        setSchedules(newSchedules);
                        setLocalData('schedules', newSchedules);
                        logAction('Schedule Deleted', `Deleted all shifts for ${selectedDateSchedule}`);
                      });
                    }}
                    className="w-full py-4 bg-gray-800/60 hover:bg-red-500/10 text-gray-400 hover:text-red-500 rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all border border-white/5 flex items-center justify-center gap-2"
                  >
                    <Trash2 size={14} /> Бүх ээлжийг устгах
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  };

  const renderHourlyLeaveView = () => {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tight">Чөлөө</h2>
          <p className="text-gray-400 mt-1">Ажилтнуудын ирүүлсэн чөлөө хүсэлтүүд.</p>
        </div>

        <div className="bg-gray-900/40 border border-gray-800 rounded-3xl overflow-hidden backdrop-blur-md shadow-2xl">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/30">
                 <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest w-40">Код</th>
                 <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">Ажилтан</th>
                 <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">Огноо / Цаг</th>
                 <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest">Шалтгаан</th>
                 <th className="px-8 py-5 text-[10px] font-black text-gray-500 uppercase tracking-widest text-right">Үйлдэл</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {hourlyLeaveRequests.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(req => {
                const requester = csrs.find(c => c.id === req.csrId);
                return (
                  <tr key={req.id} className="hover:bg-gray-800/10 transition-colors group">
                    <td className="px-8 py-6">
                       <span className="text-sm font-black text-blue-500">{requester?.code || '---'}</span>
                    </td>
                    <td className="px-8 py-6">
                       <div className="font-bold text-white uppercase tracking-wide">{req.csrName}</div>
                    </td>
                    <td className="px-8 py-6">
                        <div className="text-sm text-gray-300 font-bold mb-0.5">
                          {req.type === 'daily' ? (req.endDate && req.endDate !== req.date ? `${req.date} - ${req.endDate}` : req.date) : req.date}
                        </div>
                        <div className="text-[10px] text-gray-500 font-black flex items-center gap-1.5 uppercase tracking-widest">
                          {req.type === 'daily' ? (
                            <>
                              <Calendar size={12} /> Өдрийн чөлөө
                            </>
                          ) : (
                            <>
                              <Clock size={12} /> {req.startTime} - {req.endTime}
                            </>
                          )}
                        </div>
                     </td>
                    <td className="px-8 py-6 max-w-xs">
                       <p className="text-xs text-gray-400 font-medium leading-relaxed italic line-clamp-2">"{req.reason}"</p>
                    </td>
                    <td className="px-8 py-6 text-right">
                       {req.status === 'pending' ? (
                         <div className="flex items-center justify-end gap-2">
                            <button 
                              onClick={() => handleConfirm(`'${req.csrName}'-ийн хүсэлтийг зөвшөөрөх үү?`, () => handleApproveHourlyLeave(req.id))}
                              className="p-2.5 text-green-500 hover:bg-green-500/10 rounded-xl transition-all"
                            ><CheckCircle2 size={20} /></button>
                            <button 
                              onClick={() => {
                                const comment = prompt('Татгалзсан шалтгаан орно уу:');
                                if (comment !== null) handleRejectHourlyLeave(req.id, comment);
                              }}
                              className="p-2.5 text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                            ><XCircle size={20} /></button>
                         </div>
                       ) : (
                         <span className={`text-[10px] font-black uppercase tracking-widest ${req.status === 'approved' ? 'text-green-500' : 'text-red-500'}`}>
                           {req.status === 'approved' ? 'Зөвшөөрсөн' : 'Татгалзсан'}
                         </span>
                       )}
                    </td>
                  </tr>
                );
              })}
              {hourlyLeaveRequests.length === 0 && (
                <tr>
                   <td colSpan={5} className="py-20 text-center text-gray-500 font-bold uppercase tracking-widest text-xs opacity-50">
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

  const renderForecastView = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-black text-white tracking-tight">Дуудлагын Forecast</h2>
        <p className="text-gray-400 mt-1">Ирэх өдрүүдийн дуудлагын ачаалалыг урьдчилан таамаглах.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-gray-900/40 border border-gray-800 p-8 rounded-3xl h-[400px] flex items-center justify-center">
          <BarChart3 size={64} className="text-gray-800 opacity-20" />
          <span className="text-gray-500 font-bold ml-4">Chart loading...</span>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 p-8 rounded-3xl h-[400px] flex items-center justify-center">
          <BarChart3 size={64} className="text-gray-800 opacity-20" />
          <span className="text-gray-500 font-bold ml-4">Chart loading...</span>
        </div>
      </div>
    </div>
  );

  const SidebarItem = ({ id, icon: Icon, label, badge }: { id: string, icon: any, label: string, badge?: number }) => (
    <button 
      onClick={() => setActiveTab(id)}
      className={`w-full flex items-center gap-3 px-4 py-4 rounded-2xl transition-all relative group ${activeTab === id ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20 shadow-xl shadow-blue-500/5' : 'text-gray-500 hover:text-gray-200 hover:bg-white/5 border border-transparent'}`}
    >
      <div className={`p-2 rounded-xl transition-colors ${activeTab === id ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/40' : 'bg-gray-800/50 group-hover:bg-gray-800'}`}>
        <Icon size={18} strokeWidth={activeTab === id ? 3 : 2} />
      </div>
      {!isSidebarCollapsed && <span className="text-sm font-black uppercase tracking-widest whitespace-nowrap">{label}</span>}
      {activeTab === id && (
         <motion.div layoutId="sidebar-active" className="absolute -left-1 w-1.5 h-8 bg-blue-500 rounded-r-full shadow-[0_0_15px_#3b82f6]" />
      )}
    </button>
  );

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-gray-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className={`bg-gray-900/40 backdrop-blur-xl border-r border-gray-800 transition-all duration-500 flex flex-col ${isSidebarCollapsed ? 'w-24' : 'w-80'} relative z-50`}>
        <button 
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="absolute -right-3 top-10 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg z-30 hover:scale-110 transition-transform border border-white/20"
        >
          {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
        <div className={`p-6 border-b border-gray-800 flex items-center gap-4 bg-black/20 ${isSidebarCollapsed ? 'justify-center' : ''}`}>
          <div className="relative group cursor-pointer" onClick={handlePhotoClick}>
            <div className={`relative overflow-hidden rounded-2xl border-2 border-blue-500/50 shadow-lg transition-transform group-hover:scale-105 bg-gray-800 ${isSidebarCollapsed ? 'w-10 h-10' : 'w-14 h-14'}`}>
              <img 
                src={profile?.photoUrl || 'https://ui-avatars.com/api/?name=Admin&background=2563eb&color=fff&size=128'} 
                alt="Profile" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={isSidebarCollapsed ? 12 : 16} className="text-white" />
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
              <h2 className="text-white font-black text-lg tracking-tight truncate uppercase italic">{profile?.name || 'Supervisor'}</h2>
              <p className="text-blue-500 text-[10px] font-black uppercase tracking-[0.1em] truncate mb-0.5">Supervisor</p>
              <p className="text-gray-500 text-[9px] font-bold truncate opacity-60">{profile?.email}</p>
            </div>
          )}
        </div>

      <nav className="flex-1 px-6 space-y-3 overflow-y-auto custom-scrollbar pt-8">
          <SidebarItem id="users" icon={Users} label="Ажилтны удирдлага" />
          <SidebarItem id="schedule" icon={Calendar} label="Хуваарь удирдлага" />
          <SidebarItem id="vacation" icon={Palmtree} label="Ээлжийн амралт" />
          <SidebarItem id="forecast" icon={BarChart3} label="Forecast" />
          <SidebarItem id="training" icon={BookOpen} label="Сургалт" />
        </nav>

        <div className="p-4 mt-auto space-y-2">
          <button 
            onClick={() => setIsChangingPassword(true)}
            className="w-full flex items-center gap-3 px-4 py-4 text-gray-400 hover:bg-gray-800 rounded-2xl transition-all"
          >
            <Settings size={20} />
            {!isSidebarCollapsed && <span className="text-sm font-bold">Нууц үг солих</span>}
          </button>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-4 text-red-500 hover:bg-red-500/10 rounded-2xl transition-all"
          >
            <LogOut size={20} />
            {!isSidebarCollapsed && <span className="text-sm font-bold">Системээс гарах</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <header className="h-24 border-b border-gray-800/50 flex items-center justify-between px-10 bg-gray-900/20 backdrop-blur-2xl z-10 shrink-0">
          <div>
            <h1 className="text-3xl font-black text-white tracking-tighter capitalize mb-1">
              {activeTab === 'users' ? 'Ажилтны удирдлага' : 
               activeTab === 'schedule' ? 'Хуваарь удирдлага' : 
               activeTab === 'vacation' ? 'Ээлжийн амралт' : 
               activeTab === 'forecast' ? 'Дуудлагын Forecast' :
               activeTab === 'training' ? 'Сургалт' :
               'Мэдэгдэл'}
            </h1>
          </div>
          
          <div className="flex items-center gap-8 relative">
            {activeTab === 'users' && (
              <div className="relative" ref={filterRef}>
                <button 
                  onClick={() => setIsFilterOpen(!isFilterOpen)}
                  className={`flex items-center gap-2.5 px-6 py-3 border rounded-[1.2rem] text-sm font-black transition-all shadow-xl ${isFilterOpen ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#111418] border-white/10 text-white hover:bg-gray-800'}`}
                >
                   <Filter size={18} className={isFilterOpen ? 'text-white' : 'text-[#00a3ff]'} />
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
                        <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-6">Хайлт & Шүүлтүүр</h3>
                        
                        <div className="space-y-5">
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">Сегмент</label>
                            <select 
                              value={filters.segment}
                              onChange={(e) => setFilters(prev => ({ ...prev, segment: e.target.value }))}
                              className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none cursor-pointer"
                            >
                              <option value="All">Бүх сегмент</option>
                              {segments.map(s => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">Имэйл хаягаар хайх</label>
                            <div className="relative">
                              <Mail size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600" />
                              <input 
                                type="text"
                                value={filters.email}
                                onChange={(e) => setFilters(prev => ({ ...prev, email: e.target.value }))}
                                placeholder="example@mobicom.mn"
                                className="w-full bg-black/40 border border-white/5 rounded-xl pl-12 pr-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 placeholder:text-gray-700"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">Ажилтны кодоор хайх</label>
                            <div className="relative">
                              <Users size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600" />
                              <input 
                                type="text"
                                value={filters.code}
                                onChange={(e) => setFilters(prev => ({ ...prev, code: e.target.value }))}
                                placeholder="EMP1234"
                                className="w-full bg-black/40 border border-white/5 rounded-xl pl-12 pr-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 placeholder:text-gray-700 font-mono"
                              />
                            </div>
                          </div>

                          <div className="pt-2">
                            <button 
                              onClick={() => {
                                setFilters({ segment: 'All', email: '', code: '' });
                                setSearchQuery('');
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
            <DigitalClock months={ENG_MONTHS} weekdays={['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']} />
          </div>
        </header>

        <div className="flex-1 p-8 overflow-y-auto custom-scrollbar relative">
          <AnimatePresence mode="wait">
            <motion.div 
              key={activeTab}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'users' && renderUsersView()}
              {activeTab === 'vacation' && renderVacationView()}
              {activeTab === 'hourlyLeave' && renderHourlyLeaveView()}
              {activeTab === 'schedule' && renderScheduleView()}
              {activeTab === 'notifications' && renderNotificationsView()}
              {activeTab === 'forecast' && renderForecastView()}
              {activeTab === 'training' && renderTrainingView()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Modals */}
        <AnimatePresence>
          {isChangingPassword && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsChangingPassword(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
                <button onClick={() => setIsChangingPassword(false)} className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors">
                  <X size={24} />
                </button>
                <h2 className="text-2xl font-black text-white mb-6">Нууц үг солих</h2>
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] ml-1 mb-2 block">Хуучин нууц үг</label>
                    <input type="password" value={passwordForm.old} onChange={(e) => setPasswordForm({...passwordForm, old: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-2xl py-3.5 px-5 text-white focus:outline-none focus:border-blue-500 font-bold" required />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] ml-1 mb-2 block">Шинэ нууц үг</label>
                    <input type="password" value={passwordForm.new} onChange={(e) => setPasswordForm({...passwordForm, new: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-2xl py-3.5 px-5 text-white focus:outline-none focus:border-blue-500 font-bold" required />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] ml-1 mb-2 block">Шинэ нууц үг давтах</label>
                    <input type="password" value={passwordForm.confirm} onChange={(e) => setPasswordForm({...passwordForm, confirm: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-2xl py-3.5 px-5 text-white focus:outline-none focus:border-blue-500 font-bold" required />
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button type="button" onClick={() => setIsChangingPassword(false)} className="flex-1 py-4 bg-gray-800 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-700 transition-all">Цуцлах</button>
                    <button type="submit" className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20">Хадгалах</button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {confirmAction && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setConfirmAction(null)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative bg-gray-900 border border-gray-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl">
                <div className="w-16 h-16 bg-red-600/10 rounded-2xl flex items-center justify-center text-red-500 mb-6 mx-auto">
                  <AlertCircle size={32} />
                </div>
                <h3 className="text-xl font-black text-center text-white mb-2">Баталгаажуулах</h3>
                <p className="text-gray-400 text-center text-sm mb-8 leading-relaxed">{confirmAction.title}</p>
                <div className="flex gap-4">
                  <button onClick={() => setConfirmAction(null)} className="flex-1 py-4 bg-gray-800 text-white rounded-2xl font-bold hover:bg-gray-700 transition-all">Цуцлах</button>
                  <button onClick={() => { confirmAction.onConfirm(); setConfirmAction(null); }} className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20">Тийм</button>
                </div>
              </motion.div>
            </div>
          )}

          {secureConfirmAction && (
            <div className="fixed inset-0 z-[155] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSecureConfirmAction(null)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, rotateX: 20, scale: 0.95 }} animate={{ opacity: 1, rotateX: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                  <Lock size={120} className="text-red-500" />
                </div>
                
                <div className="relative">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-14 h-14 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 border border-red-500/20 shadow-inner">
                      <ShieldAlert size={28} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-black text-white tracking-tight leading-none mb-1">{secureConfirmAction.title}</h3>
                      <p className="text-[10px] font-black text-red-500 uppercase tracking-[0.2em]">Sensitive Operation</p>
                    </div>
                  </div>

                  <p className="text-gray-400 text-sm mb-8 leading-relaxed font-medium">{secureConfirmAction.description}</p>
                  
                  {secureConfirmAction.error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-bold animate-shake">
                      {secureConfirmAction.error}
                    </div>
                  )}

                  <div className="space-y-4 mb-8">
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Админ Нэр</label>
                      <input 
                        type="text" 
                        value={secureConfirmAction.username || ''} 
                        onChange={e => setSecureConfirmAction(prev => ({ ...prev!, username: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-2xl py-4 px-5 text-white focus:outline-none focus:border-red-500/50 transition-all shadow-inner placeholder:text-gray-600" 
                        placeholder="admin"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Нууц үг</label>
                      <input 
                        type="password" 
                        autoFocus
                        value={secureConfirmAction.password || ''} 
                        onChange={e => setSecureConfirmAction(prev => ({ ...prev!, password: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const isValid = (secureConfirmAction.username?.toLowerCase() === 'admin' || secureConfirmAction.username?.toLowerCase() === 'admin@mobicom.mn') && secureConfirmAction.password && secureConfirmAction.password.length > 0;
                            if (isValid) {
                              secureConfirmAction.onConfirm();
                              setSecureConfirmAction(null);
                            } else {
                              setSecureConfirmAction(prev => ({ ...prev!, error: 'Нэвтрэх нэр эсвэл нууц үг буруу байна.' }));
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
                        const isValid = (secureConfirmAction.username?.toLowerCase() === 'admin' || secureConfirmAction.username?.toLowerCase() === 'admin@mobicom.mn') && secureConfirmAction.password && secureConfirmAction.password.length > 0;
                        if (isValid) {
                          secureConfirmAction.onConfirm(); 
                          setSecureConfirmAction(null); 
                        } else {
                          setSecureConfirmAction(prev => ({ ...prev!, error: 'Нэвтрэх нэр эсвэл нууц үг буруу байна.' }));
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
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAddingHoliday(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-3xl bg-gray-900 border border-gray-800 rounded-3xl p-10 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-3xl font-black text-white">Баяр ёслол удирдах</h3>
                  <button onClick={() => setIsAddingHoliday(false)} className="p-2 text-gray-500 hover:text-white transition-colors"><X size={24} /></button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10 flex-1 overflow-hidden">
                  {/* Form */}
                  <div className="space-y-6 flex flex-col">
                    <h4 className="text-[10px] font-black text-blue-500 uppercase tracking-widest border-l-2 border-blue-500 pl-3">Шинээр нэвтрүүлэх</h4>
                    <div className="space-y-4 bg-white/5 p-8 rounded-3xl border border-white/5 flex-1">
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Огноо</label>
                        <input 
                          type="date" 
                          value={holidayData.date}
                          onChange={(e) => setHolidayData(prev => ({ ...prev, date: e.target.value }))}
                          className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 px-5 text-white focus:outline-none focus:border-blue-500 font-bold transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Нэршил</label>
                        <input 
                          type="text" 
                          placeholder="Жишээ: Цагаан сар"
                          value={holidayData.name}
                          onChange={(e) => setHolidayData(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 px-5 text-white focus:outline-none focus:border-blue-500 placeholder:text-gray-700 transition-all font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Хасагдах цаг</label>
                        <input 
                          type="number" 
                          value={holidayData.hours}
                          onChange={(e) => setHolidayData(prev => ({ ...prev, hours: Number(e.target.value) }))}
                          className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 px-5 text-white focus:outline-none focus:border-blue-500 font-bold transition-all"
                        />
                      </div>
                      <div className="pt-4 flex gap-3">
                        {holidayData.id && (
                          <button 
                            onClick={() => setHolidayData({ id: '', date: '', name: '', hours: 8 })} 
                            className="flex-1 py-4 bg-gray-800 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-gray-700 transition-all"
                          >
                            Болих
                          </button>
                        )}
                        <button 
                          onClick={handleAddHoliday} 
                          className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/20"
                        >
                          {holidayData.id ? 'Шинэчлэх' : 'Хадгалах'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* List */}
                  <div className="flex flex-col h-full overflow-hidden">
                    <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest border-l-2 border-red-500 pl-3 mb-6">Бүртгэлтэй жагсаалт</h4>
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-3 space-y-3">
                      {holidays.length > 0 ? (
                        holidays.map((h, i) => (
                          <div key={i} className="bg-white/5 border border-white/5 rounded-3xl p-5 flex items-center justify-between group hover:border-red-500/20 transition-all">
                            <div>
                              <p className="text-white font-black text-sm">{h.name}</p>
                              <p className="text-[9px] text-gray-500 font-black tracking-widest uppercase mt-1">{h.date} • {h.hours} цаг хасагдана</p>
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
                                  handleConfirm(`'${h.name}'-г бүртгэлээс устгах уу?`, () => {
                                    const updated = holidays.filter(item => item.id !== h.id);
                                    setLocalData('holidays', updated);
                                    setHolidays(updated);
                                    if (holidayData.id === h.id) {
                                      setHolidayData({ id: '', date: '', name: '', hours: 8 });
                                    }
                                  });
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
                          <p className="text-xs font-bold text-gray-500">Одоогоор баяр ёслол<br/>бүртгэгдээгүй байна</p>
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
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedMaterial(null)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-5xl bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-gray-800 flex items-center justify-between bg-gray-900/50 backdrop-blur-xl shrink-0">
                  <div className="flex-1">
                    <h2 className="text-xl font-black text-white">{selectedMaterial.title}</h2>
                    <p className="text-xs text-gray-500 mt-1">{selectedMaterial.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {(() => {
                      const isDeadlinePassed = selectedMaterial.deadline && new Date(selectedMaterial.deadline) < new Date();
                      const alreadySeen = selectedMaterial.seenBy?.some(s => s.userId === 'admin');
                      
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
                    <LazyMedia src={selectedMaterial.url} alt={selectedMaterial.title} type="Image" className="max-w-full max-h-full rounded-xl" objectFit="contain" />
                  ) : selectedMaterial.type === 'Video' ? (
                    <LazyMedia src={selectedMaterial.url} type="Video" className="max-w-full max-h-full rounded-xl" objectFit="contain" />
                  ) : selectedMaterial.type === 'PDF' ? (
                    <iframe src={selectedMaterial.url} className="w-full h-full min-h-[60vh] rounded-xl border-none" title={selectedMaterial.title} />
                  ) : (
                    <div className="text-center space-y-6 p-12">
                      <div className="w-20 h-20 bg-blue-600/10 rounded-3xl flex items-center justify-center mx-auto">
                        <FileText size={40} className="text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white mb-2">{selectedMaterial.type === 'File' ? 'Файл татах' : 'Гадна холбоос'}</h3>
                        <p className="text-gray-400 max-w-md mx-auto">
                          {selectedMaterial.type === 'File' 
                            ? 'Энэ материалыг шууд үзэх боломжгүй тул татаж авч үзнэ үү.' 
                            : 'Энэ материал нь гадны вэбсайт дээр байрлаж байна.'}
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

          {isAddingMaterial && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setIsAddingMaterial(false); setEditingMaterial(null); }} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                  <BookOpen size={120} className="text-blue-500" />
                </div>
                
                <h2 className="text-2xl font-black text-white mb-6 relative">{editingMaterial ? 'Материал засах' : 'Шинэ материал нэмэх'}</h2>
                <form onSubmit={handleAddMaterial} className="space-y-6 relative">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Гарчиг</label>
                      <input 
                        type="text" 
                        value={newMaterial.title || ''} 
                        onChange={e => setNewMaterial(prev => ({ ...prev, title: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 transition-colors" 
                        placeholder="Материалын гарчиг..."
                        required 
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Тайлбар</label>
                      <textarea 
                        value={newMaterial.description || ''} 
                        onChange={e => setNewMaterial(prev => ({ ...prev, description: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 h-24 resize-none transition-colors" 
                        placeholder="Материалын дэлгэрэнгүй..."
                      />
                    </div>
                    
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Файл хуулах (Зураг, Видео, Файл)</label>
                      <input 
                        type="file"
                        ref={trainingFileRef}
                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
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
                            <span className="text-sm font-bold text-white text-center line-clamp-1">{selectedFile.name}</span>
                            <span className="text-[10px] text-gray-500 uppercase">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</span>
                          </div>
                        ) : (
                          <>
                            <div className="w-12 h-12 bg-gray-700 rounded-xl flex items-center justify-center group-hover:bg-blue-600/20 group-hover:text-blue-400 transition-all">
                              <Plus size={24} className="text-gray-400 group-hover:text-blue-400" />
                            </div>
                            <div className="text-center">
                              <p className="text-sm font-bold text-gray-400">Файл сонгох</p>
                              <p className="text-[10px] text-gray-600 mt-1 uppercase tracking-widest">Бүх төрлийн файл боломжтой</p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 ml-1">Дуусах хугацаа</label>
                      <input 
                        type="datetime-local" 
                        value={newMaterial.deadline || ''} 
                        onChange={e => setNewMaterial(prev => ({ ...prev, deadline: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500 transition-colors" 
                        required 
                      />
                    </div>
                  </div>
                  <div className="flex gap-4 pt-2">
                    <button type="button" onClick={() => { setIsAddingMaterial(false); setEditingMaterial(null); }} className="flex-1 py-4 bg-gray-800 text-white font-bold rounded-xl hover:bg-gray-700 transition-all">Цуцлах</button>
                    <button type="submit" className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-500 transition-all shadow-lg">{editingMaterial ? 'Хадгалах' : 'Нэмэх'}</button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {/* Add User Modal */}
          {isAddingUser && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAddingUser(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-black text-white">Ажилтан нэмэх</h2>
                  <div className="flex bg-gray-800 p-1 rounded-xl">
                    <button 
                      onClick={() => setUserAddTab('single')}
                      className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${userAddTab === 'single' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      Нэгээр
                    </button>
                    <button 
                      onClick={() => setUserAddTab('bulk')}
                      className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${userAddTab === 'bulk' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      Олноор
                    </button>
                  </div>
                </div>

                {userAddTab === 'single' ? (
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSecureConfirm(
                        'Ажилтан нэмэх баталгаажуулалт',
                        `Шинэ ажилтныг бүртгэхийн тулд өөрийн нэвтрэх нэр болон нууц үгээ оруулна уу.`,
                        handleAddUser
                      );
                    }} 
                    className="space-y-4"
                  >
                    <div>
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">АЖИЛТНЫ КОД</label>
                      <input 
                        type="text" 
                        placeholder="EMP001"
                        value={newUser.code || ''} 
                        onChange={(e) => setNewUser({...newUser, code: e.target.value})}
                        className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" 
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">НЭР</label>
                      <input 
                        type="text" 
                        value={newUser.name || ''} 
                        onChange={(e) => setNewUser({...newUser, name: e.target.value})}
                        className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" 
                        required 
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">ИМЭЙЛ ХАЯГ</label>
                      <input 
                        type="email" 
                        placeholder="user@example.com"
                        value={newUser.email || ''} 
                        onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                        className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" 
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">СЕГМЕНТ</label>
                      <select 
                        value={newUser.lineType || ''} 
                        onChange={(e) => setNewUser({...newUser, lineType: e.target.value})}
                        className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                        required
                      >
                        <option value="">Сонгох...</option>
                        {segments.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">АЖЛЫН ТӨРӨЛ</label>
                      <select 
                        value={newUser.employmentType || 'Full Time'} 
                        onChange={(e) => setNewUser({...newUser, employmentType: e.target.value as any})}
                        className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="Full Time">Full Time</option>
                        <option value="Part Time">Part Time</option>
                      </select>
                    </div>
                    <div className="flex gap-4 pt-6">
                      <button type="button" onClick={() => setIsAddingUser(false)} className="flex-1 py-4 bg-gray-800 text-white rounded-2xl font-bold hover:bg-gray-700 transition-all uppercase tracking-widest text-[10px]">Болих</button>
                      <button type="submit" className="flex-1 py-4 bg-blue-600 text-white font-black uppercase tracking-widest rounded-2xl hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/40 text-[10px]">Нэмэх</button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500 uppercase font-black tracking-widest">Ажилтны жагсаалт ({bulkUsers.length})</p>
                      <button 
                        onClick={addBulkRow}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all"
                      >
                        <Plus size={14} />
                        Мөр нэмэх
                      </button>
                    </div>

                    <div className="max-h-[400px] overflow-y-auto pr-2 space-y-4 custom-scrollbar">
                      {bulkUsers.map((user, index) => (
                        <div key={`bulk-row-${index}`} className="p-4 bg-gray-800/40 border border-gray-800 rounded-2xl relative group">
                          {bulkUsers.length > 1 && (
                            <button 
                              onClick={() => removeBulkRow(index)}
                              className="absolute top-2 right-2 p-1 text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                            >
                              <X size={14} />
                            </button>
                          )}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                            <div>
                              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">НЭР</label>
                              <input 
                                type="text" 
                                value={user.name || ''} 
                                onChange={(e) => updateBulkUser(index, { name: e.target.value })}
                                className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-blue-500/50" 
                                placeholder="Нэр..."
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">КОД</label>
                              <input 
                                type="text" 
                                value={user.code || ''} 
                                onChange={(e) => updateBulkUser(index, { code: e.target.value })}
                                className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-blue-500/50" 
                                placeholder="EMP..."
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">СЕГМЕНТ</label>
                              <select 
                                value={user.lineType || ''} 
                                onChange={(e) => updateBulkUser(index, { lineType: e.target.value })}
                                className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-blue-500/50"
                              >
                                <option value="">Сонгох...</option>
                                {segments.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">ТӨРӨЛ</label>
                              <select 
                                value={user.employmentType || 'Full Time'} 
                                onChange={(e) => updateBulkUser(index, { employmentType: e.target.value as any })}
                                className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-blue-500/50"
                              >
                                <option value="Full Time">Full Time</option>
                                <option value="Part Time">Part Time</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-4 pt-4">
                      <button type="button" onClick={() => setIsAddingUser(false)} className="flex-1 py-4 bg-gray-800 text-white rounded-2xl font-bold hover:bg-gray-700 transition-all uppercase tracking-widest text-[10px]">Болих</button>
                      <button 
                        onClick={() => handleSecureConfirm(
                          'Ажилтнуудыг олноор нэмэх',
                          `Нийт ${bulkUsers.filter(u => u.name && u.lineType).length} ажилтныг бүртгэхийн тулд өөрийн нэвтрэх нэр болон нууц үгээ оруулна уу.`,
                          handleBulkAdd
                        )}
                        className="flex-1 py-4 bg-blue-600 text-white font-black uppercase tracking-widest rounded-2xl hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/40 text-[10px]"
                      >
                        Нэмэх
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            </div>
          )}

          {/* Edit User Modal */}
          {isEditingUser && editingUser && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsEditingUser(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
                <h2 className="text-2xl font-black text-white mb-6">Ажилтан засах</h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">АЖИЛТНЫ КОД</label>
                    <input 
                      type="text" 
                      value={editingUser.code || ''} 
                      onChange={(e) => setEditingUser({...editingUser, code: e.target.value})}
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" 
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">НЭР</label>
                    <input 
                      type="text" 
                      value={editingUser.name || ''} 
                      onChange={(e) => setEditingUser({...editingUser, name: e.target.value})}
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" 
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">ИМЭЙЛ ХАЯГ</label>
                    <input 
                      type="email" 
                      value={editingUser.email || ''} 
                      onChange={(e) => setEditingUser({...editingUser, email: e.target.value})}
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500" 
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">СЕГМЕНТ</label>
                    <select 
                      value={editingUser.lineType || ''} 
                      onChange={(e) => setEditingUser({...editingUser, lineType: e.target.value})}
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Сонгох...</option>
                      {segments.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">АЖЛЫН ТӨРӨЛ</label>
                    <select 
                      value={editingUser.employmentType || 'Full Time'} 
                      onChange={(e) => setEditingUser({...editingUser, employmentType: e.target.value as any})}
                      className="w-full bg-gray-900/40 border border-gray-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="Full Time">Full Time</option>
                      <option value="Part Time">Part Time</option>
                    </select>
                  </div>
                  <div className="flex gap-4 pt-6">
                    <button onClick={() => setIsEditingUser(false)} className="flex-1 py-4 bg-gray-800 text-white rounded-2xl font-bold hover:bg-gray-700 transition-all uppercase tracking-widest text-[10px]">Болих</button>
                    <button 
                      onClick={() => handleSecureConfirm(
                        'Мэдээлэл шинэчлэх',
                        `'${editingUser.name}' ажилтны мэдээллийг шинэчлэхийн тулд өөрийн нэвтрэх нэр болон нууц үгээ оруулна уу.`,
                        handleUpdateUser
                      )}
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
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAddingSegment(false)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl">
                <h2 className="text-2xl font-black text-white mb-6">Сегмент нэмэх</h2>
                <form onSubmit={handleAddSegment} className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Сегментийн нэр</label>
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
                    <button type="button" onClick={() => setIsAddingSegment(false)} className="flex-1 py-3 bg-gray-800 text-white rounded-xl font-bold">Болих</button>
                    <button type="submit" className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-900/40">Нэмэх</button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {/* Shift Template Management Modal */}
          {isManagingShiftTemplates && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsManagingShiftTemplates(false)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-2xl bg-gray-900 border border-white/10 rounded-[2.5rem] p-10 shadow-2xl flex flex-col max-h-[85vh]">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-3xl font-black text-white">Shift Загварууд</h2>
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
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8 p-6 bg-blue-600/5 border border-blue-500/20 rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Шинэ загвар үүсгэх</p>
                      <button onClick={() => setIsAddingTemplate(false)} className="text-gray-500 hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="flex gap-3">
                      <input 
                        type="text" 
                        value={newTemplateTime}
                        onChange={(e) => setNewTemplateTime(e.target.value)}
                        placeholder="Жишээ: 08--17"
                        className="flex-1 bg-black/40 border border-white/10 rounded-2xl py-4 px-6 text-white focus:outline-none focus:border-blue-500 font-bold"
                        autoFocus
                      />
                      <button 
                        onClick={() => {
                          if (newTemplateTime) {
                            const newTemplates = [...shiftTemplates, { id: Math.random().toString(36).substr(2, 9), time: newTemplateTime, label: newTemplateTime }];
                            setShiftTemplates(newTemplates);
                            setLocalData('shiftTemplates', newTemplates);
                            setNewTemplateTime('');
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

                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4">
                  {[...shiftTemplates]
                    .sort((a, b) => getStartTimeValue(a.time) - getStartTimeValue(b.time))
                    .map((template, idx) => (
                      <div key={template.id} className="flex items-center justify-between p-6 bg-white/5 border border-white/5 rounded-3xl group">
                      <div className="flex items-center gap-6">
                        <div className="w-12 h-12 rounded-2xl bg-blue-600/10 flex items-center justify-center text-blue-400 border border-blue-500/20">
                          <Clock size={24} />
                        </div>
                        <div>
                          <p className="text-lg font-black text-white">{template.time}</p>
                          <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Calculated: {getHoursForShift(template.time)} hours</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          const newTemplates = shiftTemplates.filter((_, i) => i !== idx);
                          setShiftTemplates(newTemplates);
                          setLocalData('shiftTemplates', newTemplates);
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
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsEditingShiftModal(false)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-xl bg-gray-900 border border-white/10 rounded-[2.5rem] p-10 shadow-2xl">
                <h2 className="text-3xl font-black text-white mb-2">{editingShiftData.id ? 'Ээлж засах' : 'Шинэ ээлж үүсгэх'}</h2>
                <p className="text-gray-400 mb-8 text-[10px] font-black uppercase tracking-widest">{editingShiftData.dateKey} өдөр</p>
                
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Ээлжийн цаг (Manual or Select)</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={editingShiftData.time} 
                        onChange={e => setEditingShiftData({...editingShiftData, time: e.target.value})} 
                        className="flex-1 bg-black/40 border border-white/5 rounded-2xl py-4 px-6 text-white focus:outline-none focus:border-blue-500 font-bold" 
                        placeholder="Жишээ: 09:00 - 18:00"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Түгээмэл цагууд</label>
                     <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                        {[...shiftTemplates]
                          .sort((a, b) => getStartTimeValue(a.time) - getStartTimeValue(b.time))
                          .map(t => {
                            const isTimeAlreadyUsed = schedules[editingShiftData.dateKey]?.shifts.some((s: any) => 
                              s.time === t.time && 
                              s.segment === editingShiftData.segment && 
                              s.employmentType === editingShiftData.employmentType &&
                              s.id !== editingShiftData.id
                            );
                            return (
                              <button 
                                key={t.id}
                                onClick={() => setEditingShiftData({...editingShiftData, time: t.time})}
                                className={`p-2 rounded-xl text-[10px] font-bold border transition-all ${
                                  editingShiftData.time === t.time 
                                    ? 'bg-blue-600 border-blue-400 text-white' 
                                    : isTimeAlreadyUsed
                                      ? 'bg-red-500/10 border-red-500/20 text-red-400 cursor-not-allowed opacity-50'
                                      : 'bg-white/5 border-white/5 text-gray-400 hover:text-white hover:border-white/10'
                                }`}
                                title={isTimeAlreadyUsed ? 'Энэ цаг аль хэдийн нэмэгдсэн байна' : ''}
                              >
                                {t.time}
                                {isTimeAlreadyUsed && <span className="block text-[8px] mt-0.5 opacity-70">USED</span>}
                              </button>
                            );
                          })}
                     </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Квот (Slots)</label>
                      <input 
                        type="number" 
                        value={editingShiftData.totalSlots} 
                        onChange={e => setEditingShiftData({...editingShiftData, totalSlots: parseInt(e.target.value)})}
                        className="w-full bg-black/40 border border-white/5 rounded-2xl py-4 px-6 text-white focus:outline-none focus:border-blue-500 font-bold" 
                      />
                    </div>
                  </div>

                  {editingShiftData.time && (
                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex items-center justify-between">
                      <span className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">Тооцоолсон ажлын цаг:</span>
                      <span className="text-lg font-black text-white">{getHoursForShift(editingShiftData.time)} цаг</span>
                    </div>
                  )}

                  <div className="flex gap-4 pt-4">
                    <button onClick={() => setIsEditingShiftModal(false)} className="flex-1 py-5 bg-gray-800 text-white rounded-3xl font-black uppercase tracking-widest text-xs hover:bg-gray-700 transition-all">Болих</button>
                    <button 
                      onClick={() => {
                        const newSchedules = { ...schedules };
                        const { dateKey, id, time, segment, employmentType, totalSlots } = editingShiftData;
                        
                        // Duplicate check
                        const isDuplicate = newSchedules[dateKey]?.shifts.some((s: any) => 
                          s.time === time && 
                          s.segment === segment && 
                          s.employmentType === employmentType && 
                          s.id !== id
                        );
                        if (isDuplicate) {
                          alert(`Энэ өдөр ${segment} ${employmentType} зориулалттай ${time} цагийн ээлж аль хэдийн нэмэгдсэн байна.`);
                          return;
                        }

                        if (!newSchedules[dateKey]) newSchedules[dateKey] = { shifts: [] };
                        
                        // Deep copy shifts array for immutability
                        const updatedShifts = [...newSchedules[dateKey].shifts];
                        
                        if (id) {
                          const idx = updatedShifts.findIndex((s: any) => s.id === id);
                          if (idx !== -1) {
                            updatedShifts[idx] = { ...updatedShifts[idx], time, segment, employmentType, totalSlots };
                          }
                        } else {
                          updatedShifts.push({
                            id: Math.random().toString(36).substr(2, 9),
                            time,
                            totalSlots,
                            bookedSlots: 0,
                            segment,
                            employmentType,
                            bookedBy: []
                          });
                        }
                        
                        newSchedules[dateKey] = { ...newSchedules[dateKey], shifts: updatedShifts };
                        
                        // Auto-add new time pattern to templates if not exists
                        if (time && !shiftTemplates.some(st => st.time === time)) {
                          const newTemplates = [...shiftTemplates, { id: Math.random().toString(36).substr(2, 9), time, label: time }];
                          setShiftTemplates(newTemplates);
                          setLocalData('shiftTemplates', newTemplates);
                        }

                        setLocalData('schedules', newSchedules);
                        setSchedules(newSchedules);
                        setIsEditingShiftModal(false);
                      }}
                      className="flex-1 py-5 bg-blue-600 text-white rounded-3xl font-black uppercase tracking-widest text-xs hover:bg-blue-500 transition-all shadow-2xl shadow-blue-500/20"
                    >Хадгалах</button>
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
