import { initializeApp } from "firebase/app";
import { getAuth, indexedDBLocalPersistence, initializeAuth } from "firebase/auth";
import { Capacitor } from "@capacitor/core";

// 1. Your Web Config from Firebase Console
const firebaseConfig = {

  apiKey: "AIzaSyBlPBeK-kc2jKhYJzG1d70QWiuWLTr62LM",

  authDomain: "track-navitag-com.firebaseapp.com",

  projectId: "track-navitag-com",

  storageBucket: "track-navitag-com.firebasestorage.app",

  messagingSenderId: "729666105352",

  appId: "1:729666105352:web:5bde3b1e1b78bb280ca1bd",

  measurementId: "G-47PTDFYLHH"

};

// 2. Initialize App
export const app = initializeApp(firebaseConfig);

// 3. Initialize Auth with Persistence
// This ensures the user stays logged in even if the app closes
let auth;

if (Capacitor.isNativePlatform()) {
    // Mobile: Use standard initialization, Capacitor handles persistence natively usually
    // But sometimes we need to force IndexedDB if local storage is flaky
    auth = initializeAuth(app, {
        persistence: indexedDBLocalPersistence
    });
} else {
    // Web
    auth = getAuth(app);
}

export { auth };