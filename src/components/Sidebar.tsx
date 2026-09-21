import React, { useRef, useState, useEffect } from 'react';
import { Home, Calendar, PlusCircle, Palmtree, Settings, LogOut, Bell, Camera, BookOpen, Sparkles, ChevronRight, ChevronLeft, Clock } from 'lucide-react';
import { MobileNavBar, MobileNavBackdrop, MobileNavClose, mobileDrawerClasses } from './MobileNavBar';
import { SidebarNavItem } from './SidebarNavItem';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { SHOW_VACATION_FEATURE } from '../config/features';
import apiClient from '../lib/api-client';
import { downscaleImageToDataUrl, validateImageFile } from '../utils/image';

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
  const { profile: authProfile, logout, setProfilePhoto } = useAuth();
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Choosing a destination should close the drawer. Leaving it open would
  // hide the thing the tap just navigated to.
  const goToTab = (tab: string) => {
    setActiveTab?.(tab);
    setIsMobileNavOpen(false);
  };

  const profile = authProfile || {
    id: '',
    name: 'Уншиж байна...',
    email: '',
    lineType: '',
    employmentType: '',
    location: '',
    photoUrl: 'https://ui-avatars.com/api/?name=User&background=2563eb&color=fff&size=128'
  };

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  // This used to write the picked file into localStorage under the key
  // `users` - which AuthContext does not read for photoUrl and which is
  // empty for a CSR - so choosing a photo did nothing whatsoever, with no
  // error. It now downscales and uploads it.
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !authProfile) return;

    const invalid = validateImageFile(file);
    if (invalid) {
      alert(invalid);
      return;
    }

    setIsUploadingPhoto(true);
    try {
      const dataUrl = await downscaleImageToDataUrl(file);
      const response = await apiClient.post('/users/me/photo', { photo: dataUrl });
      setProfilePhoto(response.data?.photoUrl || dataUrl);
    } catch (error: any) {
      console.error('Error updating photo:', error);
      alert(error.response?.data?.error || 'Зураг хадгалахад алдаа гарлаа.');
    } finally {
      setIsUploadingPhoto(false);
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
    <>
    <MobileNavBar
      name={profile.name}
      subtitle={profile.lineType}
      photoUrl={profile.photoUrl}
      initials={profile.name?.slice(0, 2).toUpperCase()}
      onOpen={() => setIsMobileNavOpen(true)}
      actions={
        // Sits beside the hamburger so an unread count is visible, and
        // reachable, without opening the drawer to find it.
        <button
          onClick={() => goToTab('notifications')}
          aria-label="Мэдэгдэл"
          className="relative w-11 h-11 flex items-center justify-center rounded-xl text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
        >
          <Bell size={22} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-gray-900">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      }
    />
    <MobileNavBackdrop open={isMobileNavOpen} onClose={() => setIsMobileNavOpen(false)} />

    <aside className={`${isCollapsed ? 'lg:w-20' : 'lg:w-72'} lg:h-screen bg-gray-900/95 backdrop-blur-xl lg:border-r border-gray-800 flex flex-col shadow-2xl z-50 lg:transition-all lg:duration-300 relative ${mobileDrawerClasses(isMobileNavOpen)}`}>
      <MobileNavClose onClose={() => setIsMobileNavOpen(false)} />
      <button 
        onClick={() => setIsCollapsed?.(!isCollapsed)}
        className="hidden lg:flex absolute -right-3 top-10 w-6 h-6 bg-blue-600 rounded-full items-center justify-center text-white shadow-lg z-30 hover:scale-110 transition-transform"
      >
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {/* Profile Section */}
      <div className={`p-6 border-b border-gray-800 flex items-center gap-4 bg-black/20 ${isCollapsed ? 'lg:justify-center' : ''}`}>
        <div
          className={`relative group ${isUploadingPhoto ? 'cursor-wait opacity-60' : 'cursor-pointer'}`}
          onClick={isUploadingPhoto ? undefined : handlePhotoClick}
        >
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
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              {profile.lineType && (
                <p className="text-blue-400 text-[10px] font-black uppercase tracking-wider">{profile.lineType}</p>
              )}
              {profile.employmentType && (
                <>
                  <span className="text-gray-700 text-[10px]">·</span>
                  <p className="text-purple-400 text-[10px] font-black uppercase tracking-wider">{profile.employmentType}</p>
                </>
              )}
              {profile.location && (
                <>
                  <span className="text-gray-700 text-[10px]">·</span>
                  <p className="text-green-400 text-[10px] font-black uppercase tracking-wider">{profile.location}</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Menu Items */}
      <nav className="flex-1 p-4 space-y-2 lg:space-y-3 overflow-y-auto">
        {!isCollapsed && <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 ml-2 mt-2">Үндсэн цэс</p>}
        
        <SidebarNavItem
          active={activeTab === 'schedule'}
          icon={Calendar}
          label="Ажлын хуваарь"
          collapsed={isCollapsed}
          onClick={() => goToTab('schedule')}
          layoutGroup="sidebar-active-shared"
        />

        {SHOW_VACATION_FEATURE && (
          <SidebarNavItem
            active={activeTab === 'vacation'}
            icon={Palmtree}
            label="Ээлжийн амралт"
            collapsed={isCollapsed}
            onClick={() => goToTab('vacation')}
            layoutGroup="sidebar-active-shared"
          />
        )}

        <SidebarNavItem
          active={activeTab === 'hourlyLeave'}
          icon={Clock}
          label="Чөлөө"
          collapsed={isCollapsed}
          onClick={() => goToTab('hourlyLeave')}
          layoutGroup="sidebar-active-shared"
        />

        <SidebarNavItem
          active={activeTab === 'notifications'}
          icon={Bell}
          label="Мэдэгдэл"
          badge={unreadCount}
          ringIcon
          sparkle={unreadCount > 0}
          collapsed={isCollapsed}
          onClick={() => goToTab('notifications')}
          layoutGroup="sidebar-active-shared"
        />

        <SidebarNavItem
          active={activeTab === 'training'}
          icon={BookOpen}
          label="Сургалт"
          badge={unreadTrainingCount}
          ringIcon={unreadTrainingCount > 0}
          badgeColor="bg-purple-500"
          collapsed={isCollapsed}
          onClick={() => goToTab('training')}
          layoutGroup="sidebar-active-shared"
        />

        {(role === 'admin' || role === 'superadmin') && (
          <SidebarNavItem
            active={activeTab === 'forecast'}
            icon={Sparkles}
            label="Дуудлагын Forecast"
            collapsed={isCollapsed}
            onClick={() => goToTab('forecast')}
            layoutGroup="sidebar-active-shared"
          />
        )}
      </nav>

      {/* Bottom Section */}
      <div className={`p-4 border-t border-gray-800 bg-black/10 ${isCollapsed ? 'lg:flex lg:flex-col lg:items-center lg:gap-2' : ''}`}>
        <button 
          onClick={() => { setIsMobileNavOpen(false); onChangePassword?.(); }}
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
    </>
  );
}
