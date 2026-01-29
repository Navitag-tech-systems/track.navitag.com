import {
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  signInWithCredential
} from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth } from '@/firebase';

/* ------------------------------------------------------------------
 * Nonce utilities
 * ------------------------------------------------------------------ */

function generateNonce(length = 32) {
  const charset =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._';
  let result = '';
  const values = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) {
    result += charset[values[i] % charset.length];
  }
  return result;
}

// REMOVED: sha256 function is no longer needed in this file
// The Native Plugin handles the hashing internally.

/* ------------------------------------------------------------------
 * Prevent duplicate sign-in attempts
 * ------------------------------------------------------------------ */

const signingIn = {
  google: false,
  apple: false,
  facebook: false
};

/* ------------------------------------------------------------------
 * Auth providers
 * ------------------------------------------------------------------ */

export const supportedProviders = [
  {
    id: 'google',
    name: 'Google',
    color: 'bg-red-400',
    handler: async () => {
      if (signingIn.google) {
        throw new Error('Sign-in already in progress');
      }

      try {
        signingIn.google = true;

        const result = await FirebaseAuthentication.signInWithGoogle();
        const credential = GoogleAuthProvider.credential(
          result?.credential?.idToken
        );

        return await signInWithCredential(auth, credential);
      } finally {
        signingIn.google = false;
      }
    }
  },

  {
    id: 'apple',
    name: 'Apple',
    color: 'bg-black',
    handler: async () => {
      if (signingIn.apple) {
        throw new Error('Sign-in already in progress');
      }

      try {
        signingIn.apple = true;

        // 1️⃣ Generate a fresh RAW nonce
        const rawNonce = generateNonce();
        
        console.log('[Apple SSO] Starting sign-in');

        // 2️⃣ Call Native Plugin with the RAW nonce.
        // The Plugin will SHA256 hash it automatically before sending to Apple.
        const result = await FirebaseAuthentication.signInWithApple({
          skipNativeAuth: false, // Force Native System UI
          nonce: rawNonce,       // Pass RAW value here
          scopes: ['email', 'name']
        });

        if (!result?.credential?.idToken) {
          throw new Error('Apple Sign-In failed: missing identity token');
        }

        // 3️⃣ Exchange Apple token for Firebase credential
        // Pass the same RAW nonce to Firebase. Firebase will hash it 
        // and compare it to the hash inside the ID Token.
        const provider = new OAuthProvider('apple.com');
        const credential = provider.credential({
          idToken: result.credential.idToken,
          rawNonce: rawNonce // Pass RAW value here
        });

        console.log('[Apple SSO] Exchanging credential with Firebase');

        // This triggers onAuthStateChanged in your main.js
        const userCredential = await signInWithCredential(auth, credential);

        console.log('[Apple SSO] Firebase sign-in successful');

        return userCredential;
      } catch (error) {
        console.error('[Apple SSO] Error:', error);
        throw error;
      } finally {
        signingIn.apple = false;
      }
    }
  },

  {
    id: 'facebook',
    name: 'Facebook',
    color: 'bg-blue-400',
    handler: async () => {
      if (signingIn.facebook) {
        throw new Error('Sign-in already in progress');
      }

      try {
        signingIn.facebook = true;

        const result = await FirebaseAuthentication.signInWithFacebook();
        const credential = FacebookAuthProvider.credential(
          result?.credential?.accessToken
        );

        return await signInWithCredential(auth, credential);
      } finally {
        signingIn.facebook = false;
      }
    }
  }
];

/* ------------------------------------------------------------------
 * Error handling
 * ------------------------------------------------------------------ */

export const getErrorMessage = (error) => {
  switch (error?.code) {
    case 'auth/user-not-found':
      return 'No account found with this email.';
    case 'auth/wrong-password':
      return 'Incorrect password.';
    case 'auth/email-already-in-use':
      return 'Email is already registered.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/invalid-email':
      return 'Invalid email address.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with the same email address.';
    case 'auth/invalid-credential':
    case 'auth/invalid-idp-response':
    case 'auth/missing-or-invalid-nonce':
      return 'Sign-in failed. Please try again.';
    default:
      return error?.message || 'Authentication failed.';
  }
};