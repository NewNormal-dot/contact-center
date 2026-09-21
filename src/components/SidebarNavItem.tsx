import { motion } from 'motion/react';

/**
 * A sidebar menu row, in the style the admin dashboard uses.
 *
 * The three dashboards had grown three different looks for the same thing:
 * the admin's chip-and-glow rows, the CSR's plain text rows, and the
 * superadmin's solid blue fill. This is the admin's, extracted so the other
 * two can share it rather than each approximating it.
 *
 * AdminDashboard keeps its own inline copy on purpose. It is the version
 * people are happy with, and reaching into it to change nothing risks
 * changing something.
 *
 * `layoutGroup` names the motion layoutId that animates the blue bar between
 * items. Two sidebars on one page would fight over a shared name, so each
 * caller passes its own.
 */
export function SidebarNavItem({
  active,
  icon: Icon,
  label,
  badge,
  badgeColor = 'bg-red-500',
  collapsed = false,
  onClick,
  layoutGroup,
}: {
  active: boolean;
  icon: any;
  label: string;
  badge?: number;
  /** Training counts are purple elsewhere in the app; keep that. */
  badgeColor?: string;
  collapsed?: boolean;
  onClick: () => void;
  layoutGroup: string;
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`w-full flex items-center gap-3 px-3 sm:px-4 py-3 lg:py-4 rounded-2xl transition-all relative group ${
        active
          ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20 shadow-xl shadow-blue-500/5'
          : 'text-gray-500 hover:text-gray-200 hover:bg-white/5 border border-transparent'
      } ${collapsed ? 'lg:justify-center' : ''}`}
    >
      <div
        className={`p-2 rounded-xl transition-colors shrink-0 ${
          active
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/40'
            : 'bg-gray-800/50 group-hover:bg-gray-800'
        }`}
      >
        <Icon size={18} strokeWidth={active ? 3 : 2} />
      </div>

      {!collapsed && (
        <span className="text-sm font-black uppercase tracking-widest whitespace-nowrap">
          {label}
        </span>
      )}

      {Boolean(badge) && (
        <span
          className={`flex items-center justify-center rounded-full ${badgeColor} text-white text-[10px] font-black shadow-lg ${
            collapsed
              ? 'absolute -top-1 -right-1 h-5 min-w-[20px] px-1'
              : 'ml-auto h-5 min-w-[20px] px-1.5'
          }`}
        >
          {badge! > 99 ? '99+' : badge}
        </span>
      )}

      {active && (
        <motion.div
          layoutId={layoutGroup}
          className="absolute -left-1 w-1.5 h-8 bg-blue-500 rounded-r-full shadow-[0_0_15px_#3b82f6]"
        />
      )}
    </button>
  );
}
