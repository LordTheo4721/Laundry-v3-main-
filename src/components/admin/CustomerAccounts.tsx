import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users,
  Search,
  Phone,
  MapPin,
  Trash2,
  RefreshCw,
  ChevronRight
} from 'lucide-react';
import { getCustomersPage, deleteCustomer } from '../../utils/api';
import type { Customer, PaginationMeta } from '../../types';

interface CustomerAccountsProps {
  setView: (v: string) => void;
}

const CUSTOMERS_PER_PAGE = 10;

const CustomerAccounts: React.FC<CustomerAccountsProps> = ({ setView }) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState(false);

  const fetchCustomers = useCallback(async (targetPage: number, search: string) => {
    try {
      setLoading(true);
      const { customers: data, meta: pageMeta } = await getCustomersPage({
        page: targetPage,
        limit: CUSTOMERS_PER_PAGE,
        search,
      });
      setCustomers(data);
      setMeta(pageMeta);
    } catch (error) {
      console.error('Failed to fetch customers:', error);
      // Set empty array on error so UI shows "no customers"
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce the search so typing does not fire a request per keystroke.
  // A ref guards the initial mount so we don't double-fetch on first render.
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      fetchCustomers(1, '');
      return;
    }
    const timer = setTimeout(() => {
      const next = searchTerm.trim();
      setDebouncedSearch(next);
      setPage(1);
      fetchCustomers(1, next);
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const handleDelete = (phone: string) => {
    const customer = customers.find(c => c.customer_phone === phone);
    if (customer) setCustomerToDelete(customer);
  };

  const confirmDeleteCustomer = async () => {
    if (!customerToDelete) return;
    const phone = customerToDelete.customer_phone;
    setDeletingCustomer(true);
    try {
      await deleteCustomer(phone);
      setCustomerToDelete(null);
      fetchCustomers(page, debouncedSearch);
    } catch (error) {
      console.error('Failed to delete customer:', error);
      alert('Failed to delete customer');
    } finally {
      setDeletingCustomer(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP'
    }).format(amount || 0);
  };

  const totalPages = meta?.totalPages ?? 1;
  const showPagination = (meta?.total ?? 0) > 0;

  return (
    <div className="space-y-8 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <button 
             onClick={() => setView('dashboard')}
             className="text-xs font-black text-zinc-400 uppercase tracking-widest hover:text-blue-500 mb-2"
           >
             ← Back to Dashboard
           </button>
          <h2 className="text-3xl font-extrabold text-zinc-900 tracking-tighter">Customer Accounts</h2>
          <p className="text-zinc-500 font-medium">Manage customer information and order history</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 w-5 h-5" aria-hidden="true" />
        <input 
          type="text"
          placeholder="Search customers by name or phone..."
          className="pl-14 pr-6 py-5 bg-white border-4 border-zinc-100 rounded-2xl outline-none focus:border-blue-500 transition-all font-bold text-sm w-full"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          aria-label="Search customers by name or phone"
        />
      </div>

      {/* Customer List */}
      <div className="bg-white rounded-[40px] border-8 border-zinc-50 shadow-xl overflow-hidden" role="region" aria-label="Customer accounts list">
        {loading ? (
          <div className="flex items-center justify-center h-64 sm:h-96">
            <RefreshCw className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500 animate-spin" aria-hidden="true" />
          </div>
        ) : customers.length === 0 ? (
          <div className="text-center py-20">
            <Users className="w-16 h-16 text-zinc-200 mx-auto mb-4" />
            <p className="text-zinc-400 font-bold">No customers found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left" role="table" aria-label="Customer accounts data table">
                <thead>
                  <tr className="bg-zinc-50/50 text-zinc-400 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-black">
                    <th className="px-3 sm:px-8 py-3 sm:py-6">Customer</th>
                    <th className="px-3 sm:px-8 py-3 sm:py-6">Contact</th>
                    <th className="px-3 sm:px-8 py-3 sm:py-6 hidden sm:table-cell">Orders</th>
                    <th className="px-3 sm:px-8 py-3 sm:py-6 hidden md:table-cell">Total Spent</th>
                    <th className="px-3 sm:px-8 py-3 sm:py-6 hidden lg:table-cell">Joined</th>
                    <th className="px-3 sm:px-8 py-3 sm:py-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {customers.map((customer) => (
                    <tr key={customer.customer_phone} className="hover:bg-zinc-50/30 transition-colors">
                      <td className="px-3 sm:px-8 py-3 sm:py-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 sm:w-10 h-8 sm:h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                            <span className="font-black text-blue-600 text-sm sm:text-base">
                              {customer.customer_name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <span className="font-black text-zinc-900 text-sm sm:text-base truncate max-w-[80px] sm:max-w-none">{customer.customer_name}</span>
                        </div>
                      </td>
                      <td className="px-3 sm:px-8 py-3 sm:py-6">
                        <div className="flex flex-col gap-1">
                          <span className="text-zinc-500 font-medium text-xs sm:text-sm flex items-center gap-1 sm:gap-2">
                            <Phone className="w-3 h-3" /> {customer.customer_phone}
                          </span>
                          {customer.address && (
                            <span className="text-zinc-400 text-xs flex items-center gap-1 sm:gap-2 max-w-[100px] sm:max-w-[150px] truncate">
                              <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{customer.address}</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 sm:px-8 py-3 sm:py-6 hidden sm:table-cell">
                        <span className="font-black text-zinc-900">{customer.total_orders || 0}</span>
                      </td>
                      <td className="px-3 sm:px-8 py-3 sm:py-6 hidden md:table-cell">
                        <span className="font-black text-emerald-600 text-sm sm:text-base">{formatCurrency(customer.total_spent)}</span>
                      </td>
                      <td className="px-3 sm:px-8 py-3 sm:py-6 hidden lg:table-cell">
                        <span className="text-zinc-400 text-xs sm:text-sm">
                          {new Date(customer.created_at).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-3 sm:px-8 py-3 sm:py-6">
                        <div className="flex items-center justify-end gap-1 sm:gap-2">
                          <button
                            onClick={() => handleDelete(customer.customer_phone)}
                            className="inline-flex items-center justify-center flex-shrink-0 p-3 bg-red-600 border-2 border-red-700 text-white hover:bg-red-700 hover:border-red-800 rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 shadow-md hover:shadow-lg min-w-[44px] min-h-[44px]"
                            title="Delete customer"
                            aria-label="Delete customer"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination - without this the list would silently hide every
                customer beyond the first page of results. */}
            {showPagination && meta && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3 sm:px-8 py-4 border-t border-zinc-100">
                <p className="text-[10px] sm:text-xs font-bold text-zinc-400">
                  Showing {((meta.page - 1) * meta.limit) + 1}-{Math.min(meta.page * meta.limit, meta.total)} of {meta.total} customers
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const next = Math.max(1, page - 1);
                      setPage(next);
                      fetchCustomers(next, debouncedSearch);
                    }}
                    disabled={page <= 1}
                    aria-label="Previous page of customers"
                    className={`inline-flex items-center gap-1 px-3 sm:px-4 py-2 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${page <= 1 ? 'bg-zinc-100 text-zinc-400' : 'bg-zinc-50 text-zinc-900 hover:bg-zinc-100'}`}
                  >
                    <ChevronRight className="w-3 h-3 rotate-180" aria-hidden="true" /> PREV
                  </button>
                  <span className="text-[10px] sm:text-xs font-black text-zinc-600 whitespace-nowrap">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => {
                      const next = Math.min(totalPages, page + 1);
                      setPage(next);
                      fetchCustomers(next, debouncedSearch);
                    }}
                    disabled={page >= totalPages}
                    aria-label="Next page of customers"
                    className={`inline-flex items-center gap-1 px-3 sm:px-4 py-2 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${page >= totalPages ? 'bg-zinc-100 text-zinc-400' : 'bg-zinc-50 text-zinc-900 hover:bg-zinc-100'}`}
                  >
                    NEXT <ChevronRight className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {customerToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-xl font-black text-zinc-900 mb-2">Delete Account</h3>
            <p className="text-lg font-bold text-zinc-900 mb-4">Are you sure you want to delete this account?</p>
            <div className="space-y-2 mb-4 text-sm">
              <p><span className="font-bold">Customer Name:</span> {customerToDelete.customer_name}</p>
              <p><span className="font-bold">Phone Number:</span> {customerToDelete.customer_phone}</p>
              <p><span className="font-bold">Orders:</span> {customerToDelete.total_orders || 0}</p>
              <p><span className="font-bold">Total Spent:</span> {formatCurrency(customerToDelete.total_spent)}</p>
            </div>
            <p className="text-sm text-rose-600 font-bold mb-6">This action will hide the customer and their details and cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { if (!deletingCustomer) setCustomerToDelete(null); }}
                className="px-4 py-2 rounded-xl bg-zinc-100 text-zinc-900 font-bold hover:bg-zinc-200 disabled:opacity-50"
                disabled={deletingCustomer}
              >
                No
              </button>
              <button
                onClick={confirmDeleteCustomer}
                className="px-4 py-2 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-50"
                disabled={deletingCustomer}
              >
                {deletingCustomer ? 'Deleting...' : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerAccounts;
