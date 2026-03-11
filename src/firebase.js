import { initializeApp } from "firebase/app";
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAJ4PiCzf5cMhp1FCEv1EA478rlC1H9FOU",
  authDomain: "kitzur-app1.firebaseapp.com",
  projectId: "kitzur-app1",
  storageBucket: "kitzur-app1.firebasestorage.app",
  messagingSenderId: "603995451341",
  appId: "1:603995451341:web:61f543cfdb200891381e84"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);