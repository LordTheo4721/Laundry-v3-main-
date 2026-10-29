import { describe, expect, it } from 'vitest';
import {
  validateFileType,
  validateFileSize,
  validateFileCount,
  validateReviewPhotos,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES,
} from './reviewPhotoValidation';

describe('reviewPhotoValidation', () => {
  it('accepts allowed image types', () => {
    expect(validateFileType({ name: 'a.jpg', type: 'image/jpeg', size: 100 })).toBe(true);
    expect(validateFileType({ name: 'b.png', type: 'image/png', size: 100 })).toBe(true);
    expect(validateFileType({ name: 'c.webp', type: 'image/webp', size: 100 })).toBe(true);
    expect(validateFileType({ name: 'd.gif', type: 'image/gif', size: 100 })).toBe(true);
  });

  it('rejects disallowed types and mismatched extensions', () => {
    expect(validateFileType({ name: 'a.txt', type: 'text/plain', size: 100 })).toBe(false);
    expect(validateFileType({ name: 'a.jpg', type: 'image/png', size: 100 })).toBe(false);
    expect(validateFileType({ name: 'a.exe', type: 'image/jpeg', size: 100 })).toBe(false);
  });

  it('enforces size limits', () => {
    expect(validateFileSize({ name: 'a.jpg', type: 'image/jpeg', size: 0 })).toBe(false);
    expect(validateFileSize({ name: 'a.jpg', type: 'image/jpeg', size: 1 })).toBe(true);
    expect(validateFileSize({ name: 'a.jpg', type: 'image/jpeg', size: MAX_FILE_SIZE_BYTES })).toBe(true);
    expect(validateFileSize({ name: 'a.jpg', type: 'image/jpeg', size: MAX_FILE_SIZE_BYTES + 1 })).toBe(false);
  });

  it('enforces file count limit', () => {
    const files = Array.from({ length: MAX_FILES }, (_, i) => ({ name: `f${i}.jpg`, type: 'image/jpeg', size: 10 }));
    expect(validateFileCount(files)).toBe(true);
    const tooMany = [...files, { name: 'extra.jpg', type: 'image/jpeg', size: 10 }];
    expect(validateFileCount(tooMany)).toBe(false);
  });

  it('validateReviewPhotos returns errors for invalid files', () => {
    const result = validateReviewPhotos([
      { name: 'bad.txt', type: 'text/plain', size: 10 },
      { name: 'big.jpg', type: 'image/jpeg', size: MAX_FILE_SIZE_BYTES + 1 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validateReviewPhotos accepts valid batch', () => {
    const result = validateReviewPhotos([
      { name: 'a.jpg', type: 'image/jpeg', size: 100 },
      { name: 'b.png', type: 'image/png', size: 200 },
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('constants are sane', () => {
    expect(ALLOWED_MIME_TYPES.length).toBeGreaterThan(0);
    expect(MAX_FILES).toBe(5);
  });

  it('handles empty file list', () => {
    const result = validateReviewPhotos([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('is case-insensitive for extensions', () => {
    expect(validateFileType({ name: 'a.JPG', type: 'image/jpeg', size: 10 })).toBe(true);
    expect(validateFileType({ name: 'b.PNG', type: 'image/png', size: 10 })).toBe(true);
  });

  it('rejects files with no extension', () => {
    expect(validateFileType({ name: 'noext', type: 'image/jpeg', size: 10 })).toBe(false);
  });

  it('rejects oversized batch count at boundary', () => {
    const files = Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ name: `f${i}.jpg`, type: 'image/jpeg', size: 10 }));
    expect(validateFileCount(files)).toBe(false);
    const result = validateReviewPhotos(files);
    expect(result.valid).toBe(false);
  });
});