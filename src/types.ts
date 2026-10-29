// Transaction status types
export type TransactionStatus = 'pending' | 'accepted' | 'washing' | 'drying' | 'ready' | 'completed' | 'declined';

// Review interface
export interface Review {
  id: number;
  transaction_id: number;
  rating: number;
  comment: string | null;
  photos?: string[];
  created_at: string;
  reference_number?: string;
  customer_name?: string;
  service_type?: string;
  total_price?: number;
  replies?: ReviewReply[];
}

// Review reply (admin reply to a customer review)
export interface ReviewReply {
  id: number;
  review_id: number;
  admin_id: number;
  message: string;
  created_at: string;
  updated_at: string;
  admin_name?: string;
  admin_username?: string;
}

// Queue types
export interface QueueEntry {
  id: number;
  transaction_id: number;
  position: number;
  estimated_wait_time: number;
  estimated_start_time: string;
  estimated_end_time: string;
  status: 'waiting' | 'in-progress' | 'completed' | 'cancelled';
  created_at: string;
}

export interface QueuePrediction {
  machine_id: number;
  machine_name: string;
  current_status: 'available' | 'in-use' | 'maintenance';
  available_at: string;
  current_job_ends_at: string | null;
  queue_length: number;
  estimated_wait: number;
  next_available_slot: string;
}

export interface OptimalBookingTime {
  date: string;
  time: string;
  wait_time_estimate: number;
  machine_availability: number;
  recommendation: 'optimal' | 'good' | 'fair' | 'busy';
}

export interface QueueStats {
  total_in_queue: number;
  average_wait_time: number;
  machines_available: number;
  machines_in_use: number;
  estimated_next_available: string;
}

// Transaction interface
export interface Transaction {
   id: number;
   reference_number: string;
   customer_name: string;
   customer_phone: string;
   customer_email?: string;
   service_type: string;
    quantity: number;
    items: Array<{ service_type: string; quantity: number; unit_price?: number }>;
    special_instructions: string | null;
    weight: number | null;
    appointment_date: string | null;
    appointment_time: string | null;
    delivery_method: 'pickup' | 'delivery';
    address: string | null;
    delivery_zone_id?: number | null;
    delivery_distance_km?: number | null;
    status: TransactionStatus;
   total_price: number;
   delivery_fee: number;
   payment_status: 'unpaid' | 'paid';
   machine_id: number | null;
   machine_name?: string;
   created_at: string;
   handwash_proof_image?: string;
    review?: { rating: number; comment: string | null; photos?: string[]; replies?: ReviewReply[] };
 }

// Machine interface
export interface Machine {
  id: number;
  name: string;
  type: 'washer' | 'dryer' | 'all-in-one';
  capacity: number;
  status: 'available' | 'in-use' | 'maintenance';
  remaining_time: number;
  drying_time: number;
}

// Pricing interfaces
export interface Pricing {
   id: number;
   service_type: string;
   pricing_type: 'tiered' | 'per_kg';
   base_price: number;
   tier_1_limit: number;
   tier_1_price: number;
   tier_2_limit: number;
   tier_2_price: number;
   tier_3_limit: number;
   tier_3_price: number;
   tier_4_limit: number;
   tier_4_price: number;
   tier_5_price_per_kg: number;
   per_kg_price: number;
   is_active: number;
   delivery_fee: number;
   updated_at: string;
 }

export interface PriceHistory {
  id: number;
  service_type: string;
  old_price_data: string | null;
  new_price_data: string | null;
  changed_by: string;
  created_at: string;
}

// Delivery configuration interfaces
export interface DeliveryOrigin {
  id: number;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  updated_at?: string;
}

export interface DeliveryZone {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  is_active: number;
  created_at?: string;
}

export interface DeliveryBand {
  id: number;
  min_km: number;
  max_km: number;
  fee: number;
  sort_order: number;
  created_at?: string;
}

export interface DeliveryConfig {
  origin: DeliveryOrigin;
  zones: DeliveryZone[];
  bands: DeliveryBand[];
}

// Stats interface
export interface Stats {
  total_orders: number;
  total_sales: number;
  pending_orders: number;
}

// Pagination metadata returned alongside list endpoints
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// View types
export type View = 'home' | 'booking' | 'machines' | 'admin' | 'receipt' | 'track' | 'admin-login';

// Sales data for reports
export interface SalesData {
  total_orders: number;
  total_sales: number;
  pending_orders: number;
  completed_orders: number;
  declined_orders: number;
  daily_sales: { date: string; total: number; count: number }[];
  service_breakdown: { service: string; count: number; total: number }[];
  payment_breakdown?: { payment_status: string; count: number; total: number }[];
  walk_in_orders?: number;
  walk_in_sales?: number;
  booking_orders?: number;
  booking_sales?: number;
  average_order_value?: number;
  completion_rate?: number;
  daily_sales_all?: { date: string; total: number; count: number; walk_in_count: number; booking_count: number }[];
  prev_total_sales?: number;
  prev_total_orders?: number;
  revenue_change?: number;
  orders_change?: number;
  peak_hours?: { hour: number; count: number }[];
  peak_days?: { day: string; count: number }[];
  top_customers?: { customer_name: string; customer_phone: string; order_count: number; total_spent: number }[];
}

// Customer data
export interface Customer {
  customer_name: string;
  customer_phone: string;
  address: string | null;
  created_at: string;
  total_orders: number;
  total_spent: number;
}

// Admin user roles
export type AdminRole = 'super_admin' | 'admin';

// Admin user interface
export interface AdminUser {
  id: number;
  username: string;
  password_hash: string;
  role: AdminRole;
  last_login: string | null;
  created_at: string;
  updated_at: string;
}

// Admin profile (without password hash)
export interface AdminProfile {
  id: number;
  username: string;
  role: AdminRole;
  last_login: string | null;
  created_at: string;
}

// Auth state interface
export interface AuthState {
  isAuthenticated: boolean;
  user: AdminProfile | null;
  token: string | null;
  expiresAt: number | null;
}

// Admin login request
export interface AdminLoginRequest {
  username: string;
  password: string;
}

// Admin login response
export interface AdminLoginResponse {
  token: string;
  expiresIn: string;
  user: AdminProfile;
}

// Change password request
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

// Update username request
export interface UpdateUsernameRequest {
  username: string;
  currentPassword: string;
}

// Audit log entry
export interface AuditLog {
  id: number;
  admin_id: number;
  action: 'login' | 'logout' | 'password_change' | 'username_change' | 'failed_login';
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

// Password strength result
export interface PasswordStrength {
  score: number; // 0-4
  feedback: string[];
  isValid: boolean;
}