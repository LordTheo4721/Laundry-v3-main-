import { describe, expect, it } from 'vitest';
import { confirmReviewSubmission } from './reviewConfirmation';

describe('confirmReviewSubmission', () => {
  it('submits only when the user confirms', () => {
    expect(confirmReviewSubmission(() => true)).toBe(true);
    expect(confirmReviewSubmission(() => false)).toBe(false);
  });
});
