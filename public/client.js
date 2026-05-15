 let authMode = 'login';
  let keyB64 = null;
  let socket = null;

  const authBtn = document.getElementById('auth-btn');
  const authAlert = document.getElementById('auth-alert');

  function switchTab(mode) {
    authMode = mode;
    document.getElementById('tab-login').classList.toggle('active', mode === 'login');
    document.getElementById('tab-register').classList.toggle('active', mode === 'register');
    authBtn.innerText = mode === 'login' ? 'Sign In' : 'Create Account';
  }

  document.getElementById('key-zone').onclick = () => document.getElementById('key-input').click();

  function handleFile(files) {
    const reader = new FileReader();
    reader.onload = e => {
      keyB64 = e.target.result.split(',')[1];
      document.getElementById('key-zone').classList.add('ok');
      document.getElementById('key-label').innerText = "✓ Key Loaded";
    };
    reader.readAsDataURL(files[0]);
  }

  async function doAuth() {
    const username = document.getElementById('f-username').value;
    const password = document.getElementById('f-password').value;
    if (!username || !password || !keyB64) return alert("Fill all fields and upload Key File");

    authBtn.disabled = true;
    try {
      const res = await fetch('/auth/' + authMode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, keyFile: keyB64 })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      sessionStorage.setItem('tc_token', data.token);
      enterChat(data.token, data.username);
    } catch (err) {
      authAlert.innerText = err.message;
      authAlert.style.display = 'block';
    } finally {
      authBtn.disabled = false;
    }
  }

  function enterChat(token, username) {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('chat-screen').style.display = 'flex';
    document.getElementById('user-badge').innerText = username;

    socket = io({ auth: { token } });
    socket.on('welcome', ({ history }) => {
      document.getElementById('messages').innerHTML = '';
      history.forEach(appendMessage);
    });
    socket.on('chat message', appendMessage);
    socket.on('kicked', (msg) => { alert(msg); doSignOut(); });
  }

  function appendMessage(msg) {
    const div = document.createElement('div');
    div.className = 'msg';
    div.innerText = `${msg.user}: ${msg.msg}`;
    const container = document.getElementById('messages');
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function doSend() {
    const input = document.getElementById('msg-input');
    if (!input.value.trim()) return;
    socket.emit('chat message', input.value);
    input.value = '';
  }

  function doSignOut() {
    sessionStorage.removeItem('tc_token');
    location.reload();
  }

  window.onload = () => {
    const token = sessionStorage.getItem('tc_token');
    if (token) enterChat(token, 'User');
  }