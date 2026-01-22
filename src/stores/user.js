import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useUserStore = defineStore('user', () => {
  // State
  const user = ref(null);
  const idToken = ref(null);
  const loading = ref(true); // "Is Firebase checking the disk?"

  // Getters (Computed properties)
  const isLoggedIn = computed(() => user.value !== null);

  // Actions
  function setUser(firebaseUser) {
    user.value = firebaseUser;
    loading.value = false;
  }

  function setToken(token) {
    idToken.value = token;
  }

  function clearUser() {
    user.value = null;
    idToken.value = null;
    loading.value = false;
  }

  return { user, idToken, loading, isLoggedIn, setUser, setToken, clearUser };
});