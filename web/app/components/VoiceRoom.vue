<template>
  <section class="voice-room-panel" :class="{ hidden: !panelVisible }" aria-label="Voice room">
    <div class="voice-room-heading"><strong>{{ panelTitle }}</strong><span aria-live="polite">{{ statusText }}</span>
    </div>
    <div class="voice-room-participants">
      <div v-if="activeConversation" class="voice-participant-card"
        :class="{ speaking: localSpeaking && !muted && !forcedMuted }">
        <span class="voice-participant-name">{{ username }} (you)</span><span class="voice-participant-activity">{{
          forcedMuted ? 'Muted by admin' : muted ? 'Muted' : 'Microphone on' }}</span>
        <div class="voice-participant-menu"><button type="button" @click="toggleMenu('local')">Controls</button>
          <div v-if="openMenuId === 'local'" class="voice-participant-controls"><button
              class="btn-ghost-accent voice-local-mute" :disabled="!localStream || forcedMuted"
              @click="toggleSelfMute">{{ forcedMuted ? 'Muted by admin' : muted ? 'Unmute microphone' : 'Mute
              microphone' }}</button></div>
        </div>
      </div>
      <div v-for="[id, info] in peerInfo" :key="id" class="voice-participant-card"
        :class="{ speaking: info.speaking && !info.adminMuted }">
        <div class="voice-participant-identity"><span class="voice-participant-name">{{ info.username }}</span><span
            class="voice-participant-activity">{{ info.adminMuted ? 'Muted by admin' : info.localMuted ? 'Muted for you'
              : 'Connected' }}</span></div>
        <div class="voice-participant-menu"><button type="button" @click="toggleMenu(id)">Controls</button>
          <div v-if="openMenuId === id" class="voice-participant-controls"><button
              class="btn-ghost-accent voice-local-mute" :aria-pressed="String(info.localMuted)"
              @click="togglePeerMute(info)">{{ info.localMuted ? 'Unmute for me' : 'Mute for me' }}</button><label
              class="voice-volume-label">Volume<input v-model.number="info.volumePercent" class="voice-volume"
                type="range" min="0" max="100" :aria-label="`${info.username} volume`"
                @input="applyAudioPolicy(info)"></label><button v-if="role === 'admin' && info.username !== username"
              class="btn-ghost-accent voice-admin-mute" @click="moderateMute(info)">{{ info.adminMuted ? 'Unmute for
              everyone' : 'Mute for everyone' }}</button></div>
        </div>
      </div>
    </div>
  </section>
  <div class="voice-presence" :class="{ hidden: !visibleRooms.length }"
    aria-label="People currently in visible voice rooms">
    <div class="voice-presence-users">
      <div v-for="room in visibleRooms" :key="room.to" class="voice-presence-group"><span
          class="voice-presence-label">{{ room.to === 'global' ? 'Global Voice' : `${room.to} Voice` }}</span><span
          v-for="person in room.participants" :key="person.username" class="voice-presence-user"
          :class="{ 'admin-muted': person.adminMuted }"
          :title="`${person.username}${person.adminMuted ? ' · Muted by admin' : ''}`"><span
            class="voice-presence-name">{{ person.username }}</span><span v-if="person.adminMuted"
            class="voice-presence-muted">Muted</span></span></div>
    </div>
  </div>
  <p v-if="errorText" class="voice-error" role="status">{{ errorText }}</p>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

const CHUNK_MS = 250;
const MAX_PLAYBACK_LEAD_SECONDS = 1.5;
const SPEAKING_RMS_THRESHOLD = 0.02;

const props = defineProps({ socket: Object, conversation: { type: String, default: 'global' }, username: { type: String, default: '' }, role: { type: String, default: 'user' } });
const peerInfo = reactive(new Map());
const peerPlayback = new Map();
const voicePresence = reactive(new Map());
const activeConversation = ref(null);
const activeSocket = ref(null);
const localStream = ref(null);
const localAnalyser = ref(null);
const localSpeaking = ref(false);
const muted = ref(false);
const forcedMuted = ref(false);
const joining = ref(false);
const errorText = ref('');
const openMenuId = ref(null);
let audioContext = null;
let meterTimer = null;
let typingSamples;
let recordGeneration = 0;
const panelVisible = computed(() => Boolean(activeConversation.value || joining.value || errorText.value));
const panelTitle = computed(() => activeConversation.value === 'global' ? 'Global Chat voice' : activeConversation.value ? `${activeConversation.value} voice` : 'Voice room');
const statusText = ref('');
const visibleRooms = computed(() => {
  const conversations = props.conversation === 'global' ? ['global'] : ['global', props.conversation];
  return conversations.filter((to) => to !== activeConversation.value && (voicePresence.get(to) || []).length)
    .map((to) => ({ to, participants: voicePresence.get(to) || [] }));
});

function toggleMenu(id) { openMenuId.value = openMenuId.value === id ? null : id; }
function refreshPresence() {
  props.socket?.emit('get voice participants', { to: 'global' });
  if (props.conversation !== 'global') props.socket?.emit('get voice participants', { to: props.conversation });
}
watch(() => props.conversation, refreshPresence);
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function soundMeter(stream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Audio level detection is unavailable.');
  audioContext ||= new AudioContextClass();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => { });
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.55;
  audioContext.createMediaStreamSource(stream).connect(analyser);
  return analyser;
}

function startMetering() {
  clearInterval(meterTimer);
  typingSamples = new Uint8Array(512);
  meterTimer = setInterval(() => {
    if (!localAnalyser.value) return;
    localAnalyser.value.getByteTimeDomainData(typingSamples);
    let energy = 0; for (const sample of typingSamples) energy += ((sample - 128) / 128) ** 2;
    localSpeaking.value = Math.sqrt(energy / typingSamples.length) > 0.035;
  }, 100);
}

function updateStatus() {
  const count = peerInfo.size;
  statusText.value = count ? `Connected · ${count + 1} participant${count === 0 ? '' : 's'}` : 'Waiting for others to connect…';
}

function applyAudioPolicy(info) {
  if (info.gainNode) info.gainNode.gain.value = info.adminMuted || info.localMuted ? 0 : info.volumePercent / 100;
}

function createPeerInfo(id, name = 'User', adminMuted = false) {
  if (peerInfo.has(id)) return peerInfo.get(id);
  const gainNode = audioContext.createGain();
  gainNode.gain.value = adminMuted ? 0 : 1;
  gainNode.connect(audioContext.destination);
  const info = reactive({ username: name, volumePercent: 100, localMuted: false, adminMuted, speaking: false, gainNode });
  peerInfo.set(id, info);
  peerPlayback.set(id, { nextStartTime: 0 });
  return info;
}

function removePeer(id) {
  const info = peerInfo.get(id);
  if (info) {
    clearTimeout(info._speakingTimer);
    try { info.gainNode?.disconnect(); } catch { /* disconnected */ }
  }
  peerInfo.delete(id);
  peerPlayback.delete(id);
  if (activeConversation.value) updateStatus();
}

async function playIncomingChunk(id, info, arrayBuffer) {
  if (!audioContext || !arrayBuffer) return;
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => { });

  let buffer;
  try { buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0)); }
  catch { return; }

  const data = buffer.getChannelData(0);
  let sumSquares = 0;
  for (let i = 0; i < data.length; i += 8) sumSquares += data[i] * data[i];
  const rms = Math.sqrt(sumSquares / Math.ceil(data.length / 8));
  info.speaking = rms > SPEAKING_RMS_THRESHOLD;
  clearTimeout(info._speakingTimer);
  info._speakingTimer = setTimeout(() => { info.speaking = false; }, buffer.duration * 1000 + 200);

  const playback = peerPlayback.get(id);
  if (!playback) return;

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(info.gainNode);
  const startAt = Math.max(audioContext.currentTime + 0.05, playback.nextStartTime);
  source.start(startAt);
  playback.nextStartTime = startAt + buffer.duration;

  if (playback.nextStartTime - audioContext.currentTime > MAX_PLAYBACK_LEAD_SECONDS) {
    playback.nextStartTime = audioContext.currentTime + 0.1;
  }
}

function pickRecorderMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  for (const type of candidates) if (window.MediaRecorder?.isTypeSupported?.(type)) return type;
  return '';
}

function recordOneChunk(stream, mimeType) {
  return new Promise((resolve) => {
    let recorder;
    try { recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream); }
    catch { resolve(null); return; }
    const parts = [];
    recorder.ondataavailable = (event) => { if (event.data && event.data.size > 0) parts.push(event.data); };
    recorder.onerror = () => resolve(null);
    recorder.onstop = () => resolve(parts.length ? new Blob(parts, { type: recorder.mimeType || mimeType }) : null);
    try { recorder.start(); } catch { resolve(null); return; }
    setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, CHUNK_MS);
  });
}

async function runRecordingLoop(generation, stream) {
  const mimeType = pickRecorderMimeType();
  while (recordGeneration === generation && activeConversation.value) {
    if (muted.value || forcedMuted.value) { await sleep(CHUNK_MS); continue; }
    const blob = await recordOneChunk(stream, mimeType);
    if (recordGeneration !== generation || !activeConversation.value) break;
    if (!blob || !blob.size) continue;
    try {
      const buffer = await blob.arrayBuffer();
      if (recordGeneration === generation) activeSocket.value?.emit('voice audio', buffer);
    } catch { /* skip */ }
  }
}

async function toggleVoice() {
  if (activeConversation.value) return leaveVoice();
  if (joining.value) return;
  const socket = props.socket; const room = props.conversation;
  if (!socket?.connected) { errorText.value = 'Chat server is disconnected. Reconnect before joining voice.'; return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !(window.AudioContext || window.webkitAudioContext)) {
    errorText.value = 'Voice rooms need microphone and audio recording support in this browser.';
    return;
  }
  joining.value = true; errorText.value = ''; statusText.value = 'Waiting for microphone permission…';
  try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume().catch(() => { }); } catch { /* try */ }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (!joining.value || room !== props.conversation || socket !== props.socket || !socket.connected) { stream.getTracks().forEach((track) => track.stop()); joining.value = false; return; }
    localStream.value = stream;
    try { localAnalyser.value = soundMeter(stream); } catch { localAnalyser.value = null; }
    joining.value = false; activeConversation.value = room; activeSocket.value = socket; muted.value = false; forcedMuted.value = false;
    statusText.value = 'Joining voice room…'; startMetering();
    socket.timeout(6000).emit('voice join', { to: room }, (error, result) => {
      if (error || !result?.ok) { errorText.value = result?.error || 'Could not join this voice room.'; cleanup(true); return; }
      forcedMuted.value = Boolean(result.forcedMuted);
      for (const person of result.participants || []) createPeerInfo(person.id, person.username, person.adminMuted);
      updateStatus();
      recordGeneration += 1;
      runRecordingLoop(recordGeneration, stream);
    });
  } catch (error) { joining.value = false; errorText.value = error?.name === 'NotAllowedError' ? 'Allow microphone access in your browser to join voice.' : 'Could not start your microphone. Check that it is connected and available.'; }
}

function toggleSelfMute() { if (!localStream.value || forcedMuted.value) return; muted.value = !muted.value; for (const track of localStream.value.getAudioTracks()) track.enabled = !muted.value; }
function togglePeerMute(info) { info.localMuted = !info.localMuted; applyAudioPolicy(info); }
function moderateMute(info) {
  activeSocket.value?.timeout(5000).emit('voice moderation mute', { username: info.username, muted: !info.adminMuted }, (error, result) => { if (error || !result?.ok) errorText.value = result?.error || 'The voice mute could not be changed.'; });
}

function cleanup(notifyServer) {
  recordGeneration += 1;
  if (notifyServer && activeSocket.value?.connected) activeSocket.value.emit('voice leave');
  for (const id of [...peerInfo.keys()]) removePeer(id);
  peerInfo.clear(); peerPlayback.clear(); clearInterval(meterTimer); meterTimer = null; localAnalyser.value = null;
  for (const track of localStream.value?.getTracks() || []) track.stop();
  localStream.value = null; audioContext?.close().catch(() => { }); audioContext = null;
  activeConversation.value = null; activeSocket.value = null; muted.value = false; forcedMuted.value = false; joining.value = false; openMenuId.value = null;
}
function leaveVoice() { cleanup(true); statusText.value = ''; errorText.value = ''; }

function onPresence({ to, participants }) { if (typeof to === 'string' && Array.isArray(participants)) voicePresence.set(to, participants); }
function onJoined({ id, username: name, adminMuted }) { if (!activeConversation.value || id === props.socket?.id) return; createPeerInfo(id, name, adminMuted); updateStatus(); }
function onAudio({ from, username: name, chunk }) {
  if (!activeConversation.value || !from || from === props.socket?.id) return;
  const info = peerInfo.get(from) || createPeerInfo(from, name);
  const arrayBuffer = chunk instanceof ArrayBuffer ? chunk : chunk?.buffer instanceof ArrayBuffer ? chunk.buffer : null;
  if (arrayBuffer) playIncomingChunk(from, info, arrayBuffer);
}
function onModeration({ username: name, muted: isMuted }) { for (const [, info] of peerInfo) if (info.username === name) { info.adminMuted = isMuted; applyAudioPolicy(info); } }
function onForcedMute({ muted: isMuted }) {
  forcedMuted.value = isMuted;
  for (const track of localStream.value?.getAudioTracks() || []) track.enabled = !muted.value && !forcedMuted.value;
  statusText.value = isMuted ? 'An admin muted your microphone.' : 'You have been unmuted.';
}
function onLeft({ id }) { removePeer(id); }
function onDisconnect() { cleanup(false); }
function attachSocket(socket) {
  if (!socket) return;
  socket.on('voice presence', onPresence); socket.on('voice participant joined', onJoined); socket.on('voice participant left', onLeft);
  socket.on('voice audio', onAudio); socket.on('voice moderation update', onModeration); socket.on('voice forced mute', onForcedMute); socket.on('disconnect', onDisconnect);
  refreshPresence();
}
function detachSocket(socket) {
  if (!socket) return;
  socket.off('voice presence', onPresence); socket.off('voice participant joined', onJoined); socket.off('voice participant left', onLeft);
  socket.off('voice audio', onAudio); socket.off('voice moderation update', onModeration); socket.off('voice forced mute', onForcedMute); socket.off('disconnect', onDisconnect);
}
watch(() => props.socket, (socket, previous) => { detachSocket(previous); attachSocket(socket); });
onMounted(refreshPresence);
onBeforeUnmount(() => { cleanup(true); detachSocket(props.socket); });
defineExpose({ activeConversation, joining, toggleVoice });
</script>