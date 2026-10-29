import type { Transaction, Machine, Stats, SalesData, Customer, Review, ReviewReply, Pricing, PriceHistory, PaginationMeta } from '../types';

export const API_BASE = '/api';

// For cookie-based auth, we don't need to manually add Authorization header
// The httpOnly cookie is sent automatically with credentials: 'include'
export const getAuthHeaders = (): HeadersInit => {
  return { 'Content-Type': 'application/json' };
};

export const getAuthFetchOptions = (): RequestInit => {
  return {
    credentials: 'include' as RequestCredentials,
    headers: getAuthHeaders(),
  };
};

export const parseResponseJson = async (res: Response): Promise<any> => res.json();

// Helper to extract data from API response
// Handles both { success: true, data: T } and { data: T } formats
const extractData = async <T>(res: Response): Promise<T> => {
  const body = await res.text();
  if (!body) {
    throw new Error(`Server returned an empty response (HTTP ${res.status})`);
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`Server returned an invalid response (HTTP ${res.status})`);
  }

  if (!res.ok) {
    const serverMessage = typeof json === 'object' && json !== null && 'error' in json && typeof json.error === 'string'
      ? json.error
      : 'Request failed';
    throw new Error(`${serverMessage} (HTTP ${res.status})`);
  }
  // Backend returns { success: true, data: T, meta: ..., timestamp: ... }
  // Some endpoints may return { data: T } directly
  // Extract the data property, handling both formats
  if (typeof json === 'object' && json !== null && 'data' in json && json.data !== undefined) {
    return json.data as T;
  }
  // Fallback: if response is the data directly (no wrapper)
  return json as T;
};

// Helper to extract data AND pagination metadata from an API response
const extractDataWithMeta = async <T>(res: Response): Promise<{ data: T; meta: PaginationMeta | null }> => {
  const body = await res.text();
  if (!body) {
    throw new Error(`Server returned an empty response (HTTP ${res.status})`);
  }

  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`Server returned an invalid response (HTTP ${res.status})`);
  }

  if (!res.ok) {
    const serverMessage = typeof json === 'object' && json !== null && 'error' in json && typeof json.error === 'string'
      ? json.error
      : 'Request failed';
    throw new Error(`${serverMessage} (HTTP ${res.status})`);
  }

  const data = (typeof json === 'object' && json !== null && 'data' in json && json.data !== undefined)
    ? json.data
    : json;
  const meta = (typeof json === 'object' && json !== null && 'meta' in json && json.meta)
    ? json.meta as PaginationMeta
    : null;

  return { data: data as T, meta };
};

export const getPublicReviews = async (): Promise<Review[]> => {
  const res = await fetch(`${API_BASE}/reviews/public`);
  return extractData<Review[]>(res);
};

export const getMachines = async (): Promise<Machine[]> => {
  const res = await fetch(`${API_BASE}/machines`);
  return extractData<Machine[]>(res);
};

export const trackTransaction = async (referenceNumber: string): Promise<Transaction> => {
  const res = await fetch(`${API_BASE}/transactions/track/${encodeURIComponent(referenceNumber)}`);
  return extractData<Transaction>(res);
};

export const createReview = async (transactionId: number, rating: number, comment?: string, photos?: File[]): Promise<{ photos?: string[] }> => {
  const formData = new FormData();
  formData.append('transaction_id', String(transactionId));
  formData.append('rating', String(rating));
  if (comment) formData.append('comment', comment);
  (photos || []).forEach((file) => formData.append('photos', file));

  const res = await fetch(`${API_BASE}/reviews`, {
    method: 'POST',
    body: formData,
    // Do NOT set Content-Type; browser sets multipart boundary
  });
  if (!res.ok) {
    let message = 'Failed to create review';
    try {
      const json = await res.json();
      message = json.error || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const json = await res.json();
  return json.data || {};
};

export const createTransaction = async (data: Omit<Transaction, 'id' | 'created_at'>): Promise<Transaction> => {
  const res = await fetch(`${API_BASE}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return extractData<Transaction>(res);
};

export const createWalkInOrder = async (data: any): Promise<Transaction> => {
  const res = await fetch(`${API_BASE}/admin/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || 'Failed to create walk-in order');
  }
  return extractData<Transaction>(res);
};

export const adminLogin = async (username: string, password: string): Promise<{ token: string; user: { id: number; username: string; role: string; last_login: string | null } }> => {
  const res = await fetch(`${API_BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  return extractData<{ token: string; user: { id: number; username: string; role: string; last_login: string | null } }>(res);
};

export const verifyAdminToken = async (): Promise<{ valid: boolean }> => {
   try {
     const res = await fetch(`${API_BASE}/admin/verify`, {
       ...getAuthFetchOptions(),
     });
     if (!res.ok) return { valid: false };
     const json = await res.json();
     return { valid: json.success !== false && json.data?.authenticated === true };
   } catch {
     return { valid: false };
   }
 };

export const getTransactions = async (): Promise<Transaction[]> => {
  const res = await fetch(`${API_BASE}/transactions?limit=100`, {
    ...getAuthFetchOptions(),
  });
  return extractData<Transaction[]>(res);
};

/**
 * Paginated transactions fetch. The server caps `limit` at 100 per page, so the
 * admin MUST page through the results - otherwise older orders are silently
 * missing from the Orders table.
 */
export const getTransactionsPage = async (
  params: { page?: number; limit?: number; search?: string } = {}
): Promise<{ transactions: Transaction[]; meta: PaginationMeta | null }> => {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (params.search && params.search.trim()) {
    query.set('search', params.search.trim());
  }
  const res = await fetch(`${API_BASE}/transactions?${query.toString()}`, {
    ...getAuthFetchOptions(),
  });
  const { data, meta } = await extractDataWithMeta<Transaction[]>(res);
  return { transactions: data, meta };
};

export const getStats = async (): Promise<Stats> => {
  const res = await fetch(`${API_BASE}/stats`, {
    ...getAuthFetchOptions(),
  });
  return extractData<Stats>(res);
};

export const getSalesData = async (range: string, serviceType?: string): Promise<SalesData> => {
  // limit controls how many daily rows the "Daily Sales" tab receives.
  // Request the server maximum so long ranges are not silently truncated.
  const params = new URLSearchParams({ range, limit: '100' });
  if (serviceType) params.set('service_type', serviceType);
  const res = await fetch(`${API_BASE}/sales?${params.toString()}`, {
    ...getAuthFetchOptions(),
  });
  return extractData<SalesData>(res);
};

export const getWalkInOrders = async (): Promise<Transaction[]> => {
  const res = await fetch(`${API_BASE}/transactions?delivery_method=pickup&limit=100`, {
    ...getAuthFetchOptions(),
  });
  return extractData<Transaction[]>(res);
};

export const getCustomers = async (params?: { page?: number; limit?: number }): Promise<Customer[]> => {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 100; // Backend max limit is 100
  const queryParams = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  const res = await fetch(`${API_BASE}/customers?${queryParams}`, {
    ...getAuthFetchOptions(),
  });
  return extractData<Customer[]>(res);
};

/**
 * Paginated customers fetch. The server caps `limit` at 100 per page, so the
 * admin MUST page through the results to see every customer.
 */
export const getCustomersPage = async (
  params: { page?: number; limit?: number; search?: string } = {}
): Promise<{ customers: Customer[]; meta: PaginationMeta | null }> => {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (params.search && params.search.trim()) {
    queryParams.set('search', params.search.trim());
  }
  const res = await fetch(`${API_BASE}/customers?${queryParams.toString()}`, {
    ...getAuthFetchOptions(),
  });
  const { data, meta } = await extractDataWithMeta<Customer[]>(res);
  return { customers: data, meta };
};

export const deleteCustomer = async (phone: string): Promise<void> => {
  const res = await fetch(`${API_BASE}/customers/${encodeURIComponent(phone)}`, {
    method: 'DELETE',
    ...getAuthFetchOptions(),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || 'Failed to delete customer');
  }
};

export const updateTransaction = async (id: number, status: string): Promise<Transaction> => {
  const res = await fetch(`${API_BASE}/transactions/${id}`, {
    method: 'PATCH',
    ...getAuthFetchOptions(),
    body: JSON.stringify({ status }),
  });
  return extractData<Transaction>(res);
};

export const updateMachine = async (id: number, status: string, remainingTime?: number): Promise<Machine> => {
  const body: Record<string, unknown> = { status };
  if (remainingTime !== undefined) body.remaining_time = remainingTime;
  
  const res = await fetch(`${API_BASE}/machines/${id}`, {
    method: 'PATCH',
    ...getAuthFetchOptions(),
    body: JSON.stringify(body),
  });
  return extractData<Machine>(res);
};

export const resetMachines = async (): Promise<void> => {
  const res = await fetch(`${API_BASE}/machines/reset`, {
    method: 'POST',
    ...getAuthFetchOptions(),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || 'Failed to reset machines');
  }
};

export const deleteTransaction = async (id: number): Promise<void> => {
  const res = await fetch(`${API_BASE}/transactions/${id}`, {
    method: 'DELETE',
    ...getAuthFetchOptions(),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || 'Failed to delete transaction');
  }
};

export const getReviews = async (): Promise<Review[]> => {
  const res = await fetch(`${API_BASE}/reviews`, {
    ...getAuthFetchOptions(),
  });
  return extractData<Review[]>(res);
};

// --- Review replies ---

export const getReviewReplies = async (reviewId: number): Promise<ReviewReply[]> => {
  const res = await fetch(`${API_BASE}/reviews/${reviewId}/replies`, {
    ...getAuthFetchOptions(),
  });
  return extractData<ReviewReply[]>(res);
};

export const createReviewReply = async (reviewId: number, message: string): Promise<ReviewReply> => {
  const res = await fetch(`${API_BASE}/reviews/${reviewId}/replies`, {
    method: 'POST',
    ...getAuthFetchOptions(),
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || 'Failed to create reply');
  }
  return extractData<ReviewReply>(res);
};

export const updateReviewReply = async (replyId: number, message: string): Promise<ReviewReply> => {
  const res = await fetch(`${API_BASE}/replies/${replyId}`, {
    method: 'PATCH',
    ...getAuthFetchOptions(),
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || 'Failed to update reply');
  }
  return extractData<ReviewReply>(res);
};

export const deleteReviewReply = async (replyId: number): Promise<void> => {
  const res = await fetch(`${API_BASE}/replies/${replyId}`, {
    method: 'DELETE',
    ...getAuthFetchOptions(),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || 'Failed to delete reply');
  }
};

export const getPricing = async (): Promise<Pricing[]> => {
  const res = await fetch(`${API_BASE}/pricing`, {
    ...getAuthFetchOptions(),
  });
  return extractData<Pricing[]>(res);
};

export const getPublicPricing = async (): Promise<Pricing[]> => {
  const res = await fetch(`${API_BASE}/pricing/public`);
  return extractData<Pricing[]>(res);
};

export const getPriceHistory = async (): Promise<PriceHistory[]> => {
  const res = await fetch(`${API_BASE}/pricing/history`, {
    ...getAuthFetchOptions(),
  });
  return extractData<PriceHistory[]>(res);
};

export const deletePriceHistory = async (): Promise<void> => {
  const res = await fetch(`${API_BASE}/pricing/history`, {
    method: 'DELETE',
    ...getAuthFetchOptions(),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || 'Failed to delete price history');
  }
};

export const updatePricing = async (serviceType: string, data: Partial<Pricing>): Promise<void> => {
  const res = await fetch(`${API_BASE}/pricing/${encodeURIComponent(serviceType)}`, {
    method: 'PATCH',
    ...getAuthFetchOptions(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || 'Failed to update pricing');
  }
};