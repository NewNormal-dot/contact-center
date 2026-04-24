import { AuditLog } from '../types';

export function logAction(action: string, details: string) {
  // Determine current user from some source or just a placeholder for now
  // Since we are moving to backend-driven logs, this is less critical
  // but we fix the types to prevent lint errors.
  
  const newLog: Partial<AuditLog> = {
    userId: 'system',
    action,
    details,
    createdAt: new Date().toISOString()
  };
  console.log('Log Action:', newLog);
}
