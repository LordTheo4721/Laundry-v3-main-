import React from 'react';
import { LayoutDashboard, Settings, ArrowRight } from 'lucide-react';
import { exitAdminPortal } from '../../utils/adminAuth';

/** The only views the admin chrome itself needs to navigate to. */
export type AdminNavView = 'home' | 'admin-settings';

interface AdminNavbarProps {
  setView: (v: AdminNavView) => void;
}

/**
 * The black "ADMIN PORTAL" header. It is the shared chrome of the control
 * panel: the portal identity sits on the left and the Settings / Exit Admin
 * actions on the right.
 */
const AdminNavbar = ({ setView }: AdminNavbarProps) => {
  const [showExitConfirm, setShowExitConfirm] = React.useState(false);

  return (
  <>
  <nav
    className="fixed top-0 left-0 right-0 h-16 sm:h-20 bg-zinc-900 text-white z-[9999] flex items-center px-4 sm:px-8 shadow-2xl"
    aria-label="Admin portal"
  >
    <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
      <div className="flex items-center gap-2 sm:gap-4">
        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-500 rounded-xl flex items-center justify-center">
          <LayoutDashboard className="w-4 h-4 sm:w-6 sm:h-6 text-white" aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-black text-sm sm:text-lg tracking-tighter leading-none">ADMIN PORTAL</h2>
          <p className="text-[8px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-widest hidden sm:block">
            Happy Wash Admin
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 sm:gap-6">
        <button
          onClick={() => setView('admin-settings')}
          className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors flex items-center gap-1 sm:gap-2"
          aria-label="Admin settings"
        >
          <Settings className="w-3 h-3 sm:w-4 sm:h-4" aria-hidden="true" />
          <span className="hidden sm:inline">Settings</span>
        </button>
        <button
          onClick={() => setShowExitConfirm(true)}
          className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors flex items-center gap-1 sm:gap-2"
        >
          <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4 rotate-180" aria-hidden="true" />
          <span className="hidden sm:inline">Exit Admin</span>
        </button>
      </div>
    </div>
   </nav>

   {showExitConfirm && (
     <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
       <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
         <p className="text-lg font-bold text-zinc-900 mb-6">Are you sure you want to exit?</p>
         <div className="flex gap-3 justify-end">
           <button
             onClick={() => setShowExitConfirm(false)}
             className="px-4 py-2 rounded-xl bg-zinc-100 text-zinc-900 font-bold hover:bg-zinc-200"
           >
             No
           </button>
           <button
             onClick={async () => {
               setShowExitConfirm(false);
               await exitAdminPortal(() => setView('home'));
             }}
             className="px-4 py-2 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700"
           >
             Yes
           </button>
         </div>
       </div>
     </div>
   )}

   </>
 );

};

 export default AdminNavbar;
