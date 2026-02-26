import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router'; 
import './style.css'; 
import App from './App.vue';
import { App as CapacitorApp } from '@capacitor/app'; 
import '@fortawesome/fontawesome-free/css/all.css'; 
import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'

// Import the new Service
import { LifecycleService } from '@/utils/lifecycle';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

// Initialize the Centralized Lifecycle Manager
// This sets up Auth, Network, and App State listeners
LifecycleService.init();

// Deep Links (Still good to keep here or move to lifecycle if prefered)
CapacitorApp.addListener('appUrlOpen', (data) => {
  const url = new URL(data.url);
  if (url.pathname === '/auth/action') {
    router.push({ path: '/auth/action', query: Object.fromEntries(url.searchParams) });
  }
});

// Remove old auth.addListener logic here
// Remove old Network.addListener logic here

app.mount('#app');