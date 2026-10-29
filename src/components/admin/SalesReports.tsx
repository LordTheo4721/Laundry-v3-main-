import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  DollarSign,
  ShoppingBag,
  Clock,
  RefreshCw,
  ArrowLeft,
  BarChart3,
  Package,
  CheckCircle,
  XCircle,
  Wallet,
  Store,
  Truck,
  Target,
  Percent,
  Download,
  Activity,
  ShoppingCart,
  Users
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';
import { getSalesData, getPricing } from '../../utils/api';
import type { SalesData } from '../../types';

interface SalesReportsProps {
  setView: (v: string) => void;
}

const SalesReports: React.FC<SalesReportsProps> = ({ setView }) => {
  const [salesData, setSalesData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'all'>('month');
  const [activeTab, setActiveTab] = useState<'overview' | 'daily' | 'services' | 'payments'>('overview');
  const [serviceType, setServiceType] = useState('');
  // The filter options come from the pricing table, NOT from the (filtered)
  // sales breakdown - otherwise selecting a service collapses the dropdown to a
  // single option and the admin can no longer switch services.
  const [serviceOptions, setServiceOptions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadServiceOptions = async () => {
      try {
        const pricing = await getPricing();
        if (cancelled) return;
        const options = [...new Set(pricing.map(p => p.service_type))].sort();
        setServiceOptions(options);
      } catch (error) {
        console.error('Failed to fetch service options:', error);
      }
    };
    loadServiceOptions();
    return () => { cancelled = true; };
  }, []);

  const fetchSalesData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSalesData(dateRange, serviceType || undefined);
      setSalesData(data);
    } catch (error) {
      console.error('Failed to fetch sales data:', error);
      setError(error instanceof Error ? error.message : 'Failed to load sales data');
      setSalesData({
        total_orders: 0,
        total_sales: 0,
        pending_orders: 0,
        completed_orders: 0,
        declined_orders: 0,
        daily_sales: [],
        service_breakdown: [],
        payment_breakdown: [],
        walk_in_orders: 0,
        walk_in_sales: 0,
        booking_orders: 0,
        booking_sales: 0,
        average_order_value: 0,
        completion_rate: 0
      });
    } finally {
      setLoading(false);
    }
  }, [dateRange, serviceType]);

  useEffect(() => {
    fetchSalesData();
  }, [fetchSalesData]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP'
    }).format(amount || 0);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  const exportToCSV = () => {
    if (!salesData) return;
    const rows: string[][] = [];
    rows.push(['Sales Report', dateRange]);
    rows.push(['Total Orders', salesData.total_orders.toString()]);
    rows.push(['Total Sales', salesData.total_sales.toString()]);
    rows.push(['Revenue Change', `${salesData.revenue_change?.toFixed(1) || 0}%`]);
    rows.push(['Orders Change', `${salesData.orders_change?.toFixed(1) || 0}%`]);
    rows.push([]);
    rows.push(['Service', 'Orders', 'Total']);
    salesData.service_breakdown?.forEach(s => rows.push([s.service, s.count.toString(), s.total.toString()]));
    rows.push([]);
    rows.push(['Payment Status', 'Orders', 'Total']);
    salesData.payment_breakdown?.forEach(p => rows.push([p.payment_status, p.count.toString(), p.total.toString()]));
    rows.push([]);
    rows.push(['Date', 'Orders', 'Total']);
    salesData.daily_sales?.forEach(d => rows.push([d.date, d.count.toString(), d.total.toString()]));

    const csvContent = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sales-report-${dateRange}-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const hasData = salesData?.total_orders > 0 || salesData?.total_sales > 0;



  const maxServiceTotal = useMemo(() => {
    return salesData?.service_breakdown?.length ? Math.max(...salesData.service_breakdown.map(s => s.total)) : 1;
  }, [salesData?.service_breakdown]);

  const maxPaymentTotal = useMemo(() => {
    return salesData?.payment_breakdown?.length ? Math.max(...salesData.payment_breakdown.map(p => p.total)) : 1;
  }, [salesData?.payment_breakdown]);

  const EmptyState = ({ message, icon }: { message: string; icon: React.ReactNode }) => (
    <div className="flex flex-col items-center justify-center py-16 text-zinc-400" role="status" aria-label={message}>
      <div className="w-20 h-20 bg-zinc-100 rounded-full flex items-center justify-center mb-4">
        {icon}
      </div>
      <p className="font-bold text-zinc-500 text-lg">{message}</p>
      <p className="text-sm text-zinc-400 mt-1">Data will appear here once orders are placed</p>
    </div>
  );

  if (loading && !salesData) {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-label="Loading sales data">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  const completedOrders = salesData?.completed_orders || 0;
  const declinedOrders = salesData?.declined_orders || 0;
  const totalOrders = salesData?.total_orders || 0;
  const aov = salesData?.average_order_value || 0;
  const completionRate = salesData?.completion_rate || 0;
  const walkInOrders = salesData?.walk_in_orders || 0;
  const walkInSales = salesData?.walk_in_sales || 0;
  const bookingOrders = salesData?.booking_orders || 0;
  const bookingSales = salesData?.booking_sales || 0;
  const revenueChange = salesData?.revenue_change || 0;
  const ordersChange = salesData?.orders_change || 0;
  const topCustomers = salesData?.top_customers || [];
  const peakHours = salesData?.peak_hours || [];
  const peakDays = salesData?.peak_days || [];

  return (
    <div className="space-y-6" role="region" aria-label="Sales reports">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <button
             onClick={() => setView('dashboard')}
             aria-label="Back to dashboard"
             className="text-xs font-black text-zinc-400 uppercase tracking-widest hover:text-blue-500 mb-2 flex items-center gap-1"
           >
             <ArrowLeft className="w-3 h-3" aria-hidden="true" /> Back to Dashboard
           </button>
          <h2 className="text-3xl font-extrabold text-zinc-900 tracking-tighter flex items-center gap-3">
            <BarChart3 className="w-8 h-8 text-blue-600" /> Sales Reports
          </h2>
          <p className="text-zinc-500 font-medium">Analytics and business insights</p>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          {/* Service Type Filter */}
          {serviceOptions.length > 0 && (
            <select
               value={serviceType}
               onChange={(e) => setServiceType(e.target.value)}
               aria-label="Filter by service type"
               className="px-3 py-2 bg-white border-2 border-zinc-200 rounded-xl text-xs font-bold text-zinc-700 focus:border-blue-500 outline-none"
             >
              <option value="">All Services</option>
              {serviceOptions.map((s, i) => (
                <option key={i} value={s}>{s}</option>
              ))}
            </select>
          )}
          <button
            onClick={exportToCSV}
            aria-label="Export sales report as CSV"
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-700 transition-all flex items-center gap-1"
          >
            <Download className="w-3 h-3" aria-hidden="true" /> Export CSV
          </button>
          {/* Date Range Selector */}
          <div className="flex gap-2">
            {(['today', 'week', 'month', 'all'] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setDateRange(range)}
                    aria-label={`View sales data for ${range}`}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1 ${
                      dateRange === range
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                    }`}
                  >
                    {range === 'today' && <Calendar className="w-3 h-3" aria-hidden="true" />}
                    {range === 'week' && <TrendingDown className="w-3 h-3" aria-hidden="true" />}
                    {range === 'month' && <TrendingUp className="w-3 h-3" aria-hidden="true" />}
                    {range === 'all' && <BarChart3 className="w-3 h-3" aria-hidden="true" />}
                    {range}
                  </button>
                ))}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 bg-zinc-100 p-1 rounded-2xl">
        {[
          { key: 'overview', label: 'Overview', icon: Activity },
          { key: 'daily', label: 'Daily Sales', icon: Calendar },
          { key: 'services', label: 'Services', icon: Package },
          { key: 'payments', label: 'Payments', icon: Wallet },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            aria-label={`View ${tab.label} tab`}
            aria-current={activeTab === tab.key ? 'page' : undefined}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              activeTab === tab.key
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            <tab.icon className="w-4 h-4" aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <>
          {/* Revenue Trend Chart */}
          <div className="bg-white p-6 sm:p-8 rounded-[32px] border-4 border-zinc-50 shadow-lg">
            <h3 className="text-lg font-extrabold text-zinc-900 mb-6 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" /> Revenue Trend
            </h3>
            {loading ? (
              <div className="flex items-center justify-center h-[300px]">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : error ? (
              <EmptyState message={error} icon={<DollarSign className="w-10 h-10" />} />
            ) : hasData && salesData?.daily_sales?.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={salesData.daily_sales.map(d => ({ ...d, total: Number(d.total) || 0 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" tickFormatter={(v) => `₱${v}`} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [formatCurrency(value), 'Revenue']}
                  />
                  <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={3} dot={{ fill: '#3b82f6', r: 5 }} activeDot={{ r: 7 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No revenue data yet" icon={<DollarSign className="w-10 h-10" />} />
            )}
          </div>

          {/* Enhanced Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-5 mt-6">
            <div className="bg-white p-4 sm:p-5 rounded-[24px] border-2 border-zinc-50 shadow-lg hover:shadow-xl transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="w-11 h-11 bg-emerald-100 rounded-xl flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                </div>
                <span className="text-[10px] font-black text-zinc-400">—</span>
              </div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Revenue</p>
              <p className="text-xl sm:text-2xl font-black text-zinc-900">{formatCurrency(salesData?.total_sales || 0)}</p>
              <p className="text-[10px] text-zinc-400 mt-1">Completed orders only</p>
              {revenueChange !== 0 && (
                <div className={`flex items-center gap-1 mt-1 text-xs font-bold ${revenueChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {revenueChange >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {formatPercent(Math.abs(revenueChange))} vs prev
                </div>
              )}
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-[24px] border-2 border-zinc-50 shadow-lg hover:shadow-xl transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="w-11 h-11 bg-blue-100 rounded-xl flex items-center justify-center">
                  <ShoppingBag className="w-5 h-5 text-blue-600" />
                </div>
                <span className="text-[10px] font-black text-zinc-400">{totalOrders}</span>
              </div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Orders</p>
              <p className="text-xl sm:text-2xl font-black text-zinc-900">{totalOrders}</p>
              {ordersChange !== 0 && (
                <div className={`flex items-center gap-1 mt-1 text-xs font-bold ${ordersChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {ordersChange >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {formatPercent(Math.abs(ordersChange))} vs prev
                </div>
              )}
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-[24px] border-2 border-zinc-50 shadow-lg hover:shadow-xl transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="w-11 h-11 bg-amber-100 rounded-xl flex items-center justify-center">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
                <span className="text-[10px] font-black text-zinc-400">{salesData?.pending_orders || 0}</span>
              </div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Pending</p>
              <p className="text-xl sm:text-2xl font-black text-zinc-900">{salesData?.pending_orders || 0}</p>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-[24px] border-2 border-zinc-50 shadow-lg hover:shadow-xl transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="w-11 h-11 bg-purple-100 rounded-xl flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-purple-600" />
                </div>
                <span className="text-[10px] font-black text-zinc-400">{completedOrders}</span>
              </div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Completed</p>
              <p className="text-xl sm:text-2xl font-black text-zinc-900">{completedOrders}</p>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-[24px] border-2 border-zinc-50 shadow-lg hover:shadow-xl transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="w-11 h-11 bg-rose-100 rounded-xl flex items-center justify-center">
                  <XCircle className="w-5 h-5 text-rose-600" />
                </div>
                <span className="text-[10px] font-black text-zinc-400">{declinedOrders}</span>
              </div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Declined</p>
              <p className="text-xl sm:text-2xl font-black text-zinc-900">{declinedOrders}</p>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-[24px] border-2 border-zinc-50 shadow-lg hover:shadow-xl transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="w-11 h-11 bg-cyan-100 rounded-xl flex items-center justify-center">
                  <Target className="w-5 h-5 text-cyan-600" />
                </div>
                <span className="text-[10px] font-black text-zinc-400">{formatCurrency(aov)}</span>
              </div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Avg Order</p>
              <p className="text-xl sm:text-2xl font-black text-zinc-900">{formatCurrency(aov)}</p>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-[24px] border-2 border-zinc-50 shadow-lg hover:shadow-xl transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="w-11 h-11 bg-rose-100 rounded-xl flex items-center justify-center">
                  <Percent className="w-5 h-5 text-rose-600" />
                </div>
                <span className="text-[10px] font-black text-zinc-400">{formatPercent(completionRate)}</span>
              </div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Completion</p>
              <p className="text-xl sm:text-2xl font-black text-zinc-900">{formatPercent(completionRate)}</p>
            </div>
          </div>

          {/* Walk-in vs Booking Comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mt-8">
            <div className="bg-white p-6 sm:p-8 rounded-[32px] border-4 border-zinc-50 shadow-lg">
              <h3 className="text-lg font-extrabold text-zinc-900 mb-6 flex items-center gap-2">
                <Store className="w-5 h-5 text-amber-600" /> Walk-In vs Booking
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-amber-50 rounded-2xl border border-amber-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                      <Store className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-zinc-400 uppercase">Walk-In Orders</p>
                      <p className="text-lg font-black text-zinc-900">{walkInOrders}</p>
                    </div>
                  </div>
                  <p className="text-lg font-black text-amber-600">{formatCurrency(walkInSales)}</p>
                </div>
                <div className="flex items-center justify-between p-4 bg-blue-50 rounded-2xl border border-blue-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                      <Truck className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-zinc-400 uppercase">Booking Orders</p>
                      <p className="text-lg font-black text-zinc-900">{bookingOrders}</p>
                    </div>
                  </div>
                  <p className="text-lg font-black text-blue-600">{formatCurrency(bookingSales)}</p>
                </div>
                <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-zinc-200 rounded-xl flex items-center justify-center">
                      <ShoppingCart className="w-5 h-5 text-zinc-600" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-zinc-400 uppercase">Total Orders</p>
                      <p className="text-lg font-black text-zinc-900">{totalOrders}</p>
                    </div>
                  </div>
                  <p className="text-lg font-black text-zinc-900">{formatCurrency(salesData?.total_sales || 0)}</p>
                </div>
              </div>
            </div>

            {/* Top Customers */}
            <div className="bg-white p-6 sm:p-8 rounded-[32px] border-4 border-zinc-50 shadow-lg">
              <h3 className="text-lg font-extrabold text-zinc-900 mb-6 flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-600" /> Top Customers
              </h3>
              {topCustomers.length > 0 ? (
                <div className="space-y-3">
                  {topCustomers.map((customer, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl border border-zinc-100">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                          <span className="text-xs font-black text-purple-600">#{index + 1}</span>
                        </div>
                        <div>
                          <p className="font-bold text-zinc-900 text-sm">{customer.customer_name}</p>
                          <p className="text-[10px] text-zinc-400">{customer.customer_phone}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-black text-zinc-900 text-sm">{customer.order_count} orders</p>
                        <p className="text-[10px] text-zinc-400">{formatCurrency(customer.total_spent)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No customer data yet" icon={<Users className="w-10 h-10" />} />
              )}
            </div>
          </div>

          {/* Peak Hours/Days Chart */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mt-8">
            <div className="bg-white p-6 sm:p-8 rounded-[32px] border-4 border-zinc-50 shadow-lg">
              <h3 className="text-lg font-extrabold text-zinc-900 mb-6 flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-600" /> Peak Hours
              </h3>
              {peakHours.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={peakHours}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} stroke="#94a3b8" label={{ value: 'Hour', position: 'insideBottom', offset: -5, fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none' }} />
                    <Bar dataKey="count" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState message="No peak hour data" icon={<Clock className="w-10 h-10" />} />
              )}
            </div>

            <div className="bg-white p-6 sm:p-8 rounded-[32px] border-4 border-zinc-50 shadow-lg">
              <h3 className="text-lg font-extrabold text-zinc-900 mb-6 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" /> Peak Days
              </h3>
              {peakDays.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={peakDays}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none' }} />
                    <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState message="No peak day data" icon={<Calendar className="w-10 h-10" />} />
              )}
            </div>
          </div>

          {/* Service Breakdown */}
          <div className="mt-8 bg-white p-6 sm:p-8 rounded-[32px] border-4 border-zinc-50 shadow-lg">
            <h3 className="text-lg font-extrabold text-zinc-900 mb-6 flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-600" /> Service Breakdown
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {salesData?.service_breakdown?.map((service, index) => {
                const maxTotal = Math.max(...(salesData?.service_breakdown?.map(s => s.total) || [1]));
                const percentage = maxTotal > 0 ? (service.total / maxTotal) * 100 : 0;
                const colors = [
                  'from-blue-500 to-blue-400',
                  'from-emerald-500 to-emerald-400',
                  'from-amber-500 to-amber-400',
                  'from-purple-500 to-purple-400',
                  'from-rose-500 to-rose-400',
                  'from-cyan-500 to-cyan-400'
                ];
                const colorClass = colors[index % colors.length];

                return (
                  <div key={index} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100 hover:border-zinc-200 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${colorClass}`} />
                      <div>
                        <p className="font-bold text-zinc-900">{service.service}</p>
                        <p className="text-[10px] text-zinc-400">{service.count} orders</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-zinc-900">{formatCurrency(service.total)}</p>
                      <p className="text-[10px] text-zinc-400">{formatPercent(percentage)} share</p>
                    </div>
                  </div>
                );
              })}
              {!salesData?.service_breakdown?.length && (
                <p className="text-zinc-400 text-center py-8 col-span-2">No service data available</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Daily Sales Tab */}
      {activeTab === 'daily' && (
        <div className="bg-white p-6 sm:p-8 rounded-[32px] border-4 border-zinc-50 shadow-lg">
          <h3 className="text-lg font-extrabold text-zinc-900 mb-6 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-green-600" /> Daily Sales Overview
          </h3>
          {hasData && salesData?.daily_sales_all?.length ? (
            <div className="space-y-4">
              {salesData.daily_sales_all.map((day, index) => {
                const walkInPct = day.total > 0 ? (day.walk_in_count / day.count) * 100 : 0;
                const bookingPct = day.total > 0 ? (day.booking_count / day.count) * 100 : 0;

                return (
                  <div key={index} className="flex items-center gap-4 p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <span className="text-xs font-black text-zinc-500 w-20">{day.date}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-6 bg-zinc-200 rounded-full overflow-hidden relative">
                          <div
                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-500"
                            style={{ width: `${walkInPct}%` }}
                          />
                          <div
                            className="absolute inset-y-0 right-0 bg-gradient-to-r from-blue-400 to-blue-500 rounded-full transition-all duration-500"
                            style={{ width: `${bookingPct}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-[10px] text-zinc-400">
                        <span className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-amber-500 rounded-full" /> Walk-In: {day.walk_in_count}
                        </span>
                        <span className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-blue-500 rounded-full" /> Booking: {day.booking_count}
                        </span>
                      </div>
                    </div>
                    <div className="text-right min-w-[100px]">
                      <p className="font-black text-zinc-900">{formatCurrency(day.total)}</p>
                      <p className="text-[10px] text-zinc-400">{day.count} orders</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState message="No daily sales data yet" icon={<Calendar className="w-10 h-10" />} />
          )}
        </div>
      )}

      {/* Services Tab */}
      {activeTab === 'services' && (
        <div className="bg-white p-6 sm:p-8 rounded-[32px] border-4 border-zinc-50 shadow-lg">
          <h3 className="text-lg font-extrabold text-zinc-900 mb-6 flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" /> Service Performance
          </h3>
          {hasData && salesData?.service_breakdown?.length ? (
            <div className="space-y-3">
              {salesData.service_breakdown.map((service, index) => {
                const percentage = maxServiceTotal > 0 ? (service.total / maxServiceTotal) * 100 : 0;
                const colors = [
                  'from-blue-500 to-blue-400',
                  'from-emerald-500 to-emerald-400',
                  'from-amber-500 to-amber-400',
                  'from-purple-500 to-purple-400',
                  'from-rose-500 to-rose-400',
                  'from-cyan-500 to-cyan-400'
                ];
                const colorClass = colors[index % colors.length];

                return (
                  <div key={index} className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 hover:border-zinc-200 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full bg-gradient-to-r ${colorClass}`} />
                        <span className="font-bold text-zinc-900">{service.service}</span>
                      </div>
                      <span className="text-sm font-black text-zinc-500">{formatPercent(percentage)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-zinc-500">{service.count} orders</span>
                        <span className="text-xs text-zinc-400">{formatCurrency(service.total)}</span>
                      </div>
                      <div className="w-32 h-2 bg-zinc-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full bg-gradient-to-r ${colorClass} rounded-full transition-all duration-500`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState message="No service data available" icon={<Package className="w-10 h-10" />} />
          )}
        </div>
      )}

      {/* Payments Tab */}
      {activeTab === 'payments' && (
        <div className="bg-white p-6 sm:p-8 rounded-[32px] border-4 border-zinc-50 shadow-lg">
          <h3 className="text-lg font-extrabold text-zinc-900 mb-6 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-green-600" /> Payment Summary
          </h3>
          {salesData?.payment_breakdown?.length ? (
            <div className="space-y-4">
              {salesData.payment_breakdown.map((payment, index) => {
                const barHeight = maxPaymentTotal > 0 ? (payment.total / maxPaymentTotal) * 100 : 0;
                const colors = [
                  'bg-emerald-500',
                  'bg-blue-500',
                  'bg-amber-500',
                  'bg-purple-500',
                  'bg-rose-500'
                ];
                const colorClass = colors[index % colors.length];
                const label = payment.payment_status === 'paid' ? 'Paid' : 'Unpaid';

                return (
                  <div key={index} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-zinc-700 capitalize">{label}</span>
                      <span className="text-sm">
                        <span className="font-black text-zinc-900">{payment.count}</span>
                        <span className="text-zinc-400 ml-1">transactions</span>
                        <span className="text-zinc-500 ml-2">{formatCurrency(payment.total)}</span>
                      </span>
                    </div>
                    <div className="h-10 bg-zinc-100 rounded-xl overflow-hidden">
                      <div
                        className={`h-full ${colorClass} rounded-xl transition-all duration-700 flex items-center justify-end pr-3`}
                        style={{ width: `${barHeight}%`, minWidth: barHeight > 0 ? '50px' : '0' }}
                      >
                        <span className="text-white text-sm font-black">{formatCurrency(payment.total)} ({formatPercent(barHeight)})</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState message="No payment data available" icon={<Wallet className="w-10 h-10" />} />
          )}
        </div>
      )}
    </div>
  );
};

export default SalesReports;
