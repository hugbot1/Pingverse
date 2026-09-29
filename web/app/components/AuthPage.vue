<template>
  <div id="auth-screen">
    <img src="/assets/logos/logo.png" alt="Pingverse logo" class="logo-img logo-auth">
    <div class="card">
      <div class="tabs">
        <button class="tab" :class="{ active: mode === 'login' }" type="button" @click="setMode('login')">LOGIN</button>
        <button class="tab" :class="{ active: mode === 'register' }" type="button" @click="setMode('register')">REGISTER</button>
      </div>
      <div class="alert" :class="{ visible: alert.message, success: alert.success }" role="alert">{{ alert.message }}</div>
      <form novalidate @submit.prevent="submit">
        <input v-model="username" type="text" placeholder="Username" autocomplete="username" maxlength="20" required>
        <input v-model="password" type="password" placeholder="Password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" maxlength="128" required>
        <p class="field-hint" :class="{ hidden: mode !== 'register' }">Username: 3-20 letters, numbers, _ or -. Password: at least 8 characters. New accounts must be approved by an administrator before you can sign in.</p>
        <button class="btn" type="submit" :disabled="busy">{{ busy ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Request Account' }}</button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';

const { get, post } = usePingverseApi();
const mode = ref('login');
const username = ref('');
const password = ref('');
const busy = ref(false);
const alert = reactive({ message: '', success: false });

useHead({ title: 'Pingverse - Sign In' });

function showAlert(message, success = false) {
  alert.message = message;
  alert.success = success;
}

function setMode(next) {
  mode.value = next;
  alert.message = '';
  alert.success = false;
}

onMounted(async () => {
  try {
    const me = await get('/auth/me');
    if (me?.username) window.location.href = '/chat';
  } catch {
    // Keep the sign-in form usable while the API is unavailable.
  }
});

async function submit() {
  alert.message = '';
  const name = username.value.trim();
  if (!name || !password.value) return showAlert('Username and password are required.');

  busy.value = true;
  try {
    if (mode.value === 'register') {
      const result = await post('/auth/register', { username: name, password: password.value });
      setMode('login');
      password.value = '';
      showAlert(result.message || 'Account created. Waiting for admin approval.', true);
    } else {
      await post('/auth/login', { username: name, password: password.value });
      window.location.href = '/chat';
    }
  } catch (error) {
    showAlert(error.message);
  } finally {
    busy.value = false;
  }
}
</script>
