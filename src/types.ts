/**
 * Shared app types for the deployed Azure backend plus the AI Studio UI.
 */

export type UserRole = 'superadmin' | 'admin' | 'csr';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'active' | 'inactive' | 'online' | 'offline';
  photoUrl?: string;
  code?: string;
  employmentType: 'Full Time' | 'Part Time' | string;
  lineType?: string;
  password?: string;
  monthlyFontTime?: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface CSR {
  id: string;
  code?: string;
  name: string;
  email?: string;
  lineType: string;
  photoUrl: string;
  status: 'online' | 'offline' | 'active' | 'inactive';
  role: UserRole;
  password?: string;
  monthlyFontTime?: Record<string, number>;
  employmentType?: 'Full Time' | 'Part Time' | string;
}

export interface EmployeeProfile extends User {
  weeklyRuleId?: string;
}

export interface WeeklyRuleTemplate {
  id: string;
  name: string;
  description: string;
  totalHours: number;
  restDaysCount: number;
  patterns: { duration: number; count: number }[];
}

export interface WorkSlot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  capacity: number;
  bookingDeadline: string;
  createdAt: string;
}

export interface SlotBooking {
  id: string;
  slotId: string;
  userId: string;
  bookedAt: string;
  status: 'confirmed' | 'cancelled' | 'auto-assigned';
}

export interface LeaveRequest {
  id: string;
  userId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  approvedBy?: string;
}

export interface VacationRequest {
  id: string;
  userId?: string;
  csrId?: string;
  csrName?: string;
  csrPhoto?: string;
  month?: string;
  startDate: string;
  endDate: string;
  reason: string;
  type?: 'vacation' | 'sick' | 'leave';
  status: 'pending' | 'approved' | 'rejected';
  createdAt?: string;
  approvedBy?: string;
}

export interface HourlyLeaveRequest {
  id: string;
  csrId: string;
  csrName: string;
  type: 'hourly' | 'daily';
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  comment?: string;
}

export interface TradeRequest {
  id: string;
  senderId: string;
  senderName?: string;
  receiverId: string;
  receiverName?: string;
  date?: string;
  senderShiftId?: string;
  senderShiftTime?: string;
  receiverShiftId?: string;
  receiverShiftTime?: string;
  senderSlotId?: string;
  receiverSlotId?: string;
  status: 'pending' | 'accepted' | 'approved' | 'rejected';
  createdAt: string;
  approvedBy?: string;
}

export interface Notification {
  id: string;
  title: string;
  content: string;
  imageUrl?: string;
  deadline?: string;
  createdAt: string;
  authorId: string;
  authorName?: string;
  type?: 'general' | 'training' | 'important';
  targetUserId?: string;
  tradeRequestId?: string;
  fileUrl?: string;
  fileName?: string;
  seenBy?: {
    userId: string;
    userName: string;
    seenAt: string;
  }[];
}

export interface NotificationReadReceipt {
  notificationId: string;
  userId: string;
  readAt: string;
}

export interface Training {
  id: string;
  title: string;
  description: string;
  attachmentUrl?: string;
  attachmentName?: string;
  deadline?: string;
  authorId: string;
  createdAt: string;
}

export interface TrainingCompletion {
  trainingId: string;
  userId: string;
  completedAt: string;
}

export interface TrainingMaterial {
  id: string;
  title: string;
  description: string;
  type: string;
  url: string;
  date: string;
  thumbnailUrl?: string;
  deadline?: string;
  fileName?: string;
  seenBy: {
    userId: string;
    userName: string;
    seenAt: string;
  }[];
}

export interface VacationQuota {
  month: string;
  limit: number;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: string;
  action: string;
  details: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details: string;
  ipAddress?: string;
  createdAt: string;
}

export interface ForecastPlaceholderEntry {
  id: string;
  date: string;
  period: string;
  callVolume: number;
  requiredStaff: number;
}

export interface FileAsset {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  uploadedBy: string;
  createdAt: string;
}
