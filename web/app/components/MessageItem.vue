<template>
  <article :id="`msg-${message.id}`" class="msg" :class="{ own: message.user === myUsername }">
    <div class="msg-meta">
      <span>{{ message.user }}{{ message.role === 'admin' ? ' (Owner)' : '' }}<small v-if="message.edited" class="msg-edited-label">(edited)</small></span>
      <div class="msg-actions">
        <button v-if="message.user === myUsername" class="msg-action-btn edit" type="button" @click="$emit('edit', message)">[Edit]</button>
        <button v-if="message.user === myUsername" class="msg-action-btn delete" type="button" @click="$emit('delete', message.id)">[X]</button>
        <button class="msg-action-btn reply" type="button" @click="$emit('reply', message)">[Reply]</button>
        <button class="msg-action-btn forward" type="button" @click="$emit('forward', message)">[Forward]</button>
        <button v-if="(message.to || 'global') !== 'global' || myRole === 'admin'" class="msg-action-btn pin" type="button" @click="$emit('pin', message.id)">{{ message.pinned ? '[Unpin]' : '[Pin]' }}</button>
        <button class="msg-action-btn save" type="button" @click="$emit('save', message.id)">{{ message.saved ? '[Saved]' : '[Save]' }}</button>
      </div>
    </div>
    <div v-if="message.pinned" class="pinned-label">Pinned by {{ message.pinnedBy || 'a user' }}</div>
    <div v-if="message.replyTo" class="reply-box" @click="$emit('jump', message.replyTo.id)"><strong>@{{ message.replyTo.user }}</strong>: {{ message.replyTo.text }}...</div>
    <div v-if="message.forwardedFrom" class="forwarded-label">Forwarded from @{{ message.forwardedFrom.user }}</div>
    <span v-if="message.msg" class="msg-content"><template v-for="(part, index) in messageParts" :key="index"><mark v-if="part.user" class="mention-highlight" :class="{ 'mention-self': part.user.toLowerCase() === myUsername.toLowerCase() }">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
    <div v-for="attachment in message.attachments || []" :key="attachment.id" class="message-media">
      <template v-if="attachment.type?.startsWith('image/')"><img class="message-media-image" :src="mediaUrl(attachment)" :alt="attachment.name" loading="lazy" crossorigin="use-credentials"><a class="message-media-download" :href="mediaUrl(attachment)" target="_blank" rel="noopener noreferrer">{{ attachment.name }}</a></template>
      <template v-else-if="attachment.type?.startsWith('video/')"><video class="message-media-video" :src="mediaUrl(attachment)" controls preload="metadata" crossorigin="use-credentials"></video><span class="message-media-name">{{ attachment.name }}</span></template>
      <template v-else-if="attachment.type?.startsWith('audio/')"><audio class="message-media-audio" :src="mediaUrl(attachment)" controls preload="metadata" crossorigin="use-credentials"></audio><span class="message-media-name">{{ attachment.name }}</span></template>
      <a v-else class="message-media-file" :href="mediaUrl(attachment)" target="_blank" rel="noopener noreferrer">{{ attachment.type === 'application/pdf' ? 'PDF' : 'File' }} · {{ attachment.name }}</a>
    </div>
    <div class="reaction-bar">
      <button v-for="(users, emoji) in visibleReactions" :key="emoji" class="reaction-chip" :class="{ active: users.includes(myUsername) }" type="button" :title="users.join(', ')" :aria-label="`${emoji}, ${users.length} reactions`" @click="$emit('react', message.id, emoji)">{{ emoji }} {{ users.length }}</button>
      <div class="reaction-controls"><button ref="pickerButton" class="reaction-add" type="button" aria-label="Add reaction" title="Add reaction" @click="$emit('toggle-picker', message.id, pickerButton)">+</button><EmojiPicker :open="pickerOpen" :anchor="pickerAnchor" @close="$emit('toggle-picker', null)" @select="(emoji) => { $emit('react', message.id, emoji); $emit('toggle-picker', null); }" /></div>
    </div>
    <div class="msg-footer"><div class="msg-time">{{ time }}</div></div>
  </article>
</template>

<script setup>
import { computed, ref } from 'vue';

const props = defineProps({ message: { type: Object, required: true }, myUsername: { type: String, default: '' }, myRole: { type: String, default: 'user' }, knownUsers: { type: Array, default: () => [] }, apiUrl: { type: String, required: true }, pickerOpen: Boolean, pickerAnchor: Object });
defineEmits(['edit', 'delete', 'reply', 'forward', 'pin', 'save', 'react', 'jump', 'toggle-picker']);
const pickerButton = ref(null);
const known = computed(() => new Set([...props.knownUsers.map((user) => user.name.toLowerCase()), props.myUsername.toLowerCase()]));
const visibleReactions = computed(() => Object.fromEntries(Object.entries(props.message.reactions || {}).filter(([, users]) => Array.isArray(users) && users.length)));
const time = computed(() => new Date(props.message.ts).toLocaleString([], { month: 'numeric', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
const messageParts = computed(() => {
  const text = props.message.msg || '';
  const parts = [];
  const pattern = /(^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]{3,20})(?![A-Za-z0-9_-])/gi;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const user = match[2];
    if (!known.value.has(user.toLowerCase())) continue;
    const start = match.index + match[1].length;
    parts.push({ text: text.slice(cursor, start) }, { text: `@${user}`, user });
    cursor = start + match[0].length - match[1].length;
  }
  parts.push({ text: text.slice(cursor) });
  return parts;
});
function mediaUrl(attachment) { return `${props.apiUrl}/media/${encodeURIComponent(attachment.id)}`; }
</script>
