
import { auth } from '@/firebase'; 
/* ------------------------------------------------------------------
 * Auth providers
 * ------------------------------------------------------------------ */

export const supportedProviders = [
  {
    id: 'google',
    name: 'Google',
    color: 'bg-red-400',
    handler: async () => {
      try {
        console.log('[Google SSO] Starting sign-in');
        const result = await auth.signInWithGoogle();
        return result.user;
      } catch (error) {
        console.error('[Google SSO] Error:', error);
        throw error;
      } 
    }
  },
  {
    id: 'apple',
    name: 'Apple',
    color: 'bg-black',
    handler: async () => {
      try {        
        console.log('[Apple SSO] Starting sign-in');
        const result = await auth.signInWithApple();
        return result.user;
      } catch (error) {
        console.error('[Apple SSO] Error:', error);
        throw error;
      } 
    }
  },
  {
    id: 'facebook',
    name: 'Facebook',
    color: 'bg-blue-400',
    handler: async () => {
      try {
        console.log('[Facebook SSO] Starting sign-in');
        const result = await auth.signInWithFacebook();
        return result.user;
      } catch (error) {
        console.error('[Facebook SSO] Error:', error);
        throw error;
      } 
    }
  }
];


export const signInWithEmailAndPassword = async (email, password) => {
  const result = await auth.signInWithEmailAndPassword({
    email: email,
    password: password,
  });
  return result.user;
};

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
    case 'auth/credential-already-in-use':
      return 'This credential is already associated with a different account.';
    default:
      return error?.message || 'Authentication failed.';
  }
};