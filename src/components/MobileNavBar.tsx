import { useEffect } from 'react';
import { Menu, X } from 'lucide-react';

/**
 * The phone-sized top bar, and the classes that turn a desktop sidebar into a
 * drawer behind it.
 *
 * All three dashboards used to render their sidebar as an ordinary block in
 * the page flow, which on a phone meant navigation occupied the first screen
 * and the content people came for started below it. A horizontal tab strip
 * was tried first and was not good enough: seven tabs do not fit across 360px,
 * so the ones that matter scroll off the right edge with nothing to say they
 * are there.
 *
 * This is the pattern people already know from every mobile site: a slim bar
 * with a hamburger, and a drawer that slides in over the content. The sidebar
 * markup does not change - it is the same element, positioned differently
 * below lg and left exactly as it was above it.
 */

/** Classes that make a sidebar a slide-in drawer below lg, and leave it alone above. */
export function mobileDrawerClasses(open: boolean) {
  return [
    'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-[100]',
    'max-lg:w-[85vw] max-lg:max-w-[320px] max-lg:shadow-2xl',
    'max-lg:transition-transform max-lg:duration-300 max-lg:ease-out',
    open ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
  ].join(' ');
}

export function MobileNavBackdrop({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Two things people expect from a drawer and notice the absence of: the page
  // behind it does not scroll under your finger, and Escape closes it.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      // Restore rather than clear: something else may have set it.
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  return (
    <div
      onClick={onClose}
      aria-hidden={!open}
      className={`lg:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-[95] transition-opacity duration-300 ${
        open ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    />
  );
}

export function MobileNavBar({
  name,
  subtitle,
  photoUrl,
  initials,
  onOpen,
}: {
  name: string;
  subtitle?: string;
  photoUrl?: string;
  initials?: string;
  onOpen: () => void;
}) {
  return (
    <div className="lg:hidden sticky top-0 z-[90] flex items-center gap-3 px-4 h-16 bg-gray-900/95 backdrop-blur-xl border-b border-gray-800">
      <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-blue-500/50 shrink-0 bg-gray-800 flex items-center justify-center">
        {photoUrl ? (
          <img src={photoUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="text-xs font-black text-blue-400">{initials || '—'}</span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-white font-bold text-sm truncate leading-tight">{name}</p>
        {subtitle && (
          <p className="text-blue-400 text-[10px] font-black uppercase tracking-wider truncate">
            {subtitle}
          </p>
        )}
      </div>

      {/* 44px square: the smallest target that is reliably tappable. */}
      <button
        onClick={onOpen}
        aria-label="Цэс нээх"
        className="w-11 h-11 -mr-2 shrink-0 flex items-center justify-center rounded-xl text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
      >
        <Menu size={24} />
      </button>
    </div>
  );
}

/** The close button that sits inside the drawer itself. */
export function MobileNavClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      aria-label="Цэс хаах"
      className="lg:hidden absolute top-3 right-3 z-10 w-10 h-10 flex items-center justify-center rounded-xl text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
    >
      <X size={22} />
    </button>
  );
}
