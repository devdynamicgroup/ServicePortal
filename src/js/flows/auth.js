let authConfig = {
  itContact: 'IT Support: 02-000-0000',
  itLine: '@watermotion-it'
};

async function loadAuthConfig() {
  try {
    const response = await fetch('/api/auth-config', { cache: 'no-store' });
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
  localStorage.setItem('wm-session', JSON.stringify({ user }));
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
      body: JSON.stringify({ username, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Username or password is incorrect');

    setLoginMessage('');
    updateLoggedInUser(data.user);
    renderCalendar();
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

function restoreLoginSession() {
  try {
    const raw = localStorage.getItem('wm-session');
    if (!raw) return false;
    const session = JSON.parse(raw);
    if (!session.user) return false;
    updateLoggedInUser(session.user);
    renderCalendar();
    goScreen('s-dash');
    return true;
  } catch {
    return false;
  }
}
