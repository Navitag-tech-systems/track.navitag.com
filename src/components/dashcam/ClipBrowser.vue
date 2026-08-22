<script setup>
// Recorded-clip browser. "Refresh list" sends 9205 for the selected window
// and then waits for the device's answer, which Traccar stores as a position
// carrying attributes.mediaList. Two ways to notice it:
//   1. the live socket — stores/devices.js copies mediaList onto
//      device.mediaList when a position with it arrives;
//   2. a /api/positions poll, for when the socket is down or the frame was
//      missed.
// Whichever lands first wins.
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue';
import { useUserStore } from '@/stores/user.js';
import { useToastStore } from '@/stores/toast.js';
import DatePicker from '@/components/datePicker.vue';
import InlineLoader from '@/components/InlineLoader.vue';
import ClipPlayer from './ClipPlayer.vue';
import {
  videoChannels, body9205, customCommand, sendCommand, findMediaList,
  parseMediaList, groupByDay, clipDurationSec, formatDuration, formatMB,
} from '@/utils/dashcam';

const props = defineProps({
  device: { type: Object, required: true },
});

const userStore = useUserStore();
const toast = useToastStore();
const server = computed(() => userStore.server_url);

const toLocalDateString = (d = new Date()) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

const today = toLocalDateString();
const dateFrom = ref(toLocalDateString(new Date(Date.now() - 2 * 86400_000)));
const dateTo = ref(today);
const channels = computed(() => videoChannels(props.device));
// 0 = all channels (JT/T 1078 uses channel 0 for "all").
const channelFilter = ref(0);

// idle | sending | waiting | ready | timeout | error
const state = ref('idle');
const errorMsg = ref('');
const clips = ref([]);
const listedAt = ref(null);
const selected = ref(null);

const RESPONSE_TIMEOUT_MS = 40_000;
const POLL_MS = 4000;
let pollTimer = null;
let deadline = null;
let requestedAt = 0;

const busy = computed(() => state.value === 'sending' || state.value === 'waiting');

const visibleClips = computed(() => {
  const list = channelFilter.value ? clips.value.filter((c) => c.ch === channelFilter.value) : clips.value;
  return groupByDay(list);
});

const channelName = (ch) => channels.value.find((c) => c.index === ch)?.name || `Ch ${ch}`;
const dayLabel = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};
const timeLabel = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function windowDates() {
  const [fy, fm, fd] = dateFrom.value.split('-').map(Number);
  const [ty, tm, td] = dateTo.value.split('-').map(Number);
  return {
    start: new Date(fy, fm - 1, fd, 0, 0, 0),
    end: new Date(ty, tm - 1, td, 23, 59, 59),
  };
}

function accept(result, source) {
  stopWaiting();
  clips.value = result.clips;
  listedAt.value = new Date(result.receivedMs || Date.now());
  state.value = 'ready';
  if (source === 'poll' || source === 'socket') {
    toast.show(`${result.count} clip${result.count === 1 ? '' : 's'} listed.`, { variant: 'success', durationMs: 2500 });
  }
}

function stopWaiting() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  deadline = null;
}

async function pollOnce() {
  if (!server.value) return;
  try {
    const r = await findMediaList(server.value, props.device.id, requestedAt - 5000);
    if (r && state.value === 'waiting') accept(r, 'poll');
    else if (Date.now() > deadline) {
      stopWaiting();
      state.value = 'timeout';
    }
  } catch (err) {
    // Keep polling until the deadline; a transient 5xx is not a verdict.
    if (Date.now() > deadline) {
      stopWaiting();
      state.value = 'timeout';
    }
  }
}

async function refresh() {
  if (busy.value || !server.value) return;
  if (dateFrom.value > dateTo.value) {
    toast.show('"From" must be before "To".', { variant: 'error' });
    return;
  }
  state.value = 'sending';
  errorMsg.value = '';
  const { start, end } = windowDates();
  requestedAt = Date.now();
  try {
    await sendCommand(server.value, props.device.id, customCommand('9205', body9205(channelFilter.value, start, end)));
  } catch (err) {
    state.value = 'error';
    errorMsg.value = err?.status === 403
      ? 'You do not have permission to query this dashcam.'
      : (err?.message || 'Could not send the list request.');
    return;
  }
  state.value = 'waiting';
  deadline = requestedAt + RESPONSE_TIMEOUT_MS;
  pollTimer = setInterval(pollOnce, POLL_MS);
}

// Socket path: the store stamps device.mediaList when a mediaList position
// arrives live.
watch(() => props.device.mediaList, (m) => {
  if (!m || state.value !== 'waiting') return;
  if ((m.receivedMs || 0) < requestedAt - 5000) return;
  accept({
    clips: parseMediaList(m.raw),
    count: Number(m.count ?? 0),
    receivedMs: m.receivedMs,
  }, 'socket');
});

// On open, show the last list the device sent (past 7 days) without waking
// it — a stale list beats an empty screen, and it is labelled with its time.
onMounted(async () => {
  if (!server.value) return;
  try {
    const r = await findMediaList(server.value, props.device.id, Date.now() - 7 * 86400_000);
    if (r && state.value === 'idle') {
      clips.value = r.clips;
      listedAt.value = new Date(r.receivedMs);
      state.value = 'ready';
    }
  } catch { /* fresh account / no positions yet */ }
});

onBeforeUnmount(stopWaiting);
</script>

<template>
  <div class="space-y-4">
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <DatePicker v-model="dateFrom" label="From" :max="dateTo" />
        <DatePicker v-model="dateTo" label="To" :min="dateFrom" :max="today" />
      </div>

      <div>
        <p class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Camera</p>
        <div class="flex gap-2 flex-wrap">
          <button
            type="button"
            @click="channelFilter = 0"
            class="px-3 py-1.5 rounded-full text-sm font-bold border transition-colors"
            :class="channelFilter === 0 ? 'bg-brand text-white border-brand' : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-100'"
          >All</button>
          <button
            v-for="c in channels"
            :key="c.index"
            type="button"
            @click="channelFilter = c.index"
            class="px-3 py-1.5 rounded-full text-sm font-bold border transition-colors"
            :class="channelFilter === c.index ? 'bg-brand text-white border-brand' : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-100'"
          >{{ c.name }}</button>
        </div>
      </div>

      <button
        type="button"
        @click="refresh"
        :disabled="busy || !server"
        class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <InlineLoader v-if="busy" class="text-white" />
        <i v-else class="fa-solid fa-rotate"></i>
        {{ state === 'sending' ? 'Sending…' : state === 'waiting' ? 'Waiting for the dashcam…' : 'Refresh list' }}
      </button>

      <p v-if="state === 'error'" class="text-xs text-red-500 leading-snug">{{ errorMsg }}</p>
      <p v-else-if="state === 'timeout'" class="text-xs text-amber-600 leading-snug">
        No answer from the dashcam in 40 s. It may be asleep or offline — try again when the vehicle is on.
      </p>
      <p v-else-if="listedAt" class="text-[11px] text-gray-400">
        List from {{ listedAt.toLocaleString(undefined, { hour12: false }) }}
      </p>
    </div>

    <div v-if="visibleClips.length === 0 && state === 'ready'" class="text-center text-sm text-gray-500 py-6">
      No clips in this range.
    </div>
    <div v-else-if="visibleClips.length === 0 && state === 'idle'" class="text-center text-sm text-gray-500 py-6">
      Pick a range and tap Refresh list to ask the dashcam what it has recorded.
    </div>

    <div v-for="group in visibleClips" :key="group.day" class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div class="bg-surface px-4 py-2.5 border-b border-gray-100 font-bold text-sm text-gray-700 flex justify-between">
        <span>{{ dayLabel(group.day) }}</span>
        <span class="text-gray-400 font-normal">{{ group.clips.length }}</span>
      </div>
      <ul class="divide-y divide-gray-100">
        <li
          v-for="clip in group.clips"
          :key="clip.id"
          @click="selected = clip"
          class="px-4 py-3 flex items-center gap-3 hover:bg-brand-light cursor-pointer transition-colors"
        >
          <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" :class="clip.alarm ? 'bg-red-50 text-red-500' : 'bg-brand-light text-brand'">
            <i class="fa-solid" :class="clip.alarm ? 'fa-triangle-exclamation' : 'fa-film'"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-bold text-gray-800">{{ timeLabel(clip.start) }} – {{ timeLabel(clip.end) }}</p>
            <p class="text-[11px] text-gray-400">{{ formatDuration(clipDurationSec(clip)) }} · {{ formatMB(clip.size) }}</p>
          </div>
          <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 shrink-0">
            {{ channelName(clip.ch) }}
          </span>
          <i class="fa-solid fa-chevron-right text-gray-300 text-xs"></i>
        </li>
      </ul>
    </div>

    <ClipPlayer v-if="selected" :device="device" :clip="selected" @close="selected = null" />
  </div>
</template>
