import { ActivityLog } from '../types';

export function logAction(action: string, details: string) {
  const adminProfile = JSON.parse(localStorage.getItem('admin_profile') || '{}');
  const csrProfile = JSON.parse(localStorage.getItem('csr_profile') || '{}');
  const superAdminProfile = JSON.parse(localStorage.getItem('superadmin_profile') || '{"name": "Super Admin", "role": "superadmin"}');
  
  // Determine current user
  let currentUser = { name: 'Unknown', role: 'unknown', id: 'unknown' };
  
  // This is a bit of a hack since we don't have a global auth state yet
  // In a real app, we'd have a useAuth hook
  if (window.location.pathname.includes('superadmin')) {
    currentUser = { ...superAdminProfile, id: 'superadmin' };
  } else if (window.location.pathname.includes('admin')) {
    currentUser = { ...adminProfile, id: 'admin' };
  } else if (window.location.pathname.includes('csr')) {
    currentUser = { ...csrProfile, id: 'csr' };
  }

  const newLog: ActivityLog = {
    id: Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action,
    details
  };

  const logs: ActivityLog[] = JSON.parse(localStorage.getItem('activity_logs') || '[]');
  logs.unshift(newLog);
  localStorage.setItem('activity_logs', JSON.stringify(logs.slice(0, 1000))); // Keep last 1000 logs
}
