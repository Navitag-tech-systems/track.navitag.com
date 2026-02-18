import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { auth } from './firebase'; 
import { setUserId } from './utils/analytics';
import { useUserStore } from './stores/user';
import router from './router'; // Import the router
import './style.css'; 
import App from './App.vue';
import { App as CapacitorApp } from '@capacitor/app'; // Import Capacitor App plugin
import '@fortawesome/fontawesome-free/css/all.css'; // <--- Add this line

import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router); // Use the router

const userStore = useUserStore(pinia);

// Replace Web SDK listener with Capawesome plugin listener
auth.addListener('authStateChange', async (data) => {
  const firebaseUser = data.user;
  if (firebaseUser) {
    userStore.setUser(firebaseUser);
    if(!firebaseUser.emailVerified){
      //send email verification
    }
    
    // The plugin provides the token in the user object or via getIdToken()
    const result = await auth.getIdToken();
    userStore.setToken(result.token);
    // set user ID for analytics
    await setUserId(firebaseUser.uid);
    
    router.replace('/');
  } else {
    userStore.clearUser();
    if (router.currentRoute.value.meta.requiresAuth) {
      router.replace('/login');
    }
  }
});

// Handle Deep Links (Password Resets / Email Verifications)
CapacitorApp.addListener('appUrlOpen', (data) => {
  // Extract the path from the URL (e.g., https://track.navitag.com/auth/action?mode=...)
  const url = new URL(data.url);
  
  // If it's the auth action route, push to router
  if (url.pathname === '/auth/action') {
    router.push({ path: '/auth/action', query: Object.fromEntries(url.searchParams) });
  }
});


app.mount('#app');