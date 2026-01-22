import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase'; // Import the auth instance we made earlier
import { useUserStore } from './stores/user';
import './style.css'; // Tailwind 4 import
import App from './App.vue';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);

// --- The Critical Auth Bridge ---
// We access the store OUTSIDE the component (requires pinia instance to be active)
const userStore = useUserStore(pinia);

// Wait for Firebase to check local storage
onAuthStateChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    // User is logged in
    userStore.setUser(firebaseUser);
    
    // Get the PHP Token immediately
    const token = await firebaseUser.getIdToken();
    userStore.setToken(token);
    
    console.log("User restored:", firebaseUser.email);
  } else {
    // User is logged out
    userStore.clearUser();
    console.log("No user found");
  }
});

app.mount('#app');