import { Notification, TrainingMaterial } from '../types';

export interface NotificationDayGroup {
  key: string;
  title: string;
  notifications: Notification[];
}

export interface TrainingMaterialDayGroup {
  key: string;
  title: string;
  materials: TrainingMaterial[];
}

const getValidDate = (value?: string) => {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const getValidNotificationDate = (notification: Notification) => (
  getValidDate(notification.createdAt || notification.deadline)
);

const getValidMaterialDate = (material: TrainingMaterial) => (
  getValidDate(material.date || material.deadline)
);

const getDayKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDayTitle = (date: Date) => {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (getDayKey(date) === getDayKey(today)) return 'Өнөөдөр';
  if (getDayKey(date) === getDayKey(yesterday)) return 'Өчигдөр';

  return date.toLocaleDateString('mn-MN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export const groupNotificationsByDay = (notifications: Notification[]): NotificationDayGroup[] => {
  const groups = new Map<string, NotificationDayGroup>();

  [...notifications]
    .sort((a, b) => getValidNotificationDate(b).getTime() - getValidNotificationDate(a).getTime())
    .forEach(notification => {
      const date = getValidNotificationDate(notification);
      const key = getDayKey(date);
      const group = groups.get(key);

      if (group) {
        group.notifications.push(notification);
        return;
      }

      groups.set(key, {
        key,
        title: getDayTitle(date),
        notifications: [notification],
      });
    });

  return Array.from(groups.values());
};

export const groupTrainingMaterialsByDay = (materials: TrainingMaterial[]): TrainingMaterialDayGroup[] => {
  const groups = new Map<string, TrainingMaterialDayGroup>();

  [...materials]
    .sort((a, b) => getValidMaterialDate(b).getTime() - getValidMaterialDate(a).getTime())
    .forEach(material => {
      const date = getValidMaterialDate(material);
      const key = getDayKey(date);
      const group = groups.get(key);

      if (group) {
        group.materials.push(material);
        return;
      }

      groups.set(key, {
        key,
        title: getDayTitle(date),
        materials: [material],
      });
    });

  return Array.from(groups.values());
};
