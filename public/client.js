let authMode = 'login', keyB64 = null, socket = null, myUsername = null, fullHistory = [], myRole = 'user';
let unreadCount = 0;
const originalTitle = "TechChat";

let activePrivateUser = null; 
let replyContext = null;      

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
    el.innerText = "All fields and the Security Key are required.";
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
    document.getElementById('user-badge').innerText = username + (role==='admin' ? ' (Owner)' : '');
    if(role === 'admin') document.getElementById('admin-tools').style.display = 'block';
    fullHistory = history; 
    applyFilter();
    scrollToBottomInstant();
    socket.emit('get users');
  });

  socket.on('announcement', (data) => {
    const bar = document.getElementById('broadcast-bar');
    if(!data.msg) { bar.style.display = 'none'; return; }
    bar.style.display = 'block';
    document.getElementById('bc-text').innerText = data.msg;
    if(data.important) {
      bar.classList.add('important-flash');
      setTimeout(() => bar.classList.remove('important-flash'), 5000);
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

  socket.on('msg updated', (updatedMsg) => {
    fullHistory = fullHistory.map(m => m._id === updatedMsg._id ? updatedMsg : m);
    applyFilter();
  });

  socket.on('error notice', (errorMsg) => {
    alert(errorMsg);
  });

  socket.on('user status alert', ({ target, muted, until }) => {
    if(target === myUsername && muted) {
      alert(`You have been timed out until: ${new Date(until).toLocaleTimeString()}`);
    }
    socket.emit('get users');
  });

  socket.on('status change', () => socket.emit('get users'));
  socket.on('user list update', () => socket.emit('get users'));
  socket.on('force logout', () => doSignOut());

  socket.on('settings success', (msg) => { alert(msg); doSignOut(); });
  socket.on('settings error', (msg) => {
    const el = document.getElementById('settings-alert');
    el.innerText = msg; el.style.display = 'block';
  });
  
  socket.on('user list', (list) => {
    document.getElementById('user-list').innerHTML = list.map(u => {
      const muteLabel = u.isMuted ? ' <span style="color:var(--danger)">[Timed Out]</span>' : '';
      const ownerLabel = u.role === 'admin' ? ' <small style="color:var(--accent); font-weight:bold;">(Owner)</small>' : '';
      
      const adminActions = (myRole === 'admin' && u.name !== myUsername) ? `
        <div style="margin-top:4px; display:flex; gap:5px;">
          <button onclick="event.stopPropagation(); timeoutUser('${u.name}')" style="background:#333; font-size:10px; color:#fff; border:none; padding:2px 4px; border-radius:3px;">Timeout</button>
          <button onclick="event.stopPropagation(); terminateAccount('${u.name}')" style="background:var(--danger); font-size:10px; color:#fff; border:none; padding:2px 4px; border-radius:3px;">Delete Account</button>
        </div>
      ` : '';

      return `
        <div class="user-item" onclick="startPrivate('${u.name}')">
          <div>
            <span style="font-weight:500;">${u.name}</span>${ownerLabel}${muteLabel}
            ${adminActions}
          </div>
          <div class="dot" style="background:${u.online ? 'var(--accent)' : '#444'}"></div>
        </div>
      `;
    }).join('');
  });
}

function startPrivate(target) {
  if (target === myUsername) return;
  activePrivateUser = target;
  document.getElementById('chat-title').innerText = `Chat with ${target}`;
  document.getElementById('back-btn').style.display = 'inline-block';
  applyFilter();
}

function exitPrivate() {
  activePrivateUser = null;
  document.getElementById('chat-title').innerText = "Chat";
  document.getElementById('back-btn').style.display = 'none';
  applyFilter();
  scrollToBottomInstant();
}

function applyFilter() {
  const query = document.getElementById('s-content').value.toLowerCase();
  const userQ = document.getElementById('s-user').value.toLowerCase();
  const sort = document.getElementById('s-sort').value;

  let filtered = fullHistory.filter(m => {
    const isGlobalView = !activePrivateUser && (!m.to || m.to === 'global');
    const isPrivateView = activePrivateUser && (
      (m.user === myUsername && m.to === activePrivateUser) ||
      (m.user === activePrivateUser && m.to === myUsername)
    );
    return isGlobalView || isPrivateView;
  });

  filtered = filtered.filter(m => m.msg && m.msg.toLowerCase().includes(query) && m.user && m.user.toLowerCase().includes(userQ));
  
  if(sort === 'new') filtered.sort((a,b) => new Date(a.ts) - new Date(b.ts));
  else filtered.sort((a,b) => new Date(b.ts) - new Date(a.ts));

  document.getElementById('messages').innerHTML = filtered.map(m => {
    const isOwn = m.user === myUsername;
    const isEdited = m.hasOwnProperty('edited') ? m.edited : false;
    const hasReply = m.hasOwnProperty('replyTo') ? m.replyTo : null;
    
    const canDelete = myRole === 'admin' || isOwn;
    const canEdit = isOwn;

    const actionButtons = `
      <div style="display:inline-block; margin-left:8px;">
        ${canEdit ? `<button onclick="editMsg('${m._id}', '${escapeHtml(m.msg)}')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.7rem;margin-right:4px;">[Edit]</button>` : ''}
        ${canDelete ? `<button onclick="deleteMsg('${m._id}')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.7rem;">[X]</button>` : ''}
        <button onclick="setReply('${m._id}', '${m.user}', '${escapeHtml(m.msg)}')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.7rem;margin-left:4px;">[Reply]</button>
      </div>
    `;

    const replyContextMark = hasReply ? `
      <div class="reply-box" onclick="scrollToMessage('${m.replyTo.id}')">
        <strong>@${m.replyTo.user}</strong>: ${m.replyTo.text}...
      </div>
    ` : '';

    return `
      <div class="msg ${isOwn ? 'own' : ''}" id="msg-${m._id}">
        <span class="msg-meta">
          <span>${m.user}${m.role === 'admin' ? ' (Owner)' : ''}${isEdited ? ' <small style="font-style:italic;opacity:0.6;">(edited)</small>' : ''}</span>
          ${actionButtons}
        </span>
        ${replyContextMark}
        <span class="msg-content">${escapeHtml(m.msg)}</span>
        <div class="msg-time">${new Date(m.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
      </div>
    `;
  }).join('');
}

function deleteMsg(id) { if(confirm("Delete this message?")) socket.emit('delete message', id); }

function editMsg(id, oldText) {
  const newMsg = prompt("Edit your message:", oldText);
  if (newMsg !== null && newMsg.trim() !== "") {
    socket.emit('edit message', { id, newMsg: newMsg.trim() });
  }
}

function setReply(id, user, text) {
  replyContext = { id, user, text: text.substring(0, 45) };
  document.getElementById('reply-text').innerText = `Replying to @${user}: "${replyContext.text}..."`;
  document.getElementById('reply-preview').style.display = 'flex';
  document.getElementById('msg-input').focus();
}

function cancelReply() {
  replyContext = null;
  document.getElementById('reply-preview').style.display = 'none';
}

function scrollToMessage(id) {
  const el = document.getElementById(`msg-${id}`);
  if(el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function timeoutUser(username) {
  const mins = prompt(`Timeout ${username} for how many minutes?`, "10");
  if (mins) socket.emit('timeout user', { target: username, mins: parseInt(mins, 10) });
}

function terminateAccount(username) {
  if (confirm(`Permanently delete account "${username}" and all their messages? This cannot be undone.`)) {
    socket.emit('delete account', username);
  }
}

function openSettings() { 
  document.getElementById('settings-alert').style.display = 'none';
  document.getElementById('settings-modal').style.display = 'flex'; 
}

function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }

function saveSettings() {
  const newUser = document.getElementById('new-username').value.trim();
  const newPass = document.getElementById('new-password').value.trim();
  if (!newUser && !newPass) return;
  socket.emit('update account', { username: newUser || null, password: newPass || null });
}

function deleteAccount() {
  if (confirm("Are you absolutely sure you want to completely erase your account and clean all your data? This action is fatal.")) {
    socket.emit('delete account', null);
  }
}

function updateBroadcast() {
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

  const data = {
    msg: i.value,
    to: activePrivateUser || 'global',
    replyTo: replyContext
  };

  socket.emit('chat message', data);
  i.value = '';
  cancelReply();
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function doSignOut() { sessionStorage.clear(); location.reload(); }
window.onload = () => { const t = sessionStorage.getItem('tc_token'); if(t) enterChat(t); };