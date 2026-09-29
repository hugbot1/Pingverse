<template>
  <div class="user-list">
    <div v-for="user in visibleUsers" :key="user.name" class="user-item" @click="$emit('open', user.name)">
      <div class="user-left"><div><span class="user-name">{{ user.name }}</span><small v-if="user.role === 'admin'" class="user-owner-label">(Owner)</small><span v-if="user.isMuted" class="user-muted-label">[Timed Out]</span></div><span class="user-presence-label">{{ statusLabel(user.presenceStatus) }}</span></div>
      <div class="user-right"><span v-if="user.unreadCount > 0 && user.name !== activeUser" class="unread-badge">{{ user.unreadCount }}</span><div class="dot" :class="`status-${status(user.presenceStatus)}`" :title="statusLabel(user.presenceStatus)" :aria-label="statusLabel(user.presenceStatus)"></div></div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ users: { type: Array, default: () => [] }, search: { type: String, default: '' }, activeUser: { type: String, default: '' } });
defineEmits(['open']);
const labels = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline' };
const status = (value) => Object.hasOwn(labels, value) ? value : 'offline';
const statusLabel = (value) => labels[status(value)];
const visibleUsers = computed(() => props.users.filter((user) => user.name.toLowerCase().includes(props.search.toLowerCase())));
</script>
