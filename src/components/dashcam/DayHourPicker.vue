<script setup>
// Bottom sheet: a week of days, then the 24 hours of the chosen day on a
// 12-hour clock. Each hour shows how long the vehicle moved (GPS) and a dot
// when video is known to exist there. Every past hour looks the same whether
// or not it had driving or was checked; only future hours are disabled.
import { ref, computed, watch } from 'vue';
import { addDays, dayStart, fmtDay, fmtHour12, fmtHourRange12, HOUR_MS } from '@/utils/dashcamPlayback';

const props = defineProps({
  dayMs: { type: Number, required: true },
  hourMs: { type: Number, required: true },
  hours: { type: Array, default: () => [] },     // [{ hour, minutes, video: 'yes' | 'check' | null }]
  dailyKm: { type: Array, default: () => [] },   // [{ day, km }]
  loading: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'day', 'pick']);

const today = dayStart(Date.now());
const weekEnd = ref(props.dayMs > addDays(today, -7) ? today : props.dayMs);
watch(() => props.dayMs, (d) => { if (d > weekEnd.value || d <= addDays(weekEnd.value, -7)) weekEnd.value = d; });

const days = computed(() => {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(weekEnd.value, -i);
    const km = props.dailyKm.find((x) => x.day === d)?.km;
    out.push({
      day: d,
      dow: new Date(d).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(),
      num: new Date(d).getDate(),
      drove: km == null ? null : km > 0.2,
      selected: d === props.dayMs,
      future: d > today,
    });
  }
  return out;
});

const now = Date.now();
const grid = computed(() => props.hours.map((h) => {
  return {
    ...h,
    label: fmtHour12(h.hour),
    future: h.hour > now,
    selected: h.hour === props.hourMs,
    pct: Math.round((h.minutes / 60) * 100),
  };
}));

const totalMin = computed(() => props.hours.reduce((s, h) => s + h.minutes, 0));
const totalLabel = computed(() => {
  const m = totalMin.value;
  if (!m) return 'No driving';
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m driving` : `${m} min driving`;
});

const pickedHour = ref(props.hourMs);
watch(() => props.hourMs, (h) => { pickedHour.value = h; });
const pickedLabel = computed(() => fmtHourRange12(pickedHour.value, pickedHour.value + HOUR_MS));
const pickedInDay = computed(() => props.hours.some((h) => h.hour === pickedHour.value));

function chooseHour(h) {
  if (h.future) return;
  pickedHour.value = h.hour;
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center bg-black/50" @click.self="emit('close')">
    <section role="dialog" aria-label="Choose day and hour" class="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl px-4 pt-2.5 pb-safe-bottom flex flex-col gap-3.5" style="padding-bottom: max(1.25rem, env(safe-area-inset-bottom))">
      <span class="self-center w-10 h-1 rounded-full bg-gray-300 sm:hidden"></span>
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold text-gray-800">Choose time</h2>
        <button type="button" @click="emit('close')" class="w-11 h-11 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center" aria-label="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="flex items-center gap-1">
        <button type="button" @click="weekEnd = addDays(weekEnd, -7)" class="w-8 h-14 text-gray-500 flex items-center justify-center" aria-label="Previous week">
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <button
          v-for="d in days"
          :key="d.day"
          type="button"
          :disabled="d.future"
          @click="emit('day', d.day)"
          class="flex-1 h-14 rounded-xl flex flex-col items-center justify-center gap-0.5 border transition-colors disabled:opacity-30"
          :class="d.selected ? 'bg-brand border-brand text-white' : 'bg-white border-gray-200 text-gray-800'"
          :aria-label="fmtDay(d.day, { weekday: 'long', day: 'numeric', month: 'long' })"
        >
          <span class="text-[10px] font-semibold">{{ d.dow }}</span>
          <span class="text-[15px] font-bold leading-none">{{ d.num }}</span>
          <span class="w-1.5 h-1.5 rounded-full" :class="d.drove ? (d.selected ? 'bg-white' : 'bg-gray-400') : 'bg-transparent'"></span>
        </button>
        <button type="button" @click="weekEnd = addDays(weekEnd, 7)" :disabled="weekEnd >= today" class="w-8 h-14 text-gray-500 flex items-center justify-center disabled:opacity-30" aria-label="Next week">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>

      <div class="flex justify-between items-baseline">
        <span class="text-sm font-bold text-gray-800">{{ fmtDay(dayMs, { weekday: 'long', day: 'numeric', month: 'long' }) }}</span>
        <span class="text-[11px] text-gray-500">{{ loading ? 'Loading…' : totalLabel }}</span>
      </div>

      <div class="grid grid-cols-6 gap-1.5">
        <button
          v-for="h in grid"
          :key="h.hour"
          type="button"
          :disabled="h.future"
          @click="chooseHour(h)"
          class="relative h-[52px] rounded-[10px] px-1.5 pt-1.5 pb-2 flex flex-col justify-between items-stretch border transition-colors disabled:opacity-30"
          :class="h.hour === pickedHour ? 'bg-brand border-brand' : 'bg-white border-gray-200'"
          :aria-label="`${h.label}, ${h.minutes} minutes driving${h.video === 'yes' ? ', video' : ''}`"
        >
          <span
            v-if="h.video === 'yes'"
            class="absolute top-1.5 right-1.5 w-[7px] h-[7px] rounded-full"
            :class="h.hour === pickedHour ? 'bg-white' : 'bg-brand'"
          ></span>
          <span class="text-[12px] font-bold text-left whitespace-nowrap" :class="h.hour === pickedHour ? 'text-white' : 'text-gray-800'">{{ h.label }}</span>
          <span class="block w-full h-1 rounded-full overflow-hidden" :class="h.hour === pickedHour ? 'bg-white/30' : 'bg-[#eceae4]'">
            <span class="block h-1" :style="{ width: h.pct + '%' }" :class="h.hour === pickedHour ? 'bg-white' : 'bg-gray-400'"></span>
          </span>
        </button>
      </div>

      <div class="flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-gray-600">
        <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-brand"></span>Video</span>
        <span class="flex items-center gap-1.5"><span class="w-3.5 h-1 rounded-full bg-gray-400"></span>Driving</span>
      </div>

      <button
        type="button"
        :disabled="!pickedInDay"
        @click="emit('pick', pickedHour)"
        class="h-[52px] rounded-2xl bg-brand hover:bg-brand-dark text-white text-[15px] font-bold disabled:opacity-50"
      >Open {{ pickedLabel }}</button>
    </section>
  </div>
</template>
