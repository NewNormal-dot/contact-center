export const getLocalData = (key: string, defaultValue: any) => {
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error(`Error parsing local storage key ${key}:`, e);
      return defaultValue;
    }
  }
  return defaultValue;
};

export const setLocalData = (key: string, data: any) => {
  localStorage.setItem(key, JSON.stringify(data));
};

export const updateLocalItem = (key: string, id: string, updates: any) => {
  const data = getLocalData(key, []);
  const updated = data.map((item: any) => (item.id === id ? { ...item, ...updates } : item));
  setLocalData(key, updated);
  return updated;
};

export const addLocalItem = (key: string, item: any) => {
  const data = getLocalData(key, []);
  const newItem = { ...item, id: item.id || Math.random().toString(36).substr(2, 9) };
  const updated = [...data, newItem];
  setLocalData(key, updated);
  return updated;
};

export const deleteLocalItem = (key: string, id: string) => {
  const data = getLocalData(key, []);
  const updated = data.filter((item: any) => item.id !== id);
  setLocalData(key, updated);
  return updated;
};
