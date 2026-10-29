// Pure validation helpers for review photo uploads.
// Shared by client-side checks and unit tests.

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const MAX_FILES = 5;

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
};

export function validateFileType(file: FileLike): boolean {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (!ALLOWED_MIME_TYPES.includes(file.type)) return false;
  if (!ALLOWED_EXTENSIONS.includes(ext)) return false;
  // Ensure extension is consistent with declared MIME type
  return (MIME_TO_EXTENSIONS[file.type] || []).includes(ext);
}

export function validateFileSize(file: FileLike): boolean {
  return file.size > 0 && file.size <= MAX_FILE_SIZE_BYTES;
}

export function validateFileCount(files: FileLike[]): boolean {
  return files.length >= 0 && files.length <= MAX_FILES;
}

export function validateReviewPhotos(files: FileLike[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!validateFileCount(files)) {
    errors.push(`You can attach at most ${MAX_FILES} photos.`);
  }
  files.forEach((f, i) => {
    if (!validateFileType(f)) {
      errors.push(`Photo ${i + 1}: unsupported file type.`);
    }
    if (!validateFileSize(f)) {
      errors.push(`Photo ${i + 1}: file must be between 1 byte and 5MB.`);
    }
  });
  return { valid: errors.length === 0, errors };
}