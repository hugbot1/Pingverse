<template>
  <header class="admin-header">
    <div class="admin-header-left"><img src="/assets/logos/logo.png" alt="Pingverse logo" class="logo-img">
      <h1 class="admin-title">Admin</h1>
    </div>
    <div class="admin-header-right"><span class="admin-name">{{ adminName }}</span><button class="btn-ghost-accent"
        type="button" @click="refreshAll">Refresh</button><button class="btn-ghost-accent" type="button"
        @click="go('/chat')">Back to Chat</button><button class="btn-ghost-accent" type="button"
        @click="signOut">Logout</button></div>
  </header>
  <main class="admin-main">
    <div class="alert" :class="{ visible: alertMessage }" role="alert">{{ alertMessage }}</div>
    <section class="panel">
      <h2 class="panel-title">Pending Approvals <span class="count-badge" :class="{ hidden: !pending.length }">{{
        pending.length }}</span></h2>
      <div class="table-wrap">
        <table v-if="pending.length" class="admin-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Requested</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in pending" :key="user.username">
              <td>{{ user.username }}</td>
              <td>{{ formatTime(user.createdAt) }}</td>
              <td>
                <div class="cell-actions"><button class="small-btn primary"
                    @click="run(() => api.post('/admin/users/approve', { username: user.username }))">Approve</button><button
                    class="small-btn danger" @click="reject(user.username)">Reject</button></div>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty-state">No accounts are waiting for approval.</p>
      </div>
    </section>
    <section class="panel">
      <h2 class="panel-title">Users</h2>
      <div class="table-wrap">
        <table v-if="approved.length" class="admin-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in approved" :key="user.username">
              <td>{{ user.username }}</td>
              <td><span class="tag" :class="{ admin: user.role === 'admin' }">{{ user.role === 'admin' ? 'Owner/Admin' :
                'User' }}</span></td>
              <td><span class="tag" :class="{ warn: isTimedOut(user) }">{{ isTimedOut(user) ? `Timed out until ${new
                Date(user.mutedUntil).toLocaleTimeString()}` : 'Active' }}</span></td>
              <td>{{ formatTime(user.createdAt) }}</td>
              <td><span v-if="user.role === 'admin'" class="tag">Protected</span>
                <div v-else class="cell-actions"><button class="small-btn neutral"
                    @click="timeout(user.username)">Timeout</button><button v-if="isTimedOut(user)"
                    class="small-btn neutral"
                    @click="run(() => api.post('/admin/users/untimeout', { username: user.username }))">End
                    Timeout</button><button class="small-btn neutral" @click="resetProfile(user.username)">Reset
                    Profile</button><button class="small-btn danger" @click="deleteUser(user.username)">Delete</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty-state">No approved users yet.</p>
      </div>
    </section>
    <section class="panel">
      <h2 class="panel-title">Announcement Banner</h2>
      <form class="inline-form" @submit.prevent="publishAnnouncement"><input v-model="announcement"
          placeholder="Message" maxlength="300"><label class="check-label"><input v-model="important"
            type="checkbox"><span>Important</span></label><button class="small-btn primary"
          type="submit">Publish</button><button class="small-btn neutral" type="button"
          @click="clearAnnouncement">Remove Banner</button></form>
    </section>
    <section class="panel">
      <h2 class="panel-title">Global Chat</h2>
      <div class="panel-actions"><button class="small-btn danger" type="button" @click="clearChat">Erase All Global
          Messages</button></div>
      <div class="table-wrap">
        <table v-if="messages.length" class="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Message</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="message in messages" :key="message.id">
              <td>{{ formatTime(message.ts) }}</td>
              <td>{{ message.user }}</td>
              <td class="wrap-text">{{ message.msg }}</td>
              <td><button class="small-btn danger" @click="deleteMessage(message)">Delete</button></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty-state">The global chat is empty.</p>
      </div>
    </section>
    <section class="panel">
      <h2 class="panel-title">Audit Log</h2>
      <div class="table-wrap">
        <table v-if="audit.length" class="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Target</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(entry, i) in audit" :key="`${entry.ts}-${i}`">
              <td>{{ formatTime(entry.ts) }}</td>
              <td>{{ entry.actor }}</td>
              <td>{{ entry.action.replaceAll('_', ' ') }}</td>
              <td>{{ entry.target || '-' }}</td>
              <td>{{ entry.detail || '-' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty-state">No activity yet.</p>
      </div>
    </section>
  </main>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';

const api = usePingverseApi();
const { showAlert, showConfirm, showPrompt } = useDialogs();
const adminName = ref('');
const pending = ref([]);
const approved = ref([]);
const messages = ref([]);
const audit = ref([]);
const alertMessage = ref('');
const announcement = ref('');
const important = ref(false);
let refreshTimer;

useHead({ title: 'Pingverse', bodyAttrs: { class: 'admin-page' } });

const formatTime = (timestamp) => new Date(timestamp).toLocaleString();
const isTimedOut = (user) => user.mutedUntil && user.mutedUntil > Date.now();
const go = (path) => { window.location.href = path; };

async function refreshAll() {
  try {
    const me = await api.get('/auth/me');
    if (!me?.username) return go('/');
    if (me.role !== 'admin') return go('/chat');
    adminName.value = me.username;
    const [users, nextMessages, nextAudit] = await Promise.all([
      api.get('/admin/users'), api.get('/admin/messages'), api.get('/admin/audit'),
    ]);
    pending.value = users.filter((user) => user.status === 'pending');
    approved.value = users.filter((user) => user.status === 'approved');
    messages.value = nextMessages;
    audit.value = nextAudit;
    alertMessage.value = '';
  } catch (error) {
    alertMessage.value = error.message;
  }
}

async function run(action, refresh = true) {
  try {
    await action();
    if (refresh) await refreshAll();
    return true;
  } catch (error) {
    await showAlert(error.message);
    return false;
  }
}

async function reject(username) {
  if (await showConfirm(`Reject and remove the request from "${username}"?`, { confirmText: 'Reject', danger: true })) run(() => api.post('/admin/users/reject', { username }));
}

async function timeout(username) {
  const answer = await showPrompt(`Time out ${username} for how many minutes?`, '10', { confirmText: 'Time out' });
  if (answer === null) return;
  const mins = Number.parseInt(answer, 10);
  if (Number.isNaN(mins) || mins < 1 || mins > 10080) return showAlert('Enter a whole number of minutes between 1 and 10080.');
  run(() => api.post('/admin/users/timeout', { username, mins }));
}

async function resetProfile(username) {
  if (await showConfirm(`Clear "${username}"'s avatar and bio?`, { confirmText: 'Clear profile', danger: true })) run(() => api.post('/admin/users/reset-profile', { username }));
}

async function deleteUser(username) {
  if (await showConfirm(`Permanently delete "${username}" and all of their messages? This cannot be undone.`, { confirmText: 'Delete user', danger: true })) run(() => api.post('/admin/users/delete', { username }));
}

async function deleteMessage(message) {
  if (await showConfirm(`Delete this message from "${message.user}"?`, { confirmText: 'Delete', danger: true })) run(() => api.post('/admin/messages/delete', { id: message.id }));
}

async function clearChat() {
  if (await showConfirm('Erase the ENTIRE global chat history for everyone? This cannot be undone.', { confirmText: 'Erase everything', danger: true })) run(() => api.post('/admin/chat/clear', {}));
}

async function publishAnnouncement() {
  const text = announcement.value.trim();
  if (!text) return showAlert('Type a message first, or use "Remove Banner" to clear it.');
  if (!await run(() => api.post('/admin/announcement', { msg: text, important: important.value }), false)) return;
  announcement.value = '';
  important.value = false;
}

function clearAnnouncement() { run(() => api.post('/admin/announcement', { msg: '', important: false }), false); }

async function signOut() {
  try { await api.post('/auth/logout', {}); } catch { /* expires on own */ }
  go('/');
}

onMounted(async () => {
  await refreshAll();
  refreshTimer = window.setInterval(() => { if (!document.hidden) refreshAll(); }, 15000);
});
onUnmounted(() => window.clearInterval(refreshTimer));
</script>