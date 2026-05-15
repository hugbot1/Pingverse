let authMode = 'login', keyB64 = null, socket = null, myUsername = null, fullHistory = [], myRole = 'user';
let unreadCount = 0;
const originalTitle = "TechChat";

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    unreadCount = 0;
    document.title = originalTitle;
  }
});

const switchTab = (m) => {
  authMode = m;
  document.getElementById('tab-login').classList.toggle('active', m==='login');
  document.getElementById('tab-register').classList.toggle('active', m==='register');
  document.getElementById('auth-btn').innerText = m==='login' ? 'Sign In' : 'Create Account';
};

const handleFile = (f) => {
  if (!f[0]) return;
  const r = new FileReader();
  r.onload = e => { 
    const parts = e.target.result.split(',');
    if (parts.length > 1) {
      keyB64 = parts[1];
      document.getElementById('key-zone').classList.add('ok');
      document.getElementById('key-label').innerText = "✓ Key Ready";
    }
  };
  r.readAsDataURL(f[0]);
};

async function doAuth() {
  const username = document.getElementById('f-username').value;
  const password = document.getElementById('f-password').value;
  if(!username || !password || !keyB64) {
    const el = document.getElementById('auth-alert');
    el.innerText = "All fields and Key required.";
    el.style.display = 'block';
    return;
  }
  try {
    const res = await fetch('/auth/' + authMode, {
      method: 'POST', 
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ username, password, keyFile: keyB64 })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error);
    sessionStorage.setItem('tc_token', data.token);
    enterChat(data.token);
  } catch(e) { 
    const el = document.getElementById('auth-alert');
    el.innerText = e.message; el.style.display = 'block'; 
  }
}

function enterChat(token) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('chat-screen').style.display = 'flex';
  socket = io({ auth: { token } });

  socket.on('welcome', ({ username, role, history }) => { 
    myUsername = username;
    myRole = role;
    document.getElementById('user-badge').innerText = username + (role==='admin' ? ' (Admin)' : '');
    if(role === 'admin') document.getElementById('admin-tools').style.display = 'block';
    fullHistory = history; 
    applyFilter();
    scrollToBottomInstant();
    socket.emit('get users');
  });

  socket.on('announcement', (data) => {
    const bar = document.getElementById('broadcast-bar');
    const txt = document.getElementById('bc-text');
    if(!data.msg) return bar.style.display = 'none';
    bar.style.display = 'block';
    txt.innerText = data.msg;
    if(data.important) {
      bar.classList.add('flash-urgent');
      setTimeout(() => bar.classList.remove('flash-urgent'), 5000);
    }
  });

  socket.on('chat message', (msg) => { 
    fullHistory.push(msg); 
    applyFilter();
    scrollToBottomInstant();
    if (document.hidden) {
      unreadCount++;
      document.title = `(${unreadCount}) New Messages!`;
    }
  });

  socket.on('msg deleted', (id) => {
    fullHistory = fullHistory.filter(m => m._id !== id);
    applyFilter();
  });

  socket.on('status change', () => socket.emit('get users'));
  socket.on('user list', (list) => {
    document.getElementById('user-list').innerHTML = list.map(u => `
      <div class="user-item">
        <span>${u.name}</span>
        <div class="dot" style="background:${u.online ? 'var(--accent)' : '#444'}"></div>
      </div>
    `).join('');
  });
}

function applyFilter() {
  const query = document.getElementById('s-content').value.toLowerCase();
  const userQ = document.getElementById('s-user').value.toLowerCase();
  const sort = document.getElementById('s-sort').value;
  let filtered = fullHistory.filter(m => m.msg.toLowerCase().includes(query) && m.user.toLowerCase().includes(userQ));
  if(sort === 'new') filtered.sort((a,b) => new Date(a.ts) - new Date(b.ts));
  else filtered.sort((a,b) => new Date(b.ts) - new Date(a.ts));

  document.getElementById('messages').innerHTML = filtered.map(m => `
    <div class="msg ${m.user === myUsername ? 'own' : ''}">
      <span class="msg-meta">${m.user} ${myRole==='admin' ? `<button onclick="delMsg('${m._id}')" style="color:var(--danger); border:none; background:none; cursor:pointer; margin-left:5px;">[Delete]</button>` : ''}</span>
      <span>${m.msg}</span>
      <span class="msg-time">${new Date(m.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
    </div>
  `).join('');
}

function delMsg(id) { socket.emit('delete message', id); }
function updateBC() {
  const msg = document.getElementById('bc-input').value;
  const important = document.getElementById('bc-check').checked;
  socket.emit('set announcement', { msg, important });
}

function scrollToBottomInstant() {
  const m = document.getElementById('messages');
  requestAnimationFrame(() => m.scrollTop = m.scrollHeight);
}

function toggleSearch() { 
  const p = document.getElementById('search-panel');
  p.style.display = p.style.display === 'none' ? 'flex' : 'none';
}

function filterUsers() {
  const q = document.getElementById('user-search').value.toLowerCase();
  document.querySelectorAll('.user-item').forEach(i => {
    i.style.display = i.innerText.toLowerCase().includes(q) ? 'flex' : 'none';
  });
}

function doSend() {
  const i = document.getElementById('msg-input');
  if(!i.value.trim()) return;
  socket.emit('chat message', i.value);
  i.value = '';
}

function doSignOut() { sessionStorage.clear(); location.reload(); }
window.onload = () => { if(sessionStorage.getItem('tc_token')) enterChat(sessionStorage.getItem('tc_token')); };