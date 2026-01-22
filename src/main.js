import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase'; 
import { useUserStore } from './stores/user';
import router from './router'; // Import the router
import './style.css'; 
import App from './App.vue';
import { App as CapacitorApp } from '@capacitor/app'; // Import Capacitor App plugin

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router); // Use the router

const userStore = useUserStore(pinia);

// Firebase listener
onAuthStateChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    userStore.setUser(firebaseUser);
    const token = await firebaseUser.getIdToken();
    userStore.setToken(token);
    
    // Redirect to home if user was on login page
    if (router.currentRoute.value.path === '/login') {
      router.replace('/');
    }
  } else {
    userStore.clearUser();
    
    // Redirect to login if user was on a protected page
    if (router.currentRoute.value.meta.requiresAuth) {
      router.replace('/login');
    }
  }
});

// Handle Deep Links (Password Resets / Email Verifications)
CapacitorApp.addListener('appUrlOpen', (data) => {
  // data.url contains the URL the app was opened with
  console.log('App opened with URL:', data.url);
  // You can parse this URL to detect if it's a firebase auth action
  // and route the user to a specific handler page if needed.
});


app.mount('#app');