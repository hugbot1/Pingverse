<template>
  <Teleport to="body">
    <div v-if="open" ref="picker" class="reaction-picker" :style="position" @keydown.esc="$emit('close')">
      <input v-model="query" class="emoji-search" type="search" placeholder="Search all emoji" aria-label="Search all emoji">
      <div class="emoji-categories">
        <button v-for="group in groups" :key="group" class="emoji-category" :class="{ active: group === activeGroup && !query }" type="button" :aria-label="`${group} emoji`" @click="selectGroup(group)">{{ group }}</button>
      </div>
      <div class="emoji-result-count" aria-live="polite">{{ filtered.length ? `${filtered.length} emoji` : 'No emoji found' }}</div>
      <div class="emoji-grid" role="listbox" aria-label="Emoji">
        <button v-for="entry in filtered" :key="entry.emoji + entry.name" class="emoji-option" type="button" role="option" :title="`${entry.displayName || entry.name} (${entry.emoji})`" :aria-label="entry.displayName || entry.name" @click="$emit('select', entry.emoji)">{{ entry.emoji }}</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({ open: Boolean, anchor: Object });
defineEmits(['close', 'select']);
const picker = ref(null);
const query = ref('');
const catalog = ref([]);
const activeGroup = ref('');
const position = ref({ left: '8px', top: '8px' });
const groups = computed(() => [...new Set(catalog.value.map((entry) => entry.group))]);
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  return catalog.value.filter((entry) => needle
    ? `${entry.name} ${entry.displayName || ''} ${entry.emoji}`.toLocaleLowerCase().includes(needle)
    : entry.group === activeGroup.value);
});

function placePicker() {
  if (!picker.value || !props.anchor) return;
  const viewport = window.visualViewport;
  const leftEdge = viewport?.offsetLeft || 0;
  const topEdge = viewport?.offsetTop || 0;
  const width = viewport?.width || window.innerWidth;
  const height = viewport?.height || window.innerHeight;
  const trigger = props.anchor.getBoundingClientRect();
  const rect = picker.value.getBoundingClientRect();
  const left = Math.max(leftEdge + 8, Math.min(trigger.left, leftEdge + width - rect.width - 8));
  let top = trigger.top - rect.height - 6;
  if (top < topEdge + 8) top = trigger.bottom + 6;
  top = Math.max(topEdge + 8, Math.min(top, topEdge + height - rect.height - 8));
  position.value = { left: `${left}px`, top: `${top}px`, width: `${Math.max(160, Math.min(360, width - 16))}px`, height: `${Math.max(120, Math.min(390, height - 16))}px` };
}

async function loadCatalog() {
  if (catalog.value.length) return;
  const response = await fetch('/data/emoji.json');
  if (!response.ok) throw new Error('Could not load emoji list');
  const data = await response.json();
  catalog.value = data.emojis || [];
  activeGroup.value = groups.value[0] || '';
}

function selectGroup(group) { activeGroup.value = group; query.value = ''; }
watch(() => props.open, async (open) => {
  if (!open) {
    window.removeEventListener('resize', placePicker);
    window.removeEventListener('scroll', placePicker, true);
    window.visualViewport?.removeEventListener('resize', placePicker);
    window.visualViewport?.removeEventListener('scroll', placePicker);
    return;
  }
  window.addEventListener('resize', placePicker);
  window.addEventListener('scroll', placePicker, true);
  window.visualViewport?.addEventListener('resize', placePicker);
  window.visualViewport?.addEventListener('scroll', placePicker);
  try { await loadCatalog(); } catch { catalog.value = []; }
  await nextTick(); placePicker(); picker.value?.querySelector('input')?.focus({ preventScroll: true });
});
watch(() => props.anchor, async () => { await nextTick(); placePicker(); });
onBeforeUnmount(() => {
  window.removeEventListener('resize', placePicker);
  window.removeEventListener('scroll', placePicker, true);
  window.visualViewport?.removeEventListener('resize', placePicker);
  window.visualViewport?.removeEventListener('scroll', placePicker);
});
</script>