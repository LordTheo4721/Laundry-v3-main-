import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  ArrowRight,
  Calendar,
  ClipboardList,
  TrendingUp,
  Clock,
  Waves,
  Zap,
  Package,
  Truck,
  Check,
  CheckCircle2,
  X,
  Search,
  XCircle,
  Loader2,
  Users,
  BarChart3,
  ChevronRight,
  Star,
  Smile,
  MapPin,
  User,
  Phone,
  DollarSign,
  Scale,
  Mail,
  Sparkles,
  AlertCircle,
  Store,
  Activity,
  Target,
  Percent,
  Eye,
  Filter,
  ShoppingCart,
  Wallet,
  Shirt,
  BedDouble,
  ScrollText,
  Droplets,
  FileText,
  Trash2,
} from 'lucide-react';
import { Receipt, printReceipt } from '../Receipt';

import SalesReports from './SalesReports';
import CustomerAccounts from './CustomerAccounts';
import CustomerReviews from './CustomerReviews';
import AdminNavbar from './AdminNavbar';
import { calculatePrice, calculateGrandTotalWithMap, calculatePriceWithFallback, FALLBACK_PRICING } from '../../utils/pricing';
import { getDeliveryFee } from '../../utils/sharedPricing';
import { calculateDeliveryFeeFromConfig } from '../../utils/sharedPricing';
import type { Pricing, PriceHistory, Review, Transaction, Machine, Stats, TransactionStatus, PaginationMeta, DeliveryConfig } from '../../types';
import type { PricingConfig } from '../../utils/sharedPricing';
import { getTransactions, getTransactionsPage, getStats, getMachines, getReviews, getPricing, getPriceHistory, verifyAdminToken, updateMachine as apiUpdateMachine, resetMachines as apiResetMachines, deleteTransaction as apiDeleteTransaction, deleteCustomer as apiDeleteCustomer, updatePricing as apiUpdatePricing, createWalkInOrder, getAuthFetchOptions, deletePriceHistory, parseResponseJson } from '../../utils/api';
import { useToast } from './Toast';

/** Number of orders shown per page in the admin Orders table */
const TRANSACTIONS_PER_PAGE = 20;

// --- Types ---
// Types are imported from '../../types'


// --- Helper functions ---
const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP'
  }).format(amount || 0);
};

const formatPercent = (value: number) => {
  return `${value.toFixed(1)}%`;
};

const getServiceIcon = (serviceType: string) => {
  if (serviceType.includes('Wash & Fold') || serviceType.includes('Clothes')) return Shirt;
  if (serviceType.includes('Comforter')) return BedDouble;
  if (serviceType.includes('Bedsheet') || serviceType.includes('Curtain') || serviceType.includes('Towel')) return ScrollText;
  if (serviceType.includes('Hand Wash')) return Droplets;
  return Package;
};

const getServiceColor = (serviceType: string) => {
  if (serviceType.includes('Wash & Fold') || serviceType.includes('Clothes')) return 'text-blue-600 bg-blue-50';
  if (serviceType.includes('Comforter')) return 'text-amber-600 bg-amber-50';
  if (serviceType.includes('Bedsheet') || serviceType.includes('Curtain') || serviceType.includes('Towel')) return 'text-emerald-600 bg-emerald-50';
  if (serviceType.includes('Hand Wash')) return 'text-rose-600 bg-rose-50';
  return 'text-zinc-600 bg-zinc-50';
};

// --- Types for component props ---
type View = 'home' | 'booking' | 'machines' | 'admin' | 'receipt' | 'track' | 'admin-login' | 'admin-settings';

type SubView = 'dashboard' | 'sales' | 'customers' | 'reviews' | 'machines' | 'pricing' | 'walk-in' | 'delivery';

interface AdminDashboardProps {
  setView: (v: View) => void;
}

// --- Components ---
// The navbar lives in its own module so every admin screen (dashboard, settings)
// can render the same chrome.
 
// --- Walk-In Order Form Component ---
interface WalkInOrderFormProps {
  machines: Machine[];
  pricingMap: Map<string, PricingConfig>;
  onOrderCreated: () => void;
}
 
const WalkInOrderForm = ({ machines, pricingMap, onOrderCreated }: WalkInOrderFormProps) => {
  const { addToast } = useToast();
  const [formData, setFormData] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    service_type: 'Wash & Fold (Clothes)',
    quantity: 1,
    special_instructions: '',
    delivery_method: 'pickup' as 'pickup' | 'delivery',
    address: '',
    delivery_zone_id: null as number | null,
  });
  const [deliveryConfig, setDeliveryConfig] = useState<DeliveryConfig | null>(null);
  useEffect(() => {
    fetch('/api/delivery/config', { credentials: 'include' })
      .then(res => res.json())
      .then(data => { if (data.success && data.data) setDeliveryConfig(data.data); })
      .catch(() => {});
  }, []);
  const [items, setItems] = useState<Array<{
    service_type: string;
    quantity: number;
    unit_price: number;
  }>>([]);
  const [loading, setLoading] = useState(false);
  const [createdTransaction, setCreatedTransaction] = useState<Transaction | null>(null);
  const [showMultiItem, setShowMultiItem] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationLoading, setConfirmationLoading] = useState(false);
 
  // Calculate unit price based on service type and total quantity across all items (for display)
  const calculateUnitPrice = (serviceType: string, quantity: number, allItems: typeof items = items) => {
    // Calculate total quantity for this service type across all items
    const totalQty = allItems
      .filter(item => item.service_type === serviceType)
      .reduce((sum, item) => sum + item.quantity, 0);
    const total = calculatePriceWithFallback(serviceType, totalQty, pricingMap);
    return totalQty > 0 ? total / totalQty : 0;
  };
 
  // Calculate price using pricing map
  const calculatePriceWithDynamic = (serviceType: string, quantity: number): number => {
    return calculatePriceWithFallback(serviceType, quantity, pricingMap);
  };
 
  const addItem = () => {
    const newServiceType = 'Wash & Fold (Clothes)';
    const newItems = [...items, { service_type: newServiceType, quantity: 1, unit_price: 0 }];
    // Calculate unit price for all items of the same service type (including the new one)
    const updatedItems = newItems.map(item => {
      if (item.service_type === newServiceType) {
        return {
          ...item,
          unit_price: calculateUnitPrice(newServiceType, item.quantity, newItems)
        };
      }
      return item;
    });
    setItems(updatedItems);
  };
 
  const updateItem = (index: number, field: string, value: string | number) => {
    const newItems = [...items];
    if (field === 'quantity') {
      const qty = parseInt(value as string) || 1;
      const serviceType = newItems[index].service_type;
      newItems[index] = {
        ...newItems[index],
        quantity: qty,
      };
      // Recalculate unit prices for all items of the same service type
      newItems.forEach((item, i) => {
        if (item.service_type === serviceType) {
          newItems[i] = {
            ...item,
            unit_price: calculateUnitPrice(serviceType, item.quantity, newItems)
          };
        }
      });
    } else if (field === 'service_type') {
      const oldServiceType = newItems[index].service_type;
      const newServiceType = value as string;
      newItems[index] = {
        ...newItems[index],
        service_type: newServiceType,
      };
      // Recalculate unit prices for all items of the old service type
      newItems.forEach((item, i) => {
        if (item.service_type === oldServiceType) {
          newItems[i] = {
            ...item,
            unit_price: calculateUnitPrice(oldServiceType, item.quantity, newItems)
          };
        }
      });
      // Recalculate unit prices for all items of the new service type
      newItems.forEach((item, i) => {
        if (item.service_type === newServiceType) {
          newItems[i] = {
            ...item,
            unit_price: calculateUnitPrice(newServiceType, item.quantity, newItems)
          };
        }
      });
    }
    setItems(newItems);
  };
 
  const removeItem = (index: number) => {
    const serviceType = items[index].service_type;
    const newItems = items.filter((_, i) => i !== index);
    // Recalculate unit prices for all remaining items of the same service type
    const updatedItems = newItems.map(item => {
      if (item.service_type === serviceType) {
        return {
          ...item,
          unit_price: calculateUnitPrice(serviceType, item.quantity, newItems)
        };
      }
      return item;
    });
    setItems(updatedItems);
  };
 
  const calculateItemTotal = (item: typeof items[0]) => {
    return item.unit_price * item.quantity;
  };
 
  // Calculate grand total using shared pricing logic
    const computeDeliveryFee = () => {
      if (formData.delivery_method !== 'delivery' || !formData.delivery_zone_id || !deliveryConfig) return 0;
      const zone = deliveryConfig.zones.find(z => z.id === formData.delivery_zone_id);
      if (!zone) return 0;
      return calculateDeliveryFeeFromConfig(deliveryConfig.origin, zone, deliveryConfig.bands).fee;
    };
    const deliveryFee = computeDeliveryFee();

    const computeGrandTotal = () => {
      const serviceTotal = calculateGrandTotalWithMap(items, pricingMap);
      return serviceTotal + deliveryFee;
    };
  
    const grandTotal = computeGrandTotal();

  // Phone validation helper (Philippines format)
  const isValidPhone = (phone: string): boolean => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('9')) return true;
    if (digits.length === 11 && digits.startsWith('09')) return true;
    if (digits.length === 12 && digits.startsWith('639')) return true;
    return false;
  };
 
  // Email validation helper
  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };
 
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

  // Validate required fields with toast errors
  if (!formData.customer_name.trim()) {
    addToast({ type: 'error', message: 'Please enter customer name' });
    return;
  }
  if (!formData.customer_phone.trim()) {
    addToast({ type: 'error', message: 'Please enter customer phone number' });
    return;
  }
  if (!isValidPhone(formData.customer_phone)) {
    addToast({ type: 'error', message: 'Please enter a valid Philippine phone number (e.g., 9123456789)' });
    return;
  }
  if (formData.customer_email.trim() && !isValidEmail(formData.customer_email)) {
    addToast({ type: 'error', message: 'Please enter a valid email address' });
    return;
  }
  if (formData.delivery_method === 'delivery' && !formData.address.trim()) {
    addToast({ type: 'error', message: 'Please enter your address for delivery' });
    return;
  }

    // Show confirmation step
    setShowConfirmation(true);
  };
 
  const handleConfirmOrder = async () => {
     setConfirmationLoading(true);
     try {
        if (showMultiItem && items.length === 0) {
          addToast({ type: 'error', message: 'Please add at least one item' });
          setConfirmationLoading(false);
          return;
        }
        const body = showMultiItem
          ? {
              ...formData,
              items: items.map(item => ({
                service_type: item.service_type,
                quantity: item.quantity,
                unit_price: item.unit_price,
              })),
            }
          : formData;
   
        const res = await fetch('/api/transactions', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           credentials: 'include',
           body: JSON.stringify(body),
         });
       const data = await parseResponseJson(res);
   
        if (data.success && data.data) {
          setCreatedTransaction(data.data);
          setShowConfirmation(false);
          // Trigger admin dashboard refresh
          window.dispatchEvent(new CustomEvent('order-created'));
          onOrderCreated();
        } else {
          addToast({ type: 'error', message: data.error || 'Failed to create walk-in order. Please try again.' });
        }
      } catch (error) {
        console.error(error);
        addToast({ type: 'error', message: 'An error occurred. Please try again.' });
      } finally {
        setConfirmationLoading(false);
      }
    };
 
  const resetForm = () => {
    setFormData({
      customer_name: '',
      customer_phone: '',
      customer_email: '',
      service_type: 'Wash & Fold (Clothes)',
      quantity: 1,
      special_instructions: '',
       delivery_method: 'pickup' as 'pickup' | 'delivery',
       address: '',
       delivery_zone_id: null,
     });
     setItems([]);
    setShowMultiItem(false);
    setCreatedTransaction(null);
  };
 
  if (createdTransaction) {
    // Calculate the confirmed total using the same frontend pricing logic for consistency
    const calculateConfirmedTotal = () => {
      if (showMultiItem && items.length > 0) {
        const total = calculateGrandTotalWithMap(items, pricingMap);
        return isNaN(total) || total <= 0 ? createdTransaction.total_price : total;
      } else {
        const qty = typeof formData.quantity === 'string' ? parseInt(formData.quantity) || 1 : (formData.quantity || 1);
        const serviceType = formData.service_type || createdTransaction.service_type;
        const total = calculatePriceWithDynamic(serviceType, qty);
        return isNaN(total) || total <= 0 ? createdTransaction.total_price : total;
      }
    };
 
    const confirmedTotal = calculateConfirmedTotal();
 
    // Create a transaction object with the confirmed total for the Receipt component
    const receiptTransaction = {
      ...createdTransaction,
      total_price: confirmedTotal,
    };
 
    return (
      <>
        <div id="walkin-receipt" style={{ display: 'none' }}>
          <Receipt transaction={receiptTransaction} type="booking" />
        </div>

        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="text-emerald-600 w-10 h-10" />
          </div>
          <h2 className="text-3xl font-black text-zinc-900 mb-2 tracking-tighter">WALK-IN ORDER CREATED!</h2>
          <p className="text-zinc-500 font-medium">Order has been registered successfully.</p>
        </div>
 
          <div className="bg-zinc-50 rounded-3xl p-8 mb-8 border-2 border-zinc-100">
            <div className="flex justify-between items-center mb-6 pb-6 border-b border-zinc-200">
              <div>
                <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Reference ID</p>
                <p className="text-2xl font-mono font-black text-blue-600">{createdTransaction.reference_number}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Date</p>
                <p className="font-bold text-zinc-900">{new Date(createdTransaction.created_at).toLocaleDateString()}</p>
              </div>
            </div>
 
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8 mb-8">
              <div>
                <p className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-1">Customer</p>
                <p className="font-bold text-zinc-900">{createdTransaction.customer_name}</p>
                <p className="text-sm text-zinc-500">{createdTransaction.customer_phone}</p>
              </div>
              <div>
                <p className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-1">Type</p>
                <p className="font-bold text-zinc-900">Walk-In</p>
                <p className="text-sm text-zinc-500">Immediate Processing</p>
              </div>
            </div>
 
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-zinc-500 font-medium">
                  {showMultiItem && items.length > 0
                    ? `${items.length} item(s)`
                    : `${createdTransaction.service_type} (x${createdTransaction.quantity})`}
                </p>
                <p className="font-bold text-zinc-900">₱{confirmedTotal.toFixed(2)}</p>
              </div>
              {createdTransaction.special_instructions && (
                <div className="bg-white p-4 rounded-2xl border border-zinc-100 italic text-sm text-zinc-500">
                  " {createdTransaction.special_instructions} "
                </div>
              )}
              <div className="pt-4 border-t border-zinc-200 flex justify-between items-center">
                <p className="font-black text-zinc-900 uppercase tracking-widest text-sm">Total Amount</p>
                <p className="text-xl font-black text-blue-600">₱{confirmedTotal.toFixed(2)}</p>
              </div>
            </div>
          </div>
 
          <div className="flex flex-col sm:flex-row gap-4 no-print">
            <button
              onClick={() => { setTimeout(() => printReceipt('walkin-receipt'), 100); }}
              className="flex-1 py-5 bg-zinc-100 text-zinc-900 rounded-3xl font-black text-lg hover:bg-zinc-200 transition-all flex items-center justify-center gap-2"
            >
              <ClipboardList className="w-5 h-5" /> Print Receipt
            </button>
            <button
              onClick={() => {
                setCreatedTransaction(null);
                resetForm();
              }}
              className="flex-1 py-5 bg-blue-500 text-white rounded-3xl font-black text-lg hover:bg-blue-600 transition-all shadow-xl shadow-blue-100"
            >
              Done
            </button>
          </div>
      </>
    );
  }
  
  return (
    <>
      <div className="max-w-4xl mx-auto py-12 sm:py-20 px-4">
        <form onSubmit={handleSubmit} className="bg-white rounded-[32px] sm:rounded-[40px] shadow-2xl border-4 sm:border-8 border-zinc-50 overflow-hidden">
          <div className="p-6 sm:p-10 text-center border-b border-zinc-100 bg-zinc-50">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-full text-xs font-black uppercase tracking-widest mb-6">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" /> Walk-In Order
            </div>
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold text-zinc-900 tracking-tighter mb-4 sm:mb-6">Register Walk-In Order</h1>
            <p className="text-zinc-500 text-lg font-medium">Customer is at the counter. Create their order instantly.</p>
          </div>
          <div className="p-6 sm:p-10 space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-3">
              <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                <User className="w-4 h-4" /> Customer Name
              </label>
              <input
                required
                type="text"
                className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                placeholder="Juan Dela Cruz"
                value={formData.customer_name}
                onChange={e => setFormData({...formData, customer_name: e.target.value})}
              />
            </div>
            <div className="space-y-3">
              <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                <Phone className="w-4 h-4" /> Phone
              </label>
              <input
                required
                type="tel"
                maxLength={12}
                className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                placeholder="9123456789 or 09123456789"
                value={formData.customer_phone}
                onChange={e => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 12);
                  setFormData({...formData, customer_phone: value});
                }}
                inputMode="numeric"
              />
            </div>
          </div>
 
          <div className="space-y-6">
            <div className="space-y-3">
              <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                <Mail className="w-4 h-4" /> Email (Optional)
              </label>
              <input
                type="email"
                className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                placeholder="customer@example.com"
                value={formData.customer_email}
                onChange={e => setFormData({...formData, customer_email: e.target.value})}
              />
            </div>
          </div>
 
          {/* Multi-Item Toggle */}
          <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border-2 border-zinc-200">
            <div>
              <p className="text-sm font-black text-zinc-900">Add Multiple Items</p>
              <p className="text-[10px] text-zinc-500">Combine multiple services in one order</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowMultiItem(!showMultiItem);
                if (!showMultiItem && items.length === 0) {
                  addItem();
                }
              }}
              className={`w-12 h-6 rounded-full transition-colors flex items-center px-1 ${
                showMultiItem ? 'bg-blue-500' : 'bg-zinc-300'
              }`}
            >
              <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                showMultiItem ? 'translate-x-6' : 'translate-x-0'
              }`} />
            </button>
          </div>
 
          {showMultiItem ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-black text-zinc-900">Items</h3>
                <button
                  type="button"
                  onClick={addItem}
                  className="px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-black hover:bg-blue-600 transition-colors flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Item
                </button>
              </div>
 
              {items.map((item, index) => (
                <div key={index} className="bg-zinc-50 p-4 rounded-2xl border-2 border-zinc-200 space-y-4">
                  <div className="flex justify-between items-start">
                    <h4 className="text-sm font-black text-zinc-900">Item {index + 1}</h4>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="text-rose-500 hover:text-rose-600 text-sm font-bold"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-zinc-400 uppercase">Service</label>
                      <select
                        value={item.service_type}
                        onChange={e => updateItem(index, 'service_type', e.target.value)}
                        className="w-full p-3 bg-white border-2 border-zinc-200 rounded-xl font-bold text-sm"
                      >
                        <option value="Wash & Fold (Clothes)">Wash & Fold (Clothes)</option>
                        <option value="Comforter (Small)">Comforter (Small)</option>
                        <option value="Comforter (Medium)">Comforter (Medium)</option>
                        <option value="Comforter (Large)">Comforter (Large)</option>
                        <option value="Bedsheet/Curtain/Towel">Bedsheet/Curtain/Towel</option>
                        <option value="Hand Wash Service">Hand Wash Service</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-zinc-400 uppercase">Quantity</label>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={e => updateItem(index, 'quantity', e.target.value)}
                        className="w-full p-3 bg-white border-2 border-zinc-200 rounded-xl font-bold text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-zinc-400 uppercase">Unit Price (₱)</label>
                      <input
                        type="text"
                        value={item.unit_price.toFixed(2)}
                        readOnly
                        className="w-full p-3 bg-zinc-100 border-2 border-zinc-200 rounded-xl font-bold text-sm text-zinc-500 cursor-not-allowed"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <p className="text-sm font-black text-blue-600">
                      Item Total: ₱{calculateItemTotal(item).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
 
              <div className="bg-blue-50 p-4 rounded-2xl border-2 border-blue-200">
                <div className="flex justify-between items-center">
                  <p className="text-sm font-black text-blue-900">Grand Total</p>
                  <p className="text-2xl font-black text-blue-600">₱{grandTotal.toFixed(2)}</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="space-y-3 md:col-span-2">
                  <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                    <Package className="w-4 h-4" /> Service
                  </label>
                  <select
                    className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg appearance-none"
                    value={formData.service_type}
                    onChange={e => setFormData({...formData, service_type: e.target.value})}
                  >
                    <option value="Wash & Fold (Clothes)">Wash & Fold (Clothes)</option>
                    <option value="Comforter (Small)">Comforter (Small)</option>
                    <option value="Comforter (Medium)">Comforter (Medium)</option>
                    <option value="Comforter (Large)">Comforter (Large)</option>
                    <option value="Bedsheet/Curtain/Towel">Bedsheet/Curtain/Towel</option>
                    <option value="Hand Wash Service">Hand Wash Service</option>
                  </select>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                    <ClipboardList className="w-4 h-4" /> {formData.service_type.includes('Comforter') ? 'Quantity (pcs)' : 'Weight (kgs)'}
                  </label>
                  <input
                    required
                    type="number"
                    min="1"
                    className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                    value={formData.quantity}
                    onChange={e => {
                      const val = parseInt(e.target.value);
                      setFormData({...formData, quantity: isNaN(val) || val < 1 ? 1 : val});
                    }}
                  />
                </div>
              </div>
 
              <div className="bg-blue-50 p-6 rounded-3xl border-2 border-blue-100 flex justify-between items-center">
                <div>
                  <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Estimated Total</p>
                  <p className="text-2xl font-black text-blue-600">
                     ₱{calculatePriceWithDynamic(formData.service_type, formData.quantity) + (formData.delivery_method === 'delivery' ? deliveryFee : 0)}
                  </p>
                </div>
                <Smile className="text-blue-200 w-10 h-10" />
              </div>
            </>
          )}
 
          <div className="space-y-3">
            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> Special Instructions
            </label>
            <textarea
              className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
              placeholder="Any special care needed? (e.g., use extra softener, delicate items)"
              rows={2}
              value={formData.special_instructions}
              onChange={e => setFormData({...formData, special_instructions: e.target.value})}
            />
          </div>

          <div className="space-y-4">
            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">How do we get it?</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <button
                type="button"
                onClick={() => setFormData({...formData, delivery_method: 'pickup'})}
                className={`p-6 rounded-[32px] border-4 flex flex-col items-center gap-3 transition-all ${
                  formData.delivery_method === 'pickup'
                  ? 'border-blue-500 bg-blue-50 text-blue-600'
                  : 'border-zinc-50 bg-zinc-50 text-zinc-400 hover:border-zinc-100'
                }`}
              >
                <Truck className="w-8 h-8" />
                <span className="font-black uppercase tracking-widest text-sm">Pickup</span>
              </button>
              <button
                type="button"
                onClick={() => setFormData({...formData, delivery_method: 'delivery'})}
                className={`p-6 rounded-[32px] border-4 flex flex-col items-center gap-3 transition-all ${
                  formData.delivery_method === 'delivery'
                  ? 'border-blue-500 bg-blue-50 text-blue-600'
                  : 'border-zinc-50 bg-zinc-50 text-zinc-400 hover:border-zinc-100'
                }`}
              >
                <Package className="w-8 h-8" />
                <span className="font-black uppercase tracking-widest text-sm">Delivery</span>
              </button>
            </div>
          </div>

          {formData.delivery_method === 'delivery' && (
            <div className="space-y-4">
              <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                <MapPin className="w-4 h-4" /> Where are you?
              </label>
              <textarea
                required
                className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                placeholder="123 Bubble Lane..."
                rows={3}
                value={formData.address}
                onChange={e => setFormData({...formData, address: e.target.value})}
              />
            </div>
          )}

          <button
            disabled={loading}
            type="submit"
            className="w-full py-6 bg-blue-500 text-white rounded-[32px] font-black text-2xl hover:bg-blue-600 transition-all shadow-2xl shadow-blue-200 flex items-center justify-center gap-3"
          >
            {loading ? <Loader2 className="w-8 h-8 " /> : (
              <>
                Review Order <Zap className="w-8 h-8" />
              </>
            )}
          </button>
          </div>
        </form>
      </div>

      {showConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50">
           <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
             <div className="p-4 sm:p-6 border-b border-zinc-100 flex-shrink-0">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="min-w-0">
                  <h2 className="text-xl sm:text-2xl font-black text-zinc-900 truncate">Confirm Walk-In Order</h2>
                  <p className="text-sm text-zinc-500 mt-1">Please review the order details before confirming</p>
                </div>
                <button
                  onClick={() => setShowConfirmation(false)}
                  className="p-2 text-zinc-400 hover:text-zinc-600 transition-colors flex-shrink-0"
                  aria-label="Close confirmation"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
 
            <div className="p-4 sm:p-6 space-y-4 pb-6">
              {/* Customer Info */}
              <div className="bg-zinc-50 rounded-2xl p-4 sm:p-5">
                <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <User className="w-4 h-4" /> Customer Information
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  <div>
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Name</p>
                    <p className="font-bold text-zinc-900 truncate">{formData.customer_name}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Phone</p>
                    <p className="font-bold text-zinc-900 truncate">{formData.customer_phone}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Email</p>
                    <p className="font-bold text-zinc-900 truncate">{formData.customer_email || 'Not provided'}</p>
                  </div>
                </div>
              </div>
 
              {/* Order Items */}
              <div className="bg-zinc-50 rounded-2xl p-4 sm:p-5">
                <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Package className="w-4 h-4" /> Order Details
                </h3>
                {showMultiItem ? (
                  <div className="space-y-3">
                    {items.map((item, index) => (
                      <div key={index} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-white rounded-xl border border-zinc-100">
                        <div className="min-w-0">
                          <p className="font-bold text-zinc-900 truncate">{item.service_type}</p>
                          <p className="text-sm text-zinc-500">Qty: {item.quantity} × ₱{item.unit_price.toFixed(2)}</p>
                        </div>
                        <p className="font-black text-blue-600 text-lg sm:text-xl whitespace-nowrap">₱{calculateItemTotal(item).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-white rounded-xl border border-zinc-100">
                    <div className="min-w-0">
                      <p className="font-bold text-zinc-900 truncate">{formData.service_type}</p>
                      <p className="text-sm text-zinc-500">
                        {formData.service_type.includes('Comforter') ? `Qty: ${formData.quantity} pcs` : `Weight: ${formData.quantity} kgs`}
                      </p>
                    </div>
                    <p className="font-black text-blue-600 text-xl sm:text-2xl whitespace-nowrap">₱{calculatePriceWithDynamic(formData.service_type, formData.quantity)}</p>
                  </div>
                )}
 
                {formData.special_instructions && (
                  <div className="mt-3 p-3 sm:p-4 bg-amber-50 rounded-xl border border-amber-100">
                    <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">Special Instructions</p>
                    <p className="text-sm text-zinc-700 italic break-words">"{formData.special_instructions}"</p>
                  </div>
                )}
              </div>
 
              {/* Order Type */}
              <div className="bg-zinc-50 rounded-2xl p-4 sm:p-5">
                <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <User className="w-4 h-4" /> Order Type
                </h3>
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                    <span className="text-zinc-500">Method</span>
                    <span className="font-bold text-zinc-900 capitalize">{formData.delivery_method === 'pickup' ? 'Pickup' : 'Delivery'}</span>
                  </div>
                  {formData.delivery_method === 'delivery' && (
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                      <span className="text-zinc-500 whitespace-nowrap">Address</span>
                      <span className="font-bold text-zinc-900 text-right sm:max-w-[65%] break-words">{formData.address}</span>
                    </div>
                  )}
                </div>
              </div>
 
              {/* Total */}
               <div className="bg-blue-50 rounded-2xl p-4 sm:p-5 border-2 border-blue-100">
                 {deliveryFee > 0 && (
                   <div className="flex justify-between items-center mb-2">
                     <p className="text-sm font-medium text-blue-700">Delivery Fee</p>
                     <p className="text-sm font-black text-blue-900">₱{deliveryFee.toFixed(2)}</p>
                   </div>
                 )}
                 <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-3">
                   <p className="text-sm font-black text-blue-900 uppercase tracking-widest">Grand Total</p>
                   <p className="text-2xl sm:text-3xl font-black text-blue-600">₱{grandTotal.toFixed(2)}</p>
                 </div>
                 <p className="text-xs sm:text-sm text-blue-700 text-center">
                   This is an estimated total. Final price may vary based on actual weight.
                 </p>
               </div>
 
              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-zinc-100">
                <button
                  onClick={() => setShowConfirmation(false)}
                  className="flex-1 py-5 bg-zinc-100 text-zinc-900 rounded-3xl font-black text-lg hover:bg-zinc-200 transition-all"
                >
                  Edit Order
                </button>
                <button
                  onClick={handleConfirmOrder}
                  disabled={confirmationLoading}
                  className="flex-1 py-5 bg-blue-500 text-white rounded-3xl font-black text-lg hover:bg-blue-600 transition-all shadow-xl shadow-blue-100 flex items-center justify-center gap-2"
                >
                  {confirmationLoading ? <Loader2 className="w-6 h-6" /> : 'Confirm & Create Order'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </>
  );
}

const AdminDashboard = ({ setView }: AdminDashboardProps) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  // Mirror of `loading` for use inside long-lived timers/closures, so the
  // safety timeout sees the CURRENT value instead of the mount-time one.
  const loadingRef = useRef(true);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  const [searchTerm, setSearchTerm] = useState('');
  // Orders table query: server-side search + pagination (the server caps a page at 100 rows)
  const [ordersQuery, setOrdersQuery] = useState<{ page: number; search: string }>({ page: 1, search: '' });
  const [transactionMeta, setTransactionMeta] = useState<PaginationMeta | null>(null);
  const [printingTransaction, setPrintingTransaction] = useState<Transaction | null>(null);
  const pendingPrintWindowRef = useRef<Window | null>(null);
  const [lastSync, setLastSync] = useState<Date>(new Date());
  const [subView, setSubView] = useState<SubView>('dashboard');
  const [completedMachines, setCompletedMachines] = useState<Record<number, number>>({});
  const [reviews, setReviews] = useState<Review[]>([]);
   const [timerDuration, setTimerDuration] = useState(2700);
  const [washTimerTransactionId, setWashTimerTransactionId] = useState<number | null>(null);
  const [dryingTimerDuration, setDryingTimerDuration] = useState(2700);
  const [dryingTimerTransactionId, setDryingTimerTransactionId] = useState<number | null>(null);
  const isMountedRef = useRef(true);

  // Pricing map for dynamic pricing calculations
  const [pricingMap, setPricingMap] = useState<Map<string, PricingConfig>>(new Map());

  // Debounce timer for machine slider
  const sliderDebounceRef = useRef<Record<string, NodeJS.Timeout>>({});

  // Lock to prevent concurrent fetchData calls
  const fetchDataLockRef = useRef(false);

  // Latest pagination/search values, read by fetchData so the polling interval
  // always requests the page the admin is currently looking at.
  const transactionPageRef = useRef(1);
  const searchRef = useRef('');

  // Debounce the search input so typing does not fire a request per keystroke.
  // A new search always restarts from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchTerm.trim();
      setOrdersQuery(prev => (prev.search === next ? prev : { page: 1, search: next }));
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Keep the refs in sync and refresh immediately when the page/search changes
  const isInitialOrdersFetch = useRef(true);
  useEffect(() => {
    transactionPageRef.current = ordersQuery.page;
    searchRef.current = ordersQuery.search;
    if (isInitialOrdersFetch.current) {
      // The mount effect below already performs the very first fetch
      isInitialOrdersFetch.current = false;
      return;
    }
    fetchData(true, undefined, ordersQuery.page, ordersQuery.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersQuery]);

  useEffect(() => {
    if (!printingTransaction) return;

    const printWindow = pendingPrintWindowRef.current;
    pendingPrintWindowRef.current = null;
    printReceipt('admin-receipt', printWindow);
    setPrintingTransaction(null);
  }, [printingTransaction]);

  const transactionsRef = useRef<Transaction[]>([]);

  const [handwashUpload, setHandwashUpload] = useState<number | null>(null);
  const [handwashUploading, setHandwashUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedMachineId, setSelectedMachineId] = useState<Record<number, number>>({});
  const [assigningMachine, setAssigningMachine] = useState<number | null>(null);
  const [confirmAccept, setConfirmAccept] = useState<{ transactionId: number; machineId: number } | null>(null);
  const [confirmNoMachine, setConfirmNoMachine] = useState<number | null>(null);
  const [confirmPayment, setConfirmPayment] = useState<{ id: number; status: 'paid' | 'unpaid' } | null>(null);

  // Walk-in form state
  const [walkInForm, setWalkInForm] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    service_type: 'Wash & Fold (Clothes)',
    quantity: 1,
    special_instructions: '',
    appointment_date: '',
    appointment_time: '',
    delivery_method: 'pickup' as 'pickup' | 'delivery',
    address: '',
    payment_status: 'unpaid' as 'unpaid' | 'paid',
    delivery_zone_id: null as number | null,
  });
  const [deliveryConfig, setDeliveryConfig] = useState<DeliveryConfig | null>(null);
  const [walkInDeliveryQuote, setWalkInDeliveryQuote] = useState<{ distance_km: number; fee: number } | null>(null);
  useEffect(() => {
    fetch('/api/delivery/config', { credentials: 'include' })
      .then(res => res.json())
      .then(data => { if (data.success && data.data) setDeliveryConfig(data.data); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (walkInForm.delivery_method !== 'delivery' || !walkInForm.address || walkInForm.address.trim().length < 5) {
      setWalkInDeliveryQuote(null);
      return;
    }
    const controller = new AbortController();
    fetch('/api/delivery/quote', {
      method: 'POST',
      ...getAuthFetchOptions(),
      body: JSON.stringify({ address: walkInForm.address }),
      signal: controller.signal,
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) setWalkInDeliveryQuote({ distance_km: data.data.distance_km, fee: data.data.fee });
        else setWalkInDeliveryQuote(null);
      })
      .catch(() => { if (!controller.signal.aborted) setWalkInDeliveryQuote(null); });
    return () => controller.abort();
  }, [walkInForm.delivery_method, walkInForm.address]);
  const [walkInLoading, setWalkInLoading] = useState(false);
  const [walkInDeliveryCoords, setWalkInDeliveryCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [walkInQuoting, setWalkInQuoting] = useState(false);
  const [walkInQuoteError, setWalkInQuoteError] = useState<string | null>(null);
  useEffect(() => {
    if (!walkInDeliveryCoords) { setWalkInDeliveryQuote(null); setWalkInQuoteError(null); return; }
    const controller = new AbortController();
    setWalkInQuoting(true);
    setWalkInQuoteError(null);
    fetch(`/api/delivery/quote-coords?lat=${walkInDeliveryCoords.lat}&lng=${walkInDeliveryCoords.lng}`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) setWalkInDeliveryQuote({ distance_km: data.data.distance_km, fee: data.data.fee });
        else setWalkInQuoteError(data.error || 'Failed to calculate delivery cost');
      })
      .catch(() => { if (!controller.signal.aborted) { setWalkInDeliveryQuote(null); setWalkInQuoteError('Failed to calculate delivery cost'); } })
      .finally(() => { if (!controller.signal.aborted) setWalkInQuoting(false); });
    // reverse geocode address
    fetch(`/api/delivery/reverse?lat=${walkInDeliveryCoords.lat}&lng=${walkInDeliveryCoords.lng}`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data?.address) setWalkInForm(prev => ({ ...prev, address: data.data.address }));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [walkInDeliveryCoords]);
  const [walkInError, setWalkInError] = useState<string | null>(null);
  const [walkInPricing, setWalkInPricing] = useState<Record<string, PricingConfig>>({});
   const [showWalkInSuccess, setShowWalkInSuccess] = useState(false);
   const [createdWalkInTransaction, setCreatedWalkInTransaction] = useState<Transaction | null>(null);
   const [submittedWalkInItems, setSubmittedWalkInItems] = useState<Array<{ service_type: string; quantity: number; unit_price: number }>>([]);
   // Multi-order items state
   const [walkInItems, setWalkInItems] = useState<Array<{ service_type: string; quantity: number; unit_price: number }>>([
     { service_type: 'Wash & Fold (Clothes)', quantity: 1, unit_price: 0 },
   ]);
   const [showMultiItem, setShowMultiItem] = useState(false);
   const [showConfirmation, setShowConfirmation] = useState(false);
   const [confirmationLoading, setConfirmationLoading] = useState(false);

  const { addToast } = useToast();

  // Complete order pop-up state
  const [completeOrderPopupId, setCompleteOrderPopupId] = useState<number | null>(null);
  const [completeOrderWeight, setCompleteOrderWeight] = useState('');
  const [completeOrderPrice, setCompleteOrderPrice] = useState('');
  const [completeOrderLoading, setCompleteOrderLoading] = useState(false);
  const [completeOrderError, setCompleteOrderError] = useState<string | null>(null);

  // Delete order confirmation pop-up state
  const [deleteOrderConfirmId, setDeleteOrderConfirmId] = useState<number | null>(null);
  const [deleteOrderLoading, setDeleteOrderLoading] = useState(false);

  // Decline order confirmation pop-up state
  const [declineOrderConfirmId, setDeclineOrderConfirmId] = useState<number | null>(null);
  const [declineOrderLoading, setDeclineOrderLoading] = useState(false);

  // Reset isMountedRef on mount to handle remount scenarios
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
    
  // Machine management state
  const [newMachine, setNewMachine] = useState({ name: '', type: 'washer' as 'washer' | 'dryer' | 'all-in-one', capacity: 10 });
  const [addingMachine, setAddingMachine] = useState(false);
   const [deletingMachine, setDeletingMachine] = useState<number | null>(null);
   const [machineToDelete, setMachineToDelete] = useState<number | null>(null);
   const [deleteAllMachinesConfirm, setDeleteAllMachinesConfirm] = useState(false);
   const [addMachineConfirm, setAddMachineConfirm] = useState(false);

  // Pricing management state
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistory[]>([]);
  const [editingPricing, setEditingPricing] = useState<Pricing | null>(null);
  const [updatingPricing, setUpdatingPricing] = useState(false);
  const [deletingPriceHistory, setDeletingPriceHistory] = useState(false);

  // Machine management handlers
  const handleAddMachine = async (e: React.FormEvent) => {
     e.preventDefault();
     if (!newMachine.name.trim()) return;

     setAddMachineConfirm(true);
   };

  const confirmAddMachine = async () => {
     setAddMachineConfirm(false);
     setAddingMachine(true);
      try {
        const res = await fetch('/api/machines', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newMachine),
        });
       const data = await parseResponseJson(res);
          if (data.success && data.data) {
            // Ensure new machine is properly initialized with remaining_time: 0 and status: 'available'
            const initializedMachine = { ...data.data, status: 'available' as const, remaining_time: 0 };
            setMachines(prev => [...prev, initializedMachine]);
            setNewMachine({ name: '', type: 'washer', capacity: 10 });
            await fetchData();
           } else {
           addToast({ type: 'error', message: data.error || 'Failed to add machine' });
         }
       } catch (error) {
         console.error(error);
         addToast({ type: 'error', message: 'Failed to add machine' });
       } finally {
         setAddingMachine(false);
       }
     };

  const handleUpdateMachine = async (id: number, updates: { status: 'available' | 'in-use' | 'maintenance'; remaining_time?: number | null }) => {
     try {
       const machine = machines.find(m => m.id === id);
       const newRemainingTime = updates.remaining_time !== undefined
         ? (updates.remaining_time === null ? 0 : updates.remaining_time)
         : (updates.status === 'available' || updates.status === 'maintenance') ? 0 : (machine?.remaining_time ?? 0);
       const res = await fetch(`/api/machines/${id}`, {
         method: 'PATCH',
         credentials: 'include',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ ...updates, remaining_time: newRemainingTime }),
       });
      const data = await parseResponseJson(res);
       if (data.success && data.data) {
         setMachines(prev => prev.map(m => m.id === id ? { ...m, ...data.data } : m));
         if (updates.status === 'available' || updates.status === 'maintenance') {
           setCompletedMachines(prev => {
             const newState = { ...prev };
             delete newState[id];
             return newState;
           });
         }
         await fetchData();
       }
     } catch (error) {
       console.error(error);
     }
   };

  const handleDeleteMachine = async (id: number) => {
    const machine = machines.find(m => m.id === id);
    const machineInfo = machine
      ? `Machine: ${machine.name}\nType: ${machine.type}\nCapacity: ${machine.capacity}kg`
      : `ID: ${id}`;
    
    addToast({ type: 'info', message: 'Deleting machine...' });
    
    setDeletingMachine(id);
    try {
      const res = await fetch(`/api/machines/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await parseResponseJson(res);
      if (data.success) {
        setMachines(prev => prev.filter(m => m.id !== id));
        setSelectedMachineId(prev => {
          const newState = { ...prev };
          Object.keys(newState).forEach(key => {
            const transactionId = Number(key);
            if (newState[transactionId] === id) delete newState[transactionId];
          });
          return newState;
        });
        await fetchData();
        addToast({ type: 'success', message: 'Machine deleted successfully' });
      } else {
        addToast({ type: 'error', message: data.error || 'Failed to delete machine' });
      }
    } catch (error) {
      console.error(error);
      addToast({ type: 'error', message: 'Failed to delete machine' });
    } finally {
      setDeletingMachine(null);
    }
  };

  const handleDeleteAllMachines = () => {
    setDeleteAllMachinesConfirm(true);
  };

  const confirmDeleteAllMachines = async () => {
    setDeleteAllMachinesConfirm(false);
    addToast({ type: 'info', message: 'Deleting all machines...' });
    
    setDeletingMachine(null);
    try {
      const res = await fetch('/api/machines', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await parseResponseJson(res);
      if (data.success) {
        setMachines([]);
        setSelectedMachineId({});
        await fetchData();
        addToast({ type: 'success', message: 'All machines deleted successfully' });
      } else {
        addToast({ type: 'error', message: data.error || 'Failed to delete machines' });
      }
    } catch (error) {
      console.error(error);
      addToast({ type: 'error', message: 'Failed to delete machines' });
    } finally {
      setDeletingMachine(null);
    }
  };

  // Pricing management handlers
  const fetchPricing = async () => {
    try {
      const res = await fetch('/api/pricing', { credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      const data = await parseResponseJson(res);
      if (data.success && data.data) {
        setPricing(data.data);
        // Update pricing map for calculations
        const map = new Map<string, PricingConfig>();
        data.data.forEach((p: Pricing) => {
           map.set(p.service_type, {
             pricing_type: p.pricing_type,
             base_price: p.base_price,
             tier_1_limit: p.tier_1_limit,
             tier_1_price: p.tier_1_price,
             tier_2_limit: p.tier_2_limit,
             tier_2_price: p.tier_2_price,
             tier_3_limit: p.tier_3_limit,
             tier_3_price: p.tier_3_price,
             tier_4_limit: p.tier_4_limit,
             tier_4_price: p.tier_4_price,
             tier_5_price_per_kg: p.tier_5_price_per_kg,
             per_kg_price: p.per_kg_price,
             is_active: p.is_active,
             delivery_fee: p.delivery_fee,
           });
         });
        setPricingMap(map);
      }
    } catch (error) {
      console.error('Failed to fetch pricing:', error);
    }
  };
  
  const fetchPriceHistory = async () => {
    try {
      const res = await fetch('/api/pricing/history', { credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      const data = await parseResponseJson(res);
      if (data.success && data.data) {
        setPriceHistory(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch price history:', error);
    }
  };

  const handleDeletePriceHistory = async () => {
    addToast({ type: 'info', message: 'Deleting price history...' });
    setDeletingPriceHistory(true);
    try {
      await deletePriceHistory();
      setPriceHistory([]);
      addToast({ type: 'success', message: 'All price history has been deleted successfully.' });
    } catch (error) {
      console.error('Failed to delete price history:', error);
      addToast({ type: 'error', message: 'Failed to delete price history. Please try again.' });
    } finally {
      setDeletingPriceHistory(false);
    }
  };

  const handleUpdatePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPricing) return;
    
    addToast({ type: 'info', message: 'Updating pricing...' });
    
    setUpdatingPricing(true);
    try {
      const formData = new FormData(e.currentTarget as HTMLFormElement);
      const updateData: Record<string, string | number> = {};
      
      formData.forEach((value, key) => {
        if (key === 'service_type' || key === 'pricing_type') {
          updateData[key] = value as string;
        } else {
          const numValue = parseFloat(value as string);
          if (isNaN(numValue)) {
            throw new Error(`Invalid value for ${key}: must be a number`);
          }
          updateData[key] = numValue;
        }
      });
      
      const res = await fetch(`/api/pricing/${encodeURIComponent(editingPricing.service_type)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      const data = await parseResponseJson(res);
      if (data.success) {
        await fetchPricing();
        await fetchPriceHistory();
        setEditingPricing(null);
        addToast({ type: 'success', message: 'Pricing updated successfully' });
      } else {
        addToast({ type: 'error', message: data.error || 'Failed to update pricing' });
      }
    } catch (error) {
       console.error(error);
        addToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to update pricing' });
      } finally {
       setUpdatingPricing(false);
     }
   };

  const showPriceChangeDetails = (history: PriceHistory) => {
    const oldData = history.old_price_data ? JSON.parse(history.old_price_data) : null;
    const newData = history.new_price_data ? JSON.parse(history.new_price_data) : null;
    
    let message = `Price change for ${history.service_type} on ${new Date(history.created_at).toLocaleString()}\n\n`;
    
    if (oldData && newData) {
      message += 'OLD:\n';
      if (oldData.pricing_type === 'tiered') {
        message += `  1-${oldData.tier_1_limit}: ₱${oldData.tier_1_price}\n`;
        message += `  ${oldData.tier_1_limit + 1}-${oldData.tier_2_limit}: ₱${oldData.tier_2_price}\n`;
        message += `  ${oldData.tier_2_limit + 1}-${oldData.tier_3_limit}: ₱${oldData.tier_3_price}\n`;
        message += `  ${oldData.tier_3_limit + 1}-${oldData.tier_4_limit}: ₱${oldData.tier_4_price}\n`;
        message += `  ${oldData.tier_4_limit + 1}+: ₱${oldData.tier_5_price_per_kg}/kg\n`;
      } else {
        message += `  ₱${oldData.per_kg_price}/kg\n`;
      }
      
      message += '\nNEW:\n';
      if (newData.pricing_type === 'tiered') {
        message += `  1-${newData.tier_1_limit}: ₱${newData.tier_1_price}\n`;
        message += `  ${newData.tier_1_limit + 1}-${newData.tier_2_limit}: ₱${newData.tier_2_price}\n`;
        message += `  ${newData.tier_2_limit + 1}-${newData.tier_3_limit}: ₱${newData.tier_3_price}\n`;
        message += `  ${newData.tier_3_limit + 1}-${newData.tier_4_limit}: ₱${newData.tier_4_price}\n`;
        message += `  ${newData.tier_4_limit + 1}+: ₱${newData.tier_5_price_per_kg}/kg\n`;
      } else {
        message += `  ₱${newData.per_kg_price}/kg\n`;
      }
    }
    
    addToast({ type: 'info', message });
  };

  const fetchData = async (skipAuthCheck = false, signal?: AbortSignal, page?: number, search?: string) => {
    // Prevent concurrent fetchData calls
    if (fetchDataLockRef.current) return;
    fetchDataLockRef.current = true;

    // Use explicit params if provided, otherwise fall back to refs
    const effectivePage = page ?? transactionPageRef.current;
    const effectiveSearch = search ?? searchRef.current;

    try {
      // If skipAuthCheck is true, we already verified the token
      if (!skipAuthCheck) {
        try {
          // Verify token is still valid using api.ts function (cookie-based)
          const { valid } = await verifyAdminToken();
          if (!valid) {
            if (isMountedRef.current) setLoading(false);
            setView('admin-login');
            return;
          }
        } catch (error) {
          console.error('Token verification failed:', error);
          // If verification fails (network error), treat as auth failure
          if (isMountedRef.current) setLoading(false);
          setView('admin-login');
          return;
        }
      }

      try {
        // Use api.ts functions for consistent response handling
        const [ordersResult, statsData, machinesData] = await Promise.all([
          getTransactionsPage({
            page: effectivePage,
            limit: TRANSACTIONS_PER_PAGE,
            search: effectiveSearch,
          }),
          getStats(),
          getMachines()
        ]);

        if (!isMountedRef.current) return;
        console.log('[DEBUG AdminDashboard] Fetched page:', effectivePage, 'search:', effectiveSearch, 'transactions:', ordersResult.transactions.length, 'meta:', ordersResult.meta);
        transactionsRef.current = ordersResult.transactions;
        setTransactions(ordersResult.transactions);
        setTransactionMeta(ordersResult.meta);
        setStats(statsData);
        setMachines(machinesData);

        // Handle reviews, pricing, price history in parallel
        const [reviewsData, pricingData, priceHistoryData] = await Promise.all([
          getReviews().catch(err => { console.error('Failed to fetch reviews:', err); return []; }),
          getPricing().catch(err => { console.error('Failed to fetch pricing:', err); return []; }),
          getPriceHistory().catch(err => { console.error('Failed to fetch price history:', err); return []; })
        ]);

        if (!isMountedRef.current) return;
        setReviews(reviewsData);
        setPricing(pricingData);
        setPriceHistory(priceHistoryData);

        setLastSync(new Date());
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;

        // Check if it's an auth error (401 or token-related)
        const isAuthError = error instanceof Error && (
          error.message.includes('401') ||
          error.message.includes('Invalid or expired token') ||
          error.message.includes('No token provided') ||
          error.message.includes('Unauthorized')
        );

        if (isAuthError) {
          if (isMountedRef.current) setLoading(false);
          setView('admin-login');
          return;
        }
        console.error('AdminDashboard fetchData error:', error);
        // Force loading to false on error
        if (isMountedRef.current) {
          setLoading(false);
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    } finally {
      // Always release the lock - the early returns above (auth failure) would
      // otherwise leave it stuck at true and silently freeze all refreshes.
      fetchDataLockRef.current = false;
    }
  };

  useEffect(() => {
      const controller = new AbortController();
      fetchData(false, controller.signal);

      const timerSyncInterval = setInterval(async () => {
        if (Object.keys(sliderDebounceRef.current).length > 0) return;
        try {
          const machinesData = await getMachines();
          if (isMountedRef.current) setMachines(machinesData);
        } catch (error) {
          console.error('Failed to sync machine timers:', error);
        }
      }, 1000);

      // Server sync every 10 seconds - merge with client-side countdown
      const syncInterval = setInterval(() => {
        fetchData(false, controller.signal);
      }, 10000);

      // Safety timeout: force loading to false after 10 seconds
      const safetyTimeout = setTimeout(() => {
        if (isMountedRef.current && loadingRef.current) {
          console.warn('fetchData timeout - forcing loading to false');
          loadingRef.current = false;
          setLoading(false);
        }
      }, 10000);

      // Listen for order-created event to refresh immediately
      const handleOrderCreated = () => {
        fetchData(false, controller.signal);
      };
      window.addEventListener('order-created', handleOrderCreated);

      return () => {
        isMountedRef.current = false;
        controller.abort();
        clearInterval(timerSyncInterval);
        clearInterval(syncInterval);
        clearTimeout(safetyTimeout);
        // Clean up slider debounce timers
        Object.values(sliderDebounceRef.current).forEach((timer) => {
          if (timer) clearTimeout(timer as unknown as NodeJS.Timeout);
        });
        sliderDebounceRef.current = {};
        setCompletedMachines({});
        window.removeEventListener('order-created', handleOrderCreated);
      };
    }, []);

    // Client-side countdown for smooth real-time timer on admin machines

  // Fetch machines and pricing for walk-in form
  const fetchWalkInFormData = async () => {
    try {
      const pricing = await getPricing();
      const pricingMap: Record<string, PricingConfig> = {};
      (pricing as any[]).forEach((p: any) => {
        pricingMap[p.service_type] = p;
      });
      setWalkInPricing({ ...FALLBACK_PRICING, ...pricingMap });
    } catch (error) {
      console.error('Error fetching walk-in form data:', error);
    }
  };

  // Calculate unit price based on service type and total quantity across all items
  const calculateUnitPrice = (serviceType: string, quantity: number, allItems: typeof walkInItems = walkInItems) => {
    const totalQty = allItems
      .filter(item => item.service_type === serviceType)
      .reduce((sum, item) => sum + item.quantity, 0);
    const pricingMap = new Map<string, PricingConfig>(
      Object.entries(walkInPricing) as [string, PricingConfig][]
    );
    const total = calculatePriceWithFallback(serviceType, totalQty, pricingMap);
    return totalQty > 0 ? total / totalQty : 0;
  };

  // Calculate price using dynamic pricing from walkInPricing, fallback to hardcoded
  const calculatePriceWithDynamic = (serviceType: string, quantity: number): number => {
    const pricingMap = new Map<string, PricingConfig>(
      Object.entries(walkInPricing) as [string, PricingConfig][]
    );
    return calculatePriceWithFallback(serviceType, quantity, pricingMap);
  };

  // Helper to get merged pricing
  const getMergedPricing = () => ({ ...FALLBACK_PRICING, ...walkInPricing });

  // Delivery fee is now calculated from configured delivery zones/bands

  // Calculate grand total using shared pricing logic
  const computeGrandTotal = () => {
    const mergedPricing = getMergedPricing();
    const pricingMap = new Map<string, PricingConfig>(
      Object.entries(mergedPricing) as [string, PricingConfig][]
    );
    let serviceTotal;
    if (showMultiItem) {
      serviceTotal = calculateGrandTotalWithMap(walkInItems, pricingMap);
    } else {
      serviceTotal = calculatePriceWithFallback(walkInForm.service_type, walkInForm.quantity, pricingMap);
    }
    const firstServiceType = showMultiItem ? (walkInItems.length > 0 ? walkInItems[0].service_type : walkInForm.service_type) : walkInForm.service_type;
    const deliveryFee = walkInForm.delivery_method === 'delivery' ? getDeliveryFee(pricingMap.get(firstServiceType) || FALLBACK_PRICING[firstServiceType]) : 0;
    return serviceTotal + deliveryFee;
  };

  const grandTotal = computeGrandTotal();

  // Phone validation helper
  const isValidPhone = (phone: string): boolean => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('9')) return true;
    if (digits.length === 11 && digits.startsWith('09')) return true;
    if (digits.length === 12 && digits.startsWith('639')) return true;
    return false;
  };

  // Email validation helper
  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Add walk-in item
  const addItem = () => {
    const newServiceType = 'Wash & Fold (Clothes)';
    const newItems = [...walkInItems, { service_type: newServiceType, quantity: 1, unit_price: 0 }];
    const updatedItems = newItems.map(item => {
      if (item.service_type === newServiceType) {
        return { ...item, unit_price: calculateUnitPrice(newServiceType, item.quantity, newItems) };
      }
      return item;
    });
    setWalkInItems(updatedItems);
  };

  // Update walk-in item
  const updateItem = (index: number, field: string, value: string | number) => {
    const newItems = [...walkInItems];
    if (field === 'quantity') {
      const qty = parseInt(value as string) || 1;
      const serviceType = newItems[index].service_type;
      newItems[index] = { ...newItems[index], quantity: qty };
      newItems.forEach((item, i) => {
        if (item.service_type === serviceType) {
          newItems[i] = { ...item, unit_price: calculateUnitPrice(serviceType, item.quantity, newItems) };
        }
      });
    } else if (field === 'service_type') {
      const oldServiceType = newItems[index].service_type;
      const newServiceType = value as string;
      newItems[index] = { ...newItems[index], service_type: newServiceType };
      newItems.forEach((item, i) => {
        if (item.service_type === oldServiceType) {
          newItems[i] = { ...item, unit_price: calculateUnitPrice(oldServiceType, item.quantity, newItems) };
        }
      });
      newItems.forEach((item, i) => {
        if (item.service_type === newServiceType) {
          newItems[i] = { ...item, unit_price: calculateUnitPrice(newServiceType, item.quantity, newItems) };
        }
      });
    }
    setWalkInItems(newItems);
  };

  // Remove walk-in item
  const removeItem = (index: number) => {
    const serviceType = walkInItems[index].service_type;
    const newItems = walkInItems.filter((_, i) => i !== index);
    const updatedItems = newItems.map(item => {
      if (item.service_type === serviceType) {
        return { ...item, unit_price: calculateUnitPrice(serviceType, item.quantity, newItems) };
      }
      return item;
    });
    setWalkInItems(updatedItems);
  };

  // Reset form
  const resetForm = () => {
    setWalkInForm({
      customer_name: '',
      customer_phone: '',
      customer_email: '',
      service_type: 'Wash & Fold (Clothes)',
      quantity: 1,
      special_instructions: '',
      appointment_date: '',
      appointment_time: '',
       delivery_method: 'pickup',
       address: '',
       payment_status: 'unpaid',
       delivery_zone_id: null,
     });
    setWalkInItems([{ service_type: 'Wash & Fold (Clothes)', quantity: 1, unit_price: 0 }]);
    setShowMultiItem(false);
    setShowConfirmation(false);
  };

  // Handle walk-in form submission (show confirmation)
  const handleWalkInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWalkInError(null);
    if (!walkInForm.customer_name.trim()) {
      addToast({ type: 'error', message: 'Please enter your name' });
      return;
    }
    if (!walkInForm.customer_phone.trim()) {
      addToast({ type: 'error', message: 'Please enter your phone number' });
      return;
    }
    if (!isValidPhone(walkInForm.customer_phone.trim())) {
      addToast({ type: 'error', message: 'Please enter a valid Philippine phone number (e.g., 9123456789)' });
      return;
    }
    if (walkInForm.customer_email.trim() && !isValidEmail(walkInForm.customer_email.trim())) {
      addToast({ type: 'error', message: 'Please enter a valid email address' });
      return;
    }
    if (walkInForm.delivery_method === 'delivery' && !walkInForm.address.trim()) {
      addToast({ type: 'error', message: 'Please enter your address for delivery' });
      return;
    }
    if (showMultiItem) {
      const invalidItems = walkInItems.filter(item => !item.quantity || item.quantity < 1);
      if (invalidItems.length > 0) {
        addToast({ type: 'error', message: 'Please enter valid quantities for all items' });
        return;
      }
    }
    setShowConfirmation(true);
  };

  // Handle confirmed order
  const handleConfirmOrder = async () => {
    setConfirmationLoading(true);
    try {
      if (showMultiItem) {
        const invalidItems = walkInItems.filter(item => !item.quantity || item.quantity < 1);
        if (invalidItems.length > 0) {
          addToast({ type: 'error', message: 'Please enter valid quantities for all items' });
          setConfirmationLoading(false);
          return;
        }
      }
      const body = showMultiItem && walkInItems.length > 0
        ? {
            ...walkInForm,
            items: walkInItems.map(item => ({
              service_type: item.service_type,
              quantity: item.quantity,
              unit_price: item.unit_price,
            })),
          }
        : walkInForm;

      const result = await createWalkInOrder(body);
      setSubmittedWalkInItems(walkInItems);
      setCreatedWalkInTransaction(result);
      setShowWalkInSuccess(true);
      setShowConfirmation(false);
      resetForm();
      window.dispatchEvent(new CustomEvent('order-created'));
      await fetchData();
    } catch (err: any) {
      setWalkInError(err.message || 'Failed to create walk-in order');
    } finally {
      setConfirmationLoading(false);
    }
  };

  // Fetch walk-in form data when subView changes to walk-in
  useEffect(() => {
    if (subView === 'walk-in') {
      fetchWalkInFormData();
    }
  }, [subView]);

  const updateStatus = async (id: number, status: TransactionStatus, price?: number, weight?: number, payment_status?: string, machine_id?: number | null, service_type?: string, dryingTime?: number, remainingTime?: number): Promise<boolean> => {
     try {
       const res = await fetch(`/api/transactions/${id}`, {
         method: 'PATCH',
         ...getAuthFetchOptions(),
         body: JSON.stringify({ status, total_price: price, weight, payment_status, machine_id, service_type, drying_time: dryingTime, remaining_time: remainingTime }),
       });

      const data = await parseResponseJson(res);
      if (!data.success) {
        alert(data.error || 'Failed to update transaction');
        return false;
      }

      await fetchData();
      return true;
    } catch (error) {
      console.error(error);
      addToast({ type: 'error', message: 'Failed to update transaction' });
      return false;
    }
  };

  // Assign a machine without starting its timer
  const assignMachineToTransaction = async (transactionId: number, machineId: number, currentStatus: TransactionStatus, currentPrice: number, currentWeight: number, currentPaymentStatus: string) => {
    
    if (!machineId) return;
     
     // Check if machine is already being assigned
     if (assigningMachine === machineId) return; // Prevent race condition for same machine
     
     // Verify machine is available
     const machine = machines.find(m => m.id === machineId);
       if (!machine || machine.status !== 'available') {
        addToast({ type: 'error', message: 'Machine is no longer available' });
        return;
      }
     
     setAssigningMachine(machineId);
    
    try {
      // 1. Update transaction with machine_id
      const transactionRes = await fetch(`/api/transactions/${transactionId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_id: machineId,
          status: currentStatus,
          total_price: currentPrice,
          weight: currentWeight,
          payment_status: currentPaymentStatus
        }),
      });
      
      const transactionData = await parseResponseJson(transactionRes);
      if (!transactionData.success) {
        throw new Error(transactionData.error || 'Failed to assign machine to transaction');
      }

      // Queue integration removed - machine assignment is manual

       // Clean up selectedMachineId for this transaction
       setSelectedMachineId(prev => {
         const newState = { ...prev };
         delete newState[transactionId];
         return newState;
       });

       // Keep selected machine so admin doesn't need to re-select
       await fetchData();
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : 'Failed to assign machine');
    } finally {
      setAssigningMachine(null);
    }
  };

  const updateMachineStatus = async (id: number, status: string, remaining_time?: number | null, drying_time?: number | null) => {
    // Store previous state for potential rollback
    let previousMachine: Machine | undefined;
    let newRemainingTime: number = 0;
    let newDryingTime: number = 0;
    
    setMachines(prevMachines => {
      const machine = prevMachines.find(m => m.id === id);
      previousMachine = machine ? { ...machine } : undefined;
      
      newRemainingTime = remaining_time !== undefined
        ? (remaining_time === null ? 0 : remaining_time)
        : (machine?.remaining_time ?? 0);
      newDryingTime = drying_time !== undefined
        ? (drying_time === null ? 0 : drying_time)
        : (machine?.drying_time ?? 0);

      if (status === 'available' || status === 'maintenance') {
        newRemainingTime = 0;
        newDryingTime = 0;
      }
      
      // Clear completion tracking when status changes to available
      if (status === 'available') {
        setCompletedMachines(prev => {
          const newState = { ...prev };
          delete newState[id];
          return newState;
        });
      }
      
      return prevMachines.map(m => m.id === id ? {
        ...m,
        status: status as Machine['status'],
        remaining_time: newRemainingTime,
        drying_time: newDryingTime,
      } : m);
    });

    try {
      const res = await fetch(`/api/machines/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, remaining_time: newRemainingTime, drying_time: newDryingTime }),
      });

      const data = await parseResponseJson(res);
      if (!data.success) {
        throw new Error(data.error || 'Failed to update machine');
      }

      fetchData();
    } catch (error) {
      console.error(error);
      addToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to update machine' });
      // Rollback optimistic update
      const machineToRestore = previousMachine;
      if (machineToRestore) {
        setMachines(prevMachines =>
          prevMachines.map(m => m.id === id ? machineToRestore : m)
        );
      }
      // The fetchData() will refresh from server on next interval
    }
  };

  const updateMachineTimer = (
    machine: Machine,
    field: 'remaining_time' | 'drying_time',
    value: number,
    saveImmediately = false,
  ) => {
    const timerKey = `${machine.id}-${field}`;
    const updatedMachine = { ...machine, [field]: value };
    setMachines(prev => prev.map(m => m.id === machine.id ? updatedMachine : m));

    if (sliderDebounceRef.current[timerKey]) {
      clearTimeout(sliderDebounceRef.current[timerKey]);
    }

    const saveTimer = () => updateMachineStatus(
      machine.id,
      machine.status,
      updatedMachine.remaining_time,
      updatedMachine.drying_time,
    );

    if (saveImmediately) {
      saveTimer();
    } else {
      sliderDebounceRef.current[timerKey] = setTimeout(() => {
        delete sliderDebounceRef.current[timerKey];
        saveTimer();
      }, 300);
    }
  };

  // Upload handwash proof image
  const uploadHandwashProof = async (transactionId: number, file: File) => {
    setHandwashUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      
      const res = await fetch(`/api/transactions/${transactionId}/handwash-proof`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      
      if (!res.ok) {
        const errorData = await parseResponseJson(res);
        throw new Error(errorData.error || 'Failed to upload handwash proof');
      }
      
      setHandwashUpload(null);
      fetchData();
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      setHandwashUploading(false);
    }
  };

  // Handle file selection for handwash proof
  const handleHandwashFileSelect = (transactionId: number) => {
    setHandwashUpload(transactionId);
    setSelectedFile(null);
    setFilePreview(null);
    setUploadError(null);
  };

  // Handle actual file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || handwashUpload === null) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file');
      return;
    }
    
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image size must be less than 5MB');
      return;
    }
    
    setUploadError(null);
    setSelectedFile(file);
    
    // Create preview
    const reader = new FileReader();
    reader.onload = () => {
      setFilePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Upload the selected file
  const handleFileUpload = async () => {
    if (!selectedFile || handwashUpload === null) return;
    
    setUploadError(null);
    setHandwashUploading(true);
    
    try {
      await uploadHandwashProof(handwashUpload, selectedFile);
      setSelectedFile(null);
      setFilePreview(null);
      setHandwashUpload(null);
    } catch (error) {
      setUploadError('Failed to upload image. Please try again.');
    } finally {
      setHandwashUploading(false);
    }
  };

  // Cancel upload
  const cancelHandwashUpload = () => {
    setHandwashUpload(null);
    setSelectedFile(null);
    setFilePreview(null);
    setUploadError(null);
  };

  if (loading && transactions.length === 0) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <AdminNavbar setView={setView} />
        <div className="flex items-center justify-center min-h-screen pt-20">
          <Loader2 className="w-12 h-12 text-blue-500 " />
        </div>
      </div>
    );
  }

  // If viewing sales, customers, reviews, or new-order, show those components but still fetch data
  // The Recent Activity table is only shown on the dashboard tab
  // Using switch to avoid TypeScript control flow narrowing warnings
  const renderSubView = () => {
    switch (subView) {
      case 'sales': {
        return (
          <SalesReports setView={(v: string) => setSubView('dashboard')} />
        );
      }
      case 'customers': {
        return (
          <CustomerAccounts setView={(v: string) => setSubView('dashboard')} />
        );
      }
      case 'reviews': {
        return (
          <CustomerReviews setView={(v: string) => setSubView('dashboard')} />
        );
      }
      case 'machines': {
        return (
          <div>
              <div className="mb-8">
                <button
                  onClick={() => setSubView('dashboard')}
                  className="text-zinc-500 hover:text-zinc-900 font-black text-sm uppercase tracking-widest flex items-center gap-2 mb-4"
                >
                  <ChevronRight className="w-4 h-4 rotate-180" /> Back to Dashboard
                </button>
                <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tighter">Machine Management</h1>
                <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs mt-1">Add, edit, and manage your laundry machines</p>
              </div>
              
              {/* Add Machine Form */}
              <div className="bg-white rounded-3xl p-6 border-4 border-zinc-50 shadow-xl mb-8">
                <h2 className="text-xl font-black text-zinc-900 mb-6">Add New Machine</h2>
                <form onSubmit={handleAddMachine} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Machine Name *</label>
                    <input
                      required
                      type="text"
                      value={newMachine.name}
                      onChange={e => setNewMachine({...newMachine, name: e.target.value})}
                      className="w-full p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold"
                      placeholder="e.g., Premium Washer 1"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Type *</label>
                    <select
                      value={newMachine.type}
                      onChange={e => setNewMachine({...newMachine, type: e.target.value as 'washer' | 'dryer' | 'all-in-one'})}
                      className="w-full p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold"
                    >
                      <option value="washer">Washer</option>
                      <option value="dryer">Dryer</option>
                      <option value="all-in-one">All-in-One</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Capacity (kg) *</label>
                    <input
                      required
                      type="number"
                      min="1"
                      max="100"
                      value={newMachine.capacity}
                      onChange={e => setNewMachine({...newMachine, capacity: parseInt(e.target.value) || 10})}
                      className="w-full p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold"
                      placeholder="10"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={addingMachine}
                    className="px-6 py-3 bg-blue-500 text-white rounded-xl font-black hover:bg-blue-600 transition-colors flex items-center justify-center gap-2"
                  >
                    {addingMachine ? <Loader2 className="w-5 h-5 " /> : 'Add Machine'}
                  </button>
                </form>
              </div>
              
              {/* Machines List */}
               <div className="bg-white rounded-3xl border-4 border-zinc-50 shadow-xl overflow-hidden">
                 <div className="p-6 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                   <h2 className="text-xl font-black text-zinc-900">Your Machines</h2>
                   {machines.length > 0 && (
                     <button
                       onClick={handleDeleteAllMachines}
                       disabled={deletingMachine !== null}
                       className="px-4 py-2 bg-rose-500/10 text-rose-500 rounded-xl font-black text-sm uppercase tracking-widest hover:bg-rose-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                     >
                       {deletingMachine !== null ? <Loader2 className="w-4 h-4 inline mr-2" /> : null}
                       Delete All Machines
                     </button>
                   )}
                 </div>
                {machines.length === 0 ? (
                  <div className="p-12 text-center">
                    <Waves className="w-16 h-16 mx-auto text-zinc-200 mb-4" />
                    <p className="text-zinc-500 font-bold">No machines yet</p>
                    <p className="text-zinc-400 text-sm mt-2">Add your first machine using the form above</p>
                  </div>
                ) : (
                  <div className="p-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {machines.map((machine) => (
                          <div key={machine.id} className="group bg-zinc-50 rounded-2xl border-2 border-zinc-100 p-5 hover:border-zinc-200 hover:shadow-lg transition-all duration-200 flex flex-col">
                            <div className="flex items-start justify-between mb-4">
                              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                                machine.type === 'washer' ? 'bg-blue-100 text-blue-600' :
                                machine.type === 'dryer' ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'
                              }`}>
                                {machine.type === 'washer' ? <Waves className="w-6 h-6" /> :
                                 machine.type === 'dryer' ? <Zap className="w-6 h-6" /> :
                                 <div className="relative">
                                   <Waves className="w-4 h-4 absolute -top-1 -left-1 opacity-50" />
                                   <Zap className="w-4 h-4 absolute -bottom-1 -right-1" />
                                 </div>
                                }
                              </div>
                            </div>
                          <h3 className="font-bold text-zinc-900 text-base mb-1 truncate">{machine.name}</h3>
                          <div className="flex items-center gap-3 text-sm text-zinc-500 mb-3">
                            <span className="capitalize text-zinc-600">{machine.type.replace('-', ' ')}</span>
                            <span className="text-zinc-300">•</span>
                            <span>{machine.capacity} kg</span>
                          </div>
                          <div className="flex items-center justify-between mt-auto pt-3 border-t border-zinc-100">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                              machine.status === 'available' ? 'bg-emerald-100 text-emerald-600' :
                              machine.status === 'in-use' ? 'bg-blue-100 text-blue-600' : 'bg-rose-100 text-rose-600'
                            }`}>
                              {machine.status}
                            </span>
                            <select
                              value={machine.status}
                              onChange={e => handleUpdateMachine(machine.id, { status: e.target.value as 'available' | 'in-use' | 'maintenance' })}
                              className="p-1.5 bg-zinc-100 border border-zinc-200 rounded-lg font-bold text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="available">Available</option>
                              <option value="in-use">In Use</option>
                              <option value="maintenance">Maintenance</option>
                            </select>
                          </div>
                        </div>
                       ))}
                     </div>
                   </div>
                 )}
                 </div>
                 </div>
           );
         }
         case 'pricing': {
        return (
          <div>
              <div className="mb-8">
                <button
                  onClick={() => setSubView('dashboard')}
                  className="text-zinc-500 hover:text-zinc-900 font-black text-sm uppercase tracking-widest flex items-center gap-2 mb-4"
                >
                  <ChevronRight className="w-4 h-4 rotate-180" /> Back to Dashboard
                </button>
                <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tighter">Pricing Management</h1>
                <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs mt-1">Manage service prices and view price history</p>
              </div>
              
              {/* Current Pricing */}
                <div className="bg-white rounded-3xl border-4 border-zinc-50 shadow-xl mb-8">
                  <div className="p-6 border-b border-zinc-100">
                    <h2 className="text-xl font-black text-zinc-900">Current Pricing</h2>
                  </div>
                  {pricing.length === 0 ? (
                    <div className="p-12 text-center">
                      <DollarSign className="w-16 h-16 mx-auto text-zinc-200 mb-4" />
                      <p className="text-zinc-500 font-bold">No pricing configured</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-100">
                      {pricing.map((p) => {
                        const ServiceIcon = getServiceIcon(p.service_type);
                        const [iconColor, iconBg] = getServiceColor(p.service_type).split(' ');
                        return (
                          <div key={p.id} className="p-4 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex min-w-0 items-start sm:items-center gap-3 sm:gap-4">
                              <div className={`w-10 h-10 sm:w-14 sm:h-14 shrink-0 rounded-2xl flex items-center justify-center ${iconBg}`}>
                                <ServiceIcon className={`w-7 h-7 ${iconColor}`} />
                              </div>
                              <div className="min-w-0">
                                <h3 className="font-bold text-zinc-900 text-base sm:text-lg break-words">{p.service_type}</h3>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-zinc-900 mt-1">
                                  <span className="capitalize">{p.pricing_type === 'tiered' ? 'Tiered' : 'Per kg/piece'}</span>
                                  {p.pricing_type === 'tiered' ? (
                                    <>
                                      <span>•</span>
                                      <span>1-{p.tier_1_limit}: ₱{p.tier_1_price}</span>
                                      <span>•</span>
                                      <span>{p.tier_1_limit + 1}-{p.tier_2_limit}: ₱{p.tier_2_price}</span>
                                      <span>•</span>
                                      <span>{p.tier_2_limit + 1}-{p.tier_3_limit}: ₱{p.tier_3_price}</span>
                                      <span>•</span>
                                      <span>{p.tier_3_limit + 1}-{p.tier_4_limit}: ₱{p.tier_4_price}</span>
                                      <span>•</span>
                                      <span>{p.tier_4_limit + 1}+: ₱{p.tier_5_price_per_kg}/kg</span>
                                    </>
                                  ) : (
                                    <>
                                      <span>•</span>
                                      <span>₱{p.per_kg_price}/kg</span>
                                    </>
                                  )}
                                   <span>•</span>
                                   <span className="text-blue-600 font-bold">Delivery: ₱{p.delivery_fee}</span>
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => setEditingPricing(p)}
                              className="w-full md:w-auto px-4 py-2 bg-blue-500 text-white rounded-lg font-bold hover:bg-blue-600 transition-colors"
                            >
                              Edit
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              
              {/* Edit Pricing Modal */}
              {editingPricing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50">
                  <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                    <div className="p-4 sm:p-6 border-b border-zinc-100">
                      <h2 className="text-lg sm:text-2xl font-black text-zinc-900 break-words">Edit Pricing: {editingPricing.service_type}</h2>
                    </div>
                    <form onSubmit={handleUpdatePricing} className="p-4 sm:p-6 space-y-6">
                      <input type="hidden" name="service_type" value={editingPricing.service_type} />
                      <input type="hidden" name="pricing_type" value={editingPricing.pricing_type} />
                      
                      {editingPricing.pricing_type === 'tiered' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">1-{editingPricing.tier_1_limit} kg</label>
                            <input
                              type="number"
                              name="tier_1_price"
                              defaultValue={editingPricing.tier_1_price}
                              className="w-full p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold"
                              min="0"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">{editingPricing.tier_1_limit + 1}-{editingPricing.tier_2_limit} kg</label>
                            <input
                              type="number"
                              name="tier_2_price"
                              defaultValue={editingPricing.tier_2_price}
                              className="w-full p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold"
                              min="0"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">{editingPricing.tier_2_limit + 1}-{editingPricing.tier_3_limit} kg</label>
                            <input
                              type="number"
                              name="tier_3_price"
                              defaultValue={editingPricing.tier_3_price}
                              className="w-full p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold"
                              min="0"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">{editingPricing.tier_3_limit + 1}-{editingPricing.tier_4_limit} kg</label>
                            <input
                              type="number"
                              name="tier_4_price"
                              defaultValue={editingPricing.tier_4_price}
                              className="w-full p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold"
                              min="0"
                            />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">{editingPricing.tier_4_limit + 1}+ kg (per kg)</label>
                            <input
                              type="number"
                              name="tier_5_price_per_kg"
                              defaultValue={editingPricing.tier_5_price_per_kg}
                              className="w-full p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold"
                              min="0"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Price per kg/piece</label>
                          <input
                            type="number"
                            name="per_kg_price"
                            defaultValue={editingPricing.per_kg_price}
                            className="w-full p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold"
                            min="0"
                          />
                        </div>
                      )}
                      
                       <div className="space-y-2 pt-4 border-t border-zinc-100">
                          <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Delivery Fee (₱)</label>
                          <input
                            type="number"
                            name="delivery_fee"
                            defaultValue={editingPricing.delivery_fee}
                            className="w-full p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold"
                            min="0"
                          />
                          <p className="text-[10px] text-zinc-400">Default is ₱50. Only applies to Pick-up & Delivery orders. Drop-off orders have ₱0 delivery fee.</p>
                        </div>

                       <div className="flex gap-4 pt-4 border-t border-zinc-100">
                         <button
                           type="button"
                           onClick={() => setEditingPricing(null)}
                           className="flex-1 py-3 bg-zinc-100 text-zinc-900 rounded-lg font-bold hover:bg-zinc-200 transition-colors"
                         >
                           Cancel
                         </button>
                         <button
                           type="submit"
                           disabled={updatingPricing}
                           className="flex-1 py-3 bg-blue-500 text-white rounded-lg font-bold hover:bg-blue-600 transition-colors flex items-center justify-center gap-2"
                         >
                           {updatingPricing ? <Loader2 className="w-5 h-5 " /> : 'Save Changes'}
                         </button>
                       </div>
                    </form>
                  </div>
                </div>
              )}
              
              {/* Price History */}
              <div className="bg-white rounded-3xl border-4 border-zinc-50 shadow-xl">
                <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
                  <h2 className="text-xl font-black text-zinc-900">Price History</h2>
                  {priceHistory.length > 0 && (
                    <button
                      onClick={handleDeletePriceHistory}
                      disabled={deletingPriceHistory}
                      className="inline-flex items-center justify-center flex-shrink-0 px-4 py-2 bg-red-600 border-2 border-red-700 text-white hover:bg-red-700 hover:border-red-800 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 shadow-md hover:shadow-lg min-h-[44px] text-xs font-black uppercase tracking-widest gap-1"
                      title="Delete all price history"
                      aria-label="Delete all price history"
                    >
                      <Trash2 className="w-4 h-4" /> {deletingPriceHistory ? 'Deleting...' : 'Delete All'}
                    </button>
                  )}
                </div>
                {priceHistory.length === 0 ? (
                  <div className="p-12 text-center">
                    <Clock className="w-16 h-16 mx-auto text-zinc-200 mb-4" />
                    <p className="text-zinc-500 font-bold">No price changes recorded</p>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-100">
                    {priceHistory.map((h) => (
                      <div key={h.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                          <h3 className="font-bold text-zinc-900">{h.service_type}</h3>
                          <p className="text-sm text-zinc-500 mt-1">
                            {new Date(h.created_at).toLocaleString()} by {h.changed_by}
                          </p>
                        </div>
                        <button
                          onClick={() => showPriceChangeDetails(h)}
                          className="px-4 py-2 bg-zinc-100 text-zinc-700 rounded-lg font-bold hover:bg-zinc-200 transition-colors"
                        >
                          View Details
                        </button>
                        </div>
                      ))}
                    </div>
                  )}
            </div>
                </div>
          );
        }
        case 'delivery': {
          return (
            <div>
              <div className="mb-8">
                <button onClick={() => setSubView('dashboard')} className="text-zinc-500 hover:text-zinc-900 font-black text-sm uppercase tracking-widest flex items-center gap-2 mb-4">
                  <ChevronRight className="w-4 h-4 rotate-180" /> Back to Dashboard
                </button>
                 <h1 className="text-3xl font-extrabold text-zinc-900 tracking-tighter">Delivery Settings</h1>
                 <p className="text-zinc-500 font-medium text-sm mt-1">Set where your shop is and how delivery prices change by distance. Customers will see the delivery cost before checkout.</p>
              </div>

               {/* Visual preview */}
               <div className="bg-white rounded-3xl border-4 border-zinc-50 shadow-xl mb-8 p-6">
                 <h2 className="text-xl font-black text-zinc-900 mb-2">Delivery Area Preview</h2>
                 <p className="text-sm text-zinc-500 mb-4">This is the area where delivery is available.</p>
                 <img
                   alt="Delivery area preview"
                   src={`https://static-maps.yandex.ru/1.x/?ll=${deliveryConfig?.origin?.longitude || 120.3167},${deliveryConfig?.origin?.latitude || 16.6159}&z=14&l=map&pt=${deliveryConfig?.origin?.longitude || 120.3167},${deliveryConfig?.origin?.latitude || 16.6159},pm2rdm`}
                   style={{ height: '240px', width: '100%', borderRadius: '16px', border: '2px solid #e5e7eb', objectFit: 'cover' }}
                 />
               </div>

               {/* Origin */}
               <div className="bg-white rounded-3xl border-4 border-zinc-50 shadow-xl mb-8 p-6">
                <h2 className="text-xl font-black text-zinc-900 mb-4">Delivery Origin</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input id="origin-name" placeholder="Name" defaultValue={deliveryConfig?.origin?.name || ''} className="p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold" />
                  <input id="origin-address" placeholder="Address" defaultValue={deliveryConfig?.origin?.address || ''} className="p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold" />
                  <input id="origin-lat" placeholder="Latitude" type="number" step="any" defaultValue={deliveryConfig?.origin?.latitude || 0} className="p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold" />
                  <input id="origin-lng" placeholder="Longitude" type="number" step="any" defaultValue={deliveryConfig?.origin?.longitude || 0} className="p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold" />
                </div>
                <button
                  onClick={async () => {
                    const name = (document.getElementById('origin-name') as HTMLInputElement).value;
                    const address = (document.getElementById('origin-address') as HTMLInputElement).value;
                    const latitude = parseFloat((document.getElementById('origin-lat') as HTMLInputElement).value);
                    const longitude = parseFloat((document.getElementById('origin-lng') as HTMLInputElement).value);
                    await fetch('/api/delivery/origin', { method: 'PUT', ...getAuthFetchOptions(), body: JSON.stringify({ name, address, latitude, longitude }) });
                    const res = await fetch('/api/delivery/config', { credentials: 'include' });
                    const json = await res.json();
                    if (json.success && json.data) setDeliveryConfig(json.data);
                  }}
                  className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg font-bold"
                >
                  Save Origin
                </button>
              </div>

              {/* Zones */}
              <div className="bg-white rounded-3xl border-4 border-zinc-50 shadow-xl mb-8 p-6">
                <h2 className="text-xl font-black text-zinc-900 mb-4">Delivery Zones</h2>
                <div className="space-y-2 mb-4">
                  {deliveryConfig?.zones?.map(z => (
                    <div key={z.id} className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl">
                      <span className="font-bold">{z.name} ({z.latitude}, {z.longitude})</span>
                      <button onClick={async () => {
                        await fetch(`/api/delivery/zones/${z.id}`, { method: 'DELETE', ...getAuthFetchOptions() });
                        const res = await fetch('/api/delivery/config', { credentials: 'include' });
                        const json = await res.json();
                        if (json.success && json.data) setDeliveryConfig(json.data);
                      }} className="text-rose-600 font-bold">Delete</button>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input id="zone-name" placeholder="Zone name" className="p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold" />
                  <input id="zone-lat" placeholder="Latitude" type="number" step="any" className="p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold" />
                  <input id="zone-lng" placeholder="Longitude" type="number" step="any" className="p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold" />
                  <button onClick={async () => {
                    const name = (document.getElementById('zone-name') as HTMLInputElement).value;
                    const latitude = parseFloat((document.getElementById('zone-lat') as HTMLInputElement).value);
                    const longitude = parseFloat((document.getElementById('zone-lng') as HTMLInputElement).value);
                    await fetch('/api/delivery/zones', { method: 'POST', ...getAuthFetchOptions(), body: JSON.stringify({ name, latitude, longitude }) });
                    const res = await fetch('/api/delivery/config', { credentials: 'include' });
                    const json = await res.json();
                    if (json.success && json.data) setDeliveryConfig(json.data);
                  }} className="px-4 py-2 bg-blue-500 text-white rounded-lg font-bold">Add Zone</button>
                </div>
              </div>

              {/* Bands */}
              <div className="bg-white rounded-3xl border-4 border-zinc-50 shadow-xl mb-8 p-6">
                <h2 className="text-xl font-black text-zinc-900 mb-4">Distance Bands (Pricing)</h2>
                <div className="space-y-2 mb-4">
                  {deliveryConfig?.bands?.map(b => (
                    <div key={b.id} className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl">
                      <span className="font-bold">{b.min_km} - {b.max_km} km: ₱{b.fee}</span>
                      <button onClick={async () => {
                        await fetch(`/api/delivery/bands/${b.id}`, { method: 'DELETE', ...getAuthFetchOptions() });
                        const res = await fetch('/api/delivery/config', { credentials: 'include' });
                        const json = await res.json();
                        if (json.success && json.data) setDeliveryConfig(json.data);
                      }} className="text-rose-600 font-bold">Delete</button>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <input id="band-min" placeholder="Min km" type="number" step="any" className="p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold" />
                  <input id="band-max" placeholder="Max km" type="number" step="any" className="p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold" />
                  <input id="band-fee" placeholder="Fee" type="number" step="any" className="p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold" />
                  <input id="band-order" placeholder="Order" type="number" className="p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold" />
                  <button onClick={async () => {
                    const min_km = parseFloat((document.getElementById('band-min') as HTMLInputElement).value);
                    const max_km = parseFloat((document.getElementById('band-max') as HTMLInputElement).value);
                    const fee = parseFloat((document.getElementById('band-fee') as HTMLInputElement).value);
                    const sort_order = parseInt((document.getElementById('band-order') as HTMLInputElement).value);
                    await fetch('/api/delivery/bands', { method: 'POST', ...getAuthFetchOptions(), body: JSON.stringify({ min_km, max_km, fee, sort_order }) });
                    const res = await fetch('/api/delivery/config', { credentials: 'include' });
                    const json = await res.json();
                    if (json.success && json.data) setDeliveryConfig(json.data);
                  }} className="px-4 py-2 bg-blue-500 text-white rounded-lg font-bold">Add Band</button>
                </div>
              </div>
            </div>
          );
        }
        case 'walk-in': {
        return (
          <div>
            <div className="max-w-5xl mx-auto">
              {/* Header */}
               <div className="mb-8">
                 <button
                   onClick={() => setSubView('dashboard')}
                  className="text-zinc-500 hover:text-zinc-900 font-black text-sm uppercase tracking-widest flex items-center gap-2 mb-4"
                >
                  <ArrowRight className="w-4 h-4 rotate-180" /> Back to Dashboard
                </button>
                <h1 className="text-3xl sm:text-4xl font-extrabold text-zinc-900 tracking-tighter flex items-center gap-3">
                  <Store className="w-8 h-8 text-amber-600" /> Walk-In Orders
                </h1>
                <p className="text-zinc-500 font-bold text-xs mt-1">Register walk-in or call-in orders</p>
              </div>

              {/* Walk-In Order Form */}
               <div className="space-y-6">
                 <form onSubmit={handleWalkInSubmit} className="space-y-6">
                    {/* Error Alert */}
                    {walkInError && (
                      <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                        <p className="text-red-700 font-bold text-sm">{walkInError}</p>
                      </div>
                    )}

                    {/* Customer Info Card */}
                    <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-6 sm:p-8">
                      <h2 className="text-lg font-black text-zinc-900 mb-6 flex items-center gap-2">
                        <User className="w-5 h-5 text-blue-600" /> Customer Information
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                            <User className="w-3 h-3" /> Full Name *
                          </label>
                          <input
                            required
                            type="text"
                            value={walkInForm.customer_name}
                            onChange={e => setWalkInForm({...walkInForm, customer_name: e.target.value})}
                            className="w-full p-4 bg-zinc-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                            placeholder="Customer full name"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                            <Phone className="w-3 h-3" /> Phone *
                          </label>
                          <input
                            required
                            type="tel"
                            value={walkInForm.customer_phone}
                            onChange={e => setWalkInForm({...walkInForm, customer_phone: e.target.value.replace(/\D/g, '').slice(0, 12)})}
                            className="w-full p-4 bg-zinc-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                            placeholder="9123456789 or 09123456789"
                            maxLength={12}
                            inputMode="numeric"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                            <Mail className="w-3 h-3" /> Email <span className="text-zinc-500 font-normal">(Optional)</span>
                          </label>
                          <input
                            type="email"
                            value={walkInForm.customer_email}
                            onChange={e => setWalkInForm({...walkInForm, customer_email: e.target.value})}
                            className="w-full p-4 bg-zinc-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                            placeholder="customer@email.com"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Multi-Item Toggle */}
                    <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border-2 border-zinc-200">
                      <div>
                        <p className="text-sm font-black text-zinc-900">Add Multiple Items</p>
                        <p className="text-[10px] text-zinc-500">Combine multiple services in one order</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMultiItem(!showMultiItem);
                          if (!showMultiItem && walkInItems.length === 0) {
                            addItem();
                          }
                        }}
                        className={`w-12 h-6 rounded-full transition-colors flex items-center px-1 ${
                          showMultiItem ? 'bg-blue-500' : 'bg-zinc-300'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                          showMultiItem ? 'translate-x-6' : 'translate-x-0'
                        }`} />
                      </button>
                    </div>

                    {/* Order Details Card */}
                    <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-6 sm:p-8">
                      <h2 className="text-lg font-black text-zinc-900 mb-6 flex items-center gap-2">
                        <Package className="w-5 h-5 text-blue-600" /> Order Details
                      </h2>
                      {showMultiItem ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-lg font-black text-zinc-900">Items</h3>
                            <button
                              type="button"
                              onClick={addItem}
                              className="px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-black hover:bg-blue-600 transition-colors flex items-center gap-1"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                              Add Item
                            </button>
                          </div>
                          {walkInItems.map((item, index) => (
                            <div key={index} className="bg-zinc-50 p-4 rounded-2xl border-2 border-zinc-200 space-y-4">
                              <div className="flex justify-between items-start">
                                <h4 className="text-sm font-black text-zinc-900">Item {index + 1}</h4>
                                {walkInItems.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeItem(index)}
                                    className="text-rose-500 hover:text-rose-600 text-sm font-bold"
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="text-[10px] font-black text-zinc-400 uppercase">Service</label>
                                  <select
                                    value={item.service_type}
                                    onChange={e => updateItem(index, 'service_type', e.target.value)}
                                    className="w-full p-3 bg-white border-2 border-zinc-200 rounded-xl font-bold text-sm"
                                  >
                                    {Object.keys(FALLBACK_PRICING).map(service => (
                                      <option key={service} value={service}>{service}</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] font-black text-zinc-400 uppercase">Quantity</label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={item.quantity}
                                    onChange={e => updateItem(index, 'quantity', e.target.value)}
                                    className="w-full p-3 bg-white border-2 border-zinc-200 rounded-xl font-bold text-sm"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="space-y-3 md:col-span-2">
                              <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                                <Package className="w-4 h-4" /> Service
                              </label>
                              <select
                                required
                                value={walkInForm.service_type}
                                onChange={e => setWalkInForm({...walkInForm, service_type: e.target.value})}
                                className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg appearance-none"
                              >
                                {Object.keys(FALLBACK_PRICING).map(service => (
                                  <option key={service} value={service}>{service}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-3">
                              <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                                <ClipboardList className="w-4 h-4" /> {walkInForm.service_type.includes('Comforter') ? 'Quantity (pcs)' : 'Weight (kgs)'}
                              </label>
                              <input
                                required
                                type="number"
                                min="1"
                                value={walkInForm.quantity}
                                onChange={e => setWalkInForm({...walkInForm, quantity: parseInt(e.target.value) || 1})}
                                className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                              />
                            </div>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                              <DollarSign className="w-4 h-4" /> Service Price
                            </span>
                            <span className="font-bold text-lg text-blue-900">
                              ₱{calculatePriceWithFallback(walkInForm.service_type, walkInForm.quantity, new Map(Object.entries(walkInPricing) as [string, PricingConfig][])).toLocaleString('en-PH')}
                            </span>
                          </div>
                        </div>
                      )}
                      {/* Special Instructions, Appointment Date/Time */}
                      <div className="space-y-4 pt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          <div className="space-y-3">
                            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                              <Calendar className="w-4 h-4" /> Date
                            </label>
                            <input
                              required
                              type="date"
                              value={walkInForm.appointment_date}
                              onChange={e => setWalkInForm({...walkInForm, appointment_date: e.target.value})}
                              className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                            />
                          </div>
                          <div className="space-y-3">
                            <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                              <Clock className="w-4 h-4" /> Time
                            </label>
                            <input
                              required
                              type="time"
                              value={walkInForm.appointment_time}
                              onChange={e => setWalkInForm({...walkInForm, appointment_time: e.target.value})}
                              className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                            />
                          </div>
                        </div>
                        <div className="space-y-3">
                          <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                            <Sparkles className="w-4 h-4" /> Special Instructions
                          </label>
                          <textarea
                            value={walkInForm.special_instructions}
                            onChange={e => setWalkInForm({...walkInForm, special_instructions: e.target.value})}
                            className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                            placeholder="Any special care needed? (e.g., use extra softener, delicate items)"
                            rows={2}
                          />
                        </div>
                      </div>
                      {/* Delivery & Payment */}
                      <div className="space-y-4 pt-4">
                        <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">How do we get it?</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <button
                            type="button"
                            onClick={() => setWalkInForm({...walkInForm, delivery_method: 'pickup'})}
                            className={`p-6 rounded-[32px] border-4 flex flex-col items-center gap-3 transition-all ${
                              walkInForm.delivery_method === 'pickup'
                              ? 'border-blue-500 bg-blue-50 text-blue-600'
                              : 'border-zinc-50 bg-zinc-50 text-zinc-400 hover:border-zinc-100'
                            }`}
                          >
                            <Truck className="w-8 h-8" />
                            <span className="font-black uppercase tracking-widest text-sm">Pickup</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setWalkInForm({...walkInForm, delivery_method: 'delivery'})}
                            className={`p-6 rounded-[32px] border-4 flex flex-col items-center gap-3 transition-all ${
                              walkInForm.delivery_method === 'delivery'
                              ? 'border-blue-500 bg-blue-50 text-blue-600'
                              : 'border-zinc-50 bg-zinc-50 text-zinc-400 hover:border-zinc-100'
                            }`}
                          >
                            <Package className="w-8 h-8" />
                            <span className="font-black uppercase tracking-widest text-sm">Delivery</span>
                          </button>
                        </div>
                         {walkInForm.delivery_method === 'delivery' && (
                           <div className="space-y-3">
                             {walkInQuoting && <p className="text-sm font-bold text-blue-600">Calculating delivery cost...</p>}
                             {walkInDeliveryQuote && !walkInQuoting && (
                               <p className="text-sm font-bold text-emerald-600">
                                 Estimated delivery cost: ₱{walkInDeliveryQuote.fee.toFixed(2)} ({walkInDeliveryQuote.distance_km} km)
                               </p>
                             )}
                             {walkInQuoteError && !walkInQuoting && (
                               <p className="text-sm font-bold text-rose-600">{walkInQuoteError}</p>
                             )}

                              <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                                <MapPin className="w-4 h-4" /> Where are you?
                              </label>
                              <textarea
                                required
                                value={walkInForm.address}
                                onChange={e => setWalkInForm({...walkInForm, address: e.target.value})}
                                className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                                placeholder="123 Bubble Lane..."
                                rows={3}
                              />
                            </div>
                         )}
                        <div className="space-y-3">
                          <label className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                            <Wallet className="w-4 h-4" /> Payment Status
                          </label>
                          <select
                            required
                            value={walkInForm.payment_status}
                            onChange={e => setWalkInForm({...walkInForm, payment_status: e.target.value as any})}
                            className="w-full p-5 bg-zinc-50 border-4 border-transparent rounded-3xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-lg"
                          >
                            <option value="unpaid">Unpaid</option>
                            <option value="paid">Paid</option>
                          </select>
                        </div>
                      </div>
                      {/* Total */}
                      <div className="pt-4">
                        <div className="w-full p-4 bg-blue-50 border-2 border-blue-200 rounded-2xl font-bold text-lg text-blue-900 flex justify-between items-center">
                          <span className="text-xs font-black text-zinc-400 uppercase tracking-widest">Estimated Total</span>
                          <span>₱{grandTotal.toLocaleString('en-PH')}</span>
                        </div>
                      </div>
                    </div>

                    {/* Submit Button */}
                    <button
                       disabled={walkInLoading || confirmationLoading || (walkInForm.delivery_method === 'delivery' && !walkInForm.address.trim())}
                      type="submit"
                      className="w-full py-6 bg-blue-500 text-white rounded-[32px] font-black text-2xl hover:bg-blue-600 transition-all shadow-2xl shadow-blue-200 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {walkInLoading || confirmationLoading ? (
                        <Loader2 className="w-8 h-8" />
                      ) : (
                        <>
                          <Zap className="w-8 h-8" /> Create Walk-In Order
                        </>
                      )}
                    </button>
                  </form>
               </div>

               {/* Confirmation Modal */}
               {showConfirmation && (
                 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
                   <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                     <div className="p-6 sm:p-8">
                       <div className="text-center mb-6">
                         <h2 className="text-2xl font-black text-zinc-900 tracking-tighter">Confirm Order</h2>
                         <p className="text-zinc-500 font-medium mt-1">Please confirm your walk-in order details</p>
                       </div>
                       <div className="bg-zinc-50 rounded-2xl p-5 mb-6 border-2 border-zinc-100 space-y-3">
                         <div className="flex justify-between items-center">
                           <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Customer</p>
                           <p className="font-bold text-zinc-900">{walkInForm.customer_name}</p>
                         </div>
                         <div className="flex justify-between items-center">
                           <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Phone</p>
                           <p className="font-bold text-zinc-900">{walkInForm.customer_phone}</p>
                         </div>
                         {showMultiItem && walkInItems.length > 0 && (
                           <div className="flex justify-between items-center">
                             <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Items</p>
                             <p className="font-bold text-zinc-900">{walkInItems.length} item{walkInItems.length > 1 ? 's' : ''}</p>
                           </div>
                         )}
                         <div className="flex justify-between items-center">
                           <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Service</p>
                           <p className="font-bold text-zinc-900">{walkInForm.service_type}</p>
                         </div>
                         <div className="flex justify-between items-center">
                           <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Delivery</p>
                           <p className="font-bold text-zinc-900 capitalize">{walkInForm.delivery_method}</p>
                         </div>
                         <div className="flex justify-between items-center">
                           <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Payment</p>
                           <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold capitalize">{walkInForm.payment_status}</span>
                         </div>
                         <div className="flex justify-between items-center pt-2 border-t border-zinc-200">
                           <p className="font-black text-zinc-900 uppercase tracking-widest text-sm">Total</p>
                           <p className="text-xl font-black text-blue-600">₱{grandTotal.toLocaleString('en-PH')}</p>
                         </div>
                       </div>
                       <div className="flex flex-col gap-3">
                         <button
                           onClick={handleConfirmOrder}
                           disabled={confirmationLoading}
                           className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 flex items-center justify-center gap-2 disabled:opacity-50"
                         >
                           {confirmationLoading ? (
                             <Loader2 className="w-6 h-6 " />
                           ) : (
                             <Check className="w-6 h-6" />
                           )}
                           Confirm Order
                         </button>
                         <button
                           onClick={() => setShowConfirmation(false)}
                           className="w-full py-3 bg-zinc-100 text-zinc-600 rounded-2xl font-black text-base hover:bg-zinc-200 transition-all"
                         >
                           Cancel
                         </button>
                       </div>
                     </div>
                   </div>
                 </div>
               )}

               {/* Success Popup Overlay */}
              {showWalkInSuccess && createdWalkInTransaction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50">
                   <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
                     <div className="p-6 sm:p-8">
                      <div className="text-center mb-6">
                        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <Check className="text-emerald-600 w-8 h-8" />
                        </div>
                        <h2 className="text-2xl font-black text-zinc-900 tracking-tighter">Order Created!</h2>
                        <p className="text-zinc-500 font-medium mt-1">Your walk-in order has been successfully placed.</p>
                      </div>

                      <div className="bg-zinc-50 rounded-2xl p-5 mb-6 border-2 border-zinc-100 space-y-3">
                        <div className="flex justify-between items-center">
                          <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Reference ID</p>
                          <p className="font-mono font-black text-blue-600">{createdWalkInTransaction.reference_number}</p>
                        </div>
                        <div className="flex justify-between items-center">
                          <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Customer</p>
                          <p className="font-bold text-zinc-900">{createdWalkInTransaction.customer_name}</p>
                        </div>
                        <div className="flex justify-between items-center">
                          <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Items</p>
                          <p className="font-bold text-zinc-900">{submittedWalkInItems.length} item{submittedWalkInItems.length > 1 ? 's' : ''}</p>
                        </div>
                        <div className="space-y-1 ml-2">
                          {submittedWalkInItems.map((item, i) => (
                            <div key={i} className="flex justify-between items-center text-xs">
                              <span className="text-zinc-500">{item.service_type} (x{item.quantity})</span>
                              <span className="font-bold text-zinc-900">₱{calculatePriceWithFallback(item.service_type, item.quantity, new Map(Object.entries(walkInPricing) as [string, PricingConfig][])).toLocaleString('en-PH')}</span>
                            </div>
                          ))}
                        </div>
                        {createdWalkInTransaction.delivery_method === 'delivery' && createdWalkInTransaction.delivery_fee > 0 && (
                          <div className="flex justify-between items-center">
                            <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Delivery Fee</p>
                            <p className="font-bold text-zinc-900">₱{createdWalkInTransaction.delivery_fee.toFixed(2)}</p>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Total</p>
                          <p className="font-black text-blue-600">₱{createdWalkInTransaction.total_price?.toFixed(2)}</p>
                        </div>
                        <div className="flex justify-between items-center">
                          <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Status</p>
                          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold capitalize">{createdWalkInTransaction.payment_status || 'unpaid'}</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-3">
                        <button
                          onClick={() => {
                            setShowWalkInSuccess(false);
                            setCreatedWalkInTransaction(null);
                            setSubView('dashboard');
                          }}
                          className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-black text-lg hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-200 flex items-center justify-center gap-2"
                        >
                          <ArrowRight className="w-5 h-5 rotate-180" />
                          Return to Control Panel
                        </button>
                        <button
                          onClick={() => {
                            setShowWalkInSuccess(false);
                            setCreatedWalkInTransaction(null);
                          }}
                          className="w-full py-3 bg-zinc-100 text-zinc-600 rounded-2xl font-black text-base hover:bg-zinc-200 transition-all"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      }
      default: {
        return null;
      }
    }
  };

    const subViewContent = renderSubView();

    const machineModals = (
      <>
        {deleteAllMachinesConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <p className="text-lg font-bold text-zinc-900 mb-6">Are you sure you want to delete all?</p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setDeleteAllMachinesConfirm(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-100 text-zinc-900 font-bold hover:bg-zinc-200"
                >
                  No
                </button>
                <button
                  onClick={async () => {
                    setDeleteAllMachinesConfirm(false);
                    await confirmDeleteAllMachines();
                  }}
                  className="px-4 py-2 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700"
                >
                  Yes
                </button>
              </div>
            </div>
          </div>
        )}
        {addMachineConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <p className="text-lg font-bold text-zinc-900 mb-6">Are you sure you want to add this machine?</p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setAddMachineConfirm(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-100 text-zinc-900 font-bold hover:bg-zinc-200"
                >
                  No
                </button>
                <button
                  onClick={async () => {
                    setAddMachineConfirm(false);
                    await confirmAddMachine();
                  }}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700"
                  disabled={addingMachine}
                >
                  Yes
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );// Section navigation. It belongs to the control panel: it sits under the
   // "Control Center" title so the admin jumps between the sections of the
   // portal from a single place.
   const tabNavigation = (
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mb-8" aria-label="Admin sections">
        <button onClick={() => setSubView('dashboard')}
          aria-current={subView === 'dashboard' ? 'page' : undefined}
          className={`w-full sm:w-auto px-3 sm:px-6 py-3 sm:py-4 rounded-2xl font-black text-[10px] sm:text-sm uppercase tracking-widest transition-all min-h-[48px] ${
            subView === 'dashboard'
              ? 'bg-zinc-900 text-white'
              : 'bg-white text-zinc-500 hover:bg-zinc-100'
          }`}
        >
          <LayoutDashboard className="w-4 h-4 inline mr-2" aria-hidden="true" /> Orders
        </button>
        <button onClick={() => setSubView('walk-in')}
          aria-current={subView === 'walk-in' ? 'page' : undefined}
          className={`w-full sm:w-auto px-3 sm:px-6 py-3 sm:py-4 rounded-2xl font-black text-[10px] sm:text-sm uppercase tracking-widest transition-all min-h-[48px] ${
            subView === 'walk-in'
              ? 'bg-zinc-900 text-white'
              : 'bg-white text-zinc-500 hover:bg-zinc-100'
          }`}
        >
          <User className="w-4 h-4 inline mr-2" aria-hidden="true" /> Walk-In
        </button>
        <button onClick={() => setSubView('sales')}
          aria-current={subView === 'sales' ? 'page' : undefined}
          className={`w-full sm:w-auto px-3 sm:px-6 py-3 sm:py-4 rounded-2xl font-black text-[10px] sm:text-sm uppercase tracking-widest transition-all min-h-[48px] ${
            subView === 'sales'
              ? 'bg-zinc-900 text-white'
              : 'bg-white text-zinc-500 hover:bg-zinc-100'
          }`}
        >
          <BarChart3 className="w-4 h-4 inline mr-2" aria-hidden="true" /> Sales Reports
        </button>
        <button onClick={() => setSubView('customers')}
          aria-current={subView === 'customers' ? 'page' : undefined}
          className={`w-full sm:w-auto px-3 sm:px-6 py-3 sm:py-4 rounded-2xl font-black text-[10px] sm:text-sm uppercase tracking-widest transition-all min-h-[48px] ${
            subView === 'customers'
              ? 'bg-zinc-900 text-white'
              : 'bg-white text-zinc-500 hover:bg-zinc-100'
          }`}
        >
          <Users className="w-4 h-4 inline mr-2" aria-hidden="true" /> Customers
        </button>
        <button onClick={() => setSubView('reviews')}
          aria-current={subView === 'reviews' ? 'page' : undefined}
          className={`w-full sm:w-auto px-3 sm:px-6 py-3 sm:py-4 rounded-2xl font-black text-[10px] sm:text-sm uppercase tracking-widest transition-all min-h-[48px] ${
            subView === 'reviews'
              ? 'bg-zinc-900 text-white'
              : 'bg-white text-zinc-500 hover:bg-zinc-100'
          }`}
        >
          <Star className="w-4 h-4 inline mr-2" aria-hidden="true" /> Reviews
        </button>
        <button onClick={() => setSubView('machines')}
          aria-current={subView === 'machines' ? 'page' : undefined}
          className={`w-full sm:w-auto px-3 sm:px-6 py-3 sm:py-4 rounded-2xl font-black text-[10px] sm:text-sm uppercase tracking-widest transition-all min-h-[48px] ${subView === 'machines' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 hover:bg-zinc-100'}`}
        >
          <Waves className="w-4 h-4 inline mr-2" aria-hidden="true" /> Machines
        </button>
        <button onClick={() => setSubView('pricing')}
          aria-current={subView === 'pricing' ? 'page' : undefined}
          className={`w-full sm:w-auto px-3 sm:px-6 py-3 sm:py-4 rounded-2xl font-black text-[10px] sm:text-sm uppercase tracking-widest transition-all min-h-[48px] ${subView === 'pricing' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 hover:bg-zinc-100'}`}
        >
          <DollarSign className="w-4 h-4 inline mr-2" aria-hidden="true" /> Pricing
        </button>

      </div>
    );

    // Common admin chrome: the shared black header and a consistent page
    // container. Every sub-view is rendered through this shell so the layout and
    // the navigation stay identical across the whole portal.
    const renderAdminShell = (content: React.ReactNode) => (
      <div className="min-h-screen bg-zinc-50">
        <AdminNavbar setView={setView} />
        {printingTransaction && (
          <div id="admin-receipt" style={{ display: 'none' }}>
            <Receipt transaction={printingTransaction} type="admin" />
          </div>
        )}
        <div className="w-full mx-auto pt-20 sm:pt-24 pb-6 sm:pb-8 px-4 sm:px-6 lg:px-8">
          {content}
        </div>
      </div>
    );

    if (subViewContent) return (
      <>
        {renderAdminShell(subViewContent)}
        {machineModals}
      </>
    );

    return renderAdminShell(
      <>
        <div className="mb-8 sm:mb-10 flex flex-col sm:flex-row sm:items-end justify-between gap-4 sm:gap-6">
          <div>
            <h1 className="text-3xl sm:text-5xl font-extrabold text-zinc-900 tracking-tighter mb-3">Control Center</h1>
            <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px]">Managing the boutique laundry experience</p>
          </div>
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 flex items-center gap-2 mb-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full" />
            Last Sync: {lastSync.toLocaleTimeString()}
          </div>
        </div>

        {/* Section navigation, only available on the control panel. */}
        {tabNavigation}
{/* Stats Grid */}
         <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-8">
            {[
              { label: 'Total Orders', value: stats?.total_orders || 0, Icon: ClipboardList, color: 'blue', bgClass: 'bg-blue-50', textClass: 'text-blue-600' },
              { label: 'Total Sales', value: formatCurrency(stats?.total_sales || 0), Icon: TrendingUp, color: 'emerald', bgClass: 'bg-emerald-50', textClass: 'text-emerald-600' },
              { label: 'Pending', value: stats?.pending_orders || 0, Icon: Clock, color: 'amber', bgClass: 'bg-amber-50', textClass: 'text-amber-600' }
            ].map((s, i) => (
              <div key={s.label} className="bg-white rounded-2xl shadow-lg border border-zinc-100 p-4 sm:p-6">
               <div className="flex items-center gap-4 sm:gap-6">
                <div className={`w-12 sm:w-16 h-12 sm:h-16 ${s.bgClass} rounded-2xl sm:rounded-3xl flex items-center justify-center`}>
                  <s.Icon className={`${s.textClass} w-6 sm:w-8 h-6 sm:h-8`} aria-hidden="true" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">{s.label}</p>
                  <h3 className="text-2xl sm:text-4xl font-extrabold text-zinc-900 tracking-tighter">{s.value}</h3>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Machine Management Section */}
        <div className="mb-16">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-zinc-900 tracking-tighter">Machine Management</h2>
            <div className="flex flex-wrap gap-2">
              <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
                <div className="w-2 h-2 bg-emerald-500 rounded-full" /> Available
              </span>
              <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
                <div className="w-2 h-2 bg-blue-500 rounded-full" /> Assigned / In Use
              </span>
              <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-zinc-600 bg-zinc-50 px-3 py-1 rounded-full">
                <div className="w-2 h-2 bg-zinc-500 rounded-full" /> Maintenance
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {machines.map((m) => (
                <div key={m.id} className="bg-white rounded-2xl shadow-lg border border-zinc-100 p-4 sm:p-5 hover:shadow-xl transition-shadow">
                  <div className="flex justify-between items-start mb-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      m.type === 'washer' ? 'bg-blue-50 text-blue-500' : 
                      m.type === 'dryer' ? 'bg-amber-50 text-amber-500' : 'bg-indigo-50 text-indigo-500'
                    }`}>
                      {m.type === 'washer' ? <Waves className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
                    </div>
                    <div className="flex items-center gap-1">
                      <select 
                        className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full outline-none border-2 cursor-pointer transition-all ${
                          m.status === 'available' ? 'bg-emerald-100 text-emerald-600 border-emerald-200' : 
                          m.status === 'in-use' ? 'bg-blue-100 text-blue-600 border-blue-200' : 
                          'bg-rose-100 text-rose-600 border-rose-200'
                        }`}
                        value={m.status}
                        onChange={(e) => {
                              const newStatus = e.target.value as 'available' | 'in-use' | 'maintenance';
                              const newRemainingTime = (newStatus === 'available' || newStatus === 'maintenance') ? 0 : m.remaining_time;
                              updateMachineStatus(m.id, newStatus, newRemainingTime);
                            }}
                      >
                        <option value="available">Available</option>
                        <option value="in-use">
                          {transactions.some(transaction => transaction.machine_id === m.id && transaction.status === 'accepted')
                            ? 'Assigned'
                            : 'In Use'}
                        </option>
                        <option value="maintenance">Maintenance</option>
                      </select>
                       <button
                         onClick={() => setMachineToDelete(m.id)}
                         disabled={deletingMachine === m.id}
                        className="inline-flex items-center justify-center flex-shrink-0 p-3 bg-red-600 border-2 border-red-700 text-white hover:bg-red-700 hover:border-red-800 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 shadow-md hover:shadow-lg min-w-[44px] min-h-[44px]"
                        title="Delete machine"
                        aria-label="Delete machine"
                      >
                        {deletingMachine === m.id ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Trash2 className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <h3 className="text-base font-black text-zinc-900 mb-1 truncate">{m.name}</h3>
                  <p className="text-zinc-400 font-bold uppercase text-[10px] tracking-widest mb-3">
                    {m.type === 'all-in-one' ? 'Washer + Dryer' : m.type}
                  </p>
                  {m.status === 'in-use' && (
                    <div className="space-y-2 border-t border-zinc-100 pt-3">
                      {/* Find the transaction assigned to this machine */}
                      {(() => {
                        const assignedTransaction = transactions.find(t => t.machine_id === m.id && t.status !== 'completed' && t.status !== 'declined');
                        const loadWeight = assignedTransaction?.weight;
                        const isDrying = assignedTransaction?.status === 'drying';
                        const timerField = isDrying ? 'drying_time' : 'remaining_time';
                        const timerLabel = isDrying
                          ? 'Drying Timer'
                          : assignedTransaction?.status === 'accepted'
                            ? 'Wash Timer (Paused)'
                            : 'Wash Timer';
                        const timerValue = m[timerField];
                        return (
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-zinc-400 text-xs">{timerLabel}</span>
                              <span className="text-blue-600 font-black">{formatTime(timerValue)}</span>
                            </div>
                            {typeof loadWeight === 'number' && loadWeight > 0 && (
                              <div className="flex justify-between items-center">
                                <span className="text-zinc-400 text-xs">Load Weight</span>
                                <span className="text-emerald-600 font-black">{loadWeight} kg</span>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <input
                                type="range"
                                min="0"
                                max="3600"
                                step="30"
                                value={timerValue}
                                onChange={(e) => {
                                  updateMachineTimer(m, timerField, parseInt(e.target.value));
                                }}
                                onPointerUp={(e) => {
                                  updateMachineTimer(m, timerField, parseInt(e.currentTarget.value), true);
                                }}
                                className="flex-1 h-2 bg-zinc-100 rounded-lg appearance-none cursor-pointer accent-blue-500"
                              />
                              <span className="text-xs font-mono text-zinc-500 w-16 text-right">
                                {formatTime(timerValue)}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          <div className="mt-4 flex justify-end">
            <button
                  onClick={async () => {
                if (confirm('Reset all machines to default state?')) {
                  await apiResetMachines();
                  await fetchData();
                }
              }}
              className="px-2 py-1 bg-rose-500/20 text-rose-500 rounded hover:bg-rose-500/30 transition-colors text-[10px] font-black uppercase"
            >
              RESET MACHINES
            </button>
          </div>
        </div>

        {/* Search and Transactions Table */}
        <div className="w-full bg-white rounded-2xl sm:rounded-[40px] border-4 sm:border-8 border-zinc-50 shadow-2xl overflow-hidden">
          <div className="p-6 sm:p-8 border-b border-zinc-50 flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
            <h2 className="text-xl sm:text-2xl font-extrabold text-zinc-900 tracking-tighter">Recent Activity</h2>
            <div className="relative w-full md:w-auto">
              <Search className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 text-zinc-400 w-4 sm:w-5 h-4 sm:h-5" />
              <input
                type="text"
                placeholder="Search all orders..."
                aria-label="Search orders by reference number, customer name or phone"
                className="pl-12 sm:pl-14 pr-4 sm:pr-6 py-3 sm:py-4 bg-zinc-50 border-2 sm:border-4 border-transparent rounded-xl sm:rounded-2xl outline-none focus:bg-white focus:border-blue-500 transition-all font-bold text-sm w-full md:w-80"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 text-white text-[10px] sm:text-xs uppercase tracking-[0.2em] font-black">
                  <th className="px-3 sm:px-8 py-4 sm:py-5 border-r border-zinc-700">Ref</th>
                  <th className="px-3 sm:px-8 py-4 sm:py-5 border-r border-zinc-700">Customer</th>
                  <th className="px-3 sm:px-8 py-4 sm:py-5 border-r border-zinc-700 hidden lg:table-cell">Service</th>
                  <th className="px-3 sm:px-8 py-4 sm:py-5 border-r border-zinc-700 hidden md:table-cell">Machine</th>
                  <th className="px-3 sm:px-8 py-4 sm:py-5 border-r border-zinc-700">Status</th>
                  <th className="px-3 sm:px-8 py-4 sm:py-5 border-r border-zinc-700 hidden sm:table-cell">Total</th>
                  <th className="px-3 sm:px-8 py-4 sm:py-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 sm:px-8 py-3 sm:py-6">
                      <span className="font-mono font-black text-blue-600 text-sm sm:text-lg">{t.reference_number}</span>
                    </td>
                    <td className="px-3 sm:px-8 py-3 sm:py-6">
                      <div className="flex flex-col">
                        <span className="font-black text-zinc-900">{t.customer_name}</span>
                        <span className="text-xs font-bold text-zinc-400">{t.customer_phone}</span>
                        {t.customer_email && <span className="text-[10px] font-bold text-blue-500 truncate max-w-[100px] sm:max-w-[150px]">{t.customer_email}</span>}
                        <span className="text-[10px] text-zinc-400 truncate max-w-[100px] sm:max-w-[150px]">{t.address}</span>
                      </div>
                    </td>
                    <td className="px-3 sm:px-8 py-3 sm:py-6 hidden lg:table-cell">
                      <div className="flex flex-col">
                        <span className="font-bold text-zinc-700 text-sm">
                          {t.service_type} (x{t.quantity})
                        </span>
                        {t.service_type.toLowerCase().includes('hand wash') && t.handwash_proof_image && (
                          <div className="mt-1 flex items-center gap-2">
                            <img
                              src={t.handwash_proof_image}
                              alt="Handwash proof"
                              className="w-16 h-16 object-cover rounded-lg border border-zinc-200 shadow-sm"
                              title="Handwash proof uploaded"
                            />
                            <span className="text-[10px] font-black text-emerald-600">Proof uploaded</span>
                          </div>
                        )}
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 flex items-center gap-1 mt-1">
                          {t.delivery_method === 'delivery' ? <Truck className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                          {t.delivery_method === 'delivery' ? 'Delivery' : 'Pickup'} | {t.appointment_date} {t.appointment_time}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 sm:px-8 py-3 sm:py-6 hidden md:table-cell">
                       {t.service_type.toLowerCase().includes('hand wash') ? (
                           <div className="p-2 bg-zinc-100 border border-zinc-200 rounded-xl text-[10px] font-black uppercase tracking-widest w-full min-w-[100px] sm:min-w-[120px] text-zinc-400">
                             No Machine (Hand Wash)
                           </div>
                         ) : t.machine_name ? (
                           <div className="p-2 bg-blue-50 border border-blue-200 rounded-xl text-[10px] font-black uppercase tracking-widest w-full min-w-[100px] sm:min-w-[120px] text-blue-600">
                             {t.machine_name}
                           </div>
                         ) : (
                           <div className="p-2 bg-zinc-100 border border-zinc-200 rounded-xl text-[10px] font-black uppercase tracking-widest w-full min-w-[100px] sm:min-w-[120px] text-zinc-400">
                             No Machine Assigned
                           </div>
                         )}
                      </td>
                    <td className="px-3 sm:px-8 py-3 sm:py-6">
                      <div className="flex flex-col gap-1">
                        <span className={`px-2 sm:px-4 py-1 sm:py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-center ${
                          t.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                          t.status === 'accepted' ? 'bg-blue-100 text-blue-700' :
                          t.status === 'washing' ? 'bg-indigo-100 text-indigo-700' :
                          t.status === 'drying' ? 'bg-sky-100 text-sky-700' :
                          t.status === 'ready' ? 'bg-purple-100 text-purple-700' :
                          t.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-rose-100 text-rose-700'
                        }`}>
                          {t.status}
                        </span>
                        <button
                          onClick={() => {
                            if (t.status === 'declined') return;
                             const newStatus = t.payment_status === 'paid' ? 'unpaid' : 'paid';
                             setConfirmPayment({ id: t.id, status: newStatus });
                          }}
                          disabled={t.status === 'declined'}
                          className={`px-3 sm:px-4 py-1.5 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-widest border transition-all hover:scale-105 ${
                            t.status === 'declined'
                              ? 'bg-zinc-100 text-zinc-300 border-zinc-200 cursor-not-allowed'
                              : t.payment_status === 'paid'
                                ? 'bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600'
                                : 'bg-white text-zinc-600 border-zinc-300 hover:bg-zinc-50'
                          }`}
                        >
                          {t.status === 'declined' ? 'N/A' : t.payment_status === 'paid' ? 'PAID' : 'UNPAID'}
                        </button>
                      </div>
                    </td>
                    <td className="px-3 sm:px-8 py-3 sm:py-6 hidden sm:table-cell">
                      <div className="flex flex-col">
                        <span className="font-black text-zinc-900 text-sm sm:text-lg">₱{t.total_price}</span>
                        {typeof t.weight === 'number' && t.weight > 0 && <span className="text-[10px] text-zinc-400">{t.weight}kg</span>}
                      </div>
                    </td>
                    <td className="px-3 sm:px-8 py-3 sm:py-6">
                      <div className="ml-auto flex items-start justify-end gap-2">
                        <div className="flex max-w-[140px] sm:max-w-[180px] flex-wrap items-center justify-end gap-2">
                          {/* Pending: Machine Assignment + Accept/Decline */}
                          {t.status === 'pending' && (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                            {t.service_type.toLowerCase().includes('hand wash') ? (
                              // Hand wash orders: accept without machine
                              <button
                                onClick={() => {
                                  if (confirm('Accept this hand wash order?')) {
                                    updateStatus(t.id, 'accepted', t.total_price, t.weight || 0, t.payment_status, null, t.service_type);
                                  }
                                }}
                                className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Accept Hand Wash Order"
                                disabled={assigningMachine === t.id || confirmAccept?.transactionId === t.id}
                              >
                                {assigningMachine === t.id ? <Loader2 className="w-4 h-4 " /> : <Check className="w-4 h-4" />}
                              </button>
                            ) : (
                              // Regular orders: machine selection with auto-assign
                              <div className="flex items-center gap-2">
                                <select
                                  value={selectedMachineId[t.id] || ''}
                                    onChange={(e) => {
                                      const machineId = Number(e.target.value);
                                      setSelectedMachineId(prev => ({ ...prev, [t.id]: machineId }));
                                    }}
                                  disabled={assigningMachine === t.id || confirmAccept?.transactionId === t.id}
                                  className="shrink-0 w-[108px] sm:w-[140px] text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full outline-none border-2 border-blue-200 bg-blue-50 text-blue-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <option value="">No machine</option>
                                  {machines.filter(m => m.status === 'available' || m.id === selectedMachineId[t.id]).map(m => {
                                    const isAssigned = m.id === selectedMachineId[t.id] && m.status !== 'available';
                                    return (
                                      <option key={m.id} value={m.id} disabled={m.status !== 'available' && m.id !== selectedMachineId[t.id]}>
                                        {m.name} {isAssigned ? ' (Assigned)' : ''}{m.status !== 'available' && m.id !== selectedMachineId[t.id] ? ' (Unavailable)' : ''}
                                      </option>
                                    );
                                  })}
                                </select>
                                <button
                                  onClick={() => {
                                    const machineId = selectedMachineId[t.id];
                                    if (machineId) {
                                      setConfirmAccept({ transactionId: t.id, machineId });
                                     } else {
                                       setConfirmNoMachine(t.id);
                                     }
                                  }}
                                  className="shrink-0 p-2 text-emerald-500 hover:bg-emerald-50 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  title={selectedMachineId[t.id] ? 'Accept Order' : 'Accept Without Machine'}
                                  aria-label={selectedMachineId[t.id] ? 'Accept order' : 'Accept order without machine'}
                                  disabled={assigningMachine === t.id || confirmAccept?.transactionId === t.id}
                                >
                                  {assigningMachine === t.id ? <Loader2 className="w-5 h-5 " /> : <Check className="w-5 h-5" />}
                                </button>
                              </div>
                            )}
                            <button
                              onClick={() => setDeclineOrderConfirmId(t.id)}
                              className="shrink-0 p-2 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                              title="Decline Order"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </div>
                        )}
                        
                        {/* Accepted: Start Process */}
                        {t.status === 'accepted' && (
                          <div className="flex items-center gap-2">
                            {t.service_type.toLowerCase().includes('hand wash') && !t.handwash_proof_image ? (
                              <button
                                onClick={() => handleHandwashFileSelect(t.id)}
                                className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-amber-600 transition-colors flex items-center gap-1"
                              >
                                <Waves className="w-3 h-3" />
                                Upload Proof
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  if (t.machine_id !== null) {
                                    const machine = machines.find(m => m.id === t.machine_id);
                                    setTimerDuration(machine?.remaining_time || 2700);
                                    setWashTimerTransactionId(t.id);
                                  } else {
                                    updateStatus(t.id, 'washing');
                                  }
                                }}
                                className="px-3 py-1.5 bg-indigo-500 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-indigo-600 transition-colors"
                              >
                                Start Wash
                              </button>
                            )}
                          </div>
                        )}
                        
                        {/* In Progress: Status Badge + Next Step */}
                        {(t.status === 'washing' || t.status === 'drying') && (
                          <div className="flex items-center gap-2">
                            <span className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest ${
                              t.status === 'washing' ? 'bg-indigo-100 text-indigo-700' : 'bg-sky-100 text-sky-700'
                            }`}>
                              {t.status === 'washing' ? 'Washing' : 'Drying'}
                            </span>
                            <button
                              onClick={() => {
                                if (t.status === 'washing' && t.machine_id != null) {
                                  setDryingTimerDuration(2700);
                                  setDryingTimerTransactionId(t.id);
                                } else {
                                  updateStatus(t.id, t.status === 'washing' ? 'drying' : 'ready');
                                }
                              }}
                              disabled={((t.status === 'drying'
                                ? machines.find(machine => machine.id === t.machine_id || machine.name.trim().toLowerCase() === t.machine_name?.trim().toLowerCase())?.drying_time
                                : machines.find(machine => machine.id === t.machine_id || machine.name.trim().toLowerCase() === t.machine_name?.trim().toLowerCase())?.remaining_time
                              ) ?? (t.machine_id != null || t.machine_name != null ? 1 : 0)) > 0}
                              className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {t.status === 'washing' ? 'Start Dry' : 'Mark Ready'}
                            </button>
                          </div>
                        )}
                        
                        {/* Ready: Complete */}
                        {t.status === 'ready' && (
                          <button
                            onClick={() => {
                              setCompleteOrderPopupId(t.id);
                              setCompleteOrderWeight('');
                              setCompleteOrderPrice('');
                            }}
                            className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-emerald-600 transition-colors"
                          >
                            Complete
                          </button>
                        )}
                        
                        {/* Completed: Show badge */}
                        {t.status === 'completed' && (
                          <span className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-black uppercase tracking-widest">
                            Completed
                          </span>
                        )}
                        
                        {/* Declined: Show badge */}
                        {t.status === 'declined' && (
                          <span className="px-3 py-1.5 bg-rose-100 text-rose-700 rounded-lg text-xs font-black uppercase tracking-widest">
                            Declined
                          </span>
                        )}
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          {/* Print Button */}
                          <button
                            onClick={() => {
                              const printWindow = window.open('', '_blank', 'width=400,height=600');
                              pendingPrintWindowRef.current = printWindow;
                              setPrintingTransaction(t);
                            }}
                            className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-xl transition-colors"
                            title="Print Receipt"
                          >
                            <ClipboardList className="w-5 h-5" />
                          </button>
                            <button
                             onClick={() => setDeleteOrderConfirmId(t.id)}
                            className="inline-flex items-center justify-center flex-shrink-0 p-3 bg-red-600 border-2 border-red-700 text-white hover:bg-red-700 hover:border-red-800 rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 shadow-md hover:shadow-lg min-w-[44px] min-h-[44px]"
                            title="Delete Order"
                            aria-label="Delete order"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination - without this the table would silently hide every order
              beyond the first page of results. */}
          {transactionMeta && transactionMeta.total > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-8 py-4 border-t border-zinc-100">
              <p className="text-[10px] sm:text-xs font-bold text-zinc-400">
                Showing {((transactionMeta.page - 1) * transactionMeta.limit) + 1}-{Math.min(transactionMeta.page * transactionMeta.limit, transactionMeta.total)} of {transactionMeta.total} orders
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOrdersQuery(q => ({ ...q, page: Math.max(1, q.page - 1) }))}
                  disabled={transactionMeta.page <= 1}
                  aria-label="Previous page of orders"
                  className="inline-flex items-center gap-1 px-3 sm:px-4 py-2 bg-zinc-100 text-zinc-600 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-3 h-3 rotate-180" aria-hidden="true" /> Prev
                </button>
                <span className="text-[10px] sm:text-xs font-black text-zinc-600 whitespace-nowrap">
                  Page {transactionMeta.page} of {transactionMeta.totalPages}
                </span>
                <button
                  onClick={() => setOrdersQuery(q => ({ ...q, page: Math.min(transactionMeta.totalPages, q.page + 1) }))}
                  disabled={transactionMeta.page >= transactionMeta.totalPages}
                  aria-label="Next page of orders"
                  className="inline-flex items-center gap-1 px-3 sm:px-4 py-2 bg-zinc-100 text-zinc-600 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight className="w-3 h-3" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>

      {/* Handwash Proof Upload Modal */}
      {handwashUpload && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="text-center mb-6">
              <Waves className="w-12 h-12 mx-auto mb-2 text-amber-500" />
              <h2 className="text-xl font-black text-zinc-900">Upload Handwash Proof</h2>
              <p className="text-sm text-zinc-500 mt-1">
                Take a photo or select an image showing the laundry being hand washed
              </p>
            </div>
            
            <div className="border-2 border-dashed border-zinc-200 rounded-xl p-6 text-center mb-4">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                className="hidden"
                id="handwash-file-input"
              />
              <label
                htmlFor="handwash-file-input"
                className="cursor-pointer"
              >
                {selectedFile ? (
                  <div className="text-center">
                    <p className="font-bold text-zinc-900 truncate">{selectedFile.name}</p>
                    <p className="text-xs text-zinc-500 mt-1">Click to change</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <Waves className="w-10 h-10 mx-auto text-zinc-300 mb-2" />
                    <p className="font-bold text-zinc-600">Click to select photo</p>
                    <p className="text-xs text-zinc-400 mt-1">or take a new photo</p>
                  </div>
                )}
              </label>
            </div>

            {/* Image Preview */}
            {selectedFile && filePreview && (
              <div className="mb-4 relative">
                <p className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-2 text-center">Preview</p>
                <div className="flex justify-center">
                  <img
                    src={filePreview}
                    alt="Handwash proof preview"
                    className="max-w-full max-h-64 rounded-xl shadow-lg border border-zinc-200"
                  />
                </div>
              </div>
            )}

            {/* Error message */}
            {uploadError && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm text-center">
                {uploadError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={cancelHandwashUpload}
                className="flex-1 px-4 py-3 bg-zinc-100 text-zinc-600 rounded-xl font-black hover:bg-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFileUpload}
                disabled={!selectedFile || handwashUploading}
                className="flex-1 px-4 py-3 bg-amber-500 text-white rounded-xl font-black hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {handwashUploading ? (
                  <Loader2 className="w-5 h-5 " />
                ) : (
                  <>
                    <Waves className="w-5 h-5" />
                    Upload
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Accept Order Dialog */}
      {confirmAccept && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border-8 border-zinc-50 ">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-amber-600" />
              </div>
              <h3 className="text-xl font-black text-zinc-900">Confirm Accept Order</h3>
              <p className="text-zinc-500 mt-2">Are you sure you want to accept this order and assign the selected machine?</p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setConfirmAccept(null)}
                className="flex-1 py-3 bg-zinc-100 text-zinc-700 rounded-xl font-black hover:bg-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const { transactionId, machineId } = confirmAccept!;
                  assignMachineToTransaction(transactionId, machineId, 'accepted',
                    transactions.find(t => t.id === transactionId)?.total_price || 0,
                    transactions.find(t => t.id === transactionId)?.weight || 0,
                    transactions.find(t => t.id === transactionId)?.payment_status || 'unpaid'
                  );
                  setConfirmAccept(null);
                }}
                className="flex-1 py-3 bg-emerald-500 text-white rounded-xl font-black hover:bg-emerald-600 transition-colors disabled:opacity-50"
                disabled={assigningMachine !== null}
              >
                {assigningMachine === confirmAccept.transactionId ? <Loader2 className="w-5 h-5  mx-auto" /> : 'Confirm Accept'}
              </button>
            </div>
          </div>
        </div>
       )}

       {/* Confirm Accept Without Machine Dialog */}
       {confirmNoMachine !== null && (
         <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
           <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border-8 border-zinc-50">
             <div className="text-center mb-6">
               <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                 <AlertCircle className="w-8 h-8 text-amber-600" />
               </div>
               <h3 className="text-xl font-black text-zinc-900">Accept Without Machine</h3>
               <p className="text-zinc-500 mt-2">Are you sure you want to accept this order without assigning a machine?</p>
             </div>
             <div className="flex gap-4">
               <button
                 onClick={() => setConfirmNoMachine(null)}
                 className="flex-1 py-3 bg-zinc-100 text-zinc-700 rounded-xl font-black hover:bg-zinc-200 transition-colors"
               >
                 Cancel
               </button>
               <button
                 onClick={() => {
                   const t = transactions.find(tr => tr.id === confirmNoMachine);
                   if (t) updateStatus(t.id, 'accepted', t.total_price, t.weight || 0, t.payment_status, null, t.service_type);
                   setConfirmNoMachine(null);
                 }}
                 className="flex-1 py-3 bg-emerald-500 text-white rounded-xl font-black hover:bg-emerald-600 transition-colors"
               >
                 Confirm
               </button>
             </div>
           </div>
         </div>
       )}

       {/* Confirm Payment Status Dialog */}
       {confirmPayment && (
         <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
           <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border-8 border-zinc-50">
             <div className="text-center mb-6">
               <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                 <AlertCircle className="w-8 h-8 text-amber-600" />
               </div>
               <h3 className="text-xl font-black text-zinc-900">Update Payment Status</h3>
               <p className="text-zinc-500 mt-2">Mark this order as {confirmPayment.status.toUpperCase()}?</p>
             </div>
             <div className="flex gap-4">
               <button
                 onClick={() => setConfirmPayment(null)}
                 className="flex-1 py-3 bg-zinc-100 text-zinc-700 rounded-xl font-black hover:bg-zinc-200 transition-colors"
               >
                 Cancel
               </button>
               <button
                 onClick={() => {
                   const t = transactions.find(tr => tr.id === confirmPayment.id);
                   if (t) updateStatus(t.id, t.status, t.total_price, t.weight || 0, confirmPayment.status);
                   setConfirmPayment(null);
                 }}
                 className="flex-1 py-3 bg-emerald-500 text-white rounded-xl font-black hover:bg-emerald-600 transition-colors"
               >
                 Confirm
               </button>
             </div>
           </div>
         </div>
       )}

       {/* Wash Timer Modal */}
      {washTimerTransactionId !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl border-8 border-zinc-50">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock className="w-8 h-8 text-emerald-600" />
              </div>
              <h3 className="text-xl font-black text-zinc-900">Set Wash Timer</h3>
              <p className="text-zinc-500 mt-2">Select the wash duration before starting</p>
            </div>
            <div className="mb-6 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-600" />
                  <p className="text-sm font-bold text-zinc-700">Timer Duration</p>
                </div>
                <span className="text-sm font-mono font-black text-blue-600">{formatTime(timerDuration)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="3600"
                step="30"
                value={timerDuration}
                onChange={(e) => setTimerDuration(parseInt(e.target.value))}
                className="w-full h-2 bg-zinc-100 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-400 font-medium">
                <span>0 min</span>
                <span>60 min</span>
              </div>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setWashTimerTransactionId(null)}
                className="flex-1 py-3 bg-zinc-100 text-zinc-700 rounded-xl font-black hover:bg-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const started = await updateStatus(
                    washTimerTransactionId,
                    'washing',
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    timerDuration,
                  );
                  if (started) setWashTimerTransactionId(null);
                }}
                className="flex-1 py-3 bg-emerald-500 text-white rounded-xl font-black hover:bg-emerald-600 transition-colors"
              >
                Confirm &amp; Start Wash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drying Timer Modal */}
      {dryingTimerTransactionId !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl border-8 border-zinc-50">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock className="w-8 h-8 text-emerald-600" />
              </div>
              <h3 className="text-xl font-black text-zinc-900">Set Dry Timer</h3>
              <p className="text-zinc-500 mt-2">Select the drying duration for this machine</p>
            </div>
            <div className="mb-6 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-600" />
                  <p className="text-sm font-bold text-zinc-700">Timer Duration</p>
                </div>
                <span className="text-sm font-mono font-black text-blue-600">{formatTime(dryingTimerDuration)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="3600"
                step="30"
                value={dryingTimerDuration}
                onChange={(e) => setDryingTimerDuration(parseInt(e.target.value))}
                className="w-full h-2 bg-zinc-100 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-400 font-medium">
                <span>0 min</span>
                <span>60 min</span>
              </div>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setDryingTimerTransactionId(null)}
                className="flex-1 py-3 bg-zinc-100 text-zinc-700 rounded-xl font-black hover:bg-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const started = await updateStatus(
                    dryingTimerTransactionId,
                    'drying',
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    dryingTimerDuration,
                  );
                  if (started) setDryingTimerTransactionId(null);
                }}
                className="flex-1 py-3 bg-emerald-500 text-white rounded-xl font-black hover:bg-emerald-600 transition-colors"
              >
                Confirm &amp; Start Dry
              </button>
            </div>
          </div>
        </div>
      )}


      {machineToDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <p className="text-lg font-bold text-zinc-900 mb-6">Are you sure you want to delete this?</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setMachineToDelete(null)}
                className="px-4 py-2 rounded-xl bg-zinc-100 text-zinc-900 font-bold hover:bg-zinc-200"
              >
                No
              </button>
              <button
                onClick={async () => {
                  const id = machineToDelete;
                  setMachineToDelete(null);
                  await handleDeleteMachine(id);
                }}
                className="px-4 py-2 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700"
              >
                 Yes
               </button>
             </div>
            </div>
          </div>
        )}

      {deleteAllMachinesConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <p className="text-lg font-bold text-zinc-900 mb-6">Are you sure you want to delete all?</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteAllMachinesConfirm(false)}
                className="px-4 py-2 rounded-xl bg-zinc-100 text-zinc-900 font-bold hover:bg-zinc-200"
              >
                No
              </button>
              <button
                onClick={async () => {
                  setDeleteAllMachinesConfirm(false);
                  await confirmDeleteAllMachines();
                }}
                className="px-4 py-2 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {addMachineConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <p className="text-lg font-bold text-zinc-900 mb-6">Are you sure you want to add this machine?</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setAddMachineConfirm(false)}
                className="px-4 py-2 rounded-xl bg-zinc-100 text-zinc-900 font-bold hover:bg-zinc-200"
              >
                No
              </button>
              <button
                onClick={async () => {
                  setAddMachineConfirm(false);
                  await confirmAddMachine();
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700"
                disabled={addingMachine}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

       {completeOrderPopupId !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border-4 border-zinc-50">
            <h3 className="text-xl font-black text-zinc-900 mb-2">Complete Order</h3>
            <p className="text-sm text-zinc-500 mb-4">Enter the final weight (KG) and price before completing.</p>
            {completeOrderError && (
              <p className="text-sm text-rose-600 font-bold mb-3">{completeOrderError}</p>
            )}
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Weight (KG)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={completeOrderWeight}
                  onChange={e => setCompleteOrderWeight(e.target.value)}
                  className="w-full p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold text-sm mt-1"
                  placeholder="e.g. 5.5"
                />
              </div>
              <div>
                <label className="text-xs font-black text-zinc-400 uppercase tracking-widest">Final Price (₱)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={completeOrderPrice}
                  onChange={e => setCompleteOrderPrice(e.target.value)}
                  className="w-full p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold text-sm mt-1"
                  placeholder="e.g. 250.00"
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setCompleteOrderPopupId(null); setCompleteOrderError(null); }}
                className="px-4 py-2 rounded-xl bg-zinc-100 text-zinc-900 font-bold hover:bg-zinc-200"
                disabled={completeOrderLoading}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const w = parseFloat(completeOrderWeight);
                  const p = parseFloat(completeOrderPrice);
                  if (isNaN(w) || w < 0) { setCompleteOrderError('Please enter a valid weight (KG).'); return; }
                  if (isNaN(p) || p < 0) { setCompleteOrderError('Please enter a valid final price.'); return; }
                  setCompleteOrderError(null);
                  setCompleteOrderLoading(true);
                  const ok = await updateStatus(completeOrderPopupId, 'completed', p, w);
                  setCompleteOrderLoading(false);
                  if (ok) {
                    setPrintingTransaction(prev => prev && prev.id === completeOrderPopupId
                      ? { ...prev, total_price: p, weight: w, status: 'completed' }
                      : prev);
                    setCompleteOrderPopupId(null);
                    setCompleteOrderWeight('');
                    setCompleteOrderPrice('');
                  } else {
                    setCompleteOrderError('Failed to save. Please try again.');
                  }
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50"
                disabled={completeOrderLoading}
              >
                {completeOrderLoading ? 'Saving...' : 'Save & Complete'}
              </button>
            </div>
          </div>
        </div>
      )}

        {deleteOrderConfirmId !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border-4 border-zinc-50">
            <h3 className="text-xl font-black text-zinc-900 mb-2">Delete Order</h3>
            <p className="text-sm text-zinc-500 mb-4">Are you sure you want to delete this order? This action cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteOrderConfirmId(null)}
                className="px-4 py-2 rounded-xl bg-zinc-100 text-zinc-900 font-bold hover:bg-zinc-200"
                disabled={deleteOrderLoading}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const id = deleteOrderConfirmId;
                  if (id === null) return;
                  setDeleteOrderLoading(true);
                  try {
                    await apiDeleteTransaction(id);
                    setSelectedMachineId(prev => {
                      const newState = { ...prev };
                      delete newState[id];
                      return newState;
                    });
                    await fetchData();
                    setDeleteOrderConfirmId(null);
                  } catch (error) {
                    console.error('Error deleting order:', error);
                    addToast({ type: 'error', message: 'Error deleting order' });
                  } finally {
                    setDeleteOrderLoading(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-50"
                disabled={deleteOrderLoading}
              >
                {deleteOrderLoading ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {declineOrderConfirmId !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border-4 border-zinc-50">
            <h3 className="text-xl font-black text-zinc-900 mb-2">Decline Order</h3>
            <p className="text-sm text-zinc-500 mb-4">Decline this order?</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeclineOrderConfirmId(null)}
                className="px-4 py-2 rounded-xl bg-zinc-100 text-zinc-900 font-bold hover:bg-zinc-200"
                disabled={declineOrderLoading}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const id = declineOrderConfirmId;
                  if (id === null) return;
                  setDeclineOrderLoading(true);
                  try {
                    const ok = await updateStatus(id, 'declined');
                    if (ok) setDeclineOrderConfirmId(null);
                  } catch (error) {
                    console.error('Error declining order:', error);
                    addToast({ type: 'error', message: 'Error declining order' });
                  } finally {
                    setDeclineOrderLoading(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-50"
                disabled={declineOrderLoading}
              >
                {declineOrderLoading ? 'Declining...' : 'Confirm Decline'}
              </button>
            </div>
          </div>
        </div>
      )}

        </>

    );

  }

   export default AdminDashboard;
