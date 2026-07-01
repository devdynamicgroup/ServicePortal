const AUTH_USERS = [
  { username: 'kittichai', password: 'password', name: 'Kittichai T.', role: 'Water Quality Specialist' },
  { username: 'admin', password: 'admin123', name: 'Admin', role: 'Operations' }
];

function setLoginError(message = '') {
  const box = document.getElementById('login-error');
  if (!box) return;
  box.textContent = message;
  box.classList.toggle('hidden', !message);
}

function updateLoggedInUser(user) {
  S.user = user;
  localStorage.setItem('wm-session', JSON.stringify({ username: user.username }));
  const nameEl = document.querySelector('.dash-user-name');
  const roleEl = document.querySelector('.dash-user-role');
  const avatar = document.querySelector('.dash-avatar');
  if (nameEl) nameEl.textContent = user.name;
  if (roleEl) roleEl.textContent = user.role;
  if (avatar) avatar.textContent = (user.name || user.username).trim().charAt(0).toUpperCase();
}

function doLogin() {
  const username = document.getElementById('l-user')?.value.trim().toLowerCase();
  const password = document.getElementById('l-pass')?.value || '';
  const user = AUTH_USERS.find(u => u.username.toLowerCase() === username && u.password === password);

  if (!user) {
    setLoginError('Username or password is incorrect');
    document.getElementById('l-pass')?.focus();
    return;
  }

  setLoginError('');
  updateLoggedInUser(user);
  renderCalendar();
  goScreen('s-dash');
}

function restoreLoginSession() {
  try {
    const raw = localStorage.getItem('wm-session');
    if (!raw) return false;
    const session = JSON.parse(raw);
    const user = AUTH_USERS.find(u => u.username === session.username);
    if (!user) return false;
    updateLoggedInUser(user);
    renderCalendar();
    goScreen('s-dash');
    return true;
  } catch {
    return false;
  }
}
