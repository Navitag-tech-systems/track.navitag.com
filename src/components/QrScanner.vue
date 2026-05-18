<script setup>
import { CapacitorBarcodeScanner } from '@capacitor/barcode-scanner';
import { Capacitor } from '@capacitor/core';

const props = defineProps({
  hint: { type: Number, default: 17 }, // 17 = ALL formats
  cameraDirection: { type: Number, default: 1 }, // 1 = BACK
});

const emit = defineEmits(['scanned', 'error', 'cancelled']);

const scan = async () => {
  try {
    // Web pre-check: the plugin's web implementation can throw uncatchable errors
    // if permissions are denied — pre-acquire the stream to surface NotAllowedError.
    if (Capacitor.getPlatform() === 'web') {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API not supported in this browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
    }

    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: props.hint,
      cameraDirection: props.cameraDirection,
    });

    if (result?.ScanResult) {
      emit('scanned', result.ScanResult);
      return result.ScanResult;
    }
    emit('cancelled');
    return null;
  } catch (err) {
    emit('error', err);
    return null;
  }
};

defineExpose({ scan });
</script>

<template></template>
