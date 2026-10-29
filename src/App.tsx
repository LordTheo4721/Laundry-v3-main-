import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar,
  Clock,
  Package,
  Truck,
  User,
  Phone,
  MapPin,
  CheckCircle2,
  XCircle,
  AlertCircle,
  LayoutDashboard,
  ClipboardList,
  TrendingUp,
  Search,
  ChevronRight,
  Loader2,
  Check,
  X,
  Waves,
  Sparkles,
  Zap,
  Smile,
  ArrowRight,
  Menu,
  Star,
  Mail,
  MessageSquare,
  Plus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Receipt, printReceipt } from './components/Receipt';
import AdminLogin from './components/AdminLogin';
import UserBooking from './components/UserBooking';
import AdminDashboard from './components/admin/AdminDashboard';
import AdminSettings from './components/admin/AdminSettings';
import { ToastProvider, useToast } from './components/admin/Toast';
import { calculatePrice, calculatePriceWithFallback, calculateGrandTotalWithMap, FALLBACK_PRICING } from './utils/pricing';
import { getDeliveryFee } from './utils/sharedPricing';
import type { PricingConfig, PricingRow } from './utils/sharedPricing';
import { getPublicReviews, verifyAdminToken, createReview } from './utils/api';
import { confirmReviewSubmission } from './utils/reviewConfirmation';
import { ADMIN_SESSION_CLEARED_EVENT, clearAdminSession, isAdminView, replaceHistoryEntry } from './utils/adminAuth';
import type { Review, Transaction, Machine, Stats, TransactionStatus } from './types';
import type { PricingConfig as SharedPricingConfig } from './utils/sharedPricing';

// --- Types ---

type View = 'home' | 'booking' | 'machines' | 'admin' | 'receipt' | 'track' | 'reviews' | 'admin-login' | 'admin-settings';

// Helper function to format seconds to MM:SS
const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// --- Components ---

const Navbar = ({ view, setView }: { view: View, setView: (v: View) => void }) => {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  if (view === 'admin') return null;
  return (
    <nav className="fixed top-0 left-0 right-0 bg-white border-b-2 border-zinc-200 z-[9999] shadow-md" role="navigation" aria-label="Main navigation">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
        {/* Logo */}
        <div
          className="flex items-center gap-0 cursor-pointer shrink-0"
          onClick={() => { setView('home'); setMobileOpen(false); }}
        >
          <img src="/happy-wash-mark-transparent.png" alt="HappyWash logo" className="h-8 sm:h-10 w-auto" />
          <span className="text-xl sm:text-2xl font-black text-zinc-900 tracking-tighter">Happy<span className="text-blue-600">Wash</span></span>
        </div>
        
        {/* Desktop Navigation Links */}
        <div className="hidden lg:flex items-center gap-6 lg:gap-10 bg-zinc-50/50 p-2 rounded-xl" role="menubar" aria-label="Main navigation">
          {['home', 'machines', 'booking', 'track', 'reviews'].map((v) => (
            <button
              key={v}
              onClick={() => setView(v as View)}
              className={`text-xs sm:text-sm font-black uppercase tracking-widest transition-all py-2 px-3 border-b-2 ${
                view === v ? 'text-blue-600 border-blue-600' : 'text-zinc-900 border-transparent hover:text-blue-600 hover:border-blue-300'
              }`}
              role="menuitem"
              aria-label={`Navigate to ${v === 'track' ? 'Track Order' : v === 'reviews' ? 'Reviews' : v === 'home' ? 'Home' : v.charAt(0).toUpperCase() + v.slice(1)}`}
              aria-current={view === v ? 'page' : undefined}
            >
              {v === 'track' ? 'Track Order' : v === 'reviews' ? 'Reviews' : v === 'home' ? 'Home' : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        {/* Mobile Hamburger Button */}
        <button
          className="lg:hidden p-2 rounded-xl text-zinc-700 hover:bg-zinc-100 transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Dropdown Menu */}
      {mobileOpen && (
        <div id="mobile-menu" className="lg:hidden bg-white border-t border-zinc-100 px-4 py-4 flex flex-col gap-1 shadow-lg" role="menu">
          {['home', 'machines', 'booking', 'track', 'reviews'].map((v) => (
            <button
              key={v}
              onClick={() => { setView(v as View); setMobileOpen(false); }}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm font-black uppercase tracking-widest transition-all ${
                view === v ? 'bg-blue-50 text-blue-600' : 'text-zinc-700 hover:bg-zinc-50'
              }`}
              role="menuitem"
              aria-label={`Navigate to ${v === 'track' ? 'Track Order' : v === 'reviews' ? 'Reviews' : v === 'home' ? 'Home' : v.charAt(0).toUpperCase() + v.slice(1)}`}
            >
              {v === 'track' ? 'Track Order' : v === 'reviews' ? 'Reviews' : v === 'home' ? 'Home' : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
};

const Hero = ({ onStart }: { onStart: () => void }) => (
  <div className="relative overflow-hidden py-12 sm:py-20 px-4">
    <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6 }}
      >
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-xs font-bold mb-8 uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />
          Premium Laundry Service
        </div>
        <h1 className="text-5xl sm:text-7xl md:text-9xl font-extrabold text-zinc-900 leading-[0.85] tracking-tighter mb-8">
          Freshness <br />
          <span className="text-blue-600">Redefined.</span>
        </h1>
        <p className="text-lg text-zinc-500 mb-12 max-w-md leading-relaxed font-medium">
          Experience the future of laundry. Smart tracking, eco-friendly care, and quick delivery.
        </p>
        <div className="flex flex-wrap gap-5">
          <button 
            onClick={onStart}
            className="px-8 py-4 bg-zinc-900 text-white rounded-2xl font-bold text-lg hover:bg-blue-600 transition-all shadow-xl shadow-zinc-200 flex items-center gap-3 group"
          >
            Start Booking
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" strokeWidth={2.5} />
          </button>
          <button 
            onClick={() => {
              const el = document.getElementById('pricing');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="px-10 py-5 bg-white text-zinc-900 border-4 border-zinc-100 rounded-3xl font-black text-xl hover:bg-zinc-50 transition-all flex items-center gap-3"
          >
            View Services
          </button>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.8, rotate: -5 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="relative"
      >
        <div className="relative z-10 bg-white p-4 rounded-[40px] shadow-2xl border-8 border-zinc-50">
          <img 
            src="https://picsum.photos/seed/laundry/800/600" 
            className="rounded-[32px] w-full h-[500px] object-cover"
            alt="Laundry"
            referrerPolicy="no-referrer"
            onError={(e) => { e.currentTarget.src = 'https://via.placeholder.com/800x600?text=Image+Unavailable'; }}
          />
          <div className="absolute -bottom-6 -left-6 bg-amber-400 p-8 rounded-3xl shadow-xl rotate-6">
            <Zap className="text-white w-10 h-10 mb-2" />
            <p className="text-white font-black text-2xl leading-none">FAST<br />DRY</p>
          </div>
          <div className="absolute -top-6 -right-6 bg-blue-500 p-8 rounded-full shadow-xl -rotate-12">
            <Smile className="text-white w-10 h-10" />
          </div>
        </div>
        {/* Decorative elements */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-blue-100 rounded-full blur-[120px] -z-10 opacity-50" />
      </motion.div>
    </div>
  </div>
);

const Pricing = () => {
  const [dynamicPricing, setDynamicPricing] = useState<Record<string, SharedPricingConfig>>({});
  const [pricingLoading, setPricingLoading] = useState(true);

  // Fetch dynamic pricing from API
  useEffect(() => {
    fetch('/api/pricing/public')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) {
          const pricingMap: Record<string, SharedPricingConfig> = {};
          data.data.forEach((p: PricingRow) => {
             pricingMap[p.service_type] = {
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
             };
          });
          setDynamicPricing(pricingMap);
        }
        setPricingLoading(false);
      })
      .catch(() => {
        setPricingLoading(false);
      });
  }, []);

  // Helper to calculate price for display using shared pricing logic
  const calculateDisplayPrice = (serviceType: string, quantity: number): number => {
    // Convert dynamicPricing to Map for shared pricing function
    const pricingMap = new Map<string, SharedPricingConfig>(
      Object.entries(dynamicPricing) as [string, SharedPricingConfig][]
    );
    return calculatePriceWithFallback(serviceType, quantity, pricingMap);
  };

  const services = [
    {
      title: "Wash & Fold",
      description: "Our signature service. We treat your everyday wear with the utmost care, using premium detergents and eco-friendly softeners.",
      image: "https://www.sourceoffabric.com/wp-content/uploads/2024/09/Woman-giving-away-washed-and-folded-clothing-1024x683.jpg",
      serviceType: "Wash & Fold (Clothes)",
      pricingType: "tiered",
      icon: Waves,
      color: "blue",
      bgClass: "bg-blue-50",
      textClass: "text-blue-600"
    },
    {
      title: "Comforters",
      description: "Deep cleaning for your bulkiest items. We ensure your comforters return fluffy, fresh, and allergen-free.",
      image: "https://www.bhg.com/thmb/cqz83t_lXtAOPHidEuggUe-UHJQ=/750x0/filters:no_upscale():max_bytes(150000):strip_icc():format(webp)/BHG-wash-and-dry-down-filled-items-01-49856-0c8d04175d9846019e87291865f471fb.jpg",
      serviceTypes: ["Comforter (Small)", "Comforter (Medium)", "Comforter (Large)"],
      pricingType: "per_kg",
      icon: Package,
      color: "amber",
      bgClass: "bg-amber-50",
      textClass: "text-amber-600"
    },
    {
      title: "Household Items",
      description: "From curtains to bedsheets, we handle your home textiles with specialized programs to maintain fabric integrity.",
      image: "https://cdn.apartmenttherapy.info/image/upload/f_auto,q_auto:eco,c_fit,w_730,h_487/shutterstock_776246272",
      serviceType: "Bedsheet/Curtain/Towel",
      pricingType: "per_kg",
      icon: Sparkles,
      color: "emerald",
      bgClass: "bg-emerald-50",
      textClass: "text-emerald-600"
    },
    {
      title: "Hand Wash",
      description: "For your most delicate treasures. Gentle manual cleaning for silks, wools, and intricate designs.",
      image: "https://hgtvhome.sndimg.com/content/dam/images/hgtv/stock/2022/9/GettyImages-1149017118.jpg.rend.hgtvcom.616.411.85.suffix/1664383662182.webp",
      serviceType: "Hand Wash Service",
      pricingType: "per_kg",
      icon: Smile,
      color: "rose",
      bgClass: "bg-rose-50",
      textClass: "text-rose-600"
    }
  ];

  return (
    <div id="pricing" className="max-w-7xl mx-auto py-32 px-4">
      <div className="mb-32">
        <h2 className="text-4xl sm:text-7xl md:text-8xl font-extrabold text-zinc-900 tracking-tighter mb-8">Our Services</h2>
        <p className="text-zinc-500 text-xl font-medium max-w-xl leading-relaxed">
          Tailored care for every fabric. Discover our range of premium laundry solutions designed for your lifestyle.
        </p>
      </div>

      <div className="space-y-40">
        {services.map((service, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 60 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
            className={`flex flex-col ${index % 2 === 0 ? 'lg:flex-row' : 'lg:flex-row-reverse'} gap-16 items-center`}
          >
            <div className="flex-1 w-full">
              <div className="relative aspect-[4/3] rounded-[48px] overflow-hidden shadow-2xl group">
                <img
                  src={service.image}
                  alt={service.title}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  referrerPolicy="no-referrer"
                  onError={(e) => { e.currentTarget.src = 'https://via.placeholder.com/800x600?text=Image+Unavailable'; }}
                />
                <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors duration-500" />
              </div>
            </div>
            
            <div className="flex-1 space-y-8">
              <div className={`w-16 h-16 rounded-3xl flex items-center justify-center ${service.bgClass} ${service.textClass}`}>
                <service.icon className="w-8 h-8" strokeWidth={2.5} />
              </div>
              
              <h3 className="text-5xl font-extrabold text-zinc-900 tracking-tighter">{service.title}</h3>
              <p className="text-zinc-500 text-lg leading-relaxed font-medium">
                {service.description}
              </p>

              <div className="pt-8 border-t border-zinc-100">
                {service.pricingType === 'tiered' && service.serviceType ? (
                  <div className="grid grid-cols-2 gap-4">
                    {(() => {
                      const config = dynamicPricing[service.serviceType!];
                      const tier1 = config?.tier_1_limit ?? 5;
                      const tier2 = config?.tier_2_limit ?? 7;
                      const tier3 = config?.tier_3_limit ?? 8;
                       const tier4 = config?.tier_4_limit ?? 9;
                       const deliveryFee = getDeliveryFee(config || FALLBACK_PRICING[service.serviceType]);
                       return [
                        { label: `1-${tier1} kgs`, qty: 1 },
                        { label: `${tier1 + 1}-${tier2} kgs`, qty: 6 },
                        { label: `${tier2 + 1}-${tier3} kgs`, qty: 8 },
                        { label: `${tier3 + 1}-${tier4} kgs`, qty: 9 },
                        { label: `${tier4 + 1}+ kgs`, qty: 10 },
                      ].map((rate, rIndex) => (
                        <div key={rIndex} className="space-y-2">
                          <div className="flex justify-between items-center p-4 bg-zinc-50 rounded-2xl">
                            <span className="text-xs font-black uppercase tracking-widest text-zinc-400">{rate.label}</span>
                            <span className="text-xl font-extrabold text-zinc-900">₱{calculateDisplayPrice(service.serviceType!, rate.qty)}</span>
                           </div>
                           <p className="text-[10px] text-emerald-600 font-bold text-center">+ ₱{deliveryFee} delivery fee</p>
                         </div>
                       ));
                    })()}
                  </div>
                ) : service.serviceTypes ? (
                  <div className="grid grid-cols-2 gap-4">
                    {service.serviceTypes.map((st, rIndex) => {
                      const label = st.replace('Comforter (', '').replace(')', '');
                       const config = dynamicPricing[st] || FALLBACK_PRICING[st];
                       const deliveryFee = getDeliveryFee(config);
                       return (
                        <div key={rIndex} className="space-y-2">
                          <div className="flex justify-between items-center p-4 bg-zinc-50 rounded-2xl">
                            <span className="text-xs font-black uppercase tracking-widest text-zinc-400">{label}</span>
                             <span className="text-xl font-extrabold text-zinc-900">₱{calculateDisplayPrice(st, 1)}</span>
                           </div>
                           <p className="text-[10px] text-emerald-600 font-bold text-center">+ ₱{deliveryFee} delivery fee</p>

                        </div>
                      );
                    })}
                  </div>
                ) : service.serviceType ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-4">
                      <span className="text-xs font-black uppercase tracking-widest text-zinc-400">Rate</span>
                      <span className="text-4xl font-extrabold text-zinc-900">₱{calculateDisplayPrice(service.serviceType, 1)} / kg</span>
                    </div>

                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        className="mt-40 bg-zinc-900 p-12 md:p-20 rounded-[64px] flex flex-col md:flex-row items-center justify-between gap-12 shadow-3xl overflow-hidden relative"
      >
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 text-white rounded-full text-xs font-bold mb-8 uppercase tracking-wider">
            <Truck className="w-4 h-4" />
            Convenience First
          </div>
          <h4 className="text-5xl md:text-6xl font-extrabold text-white tracking-tighter mb-6 leading-none">
            Pickup & <br /> Delivery
          </h4>
          <p className="text-zinc-400 text-lg font-medium max-w-sm">
            We bring the freshness to your doorstep. Delivery fee: may depend on which service. Drop-off is always free.
          </p>
        </div>
        <div className="relative z-10">
          <Smile className="text-white/10 w-64 h-64 -mr-20 -mb-20" strokeWidth={1} />
        </div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/20 rounded-full blur-[100px] -z-0" />
      </motion.div>
    </div>
  );
};

const MachineStatus = () => {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMachines = async (showLoader = false, signal?: AbortSignal) => {
     if (showLoader) setLoading(true);
     try {
       const res = await fetch('/api/machines', { signal });
       const response = await res.json();
        if (response.success && response.data) {
          // Always reconcile with server-provided machine state and timers
          setMachines(response.data);
        }
     } catch (err) {
       if (err instanceof DOMException && err.name === 'AbortError') {
         return; // Ignore aborted requests
       }
       console.error('Failed to fetch machines:', err);
     } finally {
       setLoading(false);
     }
   };

  useEffect(() => {
      const controller = new AbortController();
      fetchMachines(true, controller.signal);
      const fetchInterval = setInterval(() => fetchMachines(false, controller.signal), 5000);
      // Client-side countdown for smooth real-time timer
      const countdownInterval = setInterval(() => {
        setMachines(prev => prev.map(m => {
          if (m.status === 'in-use' && (m.remaining_time > 0 || m.drying_time > 0)) {
            return {
              ...m,
              remaining_time: Math.max(0, m.remaining_time - 1),
              drying_time: Math.max(0, m.drying_time - 1),
            };
          }
          return m;
        }));
      }, 1000);
      return () => {
        controller.abort();
        clearInterval(fetchInterval);
        clearInterval(countdownInterval);
      };
    }, []);

  if (loading && machines.length === 0) return <div className="py-20 text-center" role="status" aria-label="Loading machine status"><Loader2 className="w-10 h-10 animate-spin mx-auto text-blue-500" aria-hidden="true" /></div>;

  return (
    <div className="max-w-7xl mx-auto py-20 px-4">
      <div className="text-center mb-20">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-full text-xs font-black uppercase tracking-widest mb-6">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" /> Live Machine Status
        </div>
        <h2 className="text-5xl md:text-6xl font-extrabold text-zinc-900 tracking-tighter mb-6">Laundry Tracker</h2>
        <p className="text-zinc-500 text-lg font-medium max-w-2xl mx-auto">Check which machines are spinning and which are ready for your bubbles. Updated in real-time.</p>
        <button 
          onClick={() => fetchMachines(true)}
          className="mt-8 flex items-center gap-2 mx-auto text-xs font-black uppercase tracking-widest text-zinc-400 hover:text-blue-500 transition-colors"
        >
          <Loader2 className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh Status
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {machines.map((m) => (
          <motion.div 
            key={m.id}
            whileHover={{ y: -10 }}
            className="bg-white p-8 rounded-[40px] border-4 border-zinc-50 shadow-xl relative overflow-hidden group"
          >
            <div className={`absolute top-0 right-0 w-32 h-32 -mr-16 -mt-16 rounded-full opacity-10 transition-transform group-hover:scale-150 ${
              m.status === 'available' ? 'bg-emerald-500' : 'bg-blue-500'
            }`} />
            
            <div className="flex items-center justify-between mb-8">
              <div className={`w-16 h-16 rounded-3xl flex items-center justify-center ${
                m.type === 'washer' ? 'bg-blue-50 text-blue-500' : 
                m.type === 'dryer' ? 'bg-amber-50 text-amber-500' : 'bg-indigo-50 text-indigo-500'
              }`}>
                {m.type === 'washer' ? <Waves className="w-8 h-8" strokeWidth={1.5} /> : 
                 m.type === 'dryer' ? <Zap className="w-8 h-8" strokeWidth={1.5} /> : 
                 <div className="relative">
                   <Waves className="w-6 h-6 absolute -top-2 -left-2 opacity-50" strokeWidth={1.5} />
                   <Zap className="w-6 h-6 absolute -bottom-2 -right-2" strokeWidth={1.5} />
                 </div>
                }
              </div>
              <div className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest ${
                m.status === 'available' ? 'bg-emerald-100 text-emerald-600' : 
                m.status === 'in-use' ? 'bg-blue-100 text-blue-600' : 'bg-rose-100 text-rose-600'
              }`}>
                {m.status}
              </div>
            </div>

            <h3 className="text-2xl font-bold text-zinc-900 mb-1">{m.name}</h3>
            <p className="text-zinc-400 font-bold uppercase text-[10px] tracking-widest mb-6">
              {m.type === 'all-in-one' ? 'Washer + Dryer' : m.type}
            </p>

            {m.status === 'in-use' ? (
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <span className="text-sm font-bold text-zinc-500">{m.drying_time > 0 ? 'Drying' : 'Finishing in'}</span>
                  <span className="text-3xl font-black text-blue-500">{formatTime(m.drying_time > 0 ? m.drying_time : m.remaining_time)}</span>
                </div>
                {/* Progress bar - calculates percentage based on remaining time (max 3600s = 60min) */}
                <div className="h-3 bg-zinc-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-linear"
                    style={{ width: `${Math.max(0, Math.min(100, ((m.drying_time > 0 ? m.drying_time : m.remaining_time) / 3600) * 100))}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="py-4">
                <p className="text-emerald-500 font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" /> Ready for use!
                </p>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
};

const TrackOrder = ({ setView }: { setView: (v: View) => void }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState('');
  const [rescheduleSuccess, setRescheduleSuccess] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewPhotos, setReviewPhotos] = useState<File[]>([]);
  const [reviewPhotoPreviews, setReviewPhotoPreviews] = useState<string[]>([]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;
    
    setLoading(true);
    setError('');
    setNotFound(false);
    setTransaction(null);
    setRating(0);
    setComment('');
    setRatingSubmitted(false);
    setShowReviewForm(false);

    try {
      const res = await fetch('/api/transactions/track/' + encodeURIComponent(searchTerm));
      const response = await res.json();
      
       if (response.success && response.data) {
         setTransaction(response.data);
         setRescheduleDate(response.data.appointment_date || '');
         setRescheduleTime(response.data.appointment_time || '');
         setRescheduleSuccess(false);
         setRescheduleError('');
         // Show review form for completed transactions that haven't been rated yet
         if (response.data.status === 'completed' && !response.data.review) {
           setShowReviewForm(true);
         }
       } else {
        setNotFound(true);
      }
    } catch (err) {
      setError('Failed to search. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReschedule = async () => {
    if (!transaction) return;
    if (!rescheduleDate || !rescheduleTime) {
      setRescheduleError('Please select both date and time.');
      return;
    }
    setRescheduling(true);
    setRescheduleError('');
    try {
      const res = await fetch(`/api/transactions/track/${encodeURIComponent(transaction.reference_number)}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointment_date: rescheduleDate, appointment_time: rescheduleTime }),
      });
      const data = await res.json();
      if (!res.ok || (data && data.success === false)) {
        throw new Error((data && data.error) || 'Failed to reschedule');
      }
      setTransaction(prev => prev ? { ...prev, appointment_date: rescheduleDate, appointment_time: rescheduleTime } : prev);
      setRescheduleSuccess(true);
    } catch (err) {
      setRescheduleError(err instanceof Error ? err.message : 'Failed to reschedule. Please try again.');
    } finally {
      setRescheduling(false);
    }
  };

  const handlePrint = () => {
    setTimeout(() => printReceipt('track-receipt'), 100);
  };

  const handleSubmitRating = async () => {
    if (rating === 0 || !transaction) return;
    setReviewSubmitting(true);
    setReviewError('');
    try {
      const result = await createReview(transaction.id, rating, comment.trim(), reviewPhotos);
      setRatingSubmitted(true);
      setShowReviewForm(false);
      setTransaction(prev => prev ? { ...prev, review: { rating, comment: comment.trim() || null, photos: result.photos || reviewPhotoPreviews } } : prev);
      setReviewModalOpen(false);
      // Reset photo state
      setReviewPhotos([]);
      setReviewPhotoPreviews([]);
    } catch (err) {
      console.error('Failed to submit rating', err);
      setReviewError(err instanceof Error ? err.message : 'Failed to submit review. Please try again.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  // Status steps for the timeline - only active tracking steps (no declined)
  const trackingSteps = [
    { key: 'pending', label: 'Order Received', icon: Clock, description: 'Your order has been received' },
    { key: 'accepted', label: 'Accepted', icon: CheckCircle2, description: 'Order confirmed and queued' },
    { key: 'washing', label: 'Washing', icon: Waves, description: 'Your laundry is being washed' },
    { key: 'drying', label: 'Drying', icon: Zap, description: 'Your laundry is being dried' },
    { key: 'ready', label: 'Ready for Pickup', icon: Package, description: 'Ready for pickup or delivery' },
    { key: 'completed', label: 'Completed', icon: CheckCircle2, description: 'Order completed successfully' },
  ];

  const getCurrentStepIndex = (status: string) => {
    const index = trackingSteps.findIndex(s => s.key === status);
    return index === -1 ? 0 : index;
  };

  const isDeclined = transaction?.status === 'declined';

  return (
    <div className="max-w-4xl mx-auto py-6 sm:py-10 px-4 pb-12">
      {/* Header */}
      <div className="text-center mb-8 sm:mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-widest mb-4">
          <Truck className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Track Your Order
        </div>
        <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold text-zinc-900 tracking-tighter mb-3">Where's My Laundry?</h1>
        <p className="text-zinc-500 text-base sm:text-lg font-medium max-w-xl mx-auto">
          Enter your reference number to see the current status of your laundry order.
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="mb-8 sm:mb-12">
        <div className="flex flex-col sm:flex-row gap-3 max-w-2xl mx-auto">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 w-5 h-5" />
            <input
               type="text"
               placeholder="Enter reference number (e.g., LF-A1B2C3)"
               className="w-full pl-12 pr-4 py-4 bg-white border-2 border-zinc-100 rounded-[20px] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all font-bold text-base shadow-sm"
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value.toUpperCase())}
               disabled={loading}
               aria-label="Enter your order reference number"
             />
          </div>
          <button
             type="submit"
             disabled={loading || !searchTerm.trim()}
             className="px-6 py-4 bg-blue-500 text-white rounded-[20px] font-black text-base hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-100 flex items-center gap-2 whitespace-nowrap"
             aria-label="Search for your order by reference number"
           >
             {loading ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : 'Track Order'}
           </button>
        </div>
      </form>

      {/* Error/Not Found States */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 p-4 rounded-xl text-center font-medium mb-6 flex items-center justify-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {notFound && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 p-6 rounded-xl text-center mb-6">
          <XCircle className="w-10 h-10 mx-auto mb-3" />
          <p className="font-black text-lg mb-1">Order Not Found</p>
          <p className="font-medium">Please check your reference number and try again.</p>
        </div>
      )}

      {/* Order Details Card */}
      {transaction && (
        <>
          <div id="track-receipt" style={{ display: 'none' }}>
            <Receipt transaction={transaction} type="tracking" />
          </div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-[24px] shadow-xl border border-zinc-100 overflow-hidden"
          >
            {/* Header with Reference Number and Status */}
            <div className="bg-zinc-900 p-6 sm:p-8 text-white">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-1">Reference Number</p>
                  <p className="text-2xl sm:text-3xl font-mono font-black text-blue-400 truncate">{transaction.reference_number}</p>
                </div>
                <div className={`px-4 py-2 sm:px-6 sm:py-3 rounded-full text-xs sm:text-sm font-black uppercase tracking-widest whitespace-nowrap flex items-center gap-2 ${
                   transaction.status === 'pending' ? 'bg-amber-500 text-white' :
                   transaction.status === 'accepted' ? 'bg-blue-500 text-white' :
                   transaction.status === 'washing' ? 'bg-indigo-500 text-white' :
                   transaction.status === 'drying' ? 'bg-sky-500 text-white' :
                   transaction.status === 'ready' ? 'bg-purple-500 text-white' :
                   transaction.status === 'completed' ? 'bg-emerald-500 text-white' :
                   'bg-rose-600 text-white'
                 }`}>
                  {isDeclined ? (
                    <>
                      <XCircle className="w-4 h-4" />
                      Declined
                    </>
                  ) : (
                    transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)
                  )}
                </div>
              </div>
            </div>

            <div className="p-6 sm:p-8">
              {/* Order Details Grid */}
              <div className="grid grid-cols-2 gap-4 sm:gap-6 mb-8">
                <div className="bg-zinc-50 rounded-xl p-4 sm:p-5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Customer</p>
                  <p className="font-bold text-zinc-900 truncate">{transaction.customer_name}</p>
                </div>
                <div className="bg-zinc-50 rounded-xl p-4 sm:p-5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Service</p>
                  <p className="font-bold text-zinc-900 truncate">{transaction.service_type}</p>
                </div>
                <div className="bg-zinc-50 rounded-xl p-4 sm:p-5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Quantity</p>
                  <p className="font-bold text-zinc-900">x{transaction.quantity}</p>
                </div>
                <div className="bg-zinc-50 rounded-xl p-4 sm:p-5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">Total</p>
                  <p className="font-black text-lg sm:text-xl text-blue-600">₱{transaction.total_price.toFixed(2)}</p>
                </div>
              </div>

              {/* Handwash proof image display */}
              {transaction.service_type?.toLowerCase().includes('hand wash') && transaction.handwash_proof_image && (
                <div className="mb-8">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3 text-center">Handwash Proof</p>
                  <div className="flex justify-center">
                    <img
                      src={transaction.handwash_proof_image}
                      alt="Handwash proof"
                      className="max-w-full rounded-lg shadow-lg border border-zinc-200"
                    />
                  </div>
                </div>
              )}

              {/* Modern Vertical Stepper Timeline */}
              <div className="mb-8">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-6 text-center">Order Progress</p>
                
                <div className="relative">
                  {/* Vertical connecting line */}
                  <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-zinc-100" />
                  
                  {trackingSteps.map((step, index) => {
                    const currentStepIndex = getCurrentStepIndex(transaction.status);
                    const isCompleted = index < currentStepIndex;
                    const isCurrent = index === currentStepIndex && !isDeclined;
                    const isFuture = index > currentStepIndex;
                    const StepIcon = step.icon;
                    
                    // For declined orders, show all steps as incomplete
                    const stepCompleted = isDeclined ? false : isCompleted;
                    const stepCurrent = isDeclined ? false : isCurrent;

                    return (
                      <div key={step.key} className="relative flex items-start gap-4 pb-8 last:pb-0">
                        {/* Step indicator */}
                        <div className="relative z-10 flex-shrink-0">
                          <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 border-4 ${
                            stepCompleted
                              ? 'bg-emerald-500 text-white border-emerald-500'
                              : stepCurrent
                              ? 'bg-white text-blue-500 border-blue-500 ring-4 ring-blue-500/20'
                              : 'bg-white text-zinc-300 border-zinc-200'
                          }`}>
                            {stepCompleted ? (
                              <Check className="w-7 h-7 text-white" />
                            ) : (
                              <StepIcon className={`w-7 h-7 ${stepCurrent ? 'text-blue-500' : 'text-zinc-300'}`} />
                            )}
                          </div>
                          {/* Pulse animation for current step */}
                          {stepCurrent && (
                            <div className="absolute inset-0 rounded-full border-2 border-blue-500 animate-ping opacity-75" />
                          )}
                        </div>
                        
                        {/* Step content */}
                        <div className="flex-1 min-w-0 pt-1">
                          <p className={`font-black text-sm sm:text-base uppercase tracking-wider transition-colors ${
                            stepCompleted ? 'text-zinc-900' : stepCurrent ? 'text-blue-600' : 'text-zinc-400'
                          }`}>
                            {step.label}
                          </p>
                          <p className={`text-xs sm:text-sm mt-1 transition-colors ${
                            stepCompleted ? 'text-zinc-500' : stepCurrent ? 'text-blue-500' : 'text-zinc-300'
                          }`}>
                            {step.description}
                          </p>
                          {/* Status timestamp could be added here if available */}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Declined State */}
              {isDeclined && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-center mb-6">
                  <XCircle className="w-12 h-12 mx-auto text-rose-500 mb-3" />
                  <p className="font-black text-lg text-rose-700 mb-1">Order Declined</p>
                  <p className="text-rose-600">This order was declined. Please contact us for more information.</p>
                </div>
              )}

              {/* Completed State */}
              {transaction.status === 'completed' && !isDeclined && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="bg-emerald-50 border border-emerald-100 rounded-xl p-5 mb-6"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                      <p className="font-black text-emerald-800">Order Completed</p>
                      <p className="text-emerald-600 text-sm mt-0.5">Your laundry is ready for pickup! Thank you for choosing HappyWash.</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Ready State */}
              {transaction.status === 'ready' && !isDeclined && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="bg-purple-50 border border-purple-100 rounded-xl p-5 mb-6"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Package className="w-6 h-6 text-purple-600" />
                    </div>
                    <div>
                      <p className="font-black text-purple-800">Ready for Pickup</p>
                      <p className="text-purple-600 text-sm mt-0.5">Your laundry is ready! Drop by to pick it up or schedule a delivery.</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Rating Section - Show after completion */}
              {transaction.status === 'completed' && !isDeclined && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-100 rounded-xl p-6"
                >
                  <p className="text-center font-black text-base sm:text-lg text-zinc-800 mb-4">How was your experience?</p>
                  {transaction.review ? (
                    <div className="text-center">
                      <div className="flex justify-center gap-1 mb-3">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            className={`w-8 h-8 ${
                              star <= transaction.review!.rating
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-zinc-300'
                            }`}
                          />
                        ))}
                      </div>

                       <p className="text-center text-emerald-600 font-bold flex items-center justify-center gap-2">
                         <Smile className="w-5 h-5" /> Thank you for your feedback!
                       </p>
                       {transaction.review?.photos && transaction.review.photos.length > 0 && (
                         <div className="flex gap-2 justify-center mt-3 flex-wrap">
                           {transaction.review.photos.map((p, i) => (
                             <a key={i} href={p} target="_blank" rel="noopener noreferrer">
                               <img src={p} alt={`review photo ${i + 1}`} className="w-16 h-16 object-cover rounded-xl border-2 border-zinc-200 hover:scale-105 transition-transform" />
                             </a>
                           ))}
                         </div>
                       )}
                     </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 w-full max-w-md mx-auto">
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            onClick={() => setRating(star)}
                            className="p-1 hover:scale-110 transition-transform"
                          >
                            <Star
                              className={`w-8 h-8 ${
                                star <= rating
                                  ? 'fill-amber-400 text-amber-400'
                                  : 'text-zinc-300'
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                       <textarea
                         value={comment}
                         onChange={e => setComment(e.target.value)}
                         placeholder="Write a review (optional)..."
                         rows={2}
                         className="w-full p-3 bg-white border-2 border-zinc-200 rounded-xl font-medium text-zinc-700 placeholder-zinc-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 resize-none text-sm"
                       />
                       {/* Photo upload */}
                       <div className="w-full">
                         <label className="block text-xs font-bold text-zinc-500 mb-2">Attach photos (optional, max 5, 5MB each)</label>
                         <input
                           type="file"
                           accept="image/jpeg,image/png,image/webp,image/gif"
                           multiple
                           onChange={(e) => {
                             const files = Array.from(e.target.files || []);
                             const valid = files.filter(f => f.size <= 5 * 1024 * 1024);
                             setReviewPhotos(valid);
                             setReviewPhotoPreviews(valid.map(f => URL.createObjectURL(f)));
                           }}
                           className="w-full text-sm text-zinc-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-blue-50 file:text-blue-600 file:font-bold hover:file:bg-blue-100"
                         />
                         {reviewPhotoPreviews.length > 0 && (
                           <div className="flex gap-2 mt-3 flex-wrap">
                             {reviewPhotoPreviews.map((src, i) => (
                               <div key={i} className="relative">
                                 <img src={src} alt={`preview ${i + 1}`} className="w-16 h-16 object-cover rounded-xl border-2 border-zinc-200" />
                                 <button
                                   type="button"
                                   onClick={() => {
                                     setReviewPhotos(prev => prev.filter((_, idx) => idx !== i));
                                     setReviewPhotoPreviews(prev => prev.filter((_, idx) => idx !== i));
                                   }}
                                   className="absolute -top-2 -right-2 w-5 h-5 bg-rose-500 text-white rounded-full text-xs font-bold flex items-center justify-center"
                                 >×</button>
                               </div>
                             ))}
                           </div>
                         )}
                       </div>
                       <button
                        onClick={() => { setReviewError(''); setReviewModalOpen(true); }}
                        disabled={rating === 0}
                        className={`px-6 py-3 rounded-xl font-black text-sm uppercase tracking-widest transition-all w-full ${
                          rating > 0
                            ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-lg shadow-blue-100'
                            : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
                        }`}
                      >
                        Submit Review
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </div>

             {/* Admin Replies (shown for all relevant statuses) */}
             {transaction.review?.replies && transaction.review.replies.length > 0 && (
               <div className="px-6 py-5 sm:px-8 border-t border-zinc-100">
                 <p className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3">Admin Replies</p>
                 <div className="space-y-3">
                   {transaction.review.replies.map((reply) => (
                     <div key={reply.id} className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                       <div className="flex items-center justify-between mb-1">
                         <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Admin Reply</p>
                         <p className="text-[10px] text-zinc-400">{new Date(reply.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                       </div>
                       <p className="text-sm text-zinc-800 leading-relaxed">{reply.message}</p>
                     </div>
                   ))}
                 </div>
               </div>
             )}

             {/* Reschedule Section */}
             {transaction.status !== 'declined' && (
               <div className="px-6 py-5 sm:px-8 border-t border-zinc-100">
                 <p className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3">Reschedule Pickup/Delivery</p>
                 <div className="flex flex-col sm:flex-row gap-3">
                   <input
                     type="date"
                     value={rescheduleDate}
                     onChange={e => { setRescheduleDate(e.target.value); setRescheduleSuccess(false); setRescheduleError(''); }}
                     className="flex-1 p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold text-sm"
                     aria-label="Reschedule date"
                   />
                   <input
                     type="time"
                     value={rescheduleTime}
                     onChange={e => { setRescheduleTime(e.target.value); setRescheduleSuccess(false); setRescheduleError(''); }}
                     className="flex-1 p-3 bg-zinc-50 border-2 border-zinc-200 rounded-xl font-bold text-sm"
                     aria-label="Reschedule time"
                   />
                   <button
                     onClick={handleReschedule}
                     disabled={rescheduling}
                     className="px-6 py-3 bg-blue-500 text-white rounded-xl font-black text-sm hover:bg-blue-600 disabled:opacity-50"
                   >
                     {rescheduling ? 'Saving...' : 'Reschedule'}
                   </button>
                 </div>
                 {rescheduleError && <p className="text-sm text-rose-600 font-bold mt-2">{rescheduleError}</p>}
                 {rescheduleSuccess && <p className="text-sm text-emerald-600 font-bold mt-2">Schedule updated successfully.</p>}
               </div>
             )}

             {/* Action Buttons */}
             <div className="bg-zinc-50 border-t border-zinc-100 px-6 py-5 sm:px-8">
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handlePrint}
                  className="flex-1 py-3 sm:py-4 bg-white text-zinc-900 rounded-xl font-black text-base sm:text-lg hover:bg-zinc-100 transition-all shadow-sm border border-zinc-200 flex items-center justify-center gap-2"
                >
                  <ClipboardList className="w-4 h-4 sm:w-5 sm:h-5" /> Print Receipt
                </button>
                <button
                  onClick={() => {
                    setTransaction(null);
                    setSearchTerm('');
                    setNotFound(false);
                    setError('');
                  }}
                  className="flex-1 py-3 sm:py-4 bg-blue-500 text-white rounded-xl font-black text-base sm:text-lg hover:bg-blue-600 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2"
                >
                  <Search className="w-4 h-4 sm:w-5 sm:h-5" /> Track Another
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}

       {/* Book New Order Button */}
       <div className="text-center mt-8 no-print">
         <button
           onClick={() => setView('booking')}
           className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-50 text-blue-600 rounded-full text-sm font-black hover:bg-blue-100 transition-colors"
         >
           <Plus className="w-4 h-4" /> Book New Order
         </button>
       </div>

       {reviewModalOpen && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
           <motion.div
             initial={{ opacity: 0, scale: 0.95, y: 20 }}
             animate={{ opacity: 1, scale: 1, y: 0 }}
             exit={{ opacity: 0, scale: 0.95, y: -20 }}
             className="bg-white rounded-[32px] shadow-2xl w-full max-w-md p-6 sm:p-8"
           >
             <h2 className="text-xl sm:text-2xl font-black text-zinc-900 mb-2">Submit Review</h2>
             <p className="text-sm text-zinc-500 mb-4">Are you sure you want to submit this review?</p>
             <div className="flex gap-1 mb-3">
               {[1, 2, 3, 4, 5].map((star) => (
                 <Star key={star} className={`w-6 h-6 ${star <= rating ? 'fill-amber-400 text-amber-400' : 'text-zinc-300'}`} />
               ))}
             </div>
             {comment.trim() && (
               <p className="text-sm text-zinc-700 italic mb-4">"{comment.trim()}"</p>
             )}
             {reviewError && (
               <p className="text-sm text-rose-600 font-bold mb-3">{reviewError}</p>
             )}
             {ratingSubmitted && (
               <p className="text-sm text-emerald-600 font-bold mb-3">Your review has been sent. Thank you!</p>
             )}
             <div className="flex gap-3 justify-end">
               <button
                 onClick={() => { setReviewModalOpen(false); setReviewError(''); }}
                 className="px-4 py-2 rounded-xl bg-zinc-100 text-zinc-900 font-bold hover:bg-zinc-200"
                 disabled={reviewSubmitting}
               >
                 Cancel
               </button>
               <button
                 onClick={handleSubmitRating}
                 disabled={reviewSubmitting || rating === 0}
                 className="px-4 py-2 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
               >
                 {reviewSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm & Send'}
               </button>
             </div>
           </motion.div>
         </div>
       )}

     </div>
   );
};

const UserReviews = () => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchReviews = async () => {
      try {
        setLoading(true);
        const data = await getPublicReviews();
        setReviews(data);
      } catch (err) {
        setError('Failed to load reviews. Please try again later.');
        console.error('Failed to fetch reviews:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchReviews();
  }, []);

  const getAverageRating = () => {
    if (reviews.length === 0) return 0;
    const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
    return sum / reviews.length;
  };

  const getRatingDistribution = () => {
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    reviews.forEach(r => {
      if (distribution[r.rating as keyof typeof distribution] !== undefined) {
        distribution[r.rating as keyof typeof distribution]++;
      }
    });
    return distribution;
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12 sm:py-20 px-4" role="status" aria-label="Loading reviews">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-6" aria-hidden="true" />
          <p className="text-zinc-500 font-medium">Loading reviews...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-12 sm:py-20 px-4">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-rose-400 mx-auto mb-6" />
          <h2 className="text-2xl font-black text-zinc-900 mb-2">Unable to Load Reviews</h2>
          <p className="text-zinc-500 mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-blue-500 text-white rounded-xl font-black hover:bg-blue-600 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const avgRating = getAverageRating();
  const distribution = getRatingDistribution();
  const totalReviews = reviews.length;

  return (
    <div className="max-w-4xl mx-auto py-12 sm:py-20 px-4 pb-20">
      <div className="text-center mb-12 sm:mb-16">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-600 rounded-full text-xs font-black uppercase tracking-widest mb-6">
          <Star className="w-4 h-4 fill-amber-400 text-amber-400" /> Customer Reviews
        </div>
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold text-zinc-900 tracking-tighter mb-6">What Our Customers Say</h1>
        <p className="text-zinc-500 text-lg font-medium max-w-xl mx-auto">
          Real feedback from real customers. See why people love HappyWash.
        </p>
      </div>

      {/* Overall Rating Summary */}
      <div className="bg-white rounded-[32px] shadow-2xl border-4 border-zinc-50 p-8 sm:p-12 mb-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2 mb-4">
              <span className="text-5xl sm:text-7xl font-extrabold text-zinc-900">{avgRating.toFixed(1)}</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`w-8 h-8 ${
                      star <= Math.round(avgRating)
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-zinc-300'
                    }`}
                  />
                ))}
              </div>
            </div>
            <p className="text-zinc-500 font-medium">{totalReviews} {totalReviews === 1 ? 'review' : 'reviews'}</p>
          </div>
          
          <div className="space-y-2">
            {[5, 4, 3, 2, 1].map((star) => (
              <div key={star} className="flex items-center gap-3">
                <span className="text-sm font-bold text-zinc-500 w-8 text-right">{star}★</span>
                <div className="flex-1 h-3 bg-zinc-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 rounded-full transition-all duration-500"
                    style={{ width: `${totalReviews > 0 ? (distribution[star as keyof typeof distribution] / totalReviews) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm font-bold text-zinc-500 w-12 text-right">
                  {totalReviews > 0 ? Math.round((distribution[star as keyof typeof distribution] / totalReviews) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Reviews List */}
      <div className="space-y-6">
        {reviews.length === 0 ? (
          <div className="bg-white rounded-[32px] shadow-2xl border-4 border-zinc-50 p-12 text-center">
            <MessageSquare className="w-16 h-16 text-zinc-200 mx-auto mb-6" />
            <h2 className="text-2xl font-black text-zinc-900 mb-2">No Reviews Yet</h2>
            <p className="text-zinc-500 mb-6">Be the first to share your experience!</p>
            <button
              onClick={() => window.location.hash = 'booking'}
              className="px-8 py-4 bg-blue-500 text-white rounded-2xl font-black text-lg hover:bg-blue-600 transition-all shadow-xl shadow-blue-100"
            >
              Book Your First Order
            </button>
          </div>
        ) : (
          reviews.map((review) => (
            <motion.div
              key={review.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="bg-white rounded-[24px] shadow-xl border-2 border-zinc-50 p-6 sm:p-8"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <User className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-black text-zinc-900">{review.customer_name || 'Anonymous'}</p>
                    <p className="text-sm text-zinc-500">
                      {review.reference_number ? `Order: ${review.reference_number}` : ''}
                      {review.service_type ? ` • ${review.service_type}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`w-6 h-6 ${
                        star <= review.rating
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-zinc-300'
                      }`}
                    />
                  ))}
                </div>
              </div>
              
                <p className="text-zinc-700 leading-relaxed mb-4">
                  {review.comment || 'No comment provided.'}
                </p>
                {review.photos && review.photos.length > 0 && (
                  <div className="flex gap-2 mb-4 flex-wrap">
                    {review.photos.map((p, i) => (
                      <a key={i} href={p} target="_blank" rel="noopener noreferrer">
                        <img src={p} alt={`review photo ${i + 1}`} className="w-20 h-20 object-cover rounded-xl border-2 border-zinc-200 hover:scale-105 transition-transform" />
                      </a>
                    ))}
                  </div>
                )}

               {review.replies && review.replies.length > 0 && (
                 <div className="mb-4 space-y-3">
                   {review.replies.map((reply) => (
                     <div key={reply.id} className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                       <div className="flex items-center justify-between mb-1">
                         <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Admin Reply</p>
                         <p className="text-[10px] text-zinc-400">{new Date(reply.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                       </div>
                       <p className="text-sm text-zinc-800 leading-relaxed">{reply.message}</p>
                     </div>
                   ))}
                 </div>
               )}
              
              <div className="flex items-center justify-between pt-4 border-t border-zinc-100">
                <p className="text-sm text-zinc-400">
                  {new Date(review.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
                {review.service_type && (
                  <span className="px-3 py-1 bg-zinc-100 text-zinc-600 rounded-full text-xs font-bold uppercase tracking-wider">
                    {review.service_type}
                  </span>
                )}
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};

// UserBooking moved to ./components/UserBooking

export default function App() {
  // Initialize view from URL hash for proper tab isolation
  const getInitialView = (): View => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.slice(1);
      const validViews: View[] = ['home', 'booking', 'machines', 'admin', 'receipt', 'track', 'reviews', 'admin-login', 'admin-settings'];
      if (validViews.includes(hash as View)) {
        return hash as View;
      }
    }
    return 'home';
  };

  const [view, setView] = useState<View>(getInitialView);

  // --- Admin portal protection -----------------------------------------------
  // The admin portal is only ever rendered for a session the server still
  // accepts. 'unknown' means the check is still running, so no admin markup is
  // painted before the token has been validated.
  const [adminAuth, setAdminAuth] = useState<'unknown' | 'authenticated' | 'unauthenticated'>('unknown');

  // Bumped whenever the session is wiped so the admin components are remounted
  // and cannot keep data that belonged to the previous session in memory.
  const [adminSession, setAdminSession] = useState(0);

  // Check if we should hide navbar/footer (admin views)
  const hideNavAndFooter = view === 'admin' || view === 'admin-login' || view === 'admin-settings';

  // Update URL hash when view changes (enables tab isolation, deep linking, back/forward)
  useEffect(() => {
    if (window.location.hash.slice(1) !== view) {
      window.location.hash = view;
    }
  }, [view]);

  // Listen for hash changes (e.g., back/forward buttons, other tabs)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      const validViews: View[] = ['home', 'booking', 'machines', 'admin', 'receipt', 'track', 'reviews', 'admin-login', 'admin-settings'];
      if (validViews.includes(hash as View)) {
        setView(hash as View);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Guard every admin route. An unauthenticated visitor is always sent to the
  // login page and an already authenticated one never sees the login form
  // again, so Back/Forward can never expose the portal.
  useEffect(() => {
    if (!isAdminView(view)) {
      setAdminAuth('unknown');
      return;
    }

    let cancelled = false;

    (async () => {
      const { valid } = await verifyAdminToken();
      if (cancelled) return;

      if (!valid) {
        clearAdminSession();
        setAdminAuth('unauthenticated');
        if (view !== 'admin-login') {
          replaceHistoryEntry('#admin-login');
          setView('admin-login');
        }
        return;
      }

      setAdminAuth('authenticated');
      if (view === 'admin-login') {
        // Already signed in - replace the login entry so Back cannot land on
        // the login form.
        replaceHistoryEntry('#admin');
        setView('admin');
      }
    })();

    return () => { cancelled = true; };
  }, [view]);

  // A page restored from the back-forward cache keeps the React state it had
  // when it was frozen, so the session is validated again before anything of
  // the portal is shown.
  useEffect(() => {
    const revalidateSession = () => {
      if (!isAdminView(view)) return;
      verifyAdminToken().then(({ valid }) => {
        if (!valid) {
          clearAdminSession();
          setAdminAuth('unauthenticated');
          replaceHistoryEntry('#admin-login');
          setView('admin-login');
        } else {
          setAdminAuth('authenticated');
        }
      });
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      // persisted === true means the page came from the back-forward cache.
      if (event.persisted) revalidateSession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') revalidateSession();
    };

    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [view]);

  // Remount the admin components when the session is wiped so nothing from the
  // previous session stays in memory.
  useEffect(() => {
    const handleSessionCleared = () => setAdminSession((n) => n + 1);
    window.addEventListener(ADMIN_SESSION_CLEARED_EVENT, handleSessionCleared);
    return () => window.removeEventListener(ADMIN_SESSION_CLEARED_EVENT, handleSessionCleared);
  }, []);

  return (
    <ToastProvider>
      <div className={`min-h-screen flex flex-col bg-zinc-50 font-sans text-zinc-900 selection:bg-blue-100 selection:text-blue-600 ${!hideNavAndFooter ? 'pt-20' : ''}`}>
        {!hideNavAndFooter && <Navbar view={view} setView={setView} />}
        {/* Spacer for the admin login screen, which centres itself in the viewport.
            The dashboard and settings screens render their own fixed admin
            navbar and reserve the space for it themselves. */}
        {view === 'admin-login' && <div className="h-20" />}
        
        <main
          id="main-content"
          role="main"
          className={view === 'admin-login'
            ? 'flex items-center justify-center min-h-[calc(100vh-5rem)]'
            : hideNavAndFooter
              ? 'w-full min-w-0 flex-1 min-h-[calc(100vh-5rem)]'
              : 'flex-1'}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              className="w-full min-w-0"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            >
              {view === 'home' && (
                <>
                  <Hero onStart={() => setView('booking')} />
                  <Pricing />
                </>
              )}
              {view === 'machines' && <MachineStatus />}
              {view === 'booking' && <UserBooking />}
              {view === 'track' && <TrackOrder setView={setView} />}
              {view === 'reviews' && <UserReviews />}
              {view === 'admin-login' && adminAuth !== 'authenticated' && <AdminLogin setView={setView} />}
              {view === 'admin' && adminAuth === 'authenticated' && (
                <AdminDashboard key={adminSession} setView={setView} />
              )}
              {view === 'admin-settings' && adminAuth === 'authenticated' && (
                <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 sm:pt-24 pb-6 sm:pb-8">
                  <AdminSettings key={adminSession} setView={setView} />
                </div>
              )}
              {/* Nothing of the portal is painted before the session is validated. */}
              {isAdminView(view) && adminAuth === 'unknown' && (
                <div className="flex items-center justify-center min-h-[60vh]" role="status" aria-label="Checking admin session">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" aria-hidden="true" />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        {!hideNavAndFooter && (
        <footer className="py-20 border-t border-zinc-100 mt-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-12">
            <div>
              <div className="flex items-center gap-0 mb-6">
                <img src="/happy-wash-mark-transparent.png" alt="HappyWash logo" className="h-10 w-auto" />
                <span className="text-xl font-extrabold text-zinc-900 tracking-tight">Happy<span className="text-blue-600">Wash</span></span>
              </div>
              <p className="text-zinc-400 font-medium">Making laundry the highlight of your day. Freshness delivered with a smile.</p>
            </div>
            <div className="flex flex-col gap-4">
              <h4 className="font-black uppercase tracking-widest text-xs text-zinc-900">Quick Links</h4>
              {['Home', 'Machines', 'Booking', 'Track Order', 'Reviews'].map(l => (
                <button key={l} onClick={() => setView(l === 'Track Order' ? 'track' : l === 'Reviews' ? 'reviews' : l.toLowerCase() as View)} className="text-zinc-400 hover:text-blue-500 text-left font-bold transition-colors" aria-label={`Navigate to ${l}`}>{l}</button>
              ))}
            </div>
            <div className="flex flex-col gap-4">
              <h4 className="font-black uppercase tracking-widest text-xs text-zinc-900">Contacts</h4>
              <p className="text-zinc-400 font-bold">Madayegdeg, San Fernando City, La Union</p>
              <p className="text-zinc-400 font-bold">09661305502/09205484011</p>
              <a href="https://www.facebook.com/HappywashlaundrySFC" target="_blank" rel="noopener noreferrer" className="text-zinc-400 font-bold hover:text-blue-500 transition-colors" aria-label="Visit HappyWash Facebook page (opens in new tab)">
                facebook.com/HappywashlaundrySFC
              </a>
            </div>
          </div>
          <div className="max-w-7xl mx-auto px-4 text-center mt-20 pt-8 border-t border-zinc-50">
            <p className="text-xs font-black text-zinc-300 uppercase tracking-widest">© 2025-2026 HAPPY WASH LAUNDRY SHOP. ALL RIGHTS RESERVED.</p>
            <button 
               onClick={() => setView('admin-login')}
               className="mt-4 text-xs font-black text-zinc-400 uppercase tracking-widest hover:text-blue-500 transition-colors"
               aria-label="Navigate to admin login page"
             >
               Admin Login
             </button>
          </div>
        </footer>
        )}
      </div>
    </ToastProvider>
  );
};
