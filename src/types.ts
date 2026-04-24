/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'superadmin' | 'admin' | 'csr';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'active' | 'inactive';
  photoUrl?: string;
  code?: string;
  employmentType: 'Full Time' | 'Part Time';
  createdAt: string;
  updatedAt: string;
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
  patterns: { duration: number; count: number }[]; // e.g. [{duration: 7, count: 4}, {duration: 6, count: 2}]
}

export interface WorkSlot {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  duration: number; // in hours
  capacity: number;
  bookingDeadline: string; // ISO string
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
  userId: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  approvedBy?: string;
}

export interface TradeRequest {
  id: string;
  senderId: string;
  receiverId: string;
  senderSlotId: string;
  receiverSlotId: string;
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
  authorId: string;
  createdAt: string;
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

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  details: string;
  ipAddress?: string;
  createdAt: string;
}

export interface ForecastPlaceholderEntry {
  id: string;
  date: string;
  period: string; // e.g. "morning", "afternoon"
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
