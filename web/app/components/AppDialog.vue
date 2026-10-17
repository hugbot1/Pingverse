<template>
    <dialog ref="dialog" class="forward-dialog app-dialog" @cancel.prevent="finish(cancelValue())" @pointerdown="press"
        @click="backdrop">
        <form v-if="current" @submit.prevent="finish(confirmValue())">
            <p class="app-dialog-message">{{ current.message }}</p>
            <input v-if="current.kind === 'prompt'" ref="field" v-model="value" type="text"
                :maxlength="current.maxlength" autocomplete="off" :aria-label="current.message">
            <div class="forward-dialog-actions">
                <button v-if="current.kind !== 'alert'" class="btn btn-outline" type="button"
                    @click="finish(cancelValue())">{{ current.cancelText }}</button>
                <button ref="primary" class="btn" :class="{ 'btn-danger': current.danger }" type="submit">{{
                    current.confirmText }}</button>
            </div>
        </form>
    </dialog>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue';

const { current, settle } = useDialogs();
const dialog = ref(null);
const field = ref(null);
const primary = ref(null);
const value = ref('');
let pressTarget = null;

const cancelValue = () => current.value?.kind === 'confirm' ? false : current.value?.kind === 'prompt' ? null : undefined;
const confirmValue = () => current.value?.kind === 'prompt' ? value.value : true;

function finish(result) {
    if (!current.value) return;
    dialog.value?.close();
    settle(result);
}

function press(event) { pressTarget = event.target; }

function backdrop(event) {
    const host = event.currentTarget;
    if (event.target !== host || pressTarget !== host) return;
    const rect = host.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) finish(cancelValue());
}

watch(current, async (request) => {
    if (!request) return;
    value.value = request.defaultValue ?? '';
    await nextTick();
    if (!dialog.value.open) dialog.value.showModal();
    if (field.value) field.value.select();
    else primary.value?.focus();
});
</script>