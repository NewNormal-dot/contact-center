import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { User } from '../types';
import apiClient from '../lib/api-client';
import { getLocalData } from '../utils/localStorage';

interface AuthContextType {
  user: User | null;
  profile: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  login: async () => {},
  logout: () => {},
});

function normalizeUser(raw: any): User {
  const role = raw?.role === 'superadmin' || raw?.role === 'admin' || raw?.role === 'csr' ? raw.role : 'csr';
  const name = raw?.name || raw?.displayName || raw?.email?.split('@')?.[0] || role.toUpperCase();

  return {
    id: String(raw?.id || raw?.uid || role),
    email: raw?.email || '',
    name,
    role,
    status: raw?.status || 'active',
    photoUrl:
      raw?.photoUrl ||
      raw?.photoURL ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2563eb&color=fff&size=128`,
    code: raw?.code,
    employmentType: raw?.employmentType || raw?.lineType || 'Full Time',
    lineType: raw?.lineType || raw?.employmentType || (role === 'superadmin' ? 'System Control' : role === 'admin' ? 'Supervisor' : 'Full Time'),
    createdAt: raw?.createdAt || new Date().toISOString(),
    updatedAt: raw?.updatedAt || new Date().toISOString(),
  };
}

function mapUserForUi(raw: any): any {
  const normalized = normalizeUser(raw);
  return {
    ...normalized,
    photoUrl: normalized.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(normalized.name)}&background=2563eb&color=fff&size=128`,
    lineType: normalized.lineType || normalized.employmentType || (normalized.role === 'admin' ? 'Supervisor' : normalized.role === 'superadmin' ? 'System Control' : 'Full Time'),
    status: normalized.status === 'inactive' ? 'offline' : 'online',
  };
}

function mapNotificationForUi(row: any): any {
  return {
    id: row.id,
    title: row.title,
    content: row.content || row.body || '',
    deadline: row.deadline || '',
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    authorId: row.authorId || row.author_id || 'system',
    authorName: row.authorName || row.author_name || 'Admin',
    type: row.type || 'general',
    seenBy: row.readAt || row.read_at ? [{ userId: 'me', userName: 'Me', seenAt: row.readAt || row.read_at }] : (row.seenBy || []),
  };
}

function mapTrainingForUi(row: any): any {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    type: row.type || 'document',
    url: row.attachmentUrl || row.attachment_url || row.url || '',
    date: row.createdAt || row.created_at || new Date().toISOString(),
    deadline: row.deadline || '',
    fileName: row.attachmentName || row.attachment_name || row.fileName || '',
    seenBy: row.completedAt || row.completed_at ? [{ userId: 'me', userName: 'Me', seenAt: row.completedAt || row.completed_at }] : (row.seenBy || []),
  };
}

async function hydrateLocalDataForUi(role: string) {
  try {
    const [notificationsRes, trainingsRes] = await Promise.allSettled([
      apiClient.get('/broadcasts/notifications'),
      apiClient.get('/broadcasts/trainings'),
    ]);

    if (notificationsRes.status === 'fulfilled') {
      localStorage.setItem('notifications', JSON.stringify((notificationsRes.value.data || []).map(mapNotificationForUi)));
    }
    if (trainingsRes.status === 'fulfilled') {
      localStorage.setItem('trainingMaterials', JSON.stringify((trainingsRes.value.data || []).map(mapTrainingForUi)));
    }

    if (role === 'superadmin') {
      const usersRes = await apiClient.get('/users');
      localStorage.setItem('users', JSON.stringify((usersRes.data || []).map(mapUserForUi)));
    } else if (role === 'admin') {
      const usersRes = await apiClient.get('/users/csr');
      localStorage.setItem('users', JSON.stringify((usersRes.data || []).map(mapUserForUi)));
    }

    const [leaveRes, vacationRes] = await Promise.allSettled([
      apiClient.get('/requests/leave'),
      apiClient.get('/requests/vacation'),
    ]);

    if (leaveRes.status === 'fulfilled') {
      const leaves = (leaveRes.value.data || []).map((r: any) => ({
        id: r.id,
        csrId: r.userId || r.user_id,
        csrName: r.userName || r.user_name || '',
        type: 'hourly',
        date: r.date,
        startTime: r.startTime || r.start_time,
        endTime: r.endTime || r.end_time,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt || r.created_at || new Date().toISOString(),
      }));
      localStorage.setItem('hourlyLeaveRequests', JSON.stringify(leaves));
    }

    if (vacationRes.status === 'fulfilled') {
      const vacations = (vacationRes.value.data || []).map((r: any) => ({
        id: r.id,
        csrId: r.userId || r.user_id,
        csrName: r.userName || r.user_name || '',
        csrPhoto: '',
        month: String(r.startDate || r.start_date || '').slice(0, 7),
        startDate: r.startDate || r.start_date,
        endDate: r.endDate || r.end_date,
        reason: r.reason,
        type: 'vacation',
        status: r.status,
        createdAt: r.createdAt || r.created_at || new Date().toISOString(),
      }));
      localStorage.setItem('vacationRequests', JSON.stringify(vacations));
    }
  } catch (error) {
    console.warn('UI data hydration skipped:', error);
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initialize = () => {
      const savedUser = localStorage.getItem('user');
      const token = localStorage.getItem('token');

      if (savedUser && token) {
        try {
          const normalized = normalizeUser(JSON.parse(savedUser));
          setUser(normalized);
          localStorage.setItem('test_profile', JSON.stringify(normalized));
          localStorage.setItem(`${normalized.role}_profile`, JSON.stringify(normalized));
          hydrateLocalDataForUi(normalized.role).catch(() => undefined);
        } catch (e) {
          localStorage.removeItem('user');
          localStorage.removeItem('token');
        }
      }
      setLoading(false);
    };

    const syncCurrentUser = () => {
      const savedUserStr = localStorage.getItem('user');
      if (!savedUserStr) return;
      try {
        const savedUser = JSON.parse(savedUserStr);
        const storedUsers = getLocalData('users', []);
        const matchingUser = storedUsers.find((u: any) => u.id === savedUser.id);
        if (!matchingUser) return;

        const normalized = normalizeUser(matchingUser);
        if (normalized.status === 'inactive') {
          logout();
          return;
        }

        if (normalized.role !== savedUser.role || normalized.status !== savedUser.status) {
          setUser(normalized);
          localStorage.setItem('user', JSON.stringify(normalized));
          localStorage.setItem('test_profile', JSON.stringify(normalized));
          localStorage.setItem(`${normalized.role}_profile`, JSON.stringify(normalized));
        }
      } catch (e) {
        // ignore malformed local data
      }
    };

    initialize();
    const interval = window.setInterval(syncCurrentUser, 3000);
    window.addEventListener('storage', syncCurrentUser);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('storage', syncCurrentUser);
    };
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const response = await apiClient.post('/auth/login', { email, password });
      const { token, user: apiUser } = response.data;
      const normalized = normalizeUser(apiUser);

      setUser(normalized);
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(normalized));

      localStorage.setItem('test_user', JSON.stringify({
        uid: normalized.id,
        email: normalized.email,
        displayName: normalized.name,
        photoURL: normalized.photoUrl,
      }));
      localStorage.setItem('test_profile', JSON.stringify(normalized));
      localStorage.setItem(`${normalized.role}_profile`, JSON.stringify(normalized));
      hydrateLocalDataForUi(normalized.role).catch(() => undefined);
    } catch (err: any) {
      throw new Error(err.response?.data?.error || 'Нэвтрэхэд алдаа гарлаа');
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('test_user');
    localStorage.removeItem('test_profile');
  };

  const value = useMemo(() => ({ user, profile: user, loading, login, logout }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
