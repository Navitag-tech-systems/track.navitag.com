import {
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  signInWithCredential
} from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth } from '@/firebase';

/* ------------------------------------------------------------------
 * Nonce utilities (Apple Sign-In requirement)
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

async function sha256(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ------------------------------------------------------------------
 * Auth providers
 * ------------------------------------------------------------------ */

export const supportedProviders = [
  {
    id: 'google',
    name: 'Google',
    color: 'bg-red-400',
    handler: async () => {
      const result = await FirebaseAuthentication.signInWithGoogle();
      const credential = GoogleAuthProvider.credential(
        result?.credential?.idToken
      );
      return signInWithCredential(auth, credential);
    }
  },

  {
    id: 'apple',
    name: 'Apple',
    color: 'bg-black',
    handler: async () => {
      // 1️⃣ Generate nonce
      const rawNonce = generateNonce();
      const hashedNonce = await sha256(rawNonce);

      // 2️⃣ Apple Sign-In (native iOS / web fallback)
      const result = await FirebaseAuthentication.signInWithApple({
        nonce: hashedNonce
      });

      if (!result?.credential?.idToken) {
        throw new Error('Apple Sign-In failed: missing identity token');
      }

      // 3️⃣ Exchange Apple credential for Firebase credential
      const provider = new OAuthProvider('apple.com');
      const credential = provider.credential({
        idToken: result.credential.idToken,
        rawNonce
      });

      return signInWithCredential(auth, credential);
    }
  },

  {
    id: 'facebook',
    name: 'Facebook',
    color: 'bg-blue-400',
    handler: async () => {
      const result = await FirebaseAuthentication.signInWithFacebook();
      const credential = FacebookAuthProvider.credential(
        result?.credential?.accessToken
      );
      return signInWithCredential(auth, credential);
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
      return 'Sign-in failed. Please try again.';
    default:
      return error?.message || 'Authentication failed.';
  }
};
