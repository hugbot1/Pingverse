let authMode = 'login', keyB64 = null, socket = null, myName = null, myRole = 'user', messageCache = [];
let unreadCount = 0;
const originalTitle = "TechChat Console";

// TAB NOTIFICATION LOGIC
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    unreadCount = 0;
    document.title = originalTitle;
  }
});

function switchAuth(mode) {
  authMode = mode;
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-reg').classList.toggle('active', mode === 'register');
  document.getElementById('auth-alert').style.display = 'none';
}

function handleFile(files) {
  if (!files[0]) return;
  const reader = new FileReader();
  reader.onload = e => { 
    const parts = e.target.result.split(',');
    if (parts.length > 1) {
      keyB64 = parts[1];
      document.getElementById('key-zone').classList.add('ok');
      document.getElementById('k-lab').innerText = "✓ Security Key Loaded";
    }
  };
  reader.readAsDataURL(files[0]);
}

async function doAuth() {
  const username = document.getElementById('f-user').value;
  const password = document.getElementById('f-pass').value;
  const alertBox = document.getElementById('auth-alert');

  if (!username || !password || !keyB64) {
    alertBox.innerText = "Error: Credentials and Key File required.";
    alertBox.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/auth/' + authMode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, keyFile: keyB64 })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Access Denied');

    sessionStorage.setItem('tc_token', data.token);
    startSession(data.token);
  } catch (err) {
    alertBox.innerText = err.message;
    alertBox.style.display = 'block';
  }
}

function startSession(token) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('chat-screen').style.display = 'flex';

  socket = io({ auth: { token } });

  socket.on('welcome', (data) => {
    myName = data.username;
    myRole = data.role;
    messageCache = data.history;

    document.getElementById('my-name-display').innerText = (myRole === 'admin' ? '👑 ' : '') + myName;
    if (myRole === 'admin') document.getElementById('admin-tools').style.display = 'block';

    renderMessages();
    snapToBottom();
    socket.emit('get users');
  });

  socket.on('announcement', (data) => {
    const bar = document.getElementById('broadcast-bar');
    const txt = document.getElementById('bc-display-text');
    if (!data.msg) {
      bar.style.display = 'none';
    } else {
      bar.style.display = 'block';
      bar.className = data.important ? 'urgent' : '';
      txt.innerText = data.msg;
    }
  });

  socket.on('chat message', (msg) => {
    messageCache.push(msg);
    renderMessages();
    snapToBottom();
    
    if (document.hidden) {
      unreadCount++;
      document.title = `(${unreadCount}) New Messages!`;
    }
  });

  socket.on('msg deleted', (id) => {
    messageCache = messageCache.filter(m => m._id !== id);
    renderMessages();
  });

  socket.on('status change', () => socket.emit('get users'));

  socket.on('user list', (list) => {
    document.getElementById('user-list').innerHTML = list.map(u => `
      <div style="padding:12px 20px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1a1e21;">
        <span style="font-size:0.9rem;">${u.name}</span>
        <div class="status-dot" style="background:${u.online ? 'var(--accent)' : '#444'}"></div>
      </div>
    `).join('');
  });

  socket.on('connect_error', () => { logout(); });
}

function renderMessages() {
  const container = document.getElementById('messages');
  container.innerHTML = messageCache.map(m => `
    <div class="msg ${m.user === myName ? 'own' : ''}">
      <div class="msg-meta">
        <span>${m.user}</span>
        ${myRole === 'admin' ? `<button class="del-btn" onclick="deleteMsg('${m._id}')">✕</button>` : ''}
      </div>
      <div style="line-height:1.4;">${m.msg}</div>
      <div class="msg-time">${new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  `).join('');
}

function snapToBottom() {
  const container = document.getElementById('messages');
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function doSend() {
  const input = document.getElementById('m-in');
  const val = input.value.trim();
  if (!val) return;
  socket.emit('chat message', val);
  input.value = '';
}

function sendBroadcast() {
  const msg = document.getElementById('bc-msg').value;
  const important = document.getElementById('bc-urg').checked;
  socket.emit('set announcement', { msg, important });
}

function deleteMsg(id) {
  socket.emit('delete message', id);
}

function filterUsers() {
  const q = document.getElementById('u-search').value.toLowerCase();
  document.querySelectorAll('#user-list > div').forEach(div => {
    const name = div.querySelector('span').innerText.toLowerCase();
    div.style.display = name.includes(q) ? 'flex' : 'none';
  });
}

function logout() {
  sessionStorage.clear();
  location.reload();
}

window.onload = () => {
  const token = sessionStorage.getItem('tc_token');
  if (token) startSession(token);
};