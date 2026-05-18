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
  if (m !== 'login' && m !== 'register') return;
  authMode = m;
  cancelReply();
  document.getElementById('tab-login').classList.toggle('active', m==='login');
  document.getElementById('tab-register').classList.toggle('active', m==='register');
  document.getElementById('auth-btn').innerText = m==='login' ? 'Sign In' : 'Create Account';
};

const handleFile = (f) => {
  if (!f || !f[0]) return;
  const r = new FileReader();
  r.onload = e => { 
    if (typeof e.target.result !== 'string') return;
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
    const res = await fetch('/auth/' + encodeURIComponent(authMode), {
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
  if (!token) return;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('chat-screen').style.display = 'flex';
  socket = io({ auth: { token } });

  const msgDiv = document.getElementById('messages');
  msgDiv.addEventListener('scroll', () => {
    const btn = document.getElementById('scroll-bottom-btn');
    if (btn) {
      if (msgDiv.scrollHeight - msgDiv.scrollTop - msgDiv.clientHeight > 1500) {
        btn.style.display = 'block';
      } else {
        btn.style.display = 'none';
      }
    }
  });

  socket.on('welcome', ({ username, role, history }) => { 
    myUsername = username;
    myRole = role;
    document.getElementById('user-badge').innerText = username + (role==='admin' ? ' (Owner)' : '');
    if(role === 'admin') {
      document.getElementById('admin-tools').style.display = 'block';
      const clearBtn = document.getElementById('admin-clear-btn');
      if (clearBtn) clearBtn.style.display = 'inline-block';
    }
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
    const msgDiv = document.getElementById('messages');
    const isNearBottom = msgDiv.scrollHeight - msgDiv.scrollTop - msgDiv.clientHeight < 150;
    
    if (activePrivateUser && msg.user === activePrivateUser && msg.to === myUsername) {
      msg.read = true;
      socket.emit('mark read', activePrivateUser);
    }

    fullHistory.push(msg); 
    applyFilter();
    if (isNearBottom) {
      scrollToBottomInstant();
    }
    if (document.hidden) {
      unreadCount++;
      document.title = `(${unreadCount}) New Messages!`;
    }
    socket.emit('get users');
  });

  socket.on('msg deleted', (id) => {
    fullHistory = fullHistory.filter(m => m._id !== id);
    applyFilter();
  });

  socket.on('msg updated', (updatedMsg) => {
    fullHistory = fullHistory.map(m => m._id === updatedMsg._id ? updatedMsg : m);
    applyFilter();
  });

  socket.on('chat cleared', () => {
    fullHistory = fullHistory.filter(m => m.to !== 'global' && m.to !== undefined);
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
    const container = document.getElementById('user-list');
    container.innerHTML = '';
    
    list.forEach(u => {
      const item = document.createElement('div');
      item.className = 'user-item';
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      item.onclick = () => startPrivate(u.name);

      const leftSide = document.createElement('div');
      const nameSpan = document.createElement('span');
      nameSpan.style.fontWeight = '500';
      nameSpan.textContent = u.name;
      leftSide.appendChild(nameSpan);

      if (u.role === 'admin') {
        const ownerLabel = document.createElement('small');
        ownerLabel.style.color = 'var(--accent)';
        ownerLabel.style.fontWeight = 'bold';
        ownerLabel.textContent = ' (Owner)';
        leftSide.appendChild(ownerLabel);
      }

      if (u.isMuted) {
        const muteLabel = document.createElement('span');
        muteLabel.style.color = 'var(--danger)';
        muteLabel.textContent = ' [Timed Out]';
        leftSide.appendChild(muteLabel);
      }

      if (myRole === 'admin' && u.name !== myUsername) {
        const adminActions = document.createElement('div');
        adminActions.style.marginTop = '4px';
        adminActions.style.display = 'flex';
        adminActions.style.gap = '5px';

        const tBtn = document.createElement('button');
        tBtn.style.background = '#333';
        tBtn.style.fontSize = '10px';
        tBtn.style.color = '#fff';
        tBtn.style.border = 'none';
        tBtn.style.padding = '2px 4px';
        tBtn.style.borderRadius = '3px';
        tBtn.textContent = 'Timeout';
        tBtn.onclick = (e) => { e.stopPropagation(); timeoutUser(u.name); };

        const dBtn = document.createElement('button');
        dBtn.style.background = 'var(--danger)';
        dBtn.style.fontSize = '10px';
        dBtn.style.color = '#fff';
        dBtn.style.border = 'none';
        dBtn.style.padding = '2px 4px';
        dBtn.style.borderRadius = '3px';
        dBtn.textContent = 'Delete Account';
        dBtn.onclick = (e) => { e.stopPropagation(); terminateAccount(u.name); };

        adminActions.appendChild(tBtn);
        adminActions.appendChild(dBtn);
        leftSide.appendChild(adminActions);
      }

      const rightSide = document.createElement('div');
      rightSide.style.display = 'flex';
      rightSide.style.alignItems = 'center';

      if (u.unreadCount && u.unreadCount > 0 && u.name !== activePrivateUser) {
        const badge = document.createElement('span');
        badge.style.background = 'var(--danger, #ff4d4d)';
        badge.style.color = 'white';
        badge.style.borderRadius = '50%';
        badge.style.padding = '2px 6px';
        badge.style.fontSize = '10px';
        badge.style.fontWeight = 'bold';
        badge.style.marginRight = '6px';
        badge.style.display = 'inline-block';
        badge.style.verticalAlign = 'middle';
        badge.textContent = u.unreadCount;
        rightSide.appendChild(badge);
      }

      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.style.background = u.online ? 'var(--accent)' : '#444';
      rightSide.appendChild(dot);

      item.appendChild(leftSide);
      item.appendChild(rightSide);
      container.appendChild(item);
    });
  });
}

function startPrivate(target) {
  if (target === myUsername) return;
  cancelReply();
  activePrivateUser = target;
  document.getElementById('chat-title').innerText = `Chat with ${target}`;
  document.getElementById('back-btn').style.display = 'inline-block';
  
  fullHistory.forEach(m => {
    if (m.user === target && m.to === myUsername) m.read = true;
  });

  socket.emit('mark read', target);
  applyFilter();
  socket.emit('get users');
}

function exitPrivate() {
  cancelReply();
  activePrivateUser = null;
  document.getElementById('chat-title').innerText = "Chat";
  document.getElementById('back-btn').style.display = 'none';
  applyFilter();
  scrollToBottomInstant();
  socket.emit('get users');
}

function applyFilter() {
  const query = document.getElementById('s-content').value.toLowerCase();
  const userQ = document.getElementById('s-user').value.toLowerCase();
  const sort = document.getElementById('s-sort').value;

  let filtered = fullHistory.filter(m => {
    const msgTo = m.to || 'global';
    const isGlobalView = !activePrivateUser && msgTo === 'global';
    const isPrivateView = activePrivateUser && (
      (m.user === myUsername && msgTo === activePrivateUser) ||
      (m.user === activePrivateUser && msgTo === myUsername)
    );
    return isGlobalView || isPrivateView;
  });

  filtered = filtered.filter(m => m.msg && m.msg.toLowerCase().includes(query) && m.user && m.user.toLowerCase().includes(userQ));
  
  if(sort === 'new') filtered.sort((a,b) => new Date(a.ts) - new Date(b.ts));
  else filtered.sort((a,b) => new Date(b.ts) - new Date(a.ts));

  const container = document.getElementById('messages');
  container.innerHTML = '';

  filtered.forEach(m => {
    const isOwn = m.user === myUsername;
    const isEdited = m.hasOwnProperty('edited') ? m.edited : false;
    const hasReply = m.hasOwnProperty('replyTo') ? m.replyTo : null;
    
    const canDelete = myRole === 'admin' || isOwn;
    const canEdit = isOwn;

    const msgElement = document.createElement('div');
    msgElement.className = `msg ${isOwn ? 'own' : ''}`;
    msgElement.id = `msg-${m._id}`;

    const metaSpan = document.createElement('span');
    metaSpan.className = 'msg-meta';

    const labelSpan = document.createElement('span');
    labelSpan.textContent = m.user + (m.role === 'admin' ? ' (Owner)' : '');
    if (isEdited) {
      const ed = document.createElement('small');
      ed.style.fontStyle = 'italic';
      ed.style.opacity = '0.6';
      ed.textContent = ' (edited)';
      labelSpan.appendChild(ed);
    }
    metaSpan.appendChild(labelSpan);

    const actionDiv = document.createElement('div');
    actionDiv.style.display = 'inline-block';
    actionDiv.style.marginLeft = '8px';

    if (canEdit) {
      const eBtn = document.createElement('button');
      eBtn.style.background = 'none'; eBtn.style.border = 'none'; eBtn.style.color = 'var(--accent)';
      eBtn.style.cursor = 'pointer'; eBtn.style.fontSize = '0.7rem'; eBtn.style.marginRight = '4px';
      eBtn.textContent = '[Edit]';
      eBtn.onclick = () => editMsg(m._id, m.msg);
      actionDiv.appendChild(eBtn);
    }

    if (canDelete) {
      const dBtn = document.createElement('button');
      dBtn.style.background = 'none'; dBtn.style.border = 'none'; dBtn.style.color = 'var(--danger)';
      dBtn.style.cursor = 'pointer'; dBtn.style.fontSize = '0.7rem';
      dBtn.textContent = '[X]';
      dBtn.onclick = () => deleteMsg(m._id);
      actionDiv.appendChild(dBtn);
    }

    const rBtn = document.createElement('button');
    rBtn.style.background = 'none'; rBtn.style.border = 'none'; rBtn.style.color = 'var(--text-muted)';
    rBtn.style.cursor = 'pointer'; rBtn.style.fontSize = '0.7rem'; rBtn.style.marginLeft = '4px';
    rBtn.textContent = '[Reply]';
    rBtn.onclick = () => setReply(m._id, m.user, m.msg);
    actionDiv.appendChild(rBtn);

    metaSpan.appendChild(actionDiv);
    msgElement.appendChild(metaSpan);

    if (hasReply) {
      const rBox = document.createElement('div');
      rBox.className = 'reply-box';
      rBox.onclick = () => scrollToMessage(m.replyTo.id);
      
      const strUser = document.createElement('strong');
      strUser.textContent = `@${m.replyTo.user}`;
      rBox.appendChild(strUser);
      
      const rText = document.createTextNode(`: ${m.replyTo.text}...`);
      rBox.appendChild(rText);
      msgElement.appendChild(rBox);
    }

    const contentSpan = document.createElement('span');
    contentSpan.className = 'msg-content';
    contentSpan.textContent = m.msg;
    msgElement.appendChild(contentSpan);

    const timeDiv = document.createElement('div');
    timeDiv.className = 'msg-time';
    timeDiv.textContent = new Date(m.ts).toLocaleString([], {month:'numeric', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'});
    msgElement.appendChild(timeDiv);

    container.appendChild(msgElement);
  });
}

function deleteMsg(id) { if(confirm("Delete this message?")) socket.emit('delete message', id); }

function editMsg(id, oldText) {
  const newMsg = prompt("Edit your message:", oldText);
  if (newMsg !== null && newMsg.trim() !== "") {
    socket.emit('edit message', { id, newMsg: newMsg.trim() });
  }
}

function clearChat() {
  if (confirm("Are you sure you want to completely erase the global chat history for everyone?")) {
    socket.emit('clear chat history');
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
  if (mins) {
    const parseMins = parseInt(mins, 10);
    if(!isNaN(parseMins)) socket.emit('timeout user', { target: username, mins: parseMins });
  }
}

function terminateAccount(username) {
  if (confirm(`Permanently delete account "${username}" and all their messages? This cannot be undone.`)) {
    socket.emit('delete account', username);
  }
}

function openSettings() { 
  document.getElementById('settings-alert').style.display = 'none';
  const modal = document.getElementById('settings-modal');
  
  const container = document.getElementById('dynamic-settings-fields');
  if (container) {
    container.innerHTML = '';
    const uInput = document.createElement('input');
    uInput.type = 'text'; uInput.id = 'new-username'; uInput.placeholder = 'New Username (Optional)'; uInput.autocomplete = 'off';
    const pInput = document.createElement('input');
    pInput.type = 'password'; pInput.id = 'new-password'; pInput.placeholder = 'New Password (Optional)'; pInput.autocomplete = 'off';
    container.appendChild(uInput);
    container.appendChild(pInput);
  }
  
  modal.style.display = 'flex';
}

function closeSettings() { 
  const modal = document.getElementById('settings-modal');
  modal.style.display = 'none'; 
  
  const container = document.getElementById('dynamic-settings-fields');
  if (container) container.innerHTML = '';
}

function saveSettings() {
  const uEl = document.getElementById('new-username');
  const pEl = document.getElementById('new-password');
  const newUser = uEl ? uEl.value.trim() : '';
  const newPass = pEl ? pEl.value.trim() : '';
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
  requestAnimationFrame(() => {
    m.scrollTop = m.scrollHeight;
    const btn = document.getElementById('scroll-bottom-btn');
    if (btn) btn.style.display = 'none';
  });
}

function toggleSearch() { 
  const p = document.getElementById('search-panel');
  p.style.display = p.style.display === 'none' ? 'flex' : 'none';
}

function filterUsers() {
  const q = document.getElementById('user-search').value.toLowerCase();
  document.querySelectorAll('.user-item').forEach(i => {
    i.style.display = i.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
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

function doSignOut() { sessionStorage.clear(); location.reload(); }
window.onload = () => { 
  const container = document.getElementById('dynamic-settings-fields');
  if (container) container.innerHTML = '';

  const t = sessionStorage.getItem('tc_token'); 
  if(t) enterChat(t); 
};