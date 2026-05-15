let authMode = 'login', keyB64 = null, socket = null, myUsername = null, fullHistory = [];

const switchTab = (m) => {
  authMode = m;
  document.getElementById('tab-login').classList.toggle('active', m==='login');
  document.getElementById('tab-register').classList.toggle('active', m==='register');
  document.getElementById('auth-btn').innerText = m==='login' ? 'Sign In' : 'Create Account';
};

const handleFile = (f) => {
  const r = new FileReader();
  r.onload = e => { 
    keyB64 = e.target.result.split(',')[1];
    document.getElementById('key-zone').classList.add('ok');
    document.getElementById('key-label').innerText = "✓ Key Ready";
  };
  r.readAsDataURL(f[0]);
};

async function doAuth() {
  const username = document.getElementById('f-username').value;
  const password = document.getElementById('f-password').value;
  if(!username || !password || !keyB64) return alert("Missing info");

  try {
    const res = await fetch('/auth/'+authMode, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username, password, keyFile:keyB64})
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error);
    sessionStorage.setItem('tc_token', data.token);
    enterChat(data.token, data.username);
  } catch(e) { document.getElementById('auth-alert').innerText = e.message; document.getElementById('auth-alert').style.display='block'; }
}

function enterChat(token, user) {
  myUsername = user;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('chat-screen').style.display = 'flex';
  document.getElementById('user-badge').innerText = user;

  socket = io({ auth: { token } });
  socket.on('welcome', ({ history }) => { 
    fullHistory = history; 
    applyFilter(); 
    socket.emit('get users');
  });
  socket.on('chat message', (msg) => { fullHistory.push(msg); applyFilter(); });
  socket.on('user list', (list) => {
    const container = document.getElementById('user-list');
    container.innerHTML = list.map(u => `<div class="user-item">${u}</div>`).join('');
  });
}

function applyFilter() {
  const query = document.getElementById('s-content').value.toLowerCase();
  const userQ = document.getElementById('s-user').value.toLowerCase();
  const sort = document.getElementById('s-sort').value;

  let filtered = fullHistory.filter(m => 
    m.msg.toLowerCase().includes(query) && m.user.toLowerCase().includes(userQ)
  );
  
  if(sort === 'old') filtered.sort((a,b) => new Date(a.ts) - new Date(b.ts));
  else filtered.sort((a,b) => new Date(b.ts) - new Date(a.ts));

  const container = document.getElementById('messages');
  container.innerHTML = filtered.map(m => `
    <div class="msg ${m.user === myUsername ? 'own' : ''}">
      <span class="msg-meta">${m.user}</span>
      <span>${m.msg}</span>
      <span class="msg-time">${new Date(m.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
}

function toggleSearch() { 
  const p = document.getElementById('search-panel');
  p.style.display = p.style.display === 'none' ? 'flex' : 'none';
}

function filterUsers() {
  const q = document.getElementById('user-search').value.toLowerCase();
  document.querySelectorAll('.user-item').forEach(i => {
    i.style.display = i.innerText.toLowerCase().includes(q) ? 'block' : 'none';
  });
}

function doSend() {
  const i = document.getElementById('msg-input');
  if(!i.value.trim()) return;
  socket.emit('chat message', i.value);
  i.value = '';
}

function doSignOut() { sessionStorage.clear(); location.reload(); }

window.onload = () => {
  const t = sessionStorage.getItem('tc_token');
  if(t) enterChat(t, 'User');
};