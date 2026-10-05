<template>
  <div class="user-list">
    <div v-for="user in visibleUsers" :key="user.name" class="user-item" @click="$emit('open', user.name)">
      <div class="user-left">
        <img v-if="user.hasAvatar" class="user-avatar" crossorigin="use-credentials" :src="avatarUrl(user.name)"
          :alt="`${user.name}'s avatar`" @click.stop="$emit('profile', user.name)">
        <span v-else class="user-avatar user-avatar-fallback" @click.stop="$emit('profile', user.name)">{{
          user.name.charAt(0).toUpperCase() }}</span>
        <div class="user-text">
          <div><span class="user-name">{{ user.name }}</span><small v-if="user.role === 'admin'"
              class="user-owner-label">(Owner)</small><span v-if="user.isMuted" class="user-muted-label">[Timed
              Out]</span></div><span class="user-presence-label">{{ statusLabel(user.presenceStatus) }}</span>
        </div>
      </div>
      <div class="user-right"><span v-if="user.unreadCount > 0 && user.name !== activeUser" class="unread-badge">{{
        user.unreadCount }}</span>
        <div class="dot" :class="`status-${status(user.presenceStatus)}`" :title="statusLabel(user.presenceStatus)"
          :aria-label="statusLabel(user.presenceStatus)"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ users: { type: Array, default: () => [] }, search: { type: String, default: '' }, activeUser: { type: String, default: '' }, apiUrl: { type: String, required: true } });
defineEmits(['open', 'profile']);
const labels = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline' };
const status = (value) => Object.hasOwn(labels, value) ? value : 'offline';
const statusLabel = (value) => labels[status(value)];
const visibleUsers = computed(() => props.users.filter((user) => user.name.toLowerCase().includes(props.search.toLowerCase())));
const avatarUrl = (name) => `${props.apiUrl}/profile/avatar/${encodeURIComponent(name)}`;
</script>