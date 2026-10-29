import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User, Phone, Mail, Calendar, Clock, Package, Truck, MapPin,
  CheckCircle2, ChevronRight, ChevronLeft, Plus, X, Loader2,
  ClipboardList, Sparkles,
} from 'lucide-react';
import { useToast } from './admin/Toast';
import { Receipt, printReceipt } from './Receipt';
import { calculatePriceWithFallback, FALLBACK_PRICING } from '../utils/pricing';
import { getDeliveryFee } from '../utils/sharedPricing';
import type { Transaction } from '../types';

import type { PricingConfig } from '../utils/pricing';

const LAUNDRY_SERVICE = 'Wash & Fold (Clothes)';
const LAUNDRY_SERVICES = [
  'Wash & Fold (Clothes)',
  'Comforter (Small)',
  'Comforter (Medium)',
  'Comforter (Large)',
  'Bedsheet/Curtain/Towel',
  'Hand Wash Service',
];

const STORAGE_KEY = 'happywash_booking_state';

interface BookingItem {
  service_type: string;
  quantity: number;
}

interface FormData {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  special_instructions: string;
  appointment_date: string;
  appointment_time: string;
  delivery_method: 'pickup' | 'delivery';
  address: string;
  delivery_zone_id: number | null;
}

const initialFormData: FormData = {
  customer_name: '',
  customer_phone: '',
  customer_email: '',
  special_instructions: '',
  appointment_date: '',
  appointment_time: '',
  delivery_method: 'pickup',
  address: '',
  delivery_zone_id: null,
};

const STEPS = [
  { id: 1, label: 'Your Details' },
  { id: 2, label: 'Laundry Quantity' },
  { id: 3, label: 'Schedule & Delivery' },
  { id: 4, label: 'Review & Confirm' },
];

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidPhone = (phone: string): boolean => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('9')) return true;
  if (digits.length === 11 && digits.startsWith('09')) return true;
  if (digits.length === 12 && digits.startsWith('639')) return true;
  return false;
};
const isValidAppointmentDate = (dateStr: string): boolean => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  return !isNaN(d.getTime()) && d >= today;
};

const UserBooking = () => {
  const { addToast } = useToast();

  const [step, setStep] = useState<number>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return typeof parsed.step === 'number' ? parsed.step : 1;
      }
    } catch {}
    return 1;
  });

  const [formData, setFormData] = useState<FormData>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.formData) return { ...initialFormData, ...parsed.formData };
      }
    } catch {}
    return initialFormData;
  });

  const [items, setItems] = useState<BookingItem[]>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.items) && parsed.items.length > 0) return parsed.items;
      }
    } catch {}
    return [{ service_type: LAUNDRY_SERVICE, quantity: 1 }];
  });

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [loading] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [dynamicPricing, setDynamicPricing] = useState<Record<string, any>>({});

  // Fetch dynamic pricing
  useEffect(() => {
    fetch('/api/pricing/public')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) {
          const map: Record<string, any> = {};
          data.data.forEach((p: any) => { map[p.service_type] = p; });
          setDynamicPricing(map);
        }
      })
      .catch(() => {});
  }, []);
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const [bookedTransaction, setBookedTransaction] = useState<Transaction | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ step, formData, items }));
    } catch {}
  }, [step, formData, items]);

  // Prevent background scroll when confirmation modal is open
  useEffect(() => {
    if (showConfirmation) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [showConfirmation]);

  const clearPersisted = () => {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  };

  const updateFormData = (patch: Partial<FormData>) => {
    setFormData(prev => ({ ...prev, ...patch }));
  };



  const addItem = () => {
    setItems(prev => [...prev, { service_type: LAUNDRY_SERVICE, quantity: 1 }]);
  };

  const removeItem = (index: number) => {
    setItems(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const updateItemQty = (index: number, value: string) => {
    const qty = Math.max(1, parseInt(value) || 1);
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, quantity: qty } : it)));
  };

  const updateItemService = (index: number, value: string) => {
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, service_type: value } : it)));
  };

  const totalQuantity = items.reduce((s, it) => s + (it.quantity || 0), 0);

  const mergedPricing = () => ({ ...FALLBACK_PRICING, ...dynamicPricing });

  const calculatePriceWithDynamic = (serviceType: string, quantity: number): number => {
    const pricingMap = new Map<string, PricingConfig>(
      Object.entries(mergedPricing()) as [string, PricingConfig][]
    );
    return calculatePriceWithFallback(serviceType, quantity, pricingMap);
  };

  const computeGrandTotal = () => {
    const pricingMap = new Map<string, PricingConfig>(
      Object.entries(mergedPricing()) as [string, PricingConfig][]
    );
    let serviceTotal = 0;
    const byService: Record<string, number> = {};
    items.forEach(it => { byService[it.service_type] = (byService[it.service_type] || 0) + it.quantity; });
    Object.keys(byService).forEach(st => {
      serviceTotal += calculatePriceWithFallback(st, byService[st], pricingMap);
    });
    const firstService = items.length > 0 ? items[0].service_type : LAUNDRY_SERVICE;
    const cfg = pricingMap.get(firstService) || FALLBACK_PRICING[firstService];
    const deliveryFee = formData.delivery_method === 'delivery' ? getDeliveryFee(cfg) : 0;
    return serviceTotal + deliveryFee;
  };

  const grandTotal = computeGrandTotal();

  const validateStep = (s: number): boolean => {
    const errors: Record<string, string> = {};
    if (s === 1) {
      if (!formData.customer_name.trim()) errors.customer_name = 'Please enter your name';
      if (!formData.customer_phone.trim()) errors.customer_phone = 'Please enter your phone number';
      else if (!isValidPhone(formData.customer_phone)) errors.customer_phone = 'Please enter a valid Philippine phone number (e.g., 9123456789)';
      if (formData.customer_email.trim() && !isValidEmail(formData.customer_email)) errors.customer_email = 'Please enter a valid email address';
    } else if (s === 2) {
      if (items.length === 0) errors.items = 'Add at least one laundry order';
      items.forEach((it, i) => {
        if (!it.service_type) errors[`item_${i}`] = 'Please select a laundry service';
        if (!it.quantity || it.quantity < 1) errors[`item_${i}`] = 'Quantity must be at least 1';
      });
    } else if (s === 3) {
      if (!formData.appointment_date) errors.appointment_date = 'Please select an appointment date';
      else if (!isValidAppointmentDate(formData.appointment_date)) errors.appointment_date = 'Appointment date cannot be in the past';
      if (!formData.appointment_time) errors.appointment_time = 'Please select an appointment time';
      if (formData.delivery_method === 'delivery' && !formData.address.trim()) errors.address = 'Please enter your address for delivery';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    setStep(s => Math.min(s + 1, STEPS.length));
  };

  const goBack = () => {
    setFormErrors({});
    setStep(s => Math.max(s - 1, 1));
  };

  const goToStep = (s: number) => {
    if (s < step) {
      setFormErrors({});
      setStep(s);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep(STEPS.length)) return;
    setShowConfirmation(true);
  };

  const handleConfirmOrder = async () => {
    setConfirmationLoading(true);
    try {
      const body = {
        ...formData,
        service_type: LAUNDRY_SERVICE,
        items: items.map(it => ({
          service_type: it.service_type,
          quantity: it.quantity,
        })),
      };

      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success && data.data) {
        setBookedTransaction(data.data);
        setShowConfirmation(false);
        clearPersisted();
        window.dispatchEvent(new CustomEvent('order-created'));
      } else {
        addToast({ type: 'error', message: data.error || 'Failed to create booking. Please try again.' });
      }
    } catch (error) {
      console.error(error);
      addToast({ type: 'error', message: 'An error occurred. Please try again.' });
    } finally {
      setConfirmationLoading(false);
    }
  };

  const resetForm = () => {
    setFormData(initialFormData);
    setItems([{ service_type: LAUNDRY_SERVICE, quantity: 1 }]);
    setStep(1);
    setFormErrors({});
    setBookedTransaction(null);
    setShowConfirmation(false);
    clearPersisted();
  };

  if (bookedTransaction) {
    return (
      <div className="max-w-2xl mx-auto mt-8 sm:mt-12 p-6 sm:p-10 bg-white rounded-[32px] sm:rounded-[40px] shadow-2xl border-4 sm:border-8 border-zinc-50">
        <div id="booking-receipt" style={{ display: 'none' }}>
          <Receipt transaction={{ ...bookedTransaction, total_price: bookedTransaction.total_price }} type="booking" />
        </div>
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="text-emerald-600 w-10 h-10" />
          </div>
          <h2 className="text-3xl font-black text-zinc-900 mb-2 tracking-tighter">BOOKING SUBMITTED!</h2>
          <p className="text-zinc-500 font-medium">Your laundry is in good hands.</p>
        </div>

        <div className="bg-zinc-50 rounded-3xl p-8 mb-8 border-2 border-zinc-100">
          <div className="flex justify-between items-center mb-6 pb-6 border-b border-zinc-200">
            <div>
              <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Reference ID</p>
              <p className="text-2xl font-mono font-black text-blue-600">{bookedTransaction.reference_number}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Date</p>
              <p className="font-bold text-zinc-900">{new Date(bookedTransaction.created_at).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:gap-8 mb-8">
            <div>
              <p className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-1">Customer</p>
              <p className="font-bold text-zinc-900">{bookedTransaction.customer_name}</p>
              <p className="text-sm text-zinc-500">{bookedTransaction.customer_phone}</p>
            </div>
            <div>
              <p className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-1">Appointment</p>
              <p className="font-bold text-zinc-900">{bookedTransaction.appointment_date}</p>
              <p className="text-sm text-zinc-500">{bookedTransaction.appointment_time}</p>
            </div>
          </div>

          <div className="space-y-4">
            {bookedTransaction.items && bookedTransaction.items.length > 0 && (
              <div className="space-y-2">
                {bookedTransaction.items.map((it, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <p className="text-zinc-500 font-medium">{it.service_type} × {it.quantity}</p>
                    <p className="font-bold text-zinc-900">Qty {it.quantity}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between items-center">
              <p className="text-zinc-500 font-medium">Total quantity: {bookedTransaction.quantity} load(s)</p>
              <p className="font-bold text-amber-600 text-sm">Pricing pending admin review</p>
            </div>
            {bookedTransaction.special_instructions && (
              <div className="bg-white p-4 rounded-2xl border border-zinc-100 italic text-sm text-zinc-500">
                " {bookedTransaction.special_instructions} "
              </div>
            )}
            <div className="pt-4 border-t border-zinc-200 flex justify-between items-center">
              <p className="font-black text-zinc-900 uppercase tracking-widest text-sm">Total Amount</p>
              <p className="text-xl font-black text-amber-600">Pending admin review</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 no-print">
          <button
            onClick={() => { setTimeout(() => printReceipt('booking-receipt'), 100); }}
            className="flex-1 py-5 bg-zinc-100 text-zinc-900 rounded-3xl font-black text-lg hover:bg-zinc-200 transition-all flex items-center justify-center gap-2"
          >
            <ClipboardList className="w-5 h-5" /> Print Receipt
          </button>
          <button
            onClick={resetForm}
            className="flex-1 py-5 bg-blue-500 text-white rounded-3xl font-black text-lg hover:bg-blue-600 transition-all shadow-xl shadow-blue-100"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="max-w-4xl mx-auto py-12 sm:py-20 px-4">
        <div className="text-center mb-8 sm:mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-full text-xs font-black uppercase tracking-widest mb-6">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" /> Book Now
          </div>
          <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold text-zinc-900 tracking-tighter mb-4 sm:mb-6">Book a Slot</h1>
          <p className="text-zinc-500 text-lg font-medium">Tell us when you're coming, we'll handle the rest.</p>
        </div>

        <div className="mb-8">
          <ol className="flex items-center justify-between gap-2" aria-label="Booking progress">
            {STEPS.map((s) => {
              const completed = step > s.id;
              const active = step === s.id;
              return (
                <li key={s.id} className="flex-1 flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() => goToStep(s.id)}
                    disabled={s.id > step}
                    aria-current={active ? 'step' : undefined}
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm border-4 transition-all ${
                      active ? 'bg-blue-500 text-white border-blue-500' :
                      completed ? 'bg-emerald-500 text-white border-emerald-500 cursor-pointer' :
                      'bg-zinc-100 text-zinc-400 border-zinc-200'
                    }`}
                  >
                    {completed ? <CheckCircle2 className="w-5 h-5" /> : s.id}
                  </button>
                  <span className={`text-[10px] sm:text-xs font-black uppercase tracking-widest text-center ${active ? 'text-blue-600' : completed ? 'text-emerald-600' : 'text-zinc-400'}`}>
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="mt-4 h-1 bg-zinc-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }} />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8 bg-white p-6 sm:p-10 rounded-[32px] sm:rounded-[40px] shadow-2xl border-4 sm:border-8 border-zinc-50">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                <h2 className="text-xl font-black text-zinc-900">Your Details</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2"><User className="w-4 h-4" /> Your Name</label>
                    <input
                      type="text"
                      className={`w-full p-5 bg-zinc-50 border-4 rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg ${formErrors.customer_name ? 'border-rose-500' : 'border-transparent'}`}
                      placeholder="Bubbles McGee"
                      value={formData.customer_name}
                      onChange={e => { updateFormData({ customer_name: e.target.value }); if (formErrors.customer_name) setFormErrors(p => ({ ...p, customer_name: '' })); }}
                      aria-label="Customer name"
                      aria-invalid={!!formErrors.customer_name}
                    />
                    {formErrors.customer_name && <p className="text-[10px] text-rose-600 font-bold mt-1">{formErrors.customer_name}</p>}
                  </div>
                  <div className="space-y-3">
                    <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2"><Phone className="w-4 h-4" /> Phone</label>
                    <input
                      type="tel"
                      maxLength={12}
                      className={`w-full p-5 bg-zinc-50 border-4 rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg ${formErrors.customer_phone ? 'border-rose-500' : 'border-transparent'}`}
                      placeholder="9123456789 or 09123456789"
                      value={formData.customer_phone}
                      onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 12); updateFormData({ customer_phone: v }); if (formErrors.customer_phone) setFormErrors(p => ({ ...p, customer_phone: '' })); }}
                      inputMode="numeric"
                      aria-label="Customer phone number"
                      aria-invalid={!!formErrors.customer_phone}
                    />
                    {formErrors.customer_phone && <p className="text-[10px] text-rose-600 font-bold mt-1">{formErrors.customer_phone}</p>}
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2"><Mail className="w-4 h-4" /> Email (Optional)</label>
                  <input
                    type="email"
                    className={`w-full p-5 bg-zinc-50 border-4 rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg ${formErrors.customer_email ? 'border-rose-500' : 'border-transparent'}`}
                    placeholder="you@example.com"
                    value={formData.customer_email}
                    onChange={e => { updateFormData({ customer_email: e.target.value }); if (formErrors.customer_email) setFormErrors(p => ({ ...p, customer_email: '' })); }}
                    aria-label="Customer email address"
                    aria-invalid={!!formErrors.customer_email}
                  />
                   {formErrors.customer_email && <p className="text-[10px] text-rose-600 font-bold mt-1">{formErrors.customer_email}</p>}
                   {formData.customer_email.trim() && isValidEmail(formData.customer_email) && (
                     <div className="mt-3 space-y-2">
                       {!emailVerified ? (
                         <>
                           <button
                             type="button"
                             disabled={sendingCode}
                             onClick={async () => {
                               setSendingCode(true);
                               try {
                                 const res = await fetch('/api/verify-email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: formData.customer_email }) });
                                 const data = await res.json();
                                 if (data.success) addToast({ type: 'success', message: 'Verification code sent to your email' });
                                 else addToast({ type: 'error', message: data.error || 'Failed to send code' });
                               } catch { addToast({ type: 'error', message: 'Failed to send code' }); }
                               finally { setSendingCode(false); }
                             }}
                             className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50"
                           >
                             {sendingCode ? 'Sending...' : 'Send verification code'}
                           </button>
                           <div className="flex gap-2">
                             <input
                               type="text"
                               maxLength={6}
                               value={emailCode}
                               onChange={e => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                               placeholder="Enter 6-digit code"
                               className="flex-1 p-3 bg-zinc-50 border-2 border-transparent rounded-2xl font-bold"
                             />
                             <button
                               type="button"
                               disabled={verifyingCode || emailCode.length !== 6}
                               onClick={async () => {
                                 setVerifyingCode(true);
                                 try {
                                   const res = await fetch('/api/verify-email/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: formData.customer_email, code: emailCode }) });
                                   const data = await res.json();
                                   if (data.success) { setEmailVerified(true); addToast({ type: 'success', message: 'Email verified' }); }
                                   else addToast({ type: 'error', message: data.error || 'Invalid code' });
                                 } catch { addToast({ type: 'error', message: 'Verification failed' }); }
                                 finally { setVerifyingCode(false); }
                               }}
                               className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm disabled:opacity-50"
                             >
                               {verifyingCode ? 'Verifying...' : 'Verify'}
                             </button>
                           </div>
                         </>
                       ) : (
                         <p className="text-sm font-bold text-emerald-600">✓ Email verified</p>
                       )}
                     </div>
                   )}
                 </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                <h2 className="text-xl font-black text-zinc-900">Laundry Quantity</h2>
                <p className="text-sm text-zinc-500">Choose how many laundry loads/orders. You can add multiple laundry orders in one booking.</p>
                <div className="space-y-4">
                  {items.map((item, index) => (
                    <div key={index} className="bg-zinc-50 p-4 rounded-2xl border-2 border-zinc-200 space-y-3">
                      <div className="flex justify-between items-center">
                        <h4 className="text-sm font-black text-zinc-900">Laundry Order {index + 1}</h4>
                        {items.length > 1 && (
                          <button type="button" onClick={() => removeItem(index)} className="text-rose-500 hover:text-rose-600 text-sm font-bold flex items-center gap-1">
                            <X className="w-4 h-4" /> Remove
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] font-black text-zinc-400 uppercase">Laundry Service</label>
                          <select
                            value={item.service_type}
                            onChange={e => updateItemService(index, e.target.value)}
                            className="w-full p-3 bg-white border-2 border-zinc-200 rounded-xl font-bold text-sm"
                            aria-label={`Service for laundry order ${index + 1}`}
                          >
                            {LAUNDRY_SERVICES.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-black text-zinc-400 uppercase">Quantity (loads)</label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={item.quantity}
                            onChange={e => updateItemQty(index, e.target.value)}
                            className={`w-full p-3 bg-white border-2 rounded-xl font-bold text-sm ${formErrors[`item_${index}`] ? 'border-rose-500' : 'border-zinc-200'}`}
                            aria-label={`Quantity for laundry order ${index + 1}`}
                          />
                          {formErrors[`item_${index}`] && <p className="text-[10px] text-rose-600 font-bold">{formErrors[`item_${index}`]}</p>}
                        </div>
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-zinc-200">
                        <p className="text-[10px] font-black text-zinc-400 uppercase">Estimated Price</p>
                        <p className="font-black text-blue-600">₱{calculatePriceWithDynamic(item.service_type, item.quantity).toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                  {formErrors.items && <p className="text-[10px] text-rose-600 font-bold">{formErrors.items}</p>}
                  <button
                    type="button"
                    onClick={addItem}
                    className="w-full py-3 bg-blue-50 text-blue-600 rounded-2xl font-black text-sm hover:bg-blue-100 transition-colors flex items-center justify-center gap-2 border-2 border-dashed border-blue-200"
                  >
                    <Plus className="w-4 h-4" /> Add Another Laundry Order
                  </button>
                </div>
                <div className="bg-amber-50 p-4 rounded-2xl border-2 border-amber-100">
                  <p className="text-sm text-amber-700 font-medium">
                    Total laundry quantity: <span className="font-black">{totalQuantity} load(s)</span>. Estimated total: <span className="font-black">₱{grandTotal.toFixed(2)}</span> (final pricing pending admin review).
                  </p>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                <h2 className="text-xl font-black text-zinc-900">Schedule & Delivery</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2"><Calendar className="w-4 h-4" /> Date</label>
                    <input
                      type="date"
                      className={`w-full p-5 bg-zinc-50 border-4 rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg ${formErrors.appointment_date ? 'border-rose-500' : 'border-transparent'}`}
                      value={formData.appointment_date}
                      onChange={e => { updateFormData({ appointment_date: e.target.value }); if (formErrors.appointment_date) setFormErrors(p => ({ ...p, appointment_date: '' })); }}
                      aria-label="Appointment date"
                      aria-invalid={!!formErrors.appointment_date}
                    />
                    {formErrors.appointment_date && <p className="text-[10px] text-rose-600 font-bold mt-1">{formErrors.appointment_date}</p>}
                  </div>
                  <div className="space-y-3">
                    <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2"><Clock className="w-4 h-4" /> Time</label>
                    <input
                      type="time"
                      className={`w-full p-5 bg-zinc-50 border-4 rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg ${formErrors.appointment_time ? 'border-rose-500' : 'border-transparent'}`}
                      value={formData.appointment_time}
                      onChange={e => { updateFormData({ appointment_time: e.target.value }); if (formErrors.appointment_time) setFormErrors(p => ({ ...p, appointment_time: '' })); }}
                      aria-label="Appointment time"
                      aria-invalid={!!formErrors.appointment_time}
                    />
                    {formErrors.appointment_time && <p className="text-[10px] text-rose-600 font-bold mt-1">{formErrors.appointment_time}</p>}
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">How do we get it?</label>
                  <div className="grid grid-cols-2 gap-6">
                    <button
                      type="button"
                      onClick={() => updateFormData({ delivery_method: 'pickup' })}
                      className={`p-6 rounded-[32px] border-4 flex flex-col items-center gap-3 transition-all ${formData.delivery_method === 'pickup' ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-zinc-50 bg-zinc-50 text-zinc-400 hover:border-zinc-100'}`}
                    >
                      <Truck className="w-8 h-8" />
                      <span className="font-black uppercase tracking-widest text-sm">Drop-off</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateFormData({ delivery_method: 'delivery' })}
                      className={`p-6 rounded-[32px] border-4 flex flex-col items-center gap-3 transition-all ${formData.delivery_method === 'delivery' ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-zinc-50 bg-zinc-50 text-zinc-400 hover:border-zinc-100'}`}
                    >
                      <Package className="w-8 h-8" />
                      <span className="font-black uppercase tracking-widest text-sm">Pick-up</span>
                    </button>
                  </div>
                </div>

                 {formData.delivery_method === 'delivery' && (
                   <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3">


                      <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2"><MapPin className="w-4 h-4" /> Where are you?</label>
                      <textarea
                        className={`w-full p-5 bg-zinc-50 border-4 rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg ${formErrors.address ? 'border-rose-500' : 'border-transparent'}`}
                        placeholder="123 Bubble Lane..."
                        rows={3}
                        value={formData.address}
                        onChange={e => { updateFormData({ address: e.target.value }); if (formErrors.address) setFormErrors(p => ({ ...p, address: '' })); }}
                        aria-label="Delivery address"
                        aria-invalid={!!formErrors.address}
                      />
                      {formErrors.address && <p className="text-[10px] text-rose-600 font-bold mt-1">{formErrors.address}</p>}
                  </motion.div>
                )}

                <div className="space-y-3">
                  <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2"><Sparkles className="w-4 h-4" /> Special Instructions</label>
                  <textarea
                    className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                    placeholder="Any special care needed? (e.g., use extra softener, delicate items)"
                    rows={2}
                    value={formData.special_instructions}
                    onChange={e => updateFormData({ special_instructions: e.target.value })}
                  />
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                <h2 className="text-xl font-black text-zinc-900">Review & Confirm</h2>

                <div className="bg-zinc-50 rounded-2xl p-4 sm:p-5">
                  <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2"><User className="w-4 h-4" /> Customer Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                    <div><p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Name</p><p className="font-bold text-zinc-900">{formData.customer_name}</p></div>
                    <div><p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Phone</p><p className="font-bold text-zinc-900">{formData.customer_phone}</p></div>
                    <div><p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Email</p><p className="font-bold text-zinc-900 break-words">{formData.customer_email || 'Not provided'}</p></div>
                  </div>
                </div>

                <div className="bg-zinc-50 rounded-2xl p-4 sm:p-5">
                  <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2"><Package className="w-4 h-4" /> Laundry Details</h3>
                  <div className="space-y-2">
                    {items.map((it, i) => (
                      <div key={i} className="flex justify-between items-center p-3 bg-white rounded-xl border border-zinc-100">
                        <div>
                          <p className="font-bold text-zinc-900">{it.service_type}</p>
                          <p className="text-sm text-zinc-500">Qty: {it.quantity} × ₱{(calculatePriceWithDynamic(it.service_type, it.quantity) / it.quantity).toFixed(2)}</p>
                        </div>
                        <p className="font-black text-blue-600">₱{calculatePriceWithDynamic(it.service_type, it.quantity).toFixed(2)}</p>
                      </div>
                    ))}
                    <div className="flex justify-between items-center pt-2 border-t border-zinc-200">
                      <p className="font-black text-zinc-900">Total Quantity</p>
                      <p className="font-black text-blue-600">{totalQuantity} load(s)</p>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="font-black text-zinc-900">Estimated Total</p>
                      <p className="font-black text-blue-600">₱{grandTotal.toFixed(2)}</p>
                    </div>
                  </div>
                  <p className="text-xs text-amber-600 font-bold mt-3">Final pricing pending admin review after weighing.</p>
                </div>

                <div className="bg-zinc-50 rounded-2xl p-4 sm:p-5">
                  <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2"><Truck className="w-4 h-4" /> Schedule & Delivery</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between"><span className="text-zinc-500">Date</span><span className="font-bold text-zinc-900">{formData.appointment_date}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-500">Time</span><span className="font-bold text-zinc-900">{formData.appointment_time}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-500">Method</span><span className="font-bold text-zinc-900 capitalize">{formData.delivery_method}</span></div>
                     {formData.delivery_method === 'delivery' && (
                       <>
                          <div className="flex justify-between"><span className="text-zinc-500">Address</span><span className="font-bold text-zinc-900 text-right max-w-[65%] break-words">{formData.address}</span></div>
                          <div className="flex justify-between"><span className="text-zinc-500">Delivery Fee</span><span className="font-bold text-emerald-600">₱{(() => {
                            const pricingMap = new Map<string, PricingConfig>(Object.entries(mergedPricing()) as [string, PricingConfig][]);
                            const firstService = items.length > 0 ? items[0].service_type : LAUNDRY_SERVICE;
                            const cfg = pricingMap.get(firstService) || FALLBACK_PRICING[firstService];
                            return getDeliveryFee(cfg).toFixed(2);
                          })()}</span></div>


                       </>
                     )}
                  </div>
                </div>

                {formData.special_instructions && (
                  <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                    <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">Special Instructions</p>
                    <p className="text-sm text-zinc-700 italic break-words">"{formData.special_instructions}"</p>
                  </div>
                )}

                <div className="bg-blue-50 rounded-2xl p-4 sm:p-5 border-2 border-blue-100">
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-black text-blue-900 uppercase tracking-widest">Total Amount</p>
                    <p className="text-2xl font-black text-amber-600">Pending admin review</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-zinc-100">
            {step > 1 && (
              <button
                type="button"
                onClick={goBack}
                className="flex-1 py-3 sm:py-4 bg-zinc-100 text-zinc-900 rounded-2xl font-black text-base sm:text-lg hover:bg-zinc-200 transition-all flex items-center justify-center gap-2"
              >
                <ChevronLeft className="w-5 h-5" /> Back
              </button>
            )}
            {step < STEPS.length && (
              <button
                type="button"
                onClick={goNext}
                className="flex-1 py-3 sm:py-4 bg-blue-500 text-white rounded-2xl font-black text-base sm:text-lg hover:bg-blue-600 transition-all shadow-xl shadow-blue-100 flex items-center justify-center gap-2"
              >
                Next <ChevronRight className="w-5 h-5" />
              </button>
            )}
            {step === STEPS.length && (
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-3 sm:py-4 bg-blue-500 text-white rounded-2xl font-black text-base sm:text-lg hover:bg-blue-600 transition-all shadow-xl shadow-blue-100 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Review Order <ChevronRight className="w-5 h-5" /></>}
              </button>
            )}
          </div>
        </form>

      {showConfirmation && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-4 bg-black/50 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              className="bg-white rounded-[32px] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="p-4 sm:p-6 border-b border-zinc-100 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-zinc-900">Confirm Your Order</h2>
                  <p className="text-sm text-zinc-500 mt-1">Please review your order details before confirming</p>
                </div>
                <button onClick={() => setShowConfirmation(false)} className="p-2 text-zinc-400 hover:text-zinc-600" aria-label="Close confirmation">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 sm:p-6 space-y-4">
                <div className="bg-zinc-50 rounded-2xl p-4 sm:p-5">
                  <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2"><User className="w-4 h-4" /> Customer Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                    <div><p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Name</p><p className="font-bold text-zinc-900">{formData.customer_name}</p></div>
                    <div><p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Phone</p><p className="font-bold text-zinc-900">{formData.customer_phone}</p></div>
                    <div><p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Email</p><p className="font-bold text-zinc-900 break-words">{formData.customer_email || 'Not provided'}</p></div>
                  </div>
                </div>

                <div className="bg-zinc-50 rounded-2xl p-4 sm:p-5">
                  <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2"><Package className="w-4 h-4" /> Order Details</h3>
                  <div className="space-y-3">
                    {items.map((it, i) => (
                      <div key={i} className="flex justify-between items-center p-3 bg-white rounded-xl border border-zinc-100">
                        <div>
                          <p className="font-bold text-zinc-900">{it.service_type}</p>
                          <p className="text-sm text-zinc-500">Qty: {it.quantity}</p>
                        </div>
                        <p className="font-black text-blue-600">₱{calculatePriceWithDynamic(it.service_type, it.quantity).toFixed(2)}</p>
                      </div>
                    ))}
                    <div className="flex justify-between items-center pt-2 border-t border-zinc-200">
                      <p className="font-black text-zinc-900">Total Quantity</p>
                      <p className="font-black text-blue-600">{totalQuantity} load(s)</p>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="font-black text-zinc-900">Estimated Total</p>
                      <p className="font-black text-blue-600">₱{grandTotal.toFixed(2)}</p>
                    </div>
                  </div>
                  <p className="text-xs text-amber-600 font-bold mt-3">Final pricing pending admin review.</p>
                </div>

                <div className="bg-zinc-50 rounded-2xl p-4 sm:p-5">
                  <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2"><Truck className="w-4 h-4" /> Delivery Method</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between"><span className="text-zinc-500">Method</span><span className="font-bold text-zinc-900 capitalize">{formData.delivery_method}</span></div>
                     {formData.delivery_method === 'delivery' && (
                       <>
                          <div className="flex justify-between"><span className="text-zinc-500">Address</span><span className="font-bold text-zinc-900 text-right max-w-[65%] break-words">{formData.address}</span></div>
                          <div className="flex justify-between"><span className="text-zinc-500">Delivery Fee</span><span className="font-bold text-emerald-600">₱{(() => {
                            const pricingMap = new Map<string, PricingConfig>(Object.entries(mergedPricing()) as [string, PricingConfig][]);
                            const firstService = items.length > 0 ? items[0].service_type : LAUNDRY_SERVICE;
                            const cfg = pricingMap.get(firstService) || FALLBACK_PRICING[firstService];
                            return getDeliveryFee(cfg).toFixed(2);
                          })()}</span></div>


                       </>
                     )}
                  </div>
                </div>

                <div className="bg-blue-50 rounded-2xl p-4 sm:p-5 border-2 border-blue-100">
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-black text-blue-900 uppercase tracking-widest">Total Amount</p>
                    <p className="text-2xl font-black text-amber-600">Pending admin review</p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-3 border-t border-zinc-100">
                  <button
                    onClick={() => setShowConfirmation(false)}
                    className="flex-1 py-3 sm:py-4 bg-zinc-100 text-zinc-900 rounded-2xl font-black text-base sm:text-lg hover:bg-zinc-200 transition-all"
                  >
                    Edit Order
                  </button>
                  <button
                    onClick={handleConfirmOrder}
                    disabled={confirmationLoading || (formData.delivery_method === 'delivery' && !formData.address.trim())}
                    className="flex-1 py-3 sm:py-4 bg-blue-500 text-white rounded-2xl font-black text-base sm:text-lg hover:bg-blue-600 transition-all shadow-xl shadow-blue-100 flex items-center justify-center gap-2"
                  >
                    {confirmationLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirm & Book'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserBooking;
