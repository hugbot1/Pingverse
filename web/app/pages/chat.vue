<template>
  <div id="settings-modal" :class="{ visible: settingsOpen }" @pointerdown="backdropPress" @click="backdropClick($event, closeSettings)">
    <div class="modal-content"><h3 class="settings-title">Account Settings</h3><div class="alert" :class="{ visible: settingsError }" role="alert">{{ settingsError }}</div>
      <form @submit.prevent="saveSettings"><input v-model="newUsername" type="text" placeholder="New Username" autocomplete="off"><input v-model="newPassword" type="password" placeholder="New Password" autocomplete="new-password"><button class="btn" type="submit">Update Account</button></form>
      <div class="settings-profile-section"><div class="settings-avatar-row"><img v-if="myHasAvatar" class="user-avatar settings-avatar" crossorigin="use-credentials" :src="`${api.apiUrl}/profile/avatar/${myUsername}?v=${myAvatarVersion}`" alt="Your avatar"><span v-else class="user-avatar settings-avatar user-avatar-fallback">{{ myUsername.charAt(0).toUpperCase() }}</span><input ref="avatarInput" class="attachment-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp" @change="selectAvatar"><button class="btn-ghost-accent" type="button" :disabled="avatarUploading" @click="avatarInput?.click()">{{ avatarUploading ? 'Uploading…' : 'Change Avatar' }}</button></div>
        <form @submit.prevent="saveProfile"><textarea v-model="bioDraft" class="bio-textarea" placeholder="Bio" maxlength="200"></textarea><button class="btn" type="submit">Save Bio</button></form>
      </div>
      <button class="btn btn-danger" type="button" @click="deleteOwnAccount">Delete Account &amp; Data</button><button class="btn btn-outline" type="button" @click="closeSettings">Cancel</button>
    </div>
  </div>

  <dialog ref="profileDialog" class="forward-dialog profile-dialog" @pointerdown="backdropPress" @click="backdropClick($event, closeProfile)"><div class="collection-content"><div v-if="profileUser" class="profile-card"><div class="profile-card-header"><img v-if="profileUser.hasAvatar" class="user-avatar profile-avatar" crossorigin="use-credentials" :src="`${api.apiUrl}/profile/avatar/${profileUser.username}?v=${profileUser.avatarVersion}`" :alt="`${profileUser.username}'s avatar`"><span v-else class="user-avatar profile-avatar user-avatar-fallback">{{ profileUser.username.charAt(0).toUpperCase() }}</span><div><strong>{{ profileUser.username }}</strong><span v-if="profileUser.role === 'admin'" class="user-owner-label">(Owner)</span><div class="user-presence-label">{{ profileStatusLabel }}</div></div></div><p class="profile-bio">{{ profileUser.bio || 'No bio set.' }}</p><p class="profile-meta">Member since {{ new Date(profileUser.createdAt).toLocaleDateString() }}</p></div><p v-else class="empty-state">{{ profileError || 'Loading…' }}</p><div class="forward-dialog-actions"><button v-if="canSaveProfile" class="btn btn-outline" type="button" @click="toggleSavedUser(profileUser.username)">{{ profileSaved ? 'Unsave user' : 'Save user' }}</button><button v-if="canBlockProfile" class="btn btn-outline" type="button" @click="toggleBlockProfile">{{ profileBlocked ? 'Unblock' : 'Block' }}</button><button class="btn btn-outline" type="button" @click="closeProfile">Close</button></div></div></dialog>

  <div id="chat-screen">
    <div class="sidebar">
      <div class="sidebar-header"><input v-model="userSearch" placeholder="Search people..."></div>
      <ChatUserList :users="approvedUsers" :search="userSearch" :active-user="activePrivateUser" :api-url="api.apiUrl" @open="startPrivate" @profile="openProfile" @toggle-save="toggleSavedUser" />
      <div class="sidebar-footer">
        <button v-if="myRole === 'admin'" class="btn-ghost-accent" type="button" @click="go('/admin')">Admin</button>
        <label class="presence-control"><span>Status</span><select v-model="presenceStatus" aria-label="Your presence status" @change="socket?.emit('set presence', presenceStatus)"><option value="online">Online</option><option value="idle">Idle</option><option value="dnd">Do Not Disturb</option></select></label>
        <div class="profile-section" tabindex="0" role="button" title="Manage Account" @click="openSettings" @keydown.enter="openSettings" @keydown.space.prevent="openSettings"><div class="profile-info"><span class="settings-trigger-label"></span><span id="user-badge">{{ myUsername }}{{ myRole === 'admin' ? ' (Owner)' : '' }}</span></div><span class="gear-icon">☺</span></div>
        <div class="logout-row"><button class="logout-link" type="button" @click="signOut">Logout</button></div>
      </div>
    </div>

    <div class="main-chat">
      <div class="chat-header"><div class="chat-header-left"><button class="btn-ghost-accent" :class="{ hidden: !activePrivateUser }" type="button" @click="exitPrivate">Return</button><span>{{ activePrivateUser || 'Pingverse Chat' }}</span></div><div class="logo-container"><img src="/assets/logos/logo.png" alt="Pingverse logo" class="logo-img"></div>
        <div class="chat-header-tools"><button class="btn-ghost-accent" :aria-pressed="String(Boolean(voiceRef?.activeConversation))" @click="voiceRef?.toggleVoice()">{{ voiceRef?.joining ? 'Joining…' : voiceRef?.activeConversation ? 'Leave voice' : 'Join voice' }}</button><button class="btn-ghost-accent" type="button" aria-haspopup="true" :aria-expanded="String(appsMenuOpen)" @click="toolsMenuOpen = false; appsMenuOpen = !appsMenuOpen">Apps</button><div class="header-menu"><button class="btn-ghost-accent" type="button" aria-haspopup="true" :aria-expanded="String(toolsMenuOpen)" @click="appsMenuOpen = false; toolsMenuOpen = !toolsMenuOpen">☰</button><div v-if="appsMenuOpen" class="voice-participant-controls"><button class="btn-ghost-accent" type="button" @click="appsMenuOpen = false; startWikirace()">Wikirace (BETA)</button></div><div v-if="toolsMenuOpen" class="voice-participant-controls"><button id="notifications-btn" class="btn-ghost-accent" type="button" :aria-pressed="String(alertsEnabled)" :disabled="alertsUnavailable" :title="alertsTitle" @click="toggleBrowserAlerts">{{ alertsLabel }}</button><button class="btn-ghost-accent" type="button" @click="toolsMenuOpen = false; openCollection('pins')">Pins</button><button class="btn-ghost-accent" type="button" @click="toolsMenuOpen = false; openCollection('saved')">Saved</button><button class="btn-ghost-accent" type="button" @click="toolsMenuOpen = false; openPoll()">Poll</button><button class="btn-ghost-accent" type="button" @click="toolsMenuOpen = false; toggleSearch()">Search</button><button class="btn-ghost-accent" type="button" @click="toolsMenuOpen = false; startDownload('desktopwin')">Download Pingverse Desktop for Windows</button></div></div></div>
      </div>
      <div id="broadcast-bar" :class="{ visible: announcement.msg, 'important-flash': announcement.important }"><span>{{ announcement.msg }}</span></div>
      <VoiceRoom ref="voiceRef" :socket="socket" :conversation="activePrivateUser || 'global'" :username="myUsername" :role="myRole" />

      <div class="search-panel" :class="{ hidden: !searchActive }"><input ref="searchInput" v-model="searchQuery" type="search" placeholder="Search message text..." aria-label="Search message text" @input="requestSearch"><input v-model="searchAuthor" type="search" placeholder="From user..." aria-label="Filter by sender" @input="requestSearch"><select v-model="searchSort" aria-label="Search result order" @change="requestSearch"><option value="new">Newest First</option><option value="old">Oldest First</option></select><span class="search-result-count" aria-live="polite">{{ searchCount }}</span></div>

      <div id="messages" ref="messageScroller" @scroll="onMessageScroll">
        <MessageItem v-for="message in visibleMessages" :key="message.id" :message="message" :my-username="myUsername" :my-role="myRole" :known-users="approvedUsers" :api-url="api.apiUrl" :picker-open="activeEmojiId === message.id" :picker-anchor="activeEmojiAnchor" @edit="editMessage" @delete="deleteMessage" @reply="setReply" @forward="openForward" @pin="togglePin" @save="toggleSaved" @react="toggleReaction" @jump="scrollToMessage" @toggle-picker="toggleEmojiPicker" @profile="openProfile" @vote="votePoll" @close-poll="closePoll" />
      </div>
      <div class="typing-indicator" aria-live="polite">{{ typingText }}</div>
      <div class="reply-preview-area" :class="{ visible: replyContext }"><span class="reply-preview-text">{{ replyContext ? `Replying to @${replyContext.user}: "${replyContext.text}..."` : '' }}</span><button class="reply-preview-cancel" type="button" @click="replyContext = null">&#10005;</button></div>
      <div class="attachment-tray" :class="{ hidden: !attachments.length }" aria-live="polite"><span v-for="(file, index) in attachments" :key="`${file.name}-${file.lastModified}`" class="attachment-chip">{{ file.name }} ({{ formatFileSize(file.size) }})<button type="button" :aria-label="`Remove ${file.name}`" @click="attachments.splice(index, 1)">×</button></span></div>
      <div class="chat-upload-error" :class="{ visible: chatError }" role="alert" aria-live="assertive">{{ chatError }}</div>
      <form class="input-area" @submit.prevent="sendMessage"><div class="mention-suggestions" :class="{ hidden: !mentionMatches.length }" role="listbox" aria-label="Mention suggestions"><button v-for="(name, index) in mentionMatches" :key="name" class="mention-suggestion" :aria-selected="index === mentionIndex" type="button" @pointerdown.prevent @click="insertMention(name)"><span>@{{ name }}</span><small>{{ index === 0 ? 'Mention user' : '' }}</small></button></div><input ref="attachmentInput" class="attachment-input" type="file" multiple aria-label="Choose files to attach" @change="selectAttachments"><button class="attachment-btn" type="button" aria-label="Attach files" title="Attach files" @click="attachmentInput?.click()">+</button><button class="attachment-btn voice-record-btn" :class="{ recording: voiceRecording }" type="button" :aria-label="voiceRecording ? 'Stop and send voice message' : 'Record voice message'" :title="voiceRecording ? 'Stop and send' : 'Record a voice message'" :disabled="sending && !voiceRecording" @click="voiceRecording ? stopVoiceMessage() : startVoiceMessage()">{{ voiceRecording ? `■ ${formatDuration(voiceSeconds)}` : '🕪' }}</button><button v-if="voiceRecording" class="attachment-btn voice-record-btn" type="button" aria-label="Cancel recording" title="Cancel recording" @click="stopVoiceMessage(true)">✕</button><input ref="messageInput" v-model="draft" placeholder="Type a message..." autocomplete="off" maxlength="500" aria-autocomplete="list" :aria-expanded="String(Boolean(mentionMatches.length))" @input="onDraftInput" @keydown="onDraftKeydown" @blur="stopTyping(); mentionMatches = []"><button class="btn" type="submit" :disabled="sending">Send</button></form>
      <button id="scroll-bottom-btn" :class="{ visible: showScrollButton }" type="button" @click="scrollToBottom">&#8595; New Messages</button>
    </div>
  </div>

  <dialog ref="forwardDialog" class="forward-dialog" @pointerdown="backdropPress" @click="backdropClick($event, closeForward)"><form @submit.prevent="sendForward"><h2>Forward message</h2><div class="forward-preview">{{ forwardingMessage ? `${forwardingMessage.user}: ${forwardingMessage.msg}` : '' }}</div><label for="forward-recipient">Send to</label><select id="forward-recipient" v-model="forwardRecipient" required><option value="global">Global Chat</option><option v-for="user in approvedUsers.filter((entry) => entry.name !== myUsername)" :key="user.name" :value="user.name">{{ user.name }}</option></select><div class="forward-error" role="alert">{{ forwardError }}</div><div class="forward-dialog-actions"><button class="btn btn-outline" type="button" @click="closeForward">Cancel</button><button class="btn" type="submit">Forward</button></div></form></dialog>
  <dialog ref="pollDialog" class="forward-dialog poll-dialog" @pointerdown="backdropPress" @click="backdropClick($event, closePollDialog)"><form @submit.prevent="submitPoll"><h2>Create poll</h2><div class="poll-field"><label for="poll-question">Question</label><input id="poll-question" v-model="pollQuestion" type="text" placeholder="What do you want to ask?" maxlength="200" autocomplete="off" required></div><div class="poll-field"><label>Options</label><div class="poll-option-inputs"><div v-for="(option, index) in pollOptions" :key="index" class="poll-option-input"><input v-model="pollOptions[index]" type="text" :placeholder="`Option ${index + 1}`" :aria-label="`Option ${index + 1}`" maxlength="80" autocomplete="off"><button v-if="pollOptions.length > 2" class="poll-remove" type="button" :aria-label="`Remove option ${index + 1}`" @click="pollOptions.splice(index, 1)">✕</button></div></div><button v-if="pollOptions.length < 10" class="btn-ghost-accent poll-add" type="button" @click="pollOptions.push('')">+ Add option</button></div><label class="poll-multi"><input v-model="pollMulti" type="checkbox"> Allow multiple answers</label><div class="forward-error" role="alert">{{ pollError }}</div><div class="forward-dialog-actions"><button class="btn btn-outline" type="button" @click="closePollDialog">Cancel</button><button class="btn" type="submit">Create poll</button></div></form></dialog>
  <dialog ref="collectionDialog" class="forward-dialog collection-dialog" @pointerdown="backdropPress" @click="backdropClick($event, closeCollection)"><div class="collection-content"><div class="collection-header"><h2>{{ collectionKind === 'saved' ? 'Saved messages' : `Pins in ${activePrivateUser || 'Global Chat'}` }}</h2><button class="btn btn-outline" type="button" @click="collectionDialog?.close()">Close</button></div><div class="collection-items">{{ collectionLoading ? 'Loading…' : '' }}<template v-if="!collectionLoading && !collectionMessages.length">{{ collectionKind === 'saved' ? 'No saved messages yet.' : 'No pinned messages in this chat.' }}</template><button v-for="message in collectionMessages" :key="message.id" class="collection-item" type="button" @click="openCollectedMessage(message)"><strong>{{ message.user }} · {{ conversationLabel(message) }}</strong><span>{{ message.msg }}</span></button></div></div></dialog>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { io } from 'socket.io-client';
import ChatUserList from '~/components/ChatUserList.vue';
import MessageItem from '~/components/MessageItem.vue';
import VoiceRoom from '~/components/VoiceRoom.vue';
import { usePingverseR2 } from '../composables/usePingverseR2';

const api = usePingverseApi(); const r2 = usePingverseR2(); const { showAlert, showConfirm, showPrompt } = useDialogs();
const socket = ref(null);
const voiceRef = ref(null);
const myUsername = ref(''); const myRole = ref('user'); const fullHistory = ref([]); const approvedUsers = ref([]); const activePrivateUser = ref(null); const presenceStatus = ref('online');
const userSearch = ref(''); const draft = ref(''); const attachments = ref([]); const sending = ref(false); const chatError = ref(''); const replyContext = ref(null);
const settingsOpen = ref(false); const settingsError = ref(''); const newUsername = ref(''); const newPassword = ref('');
const myHasAvatar = ref(false); const myAvatarVersion = ref(0); const bioDraft = ref(''); const avatarInput = ref(null); const avatarUploading = ref(false);
const profileDialog = ref(null); const profileUser = ref(null); const profileError = ref('');
const searchActive = ref(false); const searchQuery = ref(''); const searchAuthor = ref(''); const searchSort = ref('new'); const searchResults = ref([]); const searchCount = ref(''); const searchInput = ref(null);
const messageScroller = ref(null); const messageInput = ref(null); const attachmentInput = ref(null); const typingMap = ref(new Map()); const mentionMatches = ref([]); const mentionIndex = ref(0); const unreadCount = ref(0); const showScrollButton = ref(false);
const announcement = ref({ msg: '', important: false }); const alertsEnabled = ref(false); const alertsUnavailable = ref(false); const alertsTitle = ref('Enable browser notifications for direct messages and mentions'); const alertsLabel = ref('Alerts Off');
const activeEmojiId = ref(null); const activeEmojiAnchor = ref(null); const forwardingMessage = ref(null); const forwardRecipient = ref('global'); const forwardError = ref(''); const forwardDialog = ref(null); const collectionDialog = ref(null); const collectionKind = ref(null); const collectionMessages = ref([]); const collectionLoading = ref(false);
let typingTarget = null; let typingStopTimer = null; let searchTimer = null; let activityTimer = 0; let visibilityHandler;
const toolsMenuOpen = ref(false); const appsMenuOpen = ref(false); const pollDialog = ref(null); const pollQuestion = ref(''); const pollOptions = ref(['', '']); const pollMulti = ref(false); const pollError = ref('');
const VOICE_MESSAGE_MAX_SECONDS = 120; const voiceRecording = ref(false); const voiceSeconds = ref(0);
let voiceRecorder = null; let voiceTimer = null; let voiceCancelled = false; let voiceStarting = false; let voiceTarget = 'global';
const typingText = computed(() => { const names = [...(typingMap.value.get(activePrivateUser.value || 'global') || [])]; if (!names.length) return ''; if (names.length === 1) return `${names[0]} is typing…`; return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)} are typing…`; });
const visibleMessages = computed(() => {
  const target = activePrivateUser.value;
  const source = searchActive.value ? searchResults.value : fullHistory.value;
  return source.filter((message) => {
    const to = message.to || 'global';
    const inChat = !target ? to === 'global' : (message.user === myUsername.value && to === target) || (message.user === target && to === myUsername.value);
    return inChat && (message.msg || '').toLowerCase().includes(searchQuery.value.toLowerCase()) && message.user.toLowerCase().includes(searchAuthor.value.toLowerCase());
  }).sort((a, b) => searchActive.value && searchSort.value === 'new' ? b.ts - a.ts || b.id - a.id : a.ts - b.ts || a.id - b.id);
});
const mentionRange = computed(() => {
  const input = messageInput.value; if (!input) return null;
  const caret = input.selectionStart ?? draft.value.length; const before = draft.value.slice(0, caret); const match = /(^|[\s([{])@([A-Za-z0-9_-]{0,20})$/.exec(before);
  return match ? { query: match[2].toLowerCase(), start: caret - match[0].length + match[1].length, end: caret } : null;
});

const profileStatusLabel = computed(() => {
  if (!profileUser.value) return '';
  const labels = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline' };
  const found = approvedUsers.value.find((user) => user.name === profileUser.value.username);
  return labels[found?.presenceStatus] || labels.offline;
});

const profileBlocked = computed(() => Boolean(approvedUsers.value.find((user) => user.name === profileUser.value?.username)?.isBlocked));
const canBlockProfile = computed(() => Boolean(profileUser.value && profileUser.value.username !== myUsername.value && profileUser.value.role !== 'admin'));

const profileSaved = computed(() => Boolean(approvedUsers.value.find((user) => user.name === profileUser.value?.username)?.isSaved));
const canSaveProfile = computed(() => Boolean(profileUser.value && profileUser.value.username !== myUsername.value));

useHead({ title: 'Pingverse' });
function go(path) { window.location.href = path; }
function conversationLabel(message) { return message.to === 'global' ? 'Global Chat' : message.user === myUsername.value ? message.to : message.user; }
function scrollToBottom() { nextTick(() => { if (messageScroller.value) messageScroller.value.scrollTop = messageScroller.value.scrollHeight; showScrollButton.value = false; }); }
function scrollToMessage(id) { document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
function onMessageScroll() { if (!messageScroller.value) return; showScrollButton.value = messageScroller.value.scrollHeight - messageScroller.value.scrollTop - messageScroller.value.clientHeight > 1500; }
function startPrivate(name) {
  if (name === myUsername.value) return; stopTyping(); replyContext.value = null; activePrivateUser.value = name;
  for (const message of fullHistory.value) if (message.user === name && message.to === myUsername.value) message.read = true;
  socket.value?.emit('mark read', name); socket.value?.emit('get users'); requestSearch();
}
function exitPrivate() { stopTyping(); replyContext.value = null; activePrivateUser.value = null; socket.value?.emit('get users'); requestSearch(); scrollToBottom(); }
function setReply(message) { replyContext.value = { id: message.id, user: message.user, text: (message.msg || '').substring(0, 45) }; messageInput.value?.focus(); }
function onDraftInput() { updateMentionMatches(); if (draft.value.trim()) indicateTyping(); else stopTyping(); }
function updateMentionMatches() { const range = mentionRange.value; mentionMatches.value = range ? approvedUsers.value.map((user) => user.name).filter((name) => name !== myUsername.value && name.toLowerCase().startsWith(range.query)).slice(0, 6) : []; mentionIndex.value = Math.min(mentionIndex.value, Math.max(0, mentionMatches.value.length - 1)); }
function insertMention(name) { const range = mentionRange.value; const input = messageInput.value; if (!range || !input) return; const text = `@${name} `; input.setRangeText(text, range.start, range.end, 'end'); draft.value = input.value; mentionMatches.value = []; input.focus(); indicateTyping(); }
function onDraftKeydown(event) { if (event.key === 'Escape' && mentionMatches.value.length) { mentionMatches.value = []; return; } if (!mentionMatches.value.length) return; if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); mentionIndex.value = (mentionIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + mentionMatches.value.length) % mentionMatches.value.length; } else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); insertMention(mentionMatches.value[mentionIndex.value]); } }
function indicateTyping() { const target = activePrivateUser.value || 'global'; if (!socket.value) return; if (typingTarget && typingTarget !== target) stopTyping(); if (!typingTarget) { typingTarget = target; socket.value.emit('typing', { to: target, isTyping: true }); } clearTimeout(typingStopTimer); typingStopTimer = setTimeout(stopTyping, 1400); }
function stopTyping() { clearTimeout(typingStopTimer); if (typingTarget) socket.value?.emit('typing', { to: typingTarget, isTyping: false }); typingTarget = null; }
function selectAttachments(event) {
  for (const file of event.target.files || []) { if (attachments.value.length >= 4) { showError('You can attach up to 4 files to one message.'); break; } if (file.size > 10 * 1024 * 1024) { showError(`${file.name} is larger than the 10 MB limit.`); continue; } if (!attachments.value.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) attachments.value.push(file); }
  event.target.value = '';
}
function formatFileSize(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function showError(message) { chatError.value = message; window.setTimeout(() => { chatError.value = ''; }, 4000); }
async function uploadAttachment(file) { const response = await fetch(`${api.apiUrl}/media/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Type': file.type }, body: file }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || `Could not upload ${file.name}.`); return result.attachment; }
async function sendMessage() {
  if (sending.value || (!draft.value.trim() && !attachments.value.length) || !socket.value) return;
  stopTyping(); sending.value = true; chatError.value = '';
  try { const uploaded = []; for (const file of attachments.value) uploaded.push(await uploadAttachment(file)); socket.value.emit('chat message', { msg: draft.value.trim(), attachments: uploaded, to: activePrivateUser.value || 'global', replyTo: replyContext.value }); draft.value = ''; attachments.value = []; replyContext.value = null; mentionMatches.value = []; }
  catch (error) { showError(error.message || 'The files could not be uploaded.'); } finally { sending.value = false; }
}
function formatDuration(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
async function startVoiceMessage() {
  if (voiceRecording.value || voiceStarting || sending.value || !socket.value) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { showError('Voice messages are not supported in this browser.'); return; }
  voiceStarting = true;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { showError('Allow microphone access to record voice messages.'); return; }
  finally { voiceStarting = false; }
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
  const chunks = [];
  voiceCancelled = false; voiceTarget = activePrivateUser.value || 'global';
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = () => {
    for (const track of stream.getTracks()) track.stop();
    clearInterval(voiceTimer); voiceRecording.value = false; voiceSeconds.value = 0; voiceRecorder = null;
    if (!voiceCancelled && chunks.length) sendVoiceMessage(new Blob(chunks, { type: recorder.mimeType }), voiceTarget);
  };
  recorder.start(); voiceRecorder = recorder; voiceRecording.value = true; voiceSeconds.value = 0;
  voiceTimer = setInterval(() => { voiceSeconds.value++; if (voiceSeconds.value >= VOICE_MESSAGE_MAX_SECONDS) stopVoiceMessage(); }, 1000);
}
function stopVoiceMessage(cancel = false) { voiceCancelled = cancel; if (voiceRecorder?.state === 'recording') voiceRecorder.stop(); }
async function sendVoiceMessage(blob, target) {
  if (!socket.value) return;
  const type = (blob.type || 'audio/webm').split(';')[0];
  const extension = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' }[type] || 'webm';
  sending.value = true; chatError.value = '';
  try {
    const uploaded = await uploadAttachment(new File([blob], `voice-message.${extension}`, { type }));
    const sameChat = (activePrivateUser.value || 'global') === target;
    socket.value.emit('chat message', { msg: '', attachments: [uploaded], to: target, replyTo: sameChat ? replyContext.value : null });
    if (sameChat) replyContext.value = null;
  } catch (error) { showError(error.message || 'The voice message could not be sent.'); } finally { sending.value = false; }
}
let backdropPressTarget = null;
function backdropPress(event) { backdropPressTarget = event.target; }
function backdropClick(event, close) {
  const host = event.currentTarget;
  if (event.target !== host || backdropPressTarget !== host) return;
  if (host.tagName === 'DIALOG') {
    const rect = host.getBoundingClientRect();
    if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) return;
  }
  close();
}
function closePopups(event) {
  if (event.type === 'keydown') {
    if (event.key === 'Escape') {
      toolsMenuOpen.value = false;
      appsMenuOpen.value = false;
    }
    return;
  }
  const target = event.target;
  if (!target.closest?.('.header-menu')) {
    toolsMenuOpen.value = false;
    appsMenuOpen.value = false;
  }
  if (target !== messageInput.value && !target.closest?.('.mention-suggestions')) mentionMatches.value = [];
}
function openPoll() { pollQuestion.value = ''; pollOptions.value = ['', '']; pollMulti.value = false; pollError.value = ''; pollDialog.value?.showModal(); }
function closePollDialog() { pollDialog.value?.close(); }
function submitPoll() {
  const options = pollOptions.value.map((option) => option.trim()).filter(Boolean);
  socket.value?.emit('create poll', { question: pollQuestion.value.trim(), options, multi: pollMulti.value, to: activePrivateUser.value || 'global' }, (result) => result?.ok ? closePollDialog() : pollError.value = result?.error || 'Could not create the poll.');
}
function votePoll(id, option) { socket.value?.emit('vote poll', { id: String(id), option }, (result) => { if (!result?.ok) showAlert(result?.error || 'Could not record your vote.'); }); }
async function closePoll(id) { if (!await showConfirm('Close this poll? Nobody will be able to vote after this.', { confirmText: 'Close poll' })) return; socket.value?.emit('close poll', String(id), (result) => { if (!result?.ok) showAlert(result?.error || 'Could not close the poll.'); }); }
function requestSearch() { clearTimeout(searchTimer); if (!searchActive.value || !socket.value) return; searchCount.value = 'Searching…'; searchTimer = setTimeout(() => socket.value?.emit('search messages', { to: activePrivateUser.value || 'global', query: searchQuery.value, author: searchAuthor.value, sort: searchSort.value, requestId: ++searchRequestId }), 180); }
let searchRequestId = 0;
function toggleSearch() { searchActive.value = !searchActive.value; if (searchActive.value) { nextTick(() => searchInput.value?.focus()); requestSearch(); } else { searchResults.value = []; searchCount.value = ''; } }
function startDownload(app) { if (app === 'desktopwin') window.open(`${r2.r2Url}/PingverseSetup.exe`, '_blank'); }
function startWikirace() { window.open(`https://wikirace-app.pingverse.site/?createMatch=true&name=${encodeURIComponent(myUsername.value)}`, 'Pingverse - Wikirace', 'width=600,height=400,left=100,top=100,resizable=yes,scrollbars=yes'); }
function openForward(message) { forwardingMessage.value = message; forwardRecipient.value = 'global'; forwardError.value = ''; nextTick(() => forwardDialog.value?.showModal()); }
function closeForward() { forwardDialog.value?.close(); forwardingMessage.value = null; }
function sendForward() { if (!forwardingMessage.value) return; socket.value?.emit('forward message', { id: forwardingMessage.value.id, to: forwardRecipient.value }, (result) => result?.ok ? closeForward() : forwardError.value = result?.error || 'Could not forward this message.'); }
function openCollection(kind) { collectionKind.value = kind; collectionMessages.value = []; collectionLoading.value = true; collectionDialog.value?.showModal(); if (kind === 'saved') socket.value?.emit('get saved messages'); else socket.value?.emit('get pinned messages', { to: activePrivateUser.value || 'global' }); }
function closeCollection() { collectionDialog.value?.close(); collectionKind.value = null; }
function openCollectedMessage(message) { closeCollection(); if (message.to === 'global') { if (activePrivateUser.value) exitPrivate(); } else { const peer = message.user === myUsername.value ? message.to : message.user; if (activePrivateUser.value !== peer) startPrivate(peer); } searchQuery.value = ''; searchAuthor.value = ''; if (!fullHistory.value.some((entry) => entry.id === message.id)) fullHistory.value.push(message); nextTick(() => scrollToMessage(message.id)); }
function toggleEmojiPicker(id, anchor) { activeEmojiId.value = activeEmojiId.value === id ? null : id; activeEmojiAnchor.value = activeEmojiId.value ? anchor : null; }
function toggleReaction(id, emoji) { socket.value?.emit('toggle reaction', { id, emoji }); }
function togglePin(id) { socket.value?.emit('toggle pin', { id: String(id) }, (result) => { if (!result?.ok) showAlert(result?.error || 'Could not update the pin.'); }); }
function toggleSaved(id) { socket.value?.emit('toggle saved message', { id: String(id) }, (result) => { if (!result?.ok) showAlert(result?.error || 'Could not update saved messages.'); }); }
async function editMessage(message) { const text = await showPrompt('Edit your message:', message.msg, { confirmText: 'Save' }); if (text?.trim()) socket.value?.emit('edit message', { id: message.id, newMsg: text.trim() }); }
async function deleteMessage(id) { if (await showConfirm('Delete this message?', { confirmText: 'Delete', danger: true })) socket.value?.emit('delete message', id); }
function openSettings() { settingsError.value = ''; newUsername.value = ''; newPassword.value = ''; settingsOpen.value = true; }
function closeSettings() { settingsOpen.value = false; }
function saveSettings() { const username = newUsername.value.trim(); const password = newPassword.value.trim(); if (!username && !password) return; if (password && password.length < 8) { settingsError.value = 'New password must be at least 8 characters.'; return; } socket.value?.emit('update account', { username: username || null, password: password || null }); }
async function deleteOwnAccount() { if (await showConfirm('Are you absolutely sure you want to completely erase your account and all your data? This action is fatal.', { confirmText: 'Delete everything', danger: true })) socket.value?.emit('delete account', null); }
function saveProfile() { socket.value?.emit('update profile', { bio: bioDraft.value.trim() }); }
async function selectAvatar(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { settingsError.value = 'Avatars must be 2 MB or smaller.'; return; }
  avatarUploading.value = true; settingsError.value = '';
  try {
    const response = await fetch(`${api.apiUrl}/profile/avatar`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Type': file.type }, body: file });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The avatar could not be uploaded.');
    myHasAvatar.value = true; myAvatarVersion.value = result.avatarVersion;
  } catch (error) { settingsError.value = error.message; }
  finally { avatarUploading.value = false; }
}
async function openProfile(username) {
  profileUser.value = null; profileError.value = ''; profileDialog.value?.showModal();
  try { profileUser.value = await api.get(`/profile/${encodeURIComponent(username)}`); }
  catch (error) { profileError.value = error.message; }
}
function closeProfile() { profileDialog.value?.close(); profileUser.value = null; }
function toggleSavedUser(name) {
  const saved = approvedUsers.value.find((user) => user.name === name)?.isSaved;
  socket.value?.emit(saved ? 'unsave user' : 'save user', name, (result) => { if (!result?.ok) showAlert(result?.error || 'Could not update saved users.'); });
}
async function toggleBlockProfile() {
  const name = profileUser.value?.username; if (!name) return;
  const block = !profileBlocked.value;
  if (block && !await showConfirm(`Block ${name}?`, { confirmText: 'Block', danger: true })) return;
  socket.value?.emit(block ? 'block user' : 'unblock user', name, (result) => { if (!result?.ok) showAlert(result?.error || 'Could not update the block.'); });
}
async function signOut() { try { await api.post('/auth/logout', {}); } catch { /* if api cant be reached */ } go('/'); }
function messageMentionsUser(message, username) { const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(`(^|[^A-Za-z0-9_-])@${escaped}(?![A-Za-z0-9_-])`, 'i').test(message || ''); }
function setAlertsState() { const supported = 'Notification' in window; alertsUnavailable.value = !supported || Notification.permission === 'denied'; alertsEnabled.value = supported && Notification.permission === 'granted' && localStorage.getItem('pingverse.browser-alerts') === 'on'; alertsLabel.value = !supported ? 'Alerts Unavailable' : Notification.permission === 'denied' ? 'Alerts Blocked' : alertsEnabled.value ? 'Alerts On' : 'Alerts Off'; alertsTitle.value = alertsEnabled.value ? 'Turn browser notifications off' : 'Enable browser notifications for direct messages and mentions'; }
async function toggleBrowserAlerts() { if (!('Notification' in window) || Notification.permission === 'denied') return setAlertsState(); let permission = Notification.permission; if (permission === 'granted' && localStorage.getItem('pingverse.browser-alerts') === 'on') localStorage.setItem('pingverse.browser-alerts', 'off'); else { try { if (permission === 'default') permission = await Notification.requestPermission(); } catch { permission = 'denied'; } localStorage.setItem('pingverse.browser-alerts', permission === 'granted' ? 'on' : 'off'); } setAlertsState(); }
function notify(message, mentioned) { if (!('Notification' in window) || Notification.permission !== 'granted' || localStorage.getItem('pingverse.browser-alerts') !== 'on') return; const title = mentioned ? `${message.user} mentioned you in ${conversationLabel(message)}` : `New message from ${message.user}`; try { const notification = new Notification(title, { body: message.msg.slice(0, 180), tag: `pingverse-${message.id}` }); notification.onclick = () => { window.focus(); if (message.to === 'global') { if (activePrivateUser.value) exitPrivate(); } else { const peer = message.user === myUsername.value ? message.to : message.user; if (activePrivateUser.value !== peer) startPrivate(peer); } nextTick(() => scrollToMessage(message.id)); notification.close(); }; } catch { /* will be blocked */ } }

function onVisibilityChange() { if (!document.hidden) { unreadCount.value = 0; document.title = 'Pingverse'; } }
function onStatusChange() { socket.value?.emit('get users'); }
function onActivity() { const now = Date.now(); if (now - activityTimer > 30000) { activityTimer = now; socket.value?.emit('presence activity'); } }
function connect() {
  const client = io(api.apiUrl, { withCredentials: true }); socket.value = client;
  client.on('connect_error', (error) => { console.error('Could not connect to the chat server:', error?.message || error); if (error?.message === 'Unauthorized') go('/'); });
  client.on('welcome', (data) => { myUsername.value = data.username; myRole.value = data.role; fullHistory.value = data.history || []; bioDraft.value = data.bio || ''; myHasAvatar.value = Boolean(data.hasAvatar); myAvatarVersion.value = data.avatarVersion || 0; client.emit('get users'); nextTick(scrollToBottom); });
  client.on('profile saved', ({ bio }) => { bioDraft.value = bio; settingsError.value = ''; });
  client.on('history reload', (history) => { fullHistory.value = history || []; if (searchActive.value) requestSearch(); });
  client.on('presence status', (value) => { if (['online', 'idle', 'dnd'].includes(value)) presenceStatus.value = value; });
  client.on('user list', (list) => { approvedUsers.value = list; }); client.on('user list update', () => client.emit('get users')); client.on('status change', () => client.emit('get users'));
  client.on('chat message', (message) => {
    const incoming = message.user !== myUsername.value; const privateMessage = message.to !== 'global'; const conversation = privateMessage ? (message.user === myUsername.value ? message.to : message.user) : 'global'; const open = privateMessage ? activePrivateUser.value === conversation : !activePrivateUser.value;
    if (activePrivateUser.value && message.user === activePrivateUser.value && message.to === myUsername.value) { message.read = true; client.emit('mark read', activePrivateUser.value); }
    const nearBottom = messageScroller.value ? messageScroller.value.scrollHeight - messageScroller.value.scrollTop - messageScroller.value.clientHeight < 150 : true;
    fullHistory.value.push(message); if (searchActive.value && message.to === (activePrivateUser.value || 'global')) requestSearch();
    const mention = incoming && messageMentionsUser(message.msg, myUsername.value);
    if (incoming && (privateMessage || mention) && (!open || document.hidden || !document.hasFocus())) { unreadCount.value++; document.title = `(${unreadCount.value}) Pingverse`; notify(message, mention); }
    if (message.to === (activePrivateUser.value || 'global') && nearBottom) scrollToBottom(); else if (message.to === (activePrivateUser.value || 'global') && messageScroller.value && messageScroller.value.scrollHeight - messageScroller.value.scrollTop - messageScroller.value.clientHeight > 1500) showScrollButton.value = true;
  });
  client.on('msg updated', (updated) => { const index = fullHistory.value.findIndex((message) => message.id === updated.id); if (index !== -1) fullHistory.value[index] = { ...fullHistory.value[index], ...updated }; if (searchActive.value) requestSearch(); });
  client.on('msg deleted', (id) => { fullHistory.value = fullHistory.value.filter((message) => message.id !== id); if (searchActive.value) requestSearch(); });
  client.on('message search results', (data) => { if (!searchActive.value || data.requestId !== searchRequestId || data.to !== (activePrivateUser.value || 'global')) return; searchResults.value = data.results || []; searchCount.value = `${searchResults.value.length} result${searchResults.value.length === 1 ? '' : 's'}${data.limited ? ' (showing up to 200)' : ''}`; });
  client.on('typing', ({ username, to, isTyping }) => { if (!username || username === myUsername.value || typeof isTyping !== 'boolean') return; const users = new Set(typingMap.value.get(to) || []); isTyping ? users.add(username) : users.delete(username); if (users.size) typingMap.value.set(to, users); else typingMap.value.delete(to); });
  client.on('pin changed', ({ id, pinned, pinnedBy, pinnedAt }) => { const message = fullHistory.value.find((item) => item.id === id); if (message) Object.assign(message, { pinned, pinnedBy, pinnedAt }); if (collectionKind.value === 'pins' && collectionDialog.value?.open) client.emit('get pinned messages', { to: activePrivateUser.value || 'global' }); });
  client.on('saved status', ({ id, saved }) => { const message = fullHistory.value.find((item) => item.id === id); if (message) message.saved = saved; if (collectionKind.value === 'saved' && collectionDialog.value?.open) client.emit('get saved messages'); });
  client.on('pinned messages', ({ to, messages }) => { if (collectionKind.value === 'pins' && to === (activePrivateUser.value || 'global') && collectionDialog.value?.open) { collectionMessages.value = messages || []; collectionLoading.value = false; } });
  client.on('saved messages', (messages) => { if (collectionKind.value === 'saved' && collectionDialog.value?.open) { collectionMessages.value = messages || []; collectionLoading.value = false; } });
  client.on('chat cleared', () => { fullHistory.value = fullHistory.value.filter((message) => message.to !== 'global'); });
  client.on('user purged', (name) => { fullHistory.value = fullHistory.value.filter((message) => message.user !== name && message.to !== name); for (const [to, names] of typingMap.value) { const next = new Set(names); next.delete(name); typingMap.value.set(to, next); } if (activePrivateUser.value === name) exitPrivate(); });
  client.on('announcement', (value) => { announcement.value = value?.msg ? value : { msg: '', important: false }; });
  client.on('user status alert', ({ target, muted, until }) => { if (target === myUsername.value && muted) showAlert(`You have been timed out until ${new Date(until).toLocaleTimeString()}.`); client.emit('get users'); });
  client.on('error notice', (message) => showAlert(message));
  client.on('settings success', async (message) => { await showAlert(message); closeSettings(); go('/'); });
  client.on('settings error', (message) => { settingsError.value = message; });
  client.on('force logout', async () => { await showAlert('Your session has ended.'); go('/'); });
  client.on('disconnect', (reason) => console.warn(`Disconnected from chat server (${reason || 'unknown reason'}); Socket.IO will retry automatically.`));
}

onMounted(async () => {
  document.addEventListener('pointerdown', closePopups); document.addEventListener('keydown', closePopups);
  try { const me = await api.get('/auth/me'); if (!me?.username) return go('/'); connect(); setAlertsState(); }
  catch { go('/'); }
  visibilityHandler = onVisibilityChange; document.addEventListener('visibilitychange', visibilityHandler); for (const event of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll']) document.addEventListener(event, onActivity, { passive: true });
});
onBeforeUnmount(() => { document.removeEventListener('pointerdown', closePopups); document.removeEventListener('keydown', closePopups); stopVoiceMessage(true); clearInterval(voiceTimer); stopTyping(); clearTimeout(searchTimer); document.removeEventListener('visibilitychange', visibilityHandler); for (const event of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll']) document.removeEventListener(event, onActivity); socket.value?.disconnect(); });
</script>