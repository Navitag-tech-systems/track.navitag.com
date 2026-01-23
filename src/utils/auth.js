import { 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  OAuthProvider, 
  signInWithCredential 
} from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth } from '@/firebase';

export const supportedProviders = [
  {
    id: 'google',
    name: 'Google',
    icon: 'fa-brands fa-google',
    color: 'bg-red-600 hover:bg-red-700',
    handler: async () => {
      const result = await FirebaseAuthentication.signInWithGoogle();
      const credential = GoogleAuthProvider.credential(result.credential.idToken);
      return signInWithCredential(auth, credential);
    }
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: 'fa-brands fa-facebook-f',
    color: 'bg-blue-600 hover:bg-blue-700',
    handler: async () => {
      const result = await FirebaseAuthentication.signInWithFacebook();
      const credential = FacebookAuthProvider.credential(result.credential.accessToken);
      return signInWithCredential(auth, credential);
    }
  },
  {
    id: 'apple',
    name: 'Apple',
    icon: 'fa-brands fa-apple',
    color: 'bg-black hover:bg-gray-800',
    handler: async () => {
      const result = await FirebaseAuthentication.signInWithApple();
      const provider = new OAuthProvider('apple.com');
      const credential = provider.credential({
        idToken: result.credential.idToken,
        rawNonce: result.credential.rawNonce,
      });
      return signInWithCredential(auth, credential);
    }
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    icon: 'fa-brands fa-microsoft',
    color: 'bg-green-600 hover:bg-green-700',
    handler: async () => {
      // 1. Native Sign In
      const result = await FirebaseAuthentication.signInWithMicrosoft();
      
      // 2. Web Layer Sign In
      const provider = new OAuthProvider('microsoft.com');
      const credential = provider.credential({
        idToken: result.credential.idToken,
        accessToken: result.credential.accessToken // Optional, but good for Graph API
      });
      
      return signInWithCredential(auth, credential);
    }
  }
];

export const getErrorMessage = (error) => {
  switch (error.code) {
    case 'auth/user-not-found': return 'No account found with this email.';
    case 'auth/wrong-password': return 'Incorrect password.';
    case 'auth/email-already-in-use': return 'Email is already registered.';
    case 'auth/weak-password': return 'Password should be at least 6 characters.';
    case 'auth/invalid-email': return 'Invalid email address.';
    case 'auth/account-exists-with-different-credential': return 'An account already exists with the same email address.';
    default: return error.message;
  }
};