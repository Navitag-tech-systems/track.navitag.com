import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router'; 
import './style.css'; 
import App from './App.vue';
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


app.mount('#app');