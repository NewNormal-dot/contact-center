import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, X, Sun, Moon, Key, CheckCircle, AlertCircle } from 'lucide-react';
import apiClient from '../lib/api-client';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
  );
  const [passwords, setPasswords] = useState({ old: '', new: '', confirm: '' });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setToast({ message: 'Шинэ нууц үгнүүд тохирохгүй байна', type: 'error' });
      return;
    }
    try {
      await apiClient.post('/auth/change-password', {
        oldPassword: passwords.old,
        newPassword: passwords.new
      });
      setToast({ message: 'Нууц үг амжилттай солигдлоо', type: 'success' });
      setPasswords({ old: '', new: '', confirm: '' });
      setTimeout(onClose, 2000);
    } catch (err: any) {
      setToast({ message: err.response?.data?.error || 'Алдаа гарлаа', type: 'error' });
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }} 
            animate={{ opacity: 1, scale: 1, y: 0 }} 
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-2xl bg-white dark:bg-[#0d0d0d] border border-black/10 dark:border-white/10 rounded-3xl overflow-hidden shadow-2xl overflow-y-auto max-h-[90vh] custom-scrollbar"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md px-8 py-6 border-b border-black/5 dark:border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                 <div className="p-2 bg-blue-600/10 rounded-lg">
                    <Settings className="text-blue-600 dark:text-blue-500" size={24} />
                 </div>
                 <h2 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Тохиргоо</h2>
              </div>
              <button 
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-8">
              <section className="space-y-4">
                <h3 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] ml-1">Харагдах байдал</h3>
                <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/5">
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white mb-1">Theme горим</p>
                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Dark / Light горим солих</p>
                  </div>
                  <div className="flex bg-gray-200 dark:bg-black/40 p-1 rounded-xl border border-black/5 dark:border-white/5">
                    <button 
                      onClick={() => setTheme('light')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${theme === 'light' ? 'bg-white text-blue-600 shadow-md font-bold' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      <Sun size={16} />
                      <span className="text-[10px] uppercase">Light</span>
                    </button>
                    <button 
                      onClick={() => setTheme('dark')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${theme === 'dark' ? 'bg-blue-600 dark:bg-gray-800 text-white shadow-md font-bold' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      <Moon size={16} />
                      <span className="text-[10px] uppercase">Dark</span>
                    </button>
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] ml-1">Аюулгүй байдал</h3>
                <div className="bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-2xl p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <Key className="text-purple-500" size={20} />
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">Нууц үг солих</h4>
                  </div>

                  <form onSubmit={handleUpdatePassword} className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase ml-1">Одоогийн нууц үг</label>
                      <input 
                        type="password" required
                        className="w-full bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                        value={passwords.old}
                        onChange={e => setPasswords({...passwords, old: e.target.value})}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase ml-1">Шинэ нууц үг</label>
                        <input 
                          type="password" required
                          className="w-full bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                          value={passwords.new}
                          onChange={e => setPasswords({...passwords, new: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase ml-1">Шинэ нууц үг давтах</label>
                        <input 
                          type="password" required
                          className="w-full bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-colors text-gray-900 dark:text-white"
                          value={passwords.confirm}
                          onChange={e => setPasswords({...passwords, confirm: e.target.value})}
                        />
                      </div>
                    </div>
                    <button 
                      type="submit"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-900/20 mt-2"
                    >
                      Нууц үг хадгалах
                    </button>
                  </form>
                </div>
              </section>
            </div>
            
            <AnimatePresence>
              {toast && (
                <motion.div
                  initial={{ opacity: 0, y: 50, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 20, scale: 0.9 }}
                  className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border backdrop-blur-xl ${
                    toast.type === 'success' 
                      ? 'bg-green-500/10 border-green-500/20 text-green-500' 
                      : 'bg-red-500/10 border-red-500/20 text-red-500'
                  }`}
                >
                  {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
                  <span className="text-sm font-black uppercase tracking-wider">{toast.message}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
