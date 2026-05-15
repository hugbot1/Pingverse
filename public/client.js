let authMode = 'login', keyB64 = null, socket = null, myName = null, myRole = 'user', history = [];
let unread = 0;

const handleFile = (f) => {
  const r = new FileReader();
  r.onload = e => { 
    keyB64 = e.target.result.split(',')[1];
    document.getElementById('key-zone').classList.add('ok');
    document.getElementById('k-lab').innerText = "✓ Key Loaded";
  };
  r.readAsDataURL(f[0]);
};

async function doAuth() {
  const username = document.getElementById('f-user').value;
  const password = document.getElementById('f-pass').value;
  if(!username || !password || !keyB64) return alert("All fields + Key required");

  const res = await fetch('/auth/' + authMode, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ username, password, keyFile: keyB64 })
  });
  const data = await res.json();
  if(!res.ok) return alert(data.error);
  
  sessionStorage.setItem('tc_token', data.token);
  initChat(data.token);
}

function initChat(token) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('chat-screen').style.display = 'flex';

  socket = io({ auth: { token } });

  socket.on('welcome', (data) => {
    myName = data.username; myRole = data.role;
    document.getElementById('my-name').innerText = myName + (myRole === 'admin' ? ' 👑' : '');
    if(myRole === 'admin') document.getElementById('admin-tools').style.display = 'block';
    history = data.history; render();
    socket.emit('get users');
    setTimeout(scrollDown, 100);
  });

  socket.on('announcement', (data) => {
    const bar = document.getElementById('broadcast-bar');
    if(!data.msg) return bar.style.display = 'none';
    bar.style.display = 'block';
    bar.className = data.important ? 'urgent' : '';
    document.getElementById('bc-txt').innerText = data.msg;
  });

  socket.on('chat message', (m) => { history.push(m); render(); scrollDown(); });
  socket.on('msg deleted', (id) => { history = history.filter(m => m._id !== id); render(); });
  socket.on('status change', () => socket.emit('get users'));
  socket.on('user list', (list) => {
    document.getElementById('user-list').innerHTML = list.map(u => `
      <div style="padding:10px 20px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1a1e21;">
        <span>${u.name}</span>
        <div class="status-dot" style="background:${u.online ? 'var(--accent)' : '#444'}"></div>
      </div>
    `).join('');
  });
}

function render() {
  document.getElementById('messages').innerHTML = history.map(m => `
    <div class="msg ${m.user === myName ? 'own' : ''}">
      <div style="font-size:0.7rem; color:var(--accent); font-weight:bold;">${m.user}</div>
      <div>${m.msg} ${myRole === 'admin' ? `<button class="del-btn" onclick="delMsg('${m._id}')">🗑</button>` : ''}</div>
      <div class="msg-time">${new Date(m.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
    </div>
  `).join('');
}

function scrollDown() { 
  const m = document.getElementById('messages');
  requestAnimationFrame(() => m.scrollTop = m.scrollHeight);
}

function sendBC() {
  socket.emit('set announcement', { 
    msg: document.getElementById('bc-msg').value, 
    important: document.getElementById('bc-urg').checked 
  });
}

function delMsg(id) { socket.emit('delete message', id); }
function doSend() {
  const i = document.getElementById('m-in');
  if(!i.value.trim()) return;
  socket.emit('chat message', i.value);
  i.value = '';
}

window.onload = () => { if(sessionStorage.getItem('tc_token')) initChat(sessionStorage.getItem('tc_token')); };