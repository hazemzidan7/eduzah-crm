import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || "AIzaSyC2i1unyX1Q-uufoIHm6tjDbXVuaepkOKE",
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || "eduzah-crm.firebaseapp.com",
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || "eduzah-crm",
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || "eduzah-crm.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID|| "894794855653",
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || "1:894794855653:web:0e0d1421f1deebce49900c",
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID     || "G-MTR0XJR3SY",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
export { app, firebaseConfig };
export default app;
