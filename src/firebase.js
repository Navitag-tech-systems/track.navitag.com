import { initializeApp } from "firebase/app";

import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
//import { Capacitor } from "@capacitor/core";

// 1. Your Web Config from Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyBlPBeK-kc2jKhYJzG1d70QWiuWLTr62LM",
  authDomain: "auth.navitag.com",
  projectId: "track-navitag-com",
  storageBucket: "track-navitag-com.firebasestorage.app",
  messagingSenderId: "729666105352",
  appId: "1:729666105352:web:5bde3b1e1b78bb280ca1bd",
  measurementId: "G-47PTDFYLHH"
};

// 2. Initialize App
initializeApp(firebaseConfig);

export const auth = FirebaseAuthentication;

