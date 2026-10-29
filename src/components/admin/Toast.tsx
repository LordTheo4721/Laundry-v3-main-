import React, { useEffect, useCallback, useState, createContext, useContext, ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export interface ToastItem {
  id: number;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
}

interface ToastProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

const TOAST_AUTO_DISMISS_MS = 5000;

const ToastContext = createContext<{
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  dismissToast: (id: number) => void;
} | null>(null);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = Date.now();
    setToasts(prev => [...prev, { ...toast, id }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, dismissToast }}>
      {children}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export const Toast: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];
    toasts.forEach((toast) => {
      const timer = setTimeout(() => {
        onDismiss(toast.id);
      }, toast.duration ?? TOAST_AUTO_DISMISS_MS);
      timers.push(timer);
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, [toasts, onDismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-6 right-6 z-[99999] flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border shadow-lg p-4 animate-in slide-in-from-top-2 duration-200"
          style={{
            backgroundColor: toast.type === 'success' ? '#ecfdf5' : toast.type === 'error' ? '#fef2f2' : toast.type === 'warning' ? '#fffbeb' : '#eff6ff',
            borderColor: toast.type === 'success' ? '#bbf7d0' : toast.type === 'error' ? '#fecaca' : toast.type === 'warning' ? '#fde68a' : '#bfdbfe',
          }}
          role="alert"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="shrink-0 mt-0.5">
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden="true" />
            ) : toast.type === 'error' ? (
              <AlertCircle className="w-5 h-5 text-rose-600" aria-hidden="true" />
            ) : toast.type === 'warning' ? (
              <AlertCircle className="w-5 h-5 text-amber-600" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-blue-600" aria-hidden="true" />
            )}
          </div>
          <div className="text-sm font-medium">
            {toast.type === 'success' ? (
              <span className="text-emerald-800">{toast.message}</span>
            ) : toast.type === 'error' ? (
              <span className="text-rose-800">{toast.message}</span>
            ) : toast.type === 'warning' ? (
              <span className="text-amber-800">{toast.message}</span>
            ) : (
              <span className="text-blue-800">{toast.message}</span>
            )}
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 mt-0.5 rounded-md p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
            aria-label="Dismiss toast"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
};