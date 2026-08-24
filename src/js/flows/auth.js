let authConfig = {
  itContact: 'IT Support: 02-000-0000',
  itLine: '@watermotion-it'
};

async function loadAuthConfig() {
  try {
    const response = await fetch('/api/auth-config', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return;
    authConfig = { ...authConfig, ...(await response.json()) };
  } catch (error) {
    console.warn('Auth config unavailable', error);
  }
}

async function initAuthUI() {
  await loadAuthConfig();
}

function setLoginMessage(message = '', type = 'error') {
  const box = document.getElementById('login-error');
  if (!box) return;
  box.textContent = message;
  box.classList.toggle('hidden', !message);
  box.classList.toggle('login-msg-success', type === 'success');
}

function updateLoggedInUser(user) {
  S.user = user;
  try {
    localStorage.removeItem('wm-session');
  } catch { /* ignore */ }
  const nameEl = document.querySelector('.dash-user-name');
  const roleEl = document.querySelector('.dash-user-role');
  const avatar = document.querySelector('.dash-avatar');
  if (nameEl) nameEl.textContent = user.name || user.username;
  if (roleEl) roleEl.textContent = user.role || 'Field Specialist';
  if (avatar) avatar.textContent = (user.name || user.username || 'U').trim().charAt(0).toUpperCase();
}

async function doLogin() {
  const username = document.getElementById('l-user')?.value.trim();
  const password = document.getElementById('l-pass')?.value || '';

  if (!username || !password) {
    setLoginMessage('Enter username and password');
    return;
  }

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Username or password is incorrect');

    setLoginMessage('');
    updateLoggedInUser(data.user);
    goScreen('s-dash');
  } catch (error) {
    setLoginMessage(error.message || 'Could not sign in');
    document.getElementById('l-pass')?.focus();
  }
}

async function forgotPassword() {
  await loadAuthConfig();
  const contact = [authConfig.itContact, authConfig.itLine ? `LINE: ${authConfig.itLine}` : '']
    .filter(Boolean)
    .join(' · ');
  setLoginMessage('');
  showToast(contact || t('login.forgotIt'));
}

/**
 * Restore session from HttpOnly cookie via GET /api/auth/me.
 * Does not use localStorage bearer tokens.
 */
async function restoreLoginSession() {
  try {
    try {
      localStorage.removeItem('wm-session');
    } catch { /* ignore */ }
    const response = await fetch('/api/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => ({}));
    if (!data.user) return false;
    updateLoggedInUser(data.user);
    goScreen('s-dash');
    return true;
  } catch {
    return false;
  }
}

/** Cookie-only auth — no Authorization bearer from localStorage. */
function getAppSessionToken() {
  return '';
}

function getAppAuthHeaders() {
  return {};
}

/**
 * Sign-out on a device shared between staff must not leave the previous
 * user's Cases or notification history (customer names, appointment
 * details) visible to whoever signs in next. The app is a single-page app
 * that never reloads on sign-out, so anything left in memory or
 * localStorage would otherwise still be showing right after the next
 * login — clearing wm-session alone (the only thing this function did
 * before) isn't enough. Each module owns clearing its own state; this only
 * orchestrates the calls. Deliberately does NOT touch device-level,
 * non-user data (wm-lang, wm-csv-seed-version, the Drive upload queue —
 * clearing that would drop in-progress photo uploads for the current Case).
 */
function resetUserScopedState() {
  if (typeof resetJobsCacheForLogout === 'function') resetJobsCacheForLogout();
  if (typeof clearHighlightedCase === 'function') clearHighlightedCase();
  // wm-active-case-ref (job-state.js) points restoreActiveCaseFromPersistence()
  // at whichever Case S.activeJob was on — including hydrating its draft
  // measurements/photos into the session (job-state.js:restoreActiveCaseFromPersistence).
  // Found during a Release Gate audit: confirmSignout() (dashboard.js) already
  // cleared this manually, but clearAppSession() itself did not — so the
  // handleSessionExpired() path (a server-triggered sign-out, not a manual
  // tap) skipped it entirely, and the next login on this device could get
  // silently dropped into the previous user's in-progress Case.
  if (typeof clearActiveCaseRef === 'function') clearActiveCaseRef();
  S.activeJob = null;
  if (typeof OperatorNotificationRepository?.clearAllNotificationData === 'function') {
    OperatorNotificationRepository.clearAllNotificationData();
  }
  // Order matters: the service caches a repository instance that already
  // hydrated the previous user's notifications into memory — reset it
  // AFTER clearing localStorage above, so the next time anything needs the
  // repository it constructs a fresh one from the now-empty storage instead
  // of re-reading stale in-memory data.
  if (typeof OperatorNotificationService?.resetRepository === 'function') {
    OperatorNotificationService.resetRepository();
  }
  if (typeof OperatorNotificationStore?.setItems === 'function') {
    OperatorNotificationStore.setItems([]);
  }
  if (typeof OperatorNotificationObserver?.resetBootstrap === 'function') {
    OperatorNotificationObserver.resetBootstrap();
  }
  if (typeof refreshNotificationUi === 'function') refreshNotificationUi();
}

async function clearAppSession() {
  try {
    localStorage.removeItem('wm-session');
  } catch { /* ignore */ }
  S.user = null;
  resetUserScopedState();
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store'
    });
  } catch {
    /* ignore */
  }
}

/**
 * A previously-valid session (e.g. the 7-day token) was rejected by the
 * server as expired/invalid. Same effect as a manual sign-out, but
 * triggered by the server response instead of the user tapping Sign Out.
 */
function handleSessionExpired(message) {
  clearAppSession();
  goScreen('s-login');
  setLoginMessage(message || 'Your session has expired. Please sign in again.');
}
