<template>
  <section class="voice-room-panel" :class="{ hidden: !panelVisible }" aria-label="Voice room">
    <div class="voice-room-heading"><strong>{{ panelTitle }}</strong><span aria-live="polite">{{ statusText }}</span><template v-if="activeConversation"><button type="button" class="btn-ghost-accent voice-video-btn" :aria-pressed="String(localKinds.includes('camera'))" @click="toggleVideo('camera')">{{ localKinds.includes('camera') ? 'Stop camera' : 'Camera' }}</button><button v-if="canShareScreen" type="button" class="btn-ghost-accent voice-video-btn" :aria-pressed="String(localKinds.includes('screen'))" @click="toggleVideo('screen')">{{ localKinds.includes('screen') ? 'Stop sharing' : 'Share screen' }}</button></template></div>
    <div class="voice-room-participants">
      <div v-if="activeConversation" class="voice-participant-card" :class="{ speaking: localSpeaking && !muted && !forcedMuted }">
        <span class="voice-participant-name">{{ username }} (you)</span><span class="voice-participant-activity">{{ forcedMuted ? 'Muted by admin' : muted ? 'Muted' : 'Microphone on' }}</span>
        <div class="voice-participant-menu"><button type="button" @click="toggleMenu('local')">Controls</button><div v-if="openMenuId === 'local'" class="voice-participant-controls"><button class="btn-ghost-accent voice-local-mute" :disabled="!localStream || forcedMuted" @click="toggleSelfMute">{{ forcedMuted ? 'Muted by admin' : muted ? 'Unmute microphone' : 'Mute microphone' }}</button></div></div>
      </div>
      <div v-for="[id, info] in peerInfo" :key="id" class="voice-participant-card" :class="{ speaking: info.speaking && !info.adminMuted }">
        <div class="voice-participant-identity"><span class="voice-participant-name">{{ info.username }}</span><span class="voice-participant-activity">{{ info.adminMuted ? 'Muted by admin' : info.localMuted ? 'Muted for you' : 'Connected' }}</span></div>
        <div class="voice-participant-menu"><button type="button" @click="toggleMenu(id)">Controls</button><div v-if="openMenuId === id" class="voice-participant-controls"><button class="btn-ghost-accent voice-local-mute" :aria-pressed="String(info.localMuted)" @click="togglePeerMute(info)">{{ info.localMuted ? 'Unmute for me' : 'Mute for me' }}</button><label class="voice-volume-label">Volume<input v-model.number="info.volumePercent" class="voice-volume" type="range" min="0" max="100" :aria-label="`${info.username} volume`" @input="applyAudioPolicy(info)"></label><button v-if="role === 'admin' && info.username !== username" class="btn-ghost-accent voice-admin-mute" @click="moderateMute(info)">{{ info.adminMuted ? 'Unmute for everyone' : 'Mute for everyone' }}</button></div></div>
      </div>
    </div>
    <div v-if="localKinds.length || remoteTiles.size" class="voice-video-grid">
      <div v-for="kind in localKinds" :key="`local:${kind}`" class="voice-video-tile" :class="{ enlarged: expandedKey === `local:${kind}` }" @click="toggleExpand(`local:${kind}`)">
        <video :ref="(el) => bindLocalVideo(el, kind)" muted autoplay playsinline />
        <span class="voice-video-label">Your {{ kindLabel(kind) }}</span>
      </div>
      <div v-for="[key, tile] in remoteTiles" :key="key" class="voice-video-tile" :class="{ enlarged: expandedKey === key }" @click="toggleExpand(key)">
        <canvas :ref="(el) => registerCanvas(key, el)" />
        <span class="voice-video-label">{{ tile.username }}'s {{ kindLabel(tile.kind) }}</span>
      </div>
    </div>
  </section>
  <div class="voice-presence" :class="{ hidden: !visibleRooms.length }" aria-label="People currently in visible voice rooms"><div class="voice-presence-users">
    <div v-for="room in visibleRooms" :key="room.to" class="voice-presence-group"><span class="voice-presence-label">{{ room.to === 'global' ? 'Global Voice' : `${room.to} Voice` }}</span><span v-for="person in room.participants" :key="person.username" class="voice-presence-user" :class="{ 'admin-muted': person.adminMuted }" :title="`${person.username}${person.adminMuted ? ' · Muted by admin' : ''}`"><span class="voice-presence-name">{{ person.username }}</span><span v-if="person.adminMuted" class="voice-presence-muted">Muted</span></span></div>
  </div></div>
  <p v-if="errorText" class="voice-error" role="status">{{ errorText }}</p>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

const CHUNK_MS = 250;
const MAX_PLAYBACK_LEAD_SECONDS = 1.5;
const SPEAKING_RMS_THRESHOLD = 0.02;
const VIDEO_KINDS = ['camera', 'screen'];
const VIDEO_PROFILES = {
  camera: { maxWidth: 640, interval: 33, quality: 0.6 },
  screen: { maxWidth: 1280, interval: 33, quality: 0.6 },
};
const MAX_VIDEO_FRAME_BYTES = 800 * 1024;
const MIN_VIDEO_QUALITY = 0.5;

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
const remoteTiles = reactive(new Map());
const localKinds = ref([]);
const expandedKey = ref('');
const canShareScreen = ref(false);
const tileCanvases = new Map();
const latestFrames = new Map();
const sources = {};
const pendingVideo = new Set();
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
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
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
  for (const key of [...remoteTiles.keys()]) if (key.startsWith(`${id}:`)) removeTile(key);
  if (activeConversation.value) updateStatus();
}

function kindLabel(kind) { return kind === 'screen' ? 'Screen' : 'Camera'; }
function toggleExpand(key) { expandedKey.value = expandedKey.value === key ? '' : key; }

function drawTile(key) {
  const canvas = tileCanvases.get(key);
  const bitmap = latestFrames.get(key);
  if (!canvas || !bitmap) return;
  if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) { canvas.width = bitmap.width; canvas.height = bitmap.height; }
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
}

function registerCanvas(key, el) {
  if (!el) { tileCanvases.delete(key); return; }
  if (tileCanvases.get(key) === el) return;
  tileCanvases.set(key, el);
  drawTile(key);
}

function removeTile(key) {
  remoteTiles.delete(key);
  latestFrames.get(key)?.close();
  latestFrames.delete(key);
  tileCanvases.delete(key);
  if (expandedKey.value === key) expandedKey.value = '';
}

function bindLocalVideo(el, kind) {
  const source = sources[kind];
  if (!source) return;
  if (!el) { source.video = null; return; }
  source.video = el;
  if (el.srcObject !== source.stream) el.srcObject = source.stream;
}

async function captureFrame(kind, source) {
  const video = source.video;
  if (source.busy || !video || !video.videoWidth || sources[kind] !== source) return;
  source.busy = true;
  try {
    const scale = Math.min(1, VIDEO_PROFILES[kind].maxWidth / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    const canvas = source.canvas;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', source.quality));
    if (!blob || sources[kind] !== source) return;
    if (blob.size > MAX_VIDEO_FRAME_BYTES) { source.quality = Math.max(MIN_VIDEO_QUALITY, source.quality - 0.1); return; }
    const buffer = await blob.arrayBuffer();
    if (sources[kind] === source) activeSocket.value?.volatile.emit('voice video', kind, buffer);
  } catch { return; }
  finally { source.busy = false; }
}

function stopVideo(kind, notify = true) {
  const source = sources[kind];
  if (!source) return;
  delete sources[kind];
  clearInterval(source.timer);
  for (const track of source.stream.getTracks()) { track.onended = null; track.stop(); }
  localKinds.value = localKinds.value.filter((value) => value !== kind);
  const key = `local:${kind}`;
  if (expandedKey.value === key) expandedKey.value = '';
  if (notify && activeSocket.value?.connected) activeSocket.value.emit('voice video stop', kind);
}

async function startVideo(kind) {
  if (!activeConversation.value || sources[kind] || pendingVideo.has(kind)) return;
  const socket = activeSocket.value;
  const room = activeConversation.value;
  const devices = navigator.mediaDevices;
  if (!(kind === 'camera' ? devices?.getUserMedia : devices?.getDisplayMedia)) { errorText.value = kind === 'camera' ? 'This browser cannot access a camera.' : 'This browser cannot share your screen.'; return; }
  pendingVideo.add(kind);
  errorText.value = '';
  try {
    const stream = kind === 'camera'
      ? await devices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false })
      : await devices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
    if (activeConversation.value !== room || activeSocket.value !== socket) { stream.getTracks().forEach((track) => track.stop()); return; }
    const source = { stream, video: null, canvas: document.createElement('canvas'), quality: VIDEO_PROFILES[kind].quality, busy: false, timer: null };
    sources[kind] = source;
    for (const track of stream.getVideoTracks()) track.onended = () => { if (sources[kind] === source) stopVideo(kind); };
    localKinds.value = [...localKinds.value, kind];
    source.timer = setInterval(() => captureFrame(kind, source), VIDEO_PROFILES[kind].interval);
  } catch (error) {
    if (error?.name === 'NotAllowedError') errorText.value = kind === 'camera' ? 'Allow camera access in your browser to share video.' : 'Screen sharing was cancelled or blocked.';
    else errorText.value = kind === 'camera' ? 'Could not start your camera. Check that it is connected and available.' : 'Could not start screen sharing.';
  } finally { pendingVideo.delete(kind); }
}

function toggleVideo(kind) { if (sources[kind]) stopVideo(kind); else startVideo(kind); }

async function playIncomingChunk(id, info, arrayBuffer) {
  if (!audioContext || !arrayBuffer) return;
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});

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
  try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume().catch(() => {}); } catch { /* try */ }
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
  for (const kind of Object.keys(sources)) stopVideo(kind, false);
  for (const bitmap of latestFrames.values()) bitmap.close();
  latestFrames.clear(); tileCanvases.clear(); remoteTiles.clear(); expandedKey.value = '';
  peerInfo.clear(); peerPlayback.clear(); clearInterval(meterTimer); meterTimer = null; localAnalyser.value = null;
  for (const track of localStream.value?.getTracks() || []) track.stop();
  localStream.value = null; audioContext?.close().catch(() => {}); audioContext = null;
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
async function onVideo({ from, kind, username: name, frame }) {
  if (!activeConversation.value || !from || from === props.socket?.id || !VIDEO_KINDS.includes(kind)) return;
  if (!(frame instanceof ArrayBuffer) && !ArrayBuffer.isView(frame)) return;
  const key = `${from}:${kind}`;
  if (!remoteTiles.has(key)) remoteTiles.set(key, { id: from, kind, username: name || peerInfo.get(from)?.username || 'User' });
  let bitmap;
  try { bitmap = await createImageBitmap(new Blob([frame], { type: 'image/jpeg' })); }
  catch { return; }
  if (!remoteTiles.has(key)) { bitmap.close(); return; }
  latestFrames.get(key)?.close();
  latestFrames.set(key, bitmap);
  drawTile(key);
}
function onVideoStop({ from, kind }) { removeTile(`${from}:${kind}`); }
function onDisconnect() { cleanup(false); }
function attachSocket(socket) {
  if (!socket) return;
  socket.on('voice presence', onPresence); socket.on('voice participant joined', onJoined); socket.on('voice participant left', onLeft);
  socket.on('voice audio', onAudio); socket.on('voice video', onVideo); socket.on('voice video stop', onVideoStop); socket.on('voice moderation update', onModeration); socket.on('voice forced mute', onForcedMute); socket.on('disconnect', onDisconnect);
  refreshPresence();
}
function detachSocket(socket) {
  if (!socket) return;
  socket.off('voice presence', onPresence); socket.off('voice participant joined', onJoined); socket.off('voice participant left', onLeft);
  socket.off('voice audio', onAudio); socket.off('voice video', onVideo); socket.off('voice video stop', onVideoStop); socket.off('voice moderation update', onModeration); socket.off('voice forced mute', onForcedMute); socket.off('disconnect', onDisconnect);
}
watch(() => props.socket, (socket, previous) => { detachSocket(previous); attachSocket(socket); });
onMounted(() => { canShareScreen.value = Boolean(navigator.mediaDevices?.getDisplayMedia); refreshPresence(); });
onBeforeUnmount(() => { cleanup(true); detachSocket(props.socket); });
defineExpose({ activeConversation, joining, toggleVoice });
</script>