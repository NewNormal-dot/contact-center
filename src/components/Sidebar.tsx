import React, { useRef, useState, useEffect } from 'react';
import { Home, Calendar, PlusCircle, Palmtree, Settings, LogOut, Bell, Camera, BookOpen, Sparkles, ChevronRight, ChevronLeft, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { updateLocalItem } from '../utils/localStorage';

interface SidebarProps {
  activeTab?: string;
  setActiveTab?: (tab: string) => void;
  unreadCount?: number;
  unreadTrainingCount?: number;
  onChangePassword?: () => void;
  isCollapsed?: boolean;
  setIsCollapsed?: (collapsed: boolean) => void;
  role?: 'admin' | 'csr' | 'superadmin';
}

export default function Sidebar({ 
  activeTab = 'schedule', 
  setActiveTab, 
  unreadCount = 0, 
  unreadTrainingCount = 0,
  onChangePassword,
  isCollapsed = false,
  setIsCollapsed,
  role = 'csr'
}: SidebarProps) {
  const navigate = useNavigate();
  const { profile: authProfile, logout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const profile = authProfile || {
    id: '',
    name: 'Уншиж байна...',
    email: '',
    lineType: '',
    photoUrl: 'https://ui-avatars.com/api/?name=User&background=2563eb&color=fff&size=128'
  };

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && authProfile) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        try {
          updateLocalItem('users', authProfile.id, { photoUrl: base64 });
        } catch (error) {
          console.error('Error updating photo:', error);
        }
      };
      reader.readAsDataURL(file);
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

  return (
    <aside className={`${isCollapsed ? 'w-20' : 'w-72'} bg-gray-900/95 backdrop-blur-xl border-r border-gray-800 flex flex-col h-screen shadow-2xl z-50 transition-all duration-300 relative`}>
      <button 
        onClick={() => setIsCollapsed?.(!isCollapsed)}
        className="absolute -right-3 top-10 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg z-30 hover:scale-110 transition-transform"
      >
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {/* Profile Section */}
      <div className={`p-6 border-b border-gray-800 flex items-center gap-4 bg-black/20 ${isCollapsed ? 'justify-center' : ''}`}>
        <div className="relative group cursor-pointer" onClick={handlePhotoClick}>
          <div className={`relative overflow-hidden rounded-full border-2 border-blue-500/50 shadow-lg transition-transform group-hover:scale-105 ${isCollapsed ? 'w-10 h-10' : 'w-14 h-14'}`}>
            <img 
              src={profile.photoUrl} 
              alt="Profile" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera size={isCollapsed ? 12 : 16} className="text-white" />
            </div>
          </div>
          <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-gray-900 rounded-full"></div>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            className="hidden" 
            accept="image/*"
          />
        </div>
        {!isCollapsed && (
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-lg tracking-wide truncate" title={profile.name}>{profile.name}</h2>
            <p className="text-gray-500 text-[10px] font-bold truncate">{profile.email || 'И-мэйл байхгүй'}</p>
            <p className="text-blue-400 text-[10px] font-black uppercase tracking-wider mt-0.5">{profile.lineType}</p>
          </div>
        )}
      </div>

      {/* Menu Items */}
      <nav className="flex-1 p-4 space-y-3 overflow-y-auto">
        {!isCollapsed && <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 ml-2 mt-2">Үндсэн цэс</p>}
        
        {/* Work Schedule - Refined */}
        <button 
          onClick={() => setActiveTab?.('schedule')}
          className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all ${
            activeTab === 'schedule' 
              ? 'bg-blue-600/15 text-white border border-blue-500/30' 
              : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
          } ${isCollapsed ? 'justify-center' : ''}`}
          title={isCollapsed ? 'Ажлын хуваарь' : ''}
        >
          <Calendar size={isCollapsed ? 20 : 22} className={activeTab === 'schedule' ? "text-blue-400" : ""} />
          {!isCollapsed && <span className="text-lg font-black tracking-tight">Ажлын хуваарь</span>}
        </button>

        <button 
          onClick={() => setActiveTab?.('vacation')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-colors ${
            activeTab === 'vacation' 
              ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20' 
              : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
          } ${isCollapsed ? 'justify-center' : ''}`}
          title={isCollapsed ? 'Ээлжийн амралт' : ''}
        >
          <Palmtree size={20} />
          {!isCollapsed && <span>Ээлжийн амралт</span>}
        </button>

        <button 
          onClick={() => setActiveTab?.('hourlyLeave')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-colors ${
            activeTab === 'hourlyLeave' 
              ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20' 
              : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
          } ${isCollapsed ? 'justify-center' : ''}`}
          title={isCollapsed ? 'Чөлөө' : ''}
        >
          <Clock size={20} />
          {!isCollapsed && <span>Чөлөө</span>}
        </button>

        <button 
          onClick={() => setActiveTab?.('notifications')}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-bold transition-colors ${
            activeTab === 'notifications' 
              ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20' 
              : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
          } ${isCollapsed ? 'justify-center' : ''}`}
          title={isCollapsed ? 'Мэдэгдэл' : ''}
        >
          <div className="relative flex items-center gap-3">
            <Bell size={20} className="animate-bell-ring" />
            {!isCollapsed && <span>Мэдэгдэл</span>}
            {!isCollapsed && unreadCount > 0 && (
              <span className="sparkle-emoji">✨</span>
            )}
          </div>
          {unreadCount > 0 && (
            <span className={`bg-red-500 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-[#0a0a0a] ${isCollapsed ? 'w-4 h-4' : 'px-2 py-0.5 min-w-[20px] text-center'}`}>
              {unreadCount}
            </span>
          )}
        </button>

        <button 
          onClick={() => setActiveTab?.('training')}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-bold transition-colors ${
            activeTab === 'training' 
              ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20' 
              : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
          } ${isCollapsed ? 'justify-center' : ''}`}
          title={isCollapsed ? 'Сургалт' : ''}
        >
          <div className="flex items-center gap-3">
            <BookOpen size={20} className={unreadTrainingCount > 0 ? 'animate-bell-ring' : ''} />
            {!isCollapsed && <span>Сургалт</span>}
          </div>
          {unreadTrainingCount > 0 && (
            <span className={`bg-purple-500 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-[#0a0a0a] ${isCollapsed ? 'w-4 h-4' : 'px-2 py-0.5 min-w-[20px] text-center'}`}>
              {unreadTrainingCount}
            </span>
          )}
        </button>

        {(role === 'admin' || role === 'superadmin') && (
          <button 
            onClick={() => setActiveTab?.('forecast')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${
              activeTab === 'forecast' ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20' : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
            } ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? 'Дуудлагын Forecast' : ''}
          >
            <Sparkles size={20} />
            {!isCollapsed && <span>Дуудлагын Forecast</span>}
          </button>
        )}
      </nav>

      {/* Bottom Section */}
      <div className={`p-4 border-t border-gray-800 bg-black/10 ${isCollapsed ? 'flex flex-col items-center gap-2' : ''}`}>
        <button 
          onClick={() => onChangePassword?.()}
          className={`w-full flex items-center gap-3 px-4 py-3 text-gray-400 hover:bg-gray-800/50 hover:text-white rounded-xl font-medium transition-colors mb-2 ${isCollapsed ? 'justify-center' : ''}`}
          title={isCollapsed ? 'Нууц үг солих' : ''}
        >
          <Settings size={20} />
          {!isCollapsed && <span>Нууц үг солих</span>}
        </button>
        <button 
          onClick={handleLogout}
          className={`w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-xl font-medium transition-colors ${isCollapsed ? 'justify-center' : ''}`}
          title={isCollapsed ? 'Гарах' : ''}
        >
          <LogOut size={20} />
          {!isCollapsed && <span>Гарах</span>}
        </button>
      </div>
    </aside>
  );
}
