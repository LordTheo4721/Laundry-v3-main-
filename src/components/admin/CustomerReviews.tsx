import React, { useState, useEffect, useCallback } from 'react';
import {
  Star,
  ChevronRight,
  RefreshCw,
  User,
  Trash2,
  Edit,
  Send,
  Clock,
  AlertCircle,
  CheckCircle2,
  MoreHorizontal,
  Search,
  Phone,
} from 'lucide-react';
import {
  getReviews,
  getReviewReplies,
  createReviewReply,
  updateReviewReply,
  deleteReviewReply,
} from '../../utils/api';
import type { Review, ReviewReply } from '../../types';
import { Toast } from './Toast';

interface CustomerReviewsProps {
  setView: (v: string) => void;
}

const CUSTOMER_REVIEWS_PER_PAGE = 10;

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString();
};

const formatTime = (dateString: string) => {
  return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const CustomerReviews: React.FC<CustomerReviewsProps> = ({ setView }) => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repliesMap, setRepliesMap] = useState<Record<number, ReviewReply[]>>({});
  const [repliesLoading, setRepliesLoading] = useState<Record<number, boolean>>({});
  const [replyText, setReplyText] = useState<Record<number, string>>({});
  const [replyError, setReplyError] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState<Record<number, boolean>>({});
  const [editing, setEditing] = useState<Record<number, { message: string; original: string }>>({});
  const [deleting, setDeleting] = useState<number | null>(null);
  const [toasts, setToasts] = useState<{ id: number; type: 'success' | 'error'; message: string }[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [openReplyReviewId, setOpenReplyReviewId] = useState<number | null>(null);

  const toastId = Date.now();

  const addToast = useCallback((type: 'success' | 'error', message: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const clearError = useCallback((reviewId: number) => {
    setReplyError((prev) => {
      const next = { ...prev };
      delete next[reviewId];
      return next;
    });
  }, []);

  const fetchReviews = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getReviews();
      setReviews(data);
      setCurrentPage(1);
    } catch (err) {
      console.error('Failed to fetch reviews:', err);
      setReviews([]);
      setError('Failed to load reviews. Please try again.');
      addToast('error', 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const fetchReplies = async (reviewId: number) => {
    setRepliesLoading((prev) => ({ ...prev, [reviewId]: true }));
    try {
      const data = await getReviewReplies(reviewId);
      setRepliesMap((prev) => ({ ...prev, [reviewId]: data }));
    } catch (error) {
      console.error('Failed to fetch replies:', error);
      setRepliesMap((prev) => ({ ...prev, [reviewId]: [] }));
    } finally {
      setRepliesLoading((prev) => ({ ...prev, [reviewId]: false }));
    }
  };

  const handleSendReply = async (reviewId: number) => {
    const text = (replyText[reviewId] || '').trim();
    if (!text) {
      setReplyError((prev) => ({ ...prev, [reviewId]: 'Reply cannot be empty' }));
      return;
    }
    clearError(reviewId);
    setSubmitting((prev) => ({ ...prev, [reviewId]: true }));
    try {
      const reply = await createReviewReply(reviewId, text);
      setRepliesMap((prev) => ({
        ...prev,
        [reviewId]: [...(prev[reviewId] || []), reply],
      }));
      setReplyText((prev) => ({ ...prev, [reviewId]: '' }));
      setOpenReplyReviewId(null);
      addToast('success', 'Reply sent');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to send reply');
    } finally {
      setSubmitting((prev) => ({ ...prev, [reviewId]: false }));
    }
  };

  const handleEditReply = async (replyId: number, reviewId: number, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setEditing((prev) => ({ ...prev, [replyId]: { ...prev[replyId]!, message: trimmed } }));
      return;
    }
    try {
      const updated = await updateReviewReply(replyId, trimmed);
      setRepliesMap((prev) => ({
        ...prev,
        [reviewId]: (prev[reviewId] || []).map((r) => (r.id === replyId ? updated : r)),
      }));
      setEditing((prev) => {
        const next = { ...prev };
        delete next[replyId];
        return next;
      });
      addToast('success', 'Reply updated');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to update reply');
    }
  };

  const handleDeleteReply = async (replyId: number, reviewId: number) => {
    if (!window.confirm('Are you sure you want to delete this reply? This cannot be undone.')) return;
    setDeleting(replyId);
    try {
      await deleteReviewReply(replyId);
      setRepliesMap((prev) => ({
        ...prev,
        [reviewId]: (prev[reviewId] || []).filter((r) => r.id !== replyId),
      }));
      addToast('success', 'Reply deleted');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to delete reply');
    } finally {
      setDeleting(null);
    }
  };

  const startEditing = (replyId: number, message: string) => {
    setEditing((prev) => ({ ...prev, [replyId]: { message, original: message } }));
  };

  const cancelEditing = (replyId: number) => {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[replyId];
      return next;
    });
  };

  const getReplies = (reviewId: number) => repliesMap[reviewId] || [];

  const filteredReviews = reviews.filter((review) => {
    const search = searchTerm.toLowerCase().trim();
    if (!search) return true;
    return (
      (review.customer_name ?? '').toLowerCase().includes(search) ||
      (review.reference_number ?? '').toLowerCase().includes(search) ||
      (review.service_type ?? '').toLowerCase().includes(search)
    );
  });

  const totalPages = Math.ceil(filteredReviews.length / CUSTOMER_REVIEWS_PER_PAGE);
  const paginatedReviews = filteredReviews.slice(
    (currentPage - 1) * CUSTOMER_REVIEWS_PER_PAGE,
    currentPage * CUSTOMER_REVIEWS_PER_PAGE
  );

  if (loading) {
    return (
      <div className="space-y-8 sm:space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <button
            onClick={() => setView('dashboard')}
            className="text-xs font-black text-zinc-400 uppercase tracking-widest hover:text-blue-500 mb-2"
          >
            ← Back to Dashboard
          </button>
          <h2 className="text-3xl font-extrabold text-zinc-900 tracking-tighter">Customer Reviews</h2>
          <p className="text-zinc-500 font-medium">See what customers are saying</p>
        </div>
        <div className="bg-white rounded-[40px] border-8 border-zinc-50 shadow-xl overflow-hidden">
          <div className="flex items-center justify-center h-64 sm:h-96">
            <RefreshCw className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500 animate-spin" aria-hidden="true" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8 sm:space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <button
            onClick={() => setView('dashboard')}
            className="text-xs font-black text-zinc-400 uppercase tracking-widest hover:text-blue-500 mb-2"
          >
            ← Back to Dashboard
          </button>
          <h2 className="text-3xl font-extrabold text-zinc-900 tracking-tighter">Customer Reviews</h2>
          <p className="text-zinc-500 font-medium">See what customers are saying</p>
        </div>
        <div className="bg-white rounded-[40px] border-8 border-zinc-50 shadow-xl overflow-hidden">
          <div className="text-center py-20">
            <AlertCircle className="w-16 h-16 text-rose-400 mx-auto mb-4" />
            <p className="text-zinc-700 font-bold mb-4">{error}</p>
            <button
              onClick={fetchReviews}
              className="px-6 py-3 bg-blue-500 text-white rounded-xl font-black hover:bg-blue-600 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

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
          <h2 className="text-3xl font-extrabold text-zinc-900 tracking-tighter">Customer Reviews</h2>
          <p className="text-zinc-500 font-medium">See what customers are saying</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 w-5 h-5" aria-hidden="true" />
        <input
          type="text"
          placeholder="Search reviews by customer name or reference..."
          className="pl-14 pr-6 py-5 bg-white border-4 border-zinc-100 rounded-2xl outline-none focus:border-blue-500 transition-all font-bold text-sm w-full"
          value={searchTerm}
          onChange={e => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          aria-label="Search reviews by customer name or reference"
        />
      </div>

      <Toast toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />

      {/* Reviews Table */}
      <div className="bg-white rounded-[40px] border-8 border-zinc-50 shadow-xl overflow-hidden" role="region" aria-label="Customer reviews list">
        {filteredReviews.length === 0 ? (
          <div className="text-center py-20">
            <Star className="w-16 h-16 text-zinc-200 mx-auto mb-4" />
            <p className="text-zinc-400 font-bold">No reviews found</p>
            <p className="text-zinc-400 text-sm mt-2">Customers will appear here after completing their orders</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left" role="table" aria-label="Customer reviews data table">
                <thead>
                  <tr className="bg-zinc-50/50 text-zinc-400 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-black">
                    <th className="px-3 sm:px-8 py-3 sm:py-6">Customer</th>
                    <th className="px-3 sm:px-8 py-3 sm:py-6">Rating</th>
                    <th className="px-3 sm:px-8 py-3 sm:py-6 hidden sm:table-cell">Photos</th>
                    <th className="px-3 sm:px-8 py-3 sm:py-6 hidden sm:table-cell">Service</th>
                    <th className="px-3 sm:px-8 py-3 sm:py-6 hidden md:table-cell">Total</th>
                    <th className="px-3 sm:px-8 py-3 sm:py-6 hidden lg:table-cell">Date</th>
                    <th className="px-3 sm:px-8 py-3 sm:py-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {paginatedReviews.map((review) => {
                    const replies = getReplies(review.id);
                    const isReplyOpen = openReplyReviewId === review.id;
                    return (
                      <tr key={review.id} className="hover:bg-zinc-50/30 transition-colors">
                        <td className="px-3 sm:px-8 py-3 sm:py-6">
                          <div className="flex items-center gap-3">
                            <div className="w-8 sm:w-10 h-8 sm:h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                              <span className="font-black text-blue-600 text-sm sm:text-base">
                                {(review.customer_name ?? 'C').charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="font-black text-zinc-900 text-sm sm:text-base truncate max-w-[80px] sm:max-w-none">
                                {review.customer_name ?? 'Customer'}
                              </span>
                              <span className="text-[10px] text-zinc-500 truncate max-w-[80px] sm:max-w-none">
                                #{review.reference_number ?? review.id}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 sm:px-8 py-3 sm:py-6">
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                className={`w-4 h-4 ${star <= review.rating ? 'fill-amber-400 text-amber-400' : 'text-zinc-200'}`}
                                aria-hidden="true"
                              />
                            ))}
                            <span className="ml-1 text-[10px] font-black text-zinc-400">{review.rating}</span>
                          </div>
                        </td>
                        <td className="px-3 sm:px-8 py-3 sm:py-6 hidden sm:table-cell">
                          {review.photos && review.photos.length > 0 ? (
                            <div className="flex gap-1 flex-wrap">
                              {review.photos.map((p, i) => (
                                <a key={i} href={p} target="_blank" rel="noopener noreferrer">
                                  <img src={p} alt={`photo ${i + 1}`} className="w-10 h-10 object-cover rounded-lg border border-zinc-200 hover:scale-105 transition-transform" />
                                </a>
                              ))}
                            </div>
                          ) : (
                            <span className="text-zinc-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-3 sm:px-8 py-3 sm:py-6 hidden sm:table-cell">
                          <span className="text-zinc-700 text-sm sm:text-base">{review.service_type ?? '-'}</span>
                        </td>
                        <td className="px-3 sm:px-8 py-3 sm:py-6 hidden md:table-cell">
                          <span className="font-black text-emerald-600 text-sm sm:text-base">
                            ₱{(review.total_price ?? 0).toFixed(2)}
                          </span>
                        </td>
                        <td className="px-3 sm:px-8 py-3 sm:py-6 hidden lg:table-cell">
                          <span className="text-zinc-400 text-xs sm:text-sm">
                            {formatDate(review.created_at)}
                          </span>
                        </td>
                        <td className="px-3 sm:px-8 py-3 sm:py-6">
                          <div className="flex items-center justify-end gap-1 sm:gap-2">
                            {isReplyOpen ? (
                              <div className="flex flex-col gap-2">
                                <textarea
                                  value={replyText[review.id] ?? ''}
                                  onChange={(e) => {
                                    setReplyText((prev) => ({ ...prev, [review.id]: e.target.value }));
                                    clearError(review.id);
                                  }}
                                  rows={2}
                                  className="w-48 p-2 bg-white border-2 border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 transition-colors"
                                  placeholder="Write a reply..."
                                />
                                <div className="flex items-end gap-2">
                                  {replyError[review.id] && (
                                    <span className="text-[10px] text-rose-600 font-black">{replyError[review.id]}</span>
                                  )}
                                  <button
                                    onClick={() => handleSendReply(review.id)}
                                    disabled={submitting[review.id] || !(replyText[review.id] ?? '').trim()}
                                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-widest hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                  >
                                    {submitting[review.id] ? 'Sending...' : 'Send'}
                                  </button>
                                  <button
                                    onClick={() => setOpenReplyReviewId(null)}
                                    className="px-3 py-1.5 bg-zinc-100 text-zinc-600 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-widest hover:bg-zinc-200 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setOpenReplyReviewId(review.id);
                                  fetchReplies(review.id);
                                }}
                                className="inline-flex items-center justify-center flex-shrink-0 p-3 bg-blue-500 text-white rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 min-w-[44px] min-h-[44px]"
                                title="Reply to review"
                                aria-label="Reply to review"
                              >
                                <Send className="w-5 h-5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Replies Section (expanded below table when a review is selected for reply) */}
            {openReplyReviewId !== null && (
              <div className="bg-zinc-50 p-6 border-t border-zinc-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-black text-zinc-900 uppercase tracking-widest">
                    Admin Replies
                  </h3>
                  <button
                    onClick={() => setOpenReplyReviewId(null)}
                    className="text-[10px] font-black text-zinc-500 hover:text-zinc-900 underline"
                  >
                    Close
                  </button>
                </div>
                {repliesLoading[openReplyReviewId] ? (
                  <div className="flex items-center justify-center h-32">
                    <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" aria-hidden="true" />
                  </div>
                ) : (
                  <>
                    {getReplies(openReplyReviewId).length === 0 ? (
                      <p className="text-zinc-400 text-sm italic text-center">No admin replies yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {getReplies(openReplyReviewId).map((reply) => {
                          const isEditing = editing[reply.id] !== undefined;
                          return (
                            <div
                              key={reply.id}
                              className={isEditing ? 'bg-indigo-50 border border-indigo-200 rounded-xl p-4' : 'bg-indigo-50 border border-indigo-100 rounded-xl p-4'}
                            >
                              {isEditing ? (
                                <>
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2">
                                      <div className="w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center shrink-0">
                                        <span className="font-black text-indigo-600 text-xs">A</span>
                                      </div>
                                      <div>
                                        <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Admin</p>
                                        <p className="text-[10px] text-zinc-400">{formatTime(reply.created_at)}</p>
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => cancelEditing(reply.id)}
                                      className="text-[10px] font-black text-zinc-500 hover:text-zinc-900 underline"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                  <textarea
                                    value={editing[reply.id]?.message ?? reply.message}
                                    onChange={(e) => {
                                      setEditing((prev) => ({
                                        ...prev,
                                        [reply.id]: { ...prev[reply.id]!, message: e.target.value },
                                      }));
                                    }}
                                    className="w-full min-h-[80px] p-2 bg-white border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                                    placeholder="Type your reply..."
                                  />
                                  <div className="mt-2 flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => {
                                        const text = editing[reply.id]?.message ?? '';
                                        handleEditReply(reply.id, openReplyReviewId!, text);
                                      }}
                                      disabled={!(editing[reply.id]?.message ?? '').trim()}
                                      className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={() => cancelEditing(reply.id)}
                                      className="px-3 py-1.5 bg-zinc-100 text-zinc-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 transition-colors"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2">
                                      <div className="w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center shrink-0">
                                        <span className="font-black text-indigo-600 text-xs">A</span>
                                      </div>
                                      <div>
                                        <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Admin</p>
                                        <p className="text-[10px] text-zinc-400">{formatTime(reply.created_at)}</p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 sm:gap-2">
                                      <button
                                        onClick={() => startEditing(reply.id, reply.message)}
                                        className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 underline px-2 py-1 rounded-md hover:bg-indigo-100 transition-colors"
                                      >
                                        <Edit className="w-3 h-3" aria-hidden="true" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteReply(reply.id, openReplyReviewId!)}
                                        disabled={deleting === reply.id}
                                        className="text-[10px] font-black text-rose-600 hover:text-rose-800 underline px-2 py-1 rounded-md hover:bg-rose-50 transition-colors"
                                      >
                                        <Trash2 className="w-3 h-3" aria-hidden="true" />
                                      </button>
                                    </div>
                                  </div>
                                  <p className="text-sm text-zinc-800 leading-relaxed">{reply.message}</p>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Pagination Controls */}
            {totalPages >= 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3 sm:px-8 py-4 border-t border-zinc-100">
                <p className="text-[10px] sm:text-xs font-bold text-zinc-400">
                  Showing {((currentPage - 1) * CUSTOMER_REVIEWS_PER_PAGE) + 1}-{Math.min(currentPage * CUSTOMER_REVIEWS_PER_PAGE, filteredReviews.length)} of {filteredReviews.length} reviews
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    aria-label="Previous page of reviews"
                    className={`inline-flex items-center gap-1 px-3 sm:px-4 py-2 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${currentPage <= 1 ? 'bg-zinc-100 text-zinc-400' : 'bg-zinc-50 text-zinc-900 hover:bg-zinc-100'}`}
                  >
                    <ChevronRight className="w-3 h-3 rotate-180" aria-hidden="true" /> PREV
                  </button>
                  <span className="text-[10px] sm:text-xs font-black text-zinc-600 whitespace-nowrap">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    aria-label="Next page of reviews"
                    className={`inline-flex items-center gap-1 px-3 sm:px-4 py-2 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${currentPage >= totalPages ? 'bg-zinc-100 text-zinc-400' : 'bg-zinc-50 text-zinc-900 hover:bg-zinc-100'}`}
                  >
                    NEXT <ChevronRight className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </> 
        )}
      </div>
    </div>
  );
};

export default CustomerReviews;