import { useRef } from 'react';
import { 
  Home, 
  Calendar, 
  PlusCircle, 
  Palmtree, 
  Settings, 
  LogOut, 
  Bell, 
  Camera, 
  BookOpen, 
  Sparkles, 
  ChevronRight, 
  ChevronLeft, 
  Clock, 
  Users,
  ShieldCheck,
  ArrowLeftRight,
  ListFilter
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface SidebarProps {
  activeTab?: string;
  setActiveTab?: (tab: string) => void;
  unreadCount?: number;
  unreadTrainingCount?: number;
  onSettingsClick?: () => void;
  isCollapsed?: boolean;
  setIsCollapsed?: (collapsed: boolean) => void;
}

export default function Sidebar({ 
  activeTab = 'schedule', 
  setActiveTab, 
  unreadCount = 0, 
  unreadTrainingCount = 0,
  onSettingsClick,
  isCollapsed = false,
  setIsCollapsed,
}: SidebarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const role = user?.role || 'csr';
  const profile = {
    id: user?.id || '',
    name: user?.name || 'Уншиж байна...',
    email: user?.email || '',
    photoUrl: user?.photoUrl || `https://ui-avatars.com/api/?name=${user?.name || 'User'}&background=2563eb&color=fff&size=128`,
    employmentType: user?.employmentType || ''
  };

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const NavItem = ({ id, icon: Icon, label, badgeCount, colorClass = "" }: any) => (
    <button 
      onClick={() => setActiveTab?.(id)}
      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group ${
        activeTab === id 
          ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-lg shadow-blue-500/5' 
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50 hover:text-gray-900 dark:hover:text-white'
      } ${isCollapsed ? 'justify-center' : ''}`}
      title={isCollapsed ? label : ''}
    >
      <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
        <Icon size={isCollapsed ? 20 : 22} className={activeTab === id ? "text-blue-600 dark:text-blue-400" : "group-hover:text-gray-900 dark:group-hover:text-white transition-colors"} />
        {!isCollapsed && <span className="text-sm font-bold tracking-wide">{label}</span>}
      </div>
      {!isCollapsed && badgeCount > 0 && (
        <span className={`px-1.5 py-0.5 min-w-[18px] text-[9px] font-black rounded-full text-center text-white ${colorClass || 'bg-red-500'} border border-black/20`}>
           {badgeCount}
        </span>
      )}
    </button>
  );

  return (
    <aside className={`${isCollapsed ? 'w-20' : 'w-72'} bg-white dark:bg-[#0d0d0d] border-r border-black/5 dark:border-white/5 flex flex-col h-screen transition-all duration-300 relative shadow-2xl`}>
      <button 
        onClick={() => setIsCollapsed?.(!isCollapsed)}
        className="absolute -right-3 top-10 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-xl z-50 hover:scale-110 active:scale-95 transition-all border border-white/20"
      >
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {/* Profile Section */}
      <div className={`p-6 border-b border-black/5 dark:border-white/5 flex items-center gap-4 bg-gradient-to-b from-gray-50 dark:from-white/[0.02] to-transparent ${isCollapsed ? 'justify-center' : ''}`}>
        <div className="relative group cursor-pointer" onClick={handlePhotoClick}>
          <div className={`relative overflow-hidden rounded-2xl border-2 border-black/5 dark:border-white/5 group-hover:border-blue-500/50 transition-all ${isCollapsed ? 'w-10 h-10' : 'w-12 h-12'}`}>
            <img src={profile.photoUrl} alt="Profile" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
               <Camera size={16} className="text-white" />
            </div>
          </div>
          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-white dark:border-[#0d0d0d] rounded-full shadow-lg" />
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" />
        </div>
        {!isCollapsed && (
          <div className="flex-1 min-w-0">
            <h2 className="text-gray-900 dark:text-white font-black text-sm truncate uppercase tracking-tight">{profile.name}</h2>
            <p className="text-blue-600 dark:text-blue-500 text-[10px] font-black uppercase tracking-widest">{role}</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto custom-scrollbar">
        {!isCollapsed && <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-4 ml-2">Үндсэн үйлдэл</p>}
        
        {role === 'csr' && (
          <>
            <NavItem id="schedule" icon={Calendar} label="Хуваарь захиалга" />
            <NavItem id="mySchedule" icon={Clock} label="Миний хуваарь" />
          </>
        )}

        {(role === 'admin' || role === 'superadmin') && (
          <>
            <NavItem id="users" icon={Users} label="Хэрэглэгчид" />
            <NavItem id="schedule" icon={Calendar} label="Слот удирдах" />
          </>
        )}

        {role === 'admin' && (
           <>
              <NavItem id="hourlyLeave" icon={Clock} label="Чөлөө/Амралт" />
              <NavItem id="trades" icon={ArrowLeftRight} label="Арилжаа" />
           </>
        )}

        <NavItem id="notifications" icon={Bell} label="Мэдэгдэл" badgeCount={unreadCount} />
        <NavItem id="training" icon={BookOpen} label="Сургалт" badgeCount={unreadTrainingCount} colorClass="bg-purple-500" />
        <NavItem id="forecast" icon={Sparkles} label="Forecast" />

        {role === 'superadmin' && (
          <NavItem id="audit" icon={ShieldCheck} label="Аудит лог" />
        )}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-black/5 dark:border-white/5 space-y-2">
        <button 
          onClick={onSettingsClick}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
            activeTab === 'settings' 
              ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-lg shadow-blue-500/5' 
              : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5'
          } ${isCollapsed ? 'justify-center' : ''}`}
        >
          <Settings size={20} className={activeTab === 'settings' ? "text-blue-600 dark:text-blue-400" : ""} />
          {!isCollapsed && <span className="text-sm font-bold">Тохиргоо</span>}
        </button>
        <button 
          onClick={handleLogout}
          className={`w-full flex items-center gap-3 px-4 py-3 text-red-500/70 hover:text-red-400 hover:bg-red-500/5 rounded-xl transition-all ${isCollapsed ? 'justify-center' : ''}`}
        >
          <LogOut size={20} />
          {!isCollapsed && <span className="text-sm font-bold">Гарах</span>}
        </button>
      </div>
    </aside>
  );
}
