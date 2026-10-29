import React from 'react';

type TransactionStatus = 'pending' | 'accepted' | 'washing' | 'drying' | 'ready' | 'completed' | 'declined';

interface Transaction {
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
  status: TransactionStatus;
  total_price: number;
  delivery_fee: number;
  payment_status: 'unpaid' | 'paid';
  created_at: string;
}

interface ReceiptProps {
  transaction: Transaction;
  type: 'booking' | 'tracking' | 'admin';
}

export const Receipt: React.FC<ReceiptProps> = ({ transaction, type }) => {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  };

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-500', accepted: 'bg-blue-500', washing: 'bg-indigo-500',
    drying: 'bg-sky-500', ready: 'bg-purple-500', completed: 'bg-emerald-500', declined: 'bg-rose-500',
  };

  const hasDelivery = transaction.delivery_method === 'delivery';
  const deliveryFee = hasDelivery ? (transaction.delivery_fee || 0) : 0;
  let deliveryFeeRow: React.ReactNode = null;
  if (transaction.delivery_method === 'delivery') {
    deliveryFeeRow = (
      <div className="flex justify-between items-center">
        <p className="text-[10px] text-zinc-500">Delivery Fee</p>
        <p className="text-xs font-bold">₱{deliveryFee.toFixed(2)}</p>
      </div>
    );
  }
  const items = transaction.items ?? [];
  // Prefer the persisted final total price (e.g. after admin completion) over
  // recomputing from item unit prices, so receipts reflect final entered values.
  const grandTotal = typeof transaction.total_price === 'number' ? transaction.total_price : (items.length > 0
    ? items.reduce((sum, item) => sum + (item.quantity * (item.unit_price || 0)), 0) + deliveryFee
    : deliveryFee);
  const subtotal = Math.max(0, grandTotal - deliveryFee);

  return (
    <div className="receipt-container bg-white p-3 max-w-[420px] mx-auto font-sans text-zinc-900" role="document" aria-label={`Receipt for order ${transaction.reference_number}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <img src="/happy-wash-mark-transparent.png" alt="HappyWash logo" className="w-8 h-8 rounded-lg object-contain" />
        <div>
          <h1 className="text-lg font-black tracking-tight leading-none">Happy<span className="text-blue-600">Wash</span></h1>
          <p className="text-[9px] text-zinc-400">San Fernando City, La Union · 09661305502</p>
        </div>
      </div>

      {/* Reference & Date row */}
      <div className="flex justify-between items-center bg-zinc-50 rounded-lg px-3 py-2 mb-2">
        <div>
          <p className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold">Reference</p>
          <p className="text-sm font-mono font-black text-blue-600">{transaction.reference_number}</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold">Date</p>
          <p className="text-xs font-bold">{formatDate(transaction.created_at)}</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold">Status</p>
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black text-white ${statusColors[transaction.status] || 'bg-zinc-500'}`}
            aria-label={`Order status: ${transaction.status}`}>
            {transaction.status}
          </span>
        </div>
      </div>

      {/* Customer & Order Details */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="col-span-2 bg-zinc-50 rounded-lg px-3 py-2">
          <p className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold mb-0.5">Customer</p>
          <p className="text-xs font-bold">{transaction.customer_name}</p>
          <p className="text-[10px] text-zinc-500">{transaction.customer_phone}</p>
          {transaction.customer_email && <p className="text-[10px] text-zinc-500">{transaction.customer_email}</p>}
          {transaction.address && <p className="text-[10px] text-zinc-500">{transaction.address}</p>}
        </div>
        <div className="bg-zinc-50 rounded-lg px-3 py-2">
          <p className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold mb-0.5">Service</p>
          {items.map((item, i) => (
            <div key={i}>
              <p className="text-xs font-bold">{item.service_type}</p>
              <p className="text-[10px] text-zinc-500">Qty: {item.quantity} · ₱{(item.unit_price || 0).toFixed(2)}</p>
              <p className="text-[10px] text-zinc-500">Subtotal: ₱{(item.quantity * (item.unit_price || 0)).toFixed(2)}</p>
            </div>
          ))}
           {items.length === 0 && (
             <div>
               <p className="text-xs font-bold">{transaction.service_type}</p>
               <p className="text-[10px] text-zinc-500">Qty: {transaction.quantity}{transaction.weight ? ` · ${transaction.weight} kg` : ''}</p>
               <p className="text-[10px] text-zinc-500">Final Laundry Price: ₱{subtotal.toFixed(2)}</p>
             </div>
           )}
           {items.length > 0 && (
             <div className="mt-1 space-y-0.5">
               {transaction.weight && (
                 <p className="text-[10px] text-zinc-500">Total Weight: {transaction.weight} kg</p>
               )}
               <p className="text-[10px] text-zinc-500">Final Laundry Price: ₱{subtotal.toFixed(2)}</p>
             </div>
           )}
        </div>
        <div className="bg-zinc-50 rounded-lg px-3 py-2">
          <p className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold mb-0.5">Schedule</p>
          <p className="text-xs font-bold">{transaction.appointment_date || 'N/A'}</p>
          <p className="text-[10px] text-zinc-500">{transaction.appointment_time || 'N/A'} · {hasDelivery ? 'Delivery' : 'Pickup'}</p>
        </div>
      </div>

      {/* Special Instructions */}
      {transaction.special_instructions && (
        <div className="bg-zinc-50 rounded-lg px-3 py-1.5 mb-2">
          <p className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold">Notes</p>
          <p className="text-[10px] italic text-zinc-600">"{transaction.special_instructions}"</p>
        </div>
      )}

      {/* Progress Tracker (tracking type only) */}
      {type === 'tracking' && (
        <div className="flex items-center gap-1 mb-2 bg-zinc-50 rounded-lg px-3 py-2" role="progressbar" aria-label="Order progress" aria-valuenow={['pending','accepted','washing','drying','ready','completed'].indexOf(transaction.status) + 1} aria-valuemin={1} aria-valuemax={6}>
          {['pending','accepted','washing','drying','ready','completed'].map((step, i) => {
            const steps = ['pending','accepted','washing','drying','ready','completed'];
            const isCompleted = steps.indexOf(transaction.status) >= i;
            const labels: Record<string, string> = { pending:'Received', accepted:'Accepted', washing:'Washing', drying:'Drying', ready:'Ready', completed:'Done' };
            return (
              <React.Fragment key={step}>
                <div className="flex flex-col items-center gap-0.5">
                  <div className={`w-4 h-4 rounded-full ${isCompleted ? 'bg-blue-500' : 'bg-zinc-200'}`}
                    aria-label={isCompleted ? `${labels[step]} completed` : `${labels[step]} pending`} />
                  <p className={`text-[8px] font-medium ${isCompleted ? 'text-zinc-900' : 'text-zinc-400'}`}>{labels[step]}</p>
                </div>
                {i < 5 && <div className={`flex-1 h-0.5 rounded ${isCompleted && steps.indexOf(transaction.status) > i ? 'bg-blue-500' : 'bg-zinc-200'}`} />}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Pricing Breakdown */}
      <div className="bg-zinc-50 rounded-lg px-3 py-2 mb-2 space-y-1">
        <div className="flex justify-between items-center">
          <p className="text-[10px] text-zinc-500">Order Subtotal</p>
          <p className="text-xs font-bold">₱{subtotal.toFixed(2)}</p>
        </div>
        {deliveryFeeRow}
        <div className="flex justify-between items-center border-t border-zinc-200 pt-1">
          <p className="text-sm font-bold text-zinc-900">Grand Total</p>
          <p className="text-lg font-black text-blue-600">₱{grandTotal.toFixed(2)}</p>
        </div>
      </div>

      {/* Payment Status */}
      <div className="flex justify-between items-center bg-zinc-900 text-white rounded-xl px-4 py-2">
        <div>
          <p className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold">Payment</p>
        </div>
        <div className="text-right">
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black ${transaction.payment_status === 'paid' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}`}
            aria-label={`Payment status: ${transaction.payment_status === 'paid' ? 'Paid' : 'Unpaid'}`}>
            {transaction.payment_status === 'paid' ? 'PAID' : 'UNPAID'}
          </span>
        </div>
      </div>

      <div className="text-center mt-2">
        <p className="text-[10px] font-bold text-emerald-600">Thank you for choosing HappyWash!</p>
        <p className="text-[8px] text-zinc-400">Keep this receipt for your reference.</p>
      </div>

      <style>{"@media print{@page{size:auto;margin:10mm}.receipt-container{width:100%!important;max-width:100%!important;padding:15px!important;box-shadow:none!important;border:none!important;background:#fff!important;color:#000!important;font-size:12px!important;line-height:1.4!important;page-break-inside:avoid!important;overflow:visible!important}}"}</style>
    </div>
  );
};

export const printReceipt = (receiptId: string, targetWindow?: Window | null) => {
  const receiptElement = document.getElementById(receiptId);
  if (receiptElement) {
    const wasHidden = receiptElement.style.display === 'none';
    const originalDisplay = receiptElement.style.display;
    receiptElement.style.display = 'block';
    void receiptElement.offsetHeight;
    const receiptHTML = receiptElement.innerHTML;
    if (wasHidden) receiptElement.style.display = originalDisplay;
    const printWindow = targetWindow === undefined
      ? window.open('', '_blank', 'width=400,height=600')
      : targetWindow;
    if (printWindow) {
      printWindow.document.write('<!DOCTYPE html><html><head><title>HappyWash Receipt</title><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src="https://cdn.tailwindcss.com"></script><style>@page{size:auto;margin:10mm}body{font-family:"Inter",sans-serif;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}*{ -webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}</style></head><body>' + receiptHTML + '<script>window.onload=function(){setTimeout(function(){window.print()},500)};</script></body></html>');
      printWindow.document.close();
    } else {
      receiptElement.style.display = 'block';
      setTimeout(() => { window.print(); receiptElement.style.display = 'none'; }, 500);
    }
  } else {
    console.error('Receipt element not found:', receiptId);
    if (targetWindow) {
      targetWindow.close();
      return;
    }
    window.print();
  }
};

export default Receipt; 
