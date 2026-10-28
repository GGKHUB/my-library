// Firebase web config is public by design. Firestore access is controlled by firestore.rules.
// Replace the values below with the Web app config from Firebase Console.
export const firebaseConfig = {
  apiKey: "AIzaSyAuH3iPG87tNq_l5RLrDzW3V_ZDORaUAwc",
  authDomain: "my-library-287c6.firebaseapp.com",
  projectId: "my-library-287c6",
  storageBucket: "my-library-287c6.firebasestorage.app",
  messagingSenderId: "746638404467",
  appId: "1:746638404467:web:f678472e0307f108b73306",
  measurementId: "G-9K0R1BKESF"
};

export const firebaseConfigReady = () =>
  Boolean(firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith("PASTE_") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.startsWith("PASTE_"));

