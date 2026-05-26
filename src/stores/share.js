import { defineStore } from 'pinia';
import { ref } from 'vue';
import { request } from '@/utils/http';
import { baseUrl } from '@/utils/variables';
import { useUserStore } from '@/stores/user.js';

export const useShareStore = defineStore('share', () => {
  // --- State ---
  const loading = ref(false);
  const error = ref(null);
  const lastShare = ref(null);

  // --- Actions ---


  /**
   * Mint a public share-link token for one or more of the caller's devices.
   * See: POST /share/public — api.navitag.net/v1/API_DOCUMENTATION.md
   *
   * @param {string|number|Array<string|number>} devices - Single IMEI or array of IMEIs
   * @param {Object} [options]
   * @param {number} [options.ttlSeconds] - Lifetime in seconds (60 – 86400). Defaults to backend default (43200 / 12h).
   * @param {string} [options.label] - Optional free-form description
   * @returns {Promise<{ token, share_url, devices, expires_at, ttl_seconds }>}
   */
  const createPublicShare = async (devices, { ttlSeconds, label } = {}) => {
    const userStore = useUserStore();
    loading.value = true;
    error.value = null;

    try {
      const data = { devices };
      if (ttlSeconds != null) data.ttl_seconds = ttlSeconds;
      if (label) data.label = label;

      const res = await request.send({
        url: `${baseUrl}/share/public`,
        method: 'POST',
        data,
        token: userStore.idToken,
      });

      if (!res || res.status !== 'success') {
        throw new Error('Failed to create share link');
      }

      const share = {
        token: res.token,
        share_url: `https://share.navitag.net/t/${res.token}`,
        devices: res.devices,
        expires_at: res.expires_at,
        ttl_seconds: res.ttl_seconds,
        label: label || null,
      };

      lastShare.value = share;
      return share;
    } catch (err) {
      error.value = err;
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const clearLastShare = () => {
    lastShare.value = null;
    error.value = null;
  };

  return {
    // State
    loading,
    error,
    lastShare,

    // Actions
    createPublicShare,
    clearLastShare,
  };
});
