// Thin wrapper around a confirmation callback used before submitting a review.
export const confirmReviewSubmission = (confirmFn: () => boolean) => {
  return confirmFn();
};
