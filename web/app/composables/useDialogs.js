import { shallowRef } from 'vue';

const queue = [];
const current = shallowRef(null);

function advance() {
    current.value = queue.shift() || null;
}

function open(request) {
    return new Promise((resolve) => {
        queue.push({ ...request, resolve });
        if (!current.value) advance();
    });
}

export function useDialogs() {
    return {
        current,
        settle(result) {
            const request = current.value;
            if (!request) return;
            advance();
            request.resolve(result);
        },
        showAlert: (message, options = {}) => open({
            kind: 'alert',
            message: String(message ?? ''),
            confirmText: options.confirmText || 'OK',
        }),
        showConfirm: (message, options = {}) => open({
            kind: 'confirm',
            message: String(message ?? ''),
            confirmText: options.confirmText || 'Confirm',
            cancelText: options.cancelText || 'Cancel',
            danger: Boolean(options.danger),
        }),
        showPrompt: (message, defaultValue = '', options = {}) => open({
            kind: 'prompt',
            message: String(message ?? ''),
            defaultValue: String(defaultValue ?? ''),
            maxlength: options.maxlength,
            confirmText: options.confirmText || 'OK',
            cancelText: options.cancelText || 'Cancel',
        }),
    };
}