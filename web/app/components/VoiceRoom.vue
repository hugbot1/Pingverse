<template>
  <section class="voice-room-panel" :class="{ hidden: !panelVisible }" aria-label="Voice room">
    <div class="voice-room-heading"><strong>{{ panelTitle }}</strong><span aria-live="polite">{{ statusText }}</span></div>
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
  </section>
  <div class="voice-presence" :class="{ hidden: !visibleRooms.length }" aria-label="People currently in visible voice rooms"><div class="voice-presence-users">
    <div v-for="room in visibleRooms" :key="room.to" class="voice-presence-group"><span class="voice-presence-label">{{ room.to === 'global' ? 'Global Voice' : `${room.to} Voice` }}</span><span v-for="person in room.participants" :key="person.username" class="voice-presence-user" :class="{ 'admin-muted': person.adminMuted }" :title="`${person.username}${person.adminMuted ? ' · Muted by admin' : ''}`"><span class="voice-presence-name">{{ person.username }}</span><span v-if="person.adminMuted" class="voice-presence-muted">Muted</span></span></div>
  </div></div>
  <p v-if="errorText" class="voice-error" role="status">{{ errorText }}</p>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

const props = defineProps({ socket: Object, conversation: { type: String, default: 'global' }, username: { type: String, default: '' }, role: { type: String, default: 'user' } });
const peers = new Map();
const peerInfo = reactive(new Map());
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

function soundMeter(stream, gain) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Audio level detection is unavailable.');
  audioContext ||= new AudioContextClass();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.55;
  const source = audioContext.createMediaStreamSource(stream); source.connect(analyser);
  const gainNode = audioContext.createGain(); gainNode.gain.value = gain; analyser.connect(gainNode); gainNode.connect(audioContext.destination);
  return { analyser, source, gainNode };
}

function startMetering() {
  clearInterval(meterTimer);
  typingSamples = new Uint8Array(512);
  meterTimer = setInterval(() => {
    const measure = (analyser) => { analyser.getByteTimeDomainData(typingSamples); let energy = 0; for (const sample of typingSamples) energy += ((sample - 128) / 128) ** 2; return Math.sqrt(energy / typingSamples.length) > 0.035; };
    if (localAnalyser.value) localSpeaking.value = measure(localAnalyser.value);
    for (const [id, info] of peerInfo) if (info.analyser) { const speaking = measure(info.analyser); if (speaking !== info.speaking) peerInfo.set(id, { ...info, speaking }); }
  }, 100);
}

function updateStatus() {
  const connected = [...peers.values()].filter((peer) => peer.connectionState === 'connected').length;
  statusText.value = connected ? `Connected · ${connected + 1} participant${connected === 0 ? '' : 's'}` : 'Waiting for others to connect…';
}

function applyAudioPolicy(info) {
  if (info.gainNode) info.gainNode.gain.value = info.adminMuted || info.localMuted ? 0 : info.volumePercent / 100;
  if (info.remoteTrack) info.remoteTrack.enabled = !info.adminMuted;
}

function createPeer(id, name = 'User', adminMuted = false) {
  if (peers.has(id)) return peers.get(id);
  const info = reactive({ username: name, volumePercent: 100, localMuted: false, adminMuted, speaking: false, analyser: null, gainNode: null, remoteTrack: null, source: null });
  peerInfo.set(id, info);
  const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peers.set(id, peer);
  for (const track of localStream.value?.getAudioTracks() || []) peer.addTrack(track, localStream.value);
  peer.onicecandidate = (event) => { if (event.candidate) activeSocket.value?.emit('voice signal', { to: id, signal: { candidate: event.candidate.toJSON() } }); };
  peer.ontrack = (event) => {
    if (event.track.kind !== 'audio') return;
    info.remoteTrack = event.track;
    try { const meter = soundMeter(event.streams[0] || new MediaStream([event.track]), 1); info.analyser = meter.analyser; info.source = meter.source; info.gainNode = meter.gainNode; applyAudioPolicy(info); startMetering(); }
    catch { errorText.value = 'Voice is connected, but audio playback is unavailable in this browser.'; }
  };
  peer.onconnectionstatechange = () => { if (peer.connectionState === 'failed') removePeer(id); else updateStatus(); };
  return peer;
}

function removePeer(id) { peers.get(id)?.close(); peers.delete(id); peerInfo.delete(id); if (activeConversation.value) updateStatus(); }
async function makeOffer(id, name, adminMuted) {
  try { const peer = createPeer(id, name, adminMuted); const offer = await peer.createOffer(); await peer.setLocalDescription(offer); activeSocket.value?.emit('voice signal', { to: id, signal: peer.localDescription.toJSON() }); }
  catch { errorText.value = `Could not connect to ${name || 'a participant'}.`; }
}
async function handleSignal({ from, username: name, signal }) {
  if (!activeConversation.value || !from || !signal) return;
  const peer = createPeer(from, name);
  try {
    if (signal.description) signal = signal.description;
    if (signal.candidate) { if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate); else { peer.pendingCandidates ||= []; peer.pendingCandidates.push(signal.candidate); } return; }
    await peer.setRemoteDescription(signal);
    for (const candidate of peer.pendingCandidates || []) await peer.addIceCandidate(candidate);
    peer.pendingCandidates = [];
    if (signal.type === 'offer') { const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); activeSocket.value?.emit('voice signal', { to: from, signal: peer.localDescription.toJSON() }); }
  } catch { errorText.value = `Could not connect to ${name || 'a participant'}.`; }
}

async function toggleVoice() {
  if (activeConversation.value) return leaveVoice();
  if (joining.value) return;
  const socket = props.socket; const room = props.conversation;
  if (!socket?.connected) { errorText.value = 'Chat server is disconnected. Reconnect before joining voice.'; return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) { errorText.value = 'Voice rooms need a secure browser connection and WebRTC support.'; return; }
  joining.value = true; errorText.value = ''; statusText.value = 'Waiting for microphone permission…';
  try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume().catch(() => {}); } catch { /* can connect */ }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (!joining.value || room !== props.conversation || socket !== props.socket || !socket.connected) { stream.getTracks().forEach((track) => track.stop()); joining.value = false; return; }
    localStream.value = stream;
    try { localAnalyser.value = soundMeter(stream, 0).analyser; } catch { localAnalyser.value = null; }
    joining.value = false; activeConversation.value = room; activeSocket.value = socket; muted.value = false; forcedMuted.value = false;
    statusText.value = 'Joining voice room…'; startMetering();
    socket.timeout(6000).emit('voice join', { to: room }, (error, result) => {
      if (error || !result?.ok) { errorText.value = result?.error || 'Could not join this voice room.'; cleanup(true); return; }
      forcedMuted.value = Boolean(result.forcedMuted);
      for (const person of result.participants || []) createPeer(person.id, person.username, person.adminMuted);
      for (const track of localStream.value?.getAudioTracks() || []) track.enabled = !muted.value && !forcedMuted.value;
      updateStatus();
    });
  } catch (error) { joining.value = false; errorText.value = error?.name === 'NotAllowedError' ? 'Allow microphone access in your browser to join voice.' : 'Could not start your microphone. Check that it is connected and available.'; }
}

function toggleSelfMute() { if (!localStream.value || forcedMuted.value) return; muted.value = !muted.value; for (const track of localStream.value.getAudioTracks()) track.enabled = !muted.value; }
function togglePeerMute(info) { info.localMuted = !info.localMuted; applyAudioPolicy(info); }
function moderateMute(info) {
  activeSocket.value?.timeout(5000).emit('voice moderation mute', { username: info.username, muted: !info.adminMuted }, (error, result) => { if (error || !result?.ok) errorText.value = result?.error || 'The voice mute could not be changed.'; });
}

function cleanup(notifyServer) {
  if (notifyServer && activeSocket.value?.connected) activeSocket.value.emit('voice leave');
  for (const id of [...peers.keys()]) removePeer(id);
  peerInfo.clear(); clearInterval(meterTimer); meterTimer = null; localAnalyser.value = null;
  for (const track of localStream.value?.getTracks() || []) track.stop();
  localStream.value = null; audioContext?.close().catch(() => {}); audioContext = null;
  activeConversation.value = null; activeSocket.value = null; muted.value = false; forcedMuted.value = false; joining.value = false; openMenuId.value = null;
}
function leaveVoice() { cleanup(true); statusText.value = ''; errorText.value = ''; }

function onPresence({ to, participants }) { if (typeof to === 'string' && Array.isArray(participants)) voicePresence.set(to, participants); }
function onJoined({ id, username: name, adminMuted }) { if (activeConversation.value && id !== props.socket?.id) makeOffer(id, name, adminMuted); }
function onModeration({ username: name, muted: isMuted }) { for (const [id, info] of peerInfo) if (info.username === name) { info.adminMuted = isMuted; applyAudioPolicy(info); peerInfo.set(id, info); } }
function onForcedMute({ muted: isMuted }) { forcedMuted.value = isMuted; for (const track of localStream.value?.getAudioTracks() || []) track.enabled = !muted.value && !forcedMuted.value; statusText.value = isMuted ? 'An admin muted your microphone.' : 'You have been unmuted.'; }
function onLeft({ id }) { removePeer(id); }
function onDisconnect() { cleanup(false); }
function attachSocket(socket) {
  if (!socket) return;
  socket.on('voice presence', onPresence); socket.on('voice participant joined', onJoined); socket.on('voice participant left', onLeft);
  socket.on('voice signal', handleSignal); socket.on('voice moderation update', onModeration); socket.on('voice forced mute', onForcedMute); socket.on('disconnect', onDisconnect);
  refreshPresence();
}
function detachSocket(socket) {
  if (!socket) return;
  socket.off('voice presence', onPresence); socket.off('voice participant joined', onJoined); socket.off('voice participant left', onLeft);
  socket.off('voice signal', handleSignal); socket.off('voice moderation update', onModeration); socket.off('voice forced mute', onForcedMute); socket.off('disconnect', onDisconnect);
}
watch(() => props.socket, (socket, previous) => { detachSocket(previous); attachSocket(socket); });
onMounted(refreshPresence);
onBeforeUnmount(() => { cleanup(true); detachSocket(props.socket); });
defineExpose({ activeConversation, joining, toggleVoice });
</script>