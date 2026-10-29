/**
 * Admin session helpers.
 *
 * The admin portal must never be reachable through the browser's Back/Forward
 * buttons, a restored back-forward cache page or a cached copy of the portal.
 * These helpers own the client side of that contract: they wipe the session,
 * replace history entries and expose the guard helpers used by the router.
 */

/** Key the client uses to remember the admin JWT between reloads. */
export const ADMIN_TOKEN_KEY = 'admin_token';

/** Fired whenever the admin session is wiped so mounted views can drop their data. */
export const ADMIN_SESSION_CLEARED_EVENT = 'admin-session-cleared';

/** Every view that belongs to the admin portal. */
export const ADMIN_VIEWS = ['admin', 'admin-login', 'admin-settings'] as const;

/** True when the given view is part of the admin portal. */
export const isAdminView = (view: string): boolean =>
  (ADMIN_VIEWS as readonly string[]).includes(view);

/** Reads the token the client kept in storage (the httpOnly cookie is the real session). */
export const getStoredAdminToken = (): string | null => {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
};

/**
 * Removes every trace of the admin session from the browser: the stored JWT,
 * anything else cached under an "admin_" key and the in-memory state of the
 * mounted admin components.
 */
export const clearAdminSession = (): void => {
  try {
    for (const store of [localStorage, sessionStorage]) {
      Object.keys(store)
        .filter((key) => key.startsWith('admin_'))
        .forEach((key) => store.removeItem(key));
    }
  } catch {
    // Storage can be unavailable (private mode, disabled cookies). The
    // httpOnly session cookie is still cleared by the server on logout.
  }

  // Let any mounted admin component drop the data it is holding.
  try {
    window.dispatchEvent(new CustomEvent(ADMIN_SESSION_CLEARED_EVENT));
  } catch {
    // Non browser environment - nothing to notify.
  }
};

/**
 * Replaces the current history entry so the Back/Forward buttons can never
 * return to it. Used on logout and after a successful login.
 */
export const replaceHistoryEntry = (hash: string): void => {
  try {
    const url = `${window.location.pathname}${window.location.search}${hash}`;
    window.history.replaceState(window.history.state, '', url);
  } catch {
    // The auth guard still protects the admin routes if history is unavailable.
  }
};

/**
 * Ends the session: the server clears the httpOnly cookie and every trace of
 * the session is removed from the browser.
 */
export const logoutAdmin = async (): Promise<void> => {
  try {
    await fetch('/api/admin/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    // The local session is cleared even when the network call fails.
  }
  clearAdminSession();
};

/**
 * Full "Exit Admin" flow: ends the session, wipes the admin state and replaces
 * the current history entry, so pressing Back can never return to an admin page.
 */
export const exitAdminPortal = async (setView: (view: 'home') => void): Promise<void> => {
  await logoutAdmin();
  replaceHistoryEntry('#home');
  setView('home');
};
