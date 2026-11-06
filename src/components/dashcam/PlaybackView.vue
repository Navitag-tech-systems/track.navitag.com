<script setup>
// Playback tab: choose a day and an hour, the video plays above a map that
// shows where the vehicle was at that instant.
//
// The video for an instant can live in three places (utils/dashcamPlayback):
// the hub-sync copy, the medusa rolling cache (newest hour per camera of
// whatever was streamed), or only on the camera's SD card. The UI shows none
// of that — one "video exists" band, one player. Video that has to come off
// the camera is streamed through the medusa receiver, which caches it as it
// plays, so a second viewing is instant.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useDevicesStore } from '@/stores/devices.js';
import InlineLoader from '@/components/InlineLoader.vue';
import HlsVideo from './HlsVideo.vue';
import TrackMap from './TrackMap.vue';
import { useVideoAspect } from './dashcamAspect';
import PlaybackTimeline from './PlaybackTimeline.vue';
import DayHourPicker from './DayHourPicker.vue';
import DownloadSheet from './DownloadSheet.vue';
import PlaybackTile from './PlaybackTile.vue';
import {
  videoChannels, deviceTimeZone, sendCommand, liveHlsUrl, waitForHls, clipIsSynced,
} from '@/utils/dashcam';
import {
  HOUR_MS, dayStart, hourStart, addDays, fmtHM, fmtHMS, fmtDay, fmtHourRange12,
  saneClips, mergeClips, clipsFromPositions, videoRanges, nextVideoStart, alarmMarks,
  toTrack, fixAt, trackPoints, drivingByHour, speedSamples, candidatesAt,
  fetchPositions, fetchDailyKm, fetchRecIndex, labelPlayback, playbackCommand, stopPlaybackCommand,
  listCommand, fetchListEntries, pickListAnswer, echoKey, playbackEchoes, loadListCache, saveListCache, isChecked,
} from '@/utils/dashcamPlayback';

const props = defineProps({
  device: { type: Object, required: true },
});

const userStore = useUserStore();
const deviceStore = useDevicesStore();
const { aspect, onAspect } = useVideoAspect(props.device.id, 'playback');
const server = computed(() => userStore.server_url);
const tz = computed(() => deviceTimeZone(props.device));
const channels = computed(() => videoChannels(props.device));
const ch = ref(channels.value[0]?.index ?? 1);
const online = computed(() => deviceStore.isDeviceOnline(props.device));

// "All": the selected camera stays the main player (playhead, sound, timeline,
// download); every other camera plays beside it in a muted PlaybackTile that
// follows the playhead. 2 columns, as many rows as needed.
const allMode = ref(false);
const followers = computed(() => (allMode.value ? channels.value.filter((c) => c.index !== ch.value) : []));
const grid = computed(() => followers.value.length > 0);
const boxAspect = computed(() => {
  const n = 1 + followers.value.length;
  if (n <= 1) return aspect.value;
  return (aspect.value * 2) / Math.ceil(n / 2);
});
const camName = (index) => channels.value.find((c) => c.index === index)?.name || `Camera ${index}`;

// --- time selection --------------------------------------------------------------

const dayMs = ref(dayStart(Date.now()));
const hourMs = ref(hourStart(Date.now()));
const hourEnd = computed(() => hourMs.value + HOUR_MS);
const t = ref(hourMs.value);
const userPicked = ref(false);

const hourLabel = computed(() => fmtHourRange12(hourMs.value, hourEnd.value));
const dayLabel = computed(() => fmtDay(hourMs.value));
const canNext = computed(() => hourEnd.value <= Date.now());

// --- data ---------------------------------------------------------------------------

const track = ref([]);
const loadingDay = ref(false);
const dailyKm = ref([]);
const stored = loadListCache(props.device.id, tz.value);
const clips = ref(saneClips(stored.clips));
const checked = ref(stored.checked);
const cache = ref({});

function persistLists() {
  saveListCache(props.device.id, { checked: checked.value, clips: clips.value });
}

function addClips(list) {
  clips.value = mergeClips(clips.value, saneClips(list));
  persistLists();
}

let dayToken = 0;
async function loadDay(day) {
  const my = ++dayToken;
  loadingDay.value = true;
  try {
    const pos = await fetchPositions(server.value, props.device.id, day, addDays(day, 1));
    if (my !== dayToken) return;
    track.value = toTrack(pos);
    addClips(clipsFromPositions(pos, tz.value));
  } catch {
    if (my === dayToken) track.value = [];
  } finally {
    if (my === dayToken) loadingDay.value = false;
  }
}

async function loadDailyKm() {
  const today = dayStart(Date.now());
  try {
    dailyKm.value = await fetchDailyKm(server.value, props.device.id, addDays(today, -13), addDays(today, 1));
  } catch { dailyKm.value = []; }
}

async function refreshCache() {
  try { cache.value = await fetchRecIndex(props.device); } catch { /* medusa down: hub + camera still work */ }
}

// --- derived ---------------------------------------------------------------------------

const ranges = computed(() => videoRanges({ clips: clips.value, cache: cache.value, ch: ch.value, from: hourMs.value, to: hourEnd.value }));
const hourChecked = computed(() => isChecked(checked.value, hourMs.value, hourEnd.value));

function hoursFor(trk, day) {
  return drivingByHour(trk, day).map((h) => {
    const hasVideo = channels.value.some((c) => videoRanges({ clips: clips.value, cache: cache.value, ch: c.index, from: h.hour, to: h.hour + HOUR_MS }).length);
    return { ...h, video: hasVideo ? 'yes' : null };
  });
}
const hours = computed(() => hoursFor(track.value, dayMs.value));
const hourDriving = computed(() => hours.value.find((h) => h.hour === hourMs.value)?.minutes ?? 0);

const points = computed(() => trackPoints(track.value, hourMs.value, hourEnd.value));
const fixNow = computed(() => fixAt(track.value, t.value));
const mapPosition = computed(() => {
  const f = fixNow.value;
  if (!f || !points.value.length) return null;
  return { t: (t.value - hourMs.value) / 1000 - points.value[0][0], lat: f.lat, lng: f.lng, course: f.course };
});
const speeds = computed(() => speedSamples(track.value, hourMs.value, hourEnd.value));
const alarms = computed(() => alarmMarks(clips.value, ch.value, hourMs.value, hourEnd.value));

// --- clip list (0x9205) for the selected hour ------------------------------------------------

const listing = ref(false);
const listNote = ref('');
let listRun = 0;                 // bumps when the hour changes: abandons a running check
const usedAnswers = new Set();   // 0x1205 position ids already attributed to a request
// Server time of the last answer taken. The next camera's answer must be
// NEWER: an empty list matches any camera, and the 2 s clock slack below would
// otherwise let camera N's "nothing here" pass for camera N+1's.
let lastAnswerMs = 0;
let socketAnswer = null;         // resolver for the camera currently being asked

// The live socket stamps device.mediaList when a 0x1205 answer arrives; it is
// the fast path, the positions poll is the fallback.
watch(() => props.device.mediaList, (m) => {
  if (m && socketAnswer) socketAnswer(m);
});

// Ask ONE camera for [from, to) and wait for its answer (see listCommand for
// why never all cameras at once). Resolves { clips, clean } or null.
async function askCamera(cam, from, to, run) {
  const at = Date.now();
  await sendCommand(server.value, props.device.id, listCommand(props.device, from, to, cam));
  const deadline = at + 25_000;
  // 2 s slack for browser-vs-server clock skew, but never at or before the
  // previous answer taken.
  const since = Math.max(at - 2000, lastAnswerMs + 1);
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    let entries = [];
    const finish = (v) => {
      if (done) return;
      done = true;
      if (socketAnswer === onSocket) socketAnswer = null;   // a newer check may own it now
      clearTimeout(timer);
      if (v) {
        usedAnswers.add(v.id);
        lastAnswerMs = Math.max(lastAnswerMs, entries.find((e) => e.id === v.id)?.receivedMs || 0);
      }
      resolve(v);
    };
    const onSocket = (m) => {
      // Same id and clock as the positions poll, so one answer is taken once.
      entries = [{ id: m.positionId ?? `s${m.receivedMs}`, receivedMs: m.receivedMs, raw: m.raw, count: m.count }];
      const v = pickListAnswer(entries, since, cam, tz.value, usedAnswers, playbackEchoes);
      if (v) finish(v);
    };
    socketAnswer = onSocket;
    const poll = async () => {
      if (done) return;
      if (run !== listRun) return finish(null);
      try {
        entries = await fetchListEntries(server.value, props.device.id, since);
        const v = pickListAnswer(entries, since, cam, tz.value, usedAnswers, playbackEchoes);
        if (v) return finish(v);
      } catch { /* keep polling until the deadline */ }
      if (Date.now() > deadline) return finish(null);
      timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 1500);
  });
}

async function ensureList({ force = false } = {}) {
  if (listing.value || !server.value) return;
  if (!force) {
    if (hourChecked.value) return;
    if (!online.value) { listNote.value = 'asleep'; return; }
    if (hourDriving.value === 0 && ranges.value.length) return;
  }
  const run = ++listRun;
  const from = hourMs.value;
  const to = hourEnd.value;
  listing.value = true;
  listNote.value = '';
  let allClean = true;
  let answered = 0;
  try {
    for (const c of channels.value) {
      const res = await askCamera(c.index, from, to, run);
      if (run !== listRun) return;
      if (!res) { allClean = false; continue; }
      answered++;
      if (!res.clean) allClean = false;
      addClips(res.clips);
      // Untouched hour: go to its first video as soon as one is known.
      if (autoStart.value) followFirstVideo();
      // Otherwise show this camera's video at the playhead once it is known.
      else if (c.index === ch.value && ['novideo', 'looking'].includes(status.value)) {
        playAt(t.value, { autoplay: false, allowRemote: false });
      }
    }
  } catch (err) {
    if (run !== listRun) return;
    listNote.value = err?.status === 403 ? 'denied' : 'failed';
    allClean = false;
  } finally {
    if (run === listRun) listing.value = false;
  }
  if (run !== listRun) return;
  if (allClean && answered === channels.value.length) {
    checked.value = [...checked.value, [from, to, Date.now()]];
    persistLists();
  } else if (!listNote.value) {
    listNote.value = !answered ? (online.value ? 'noanswer' : 'queued') : 'partial';
  }
  if (['novideo', 'looking'].includes(status.value)) playAt(t.value, { autoplay: false, allowRemote: false });
}

const listMessage = computed(() => {
  if (listing.value) return '';
  switch (listNote.value) {
    case 'asleep': return 'The camera is off. Video for this hour is checked when the vehicle is on.';
    case 'queued': return 'The camera is off. The check runs when the vehicle is on.';
    case 'noanswer': return 'The camera did not answer. Try again in a moment.';
    case 'partial': return 'Not every camera answered. Some video may be missing.';
    case 'denied': return 'You do not have permission to use this camera.';
    case 'failed': return 'Could not reach the camera.';
    default: return '';
  }
});

// --- player ---------------------------------------------------------------------------------

const playerRef = ref(null);
const videoSrc = ref('');
const source = ref(null);            // { kind, url, base, end, ch, native }
// idle | loading | looking | playing | paused | novideo | asleep | tap | error
const status = ref('idle');
const errorMsg = ref('');
const muted = ref(true);
const scrubbing = ref(false);
let pendingSeek = null;              // seconds into the source, applied on loadedmetadata
let pendingPlay = true;
let remote = null;                   // { ch } while the camera is streaming to medusa
let abort = null;
let resolveToken = 0;
let ending = false;

const hubChecks = new Map();
function hubCheck(url) {
  if (!hubChecks.has(url)) hubChecks.set(url, clipIsSynced(url));
  return hubChecks.get(url);
}

const video = () => playerRef.value?.video || null;

function setSource(src, offsetSec, autoplay) {
  pendingSeek = offsetSec;
  pendingPlay = autoplay;
  source.value = src;
  if (!src) { videoSrc.value = ''; return; }
  status.value = 'loading';
  if (videoSrc.value === src.url && video()) {
    applySeek();
  } else {
    videoSrc.value = src.url;
  }
}

function applySeek() {
  const v = video();
  if (!v || pendingSeek == null) return;
  try { v.currentTime = Math.max(0, pendingSeek); } catch { /* not seekable yet */ }
  pendingSeek = null;
  if (pendingPlay) v.play().catch(() => { status.value = 'paused'; });
  else { v.pause(); status.value = 'paused'; }
}

function onLoadedMeta() {
  if (pendingSeek != null) applySeek();
}

function onPlaying() {
  status.value = 'playing';
  ending = false;
}

function onPause() {
  if (status.value === 'playing') status.value = 'paused';
}

function onPlayerError(msg) {
  status.value = 'error';
  errorMsg.value = msg || 'Playback failed.';
}

async function stopRemote() {
  abort?.abort();
  abort = null;
  if (!remote) return;
  const r = remote;
  remote = null;
  try { await sendCommand(server.value, props.device.id, stopPlaybackCommand(r.ch)); } catch { /* best effort */ }
  setTimeout(refreshCache, 4000);
}

// Play camera `ch` at instant `target`. allowRemote=false never wakes the
// camera on its own (hour changes, first open); the play button does.
async function playAt(target, { autoplay = true, allowRemote = true, freshIndex = false } = {}) {
  const my = ++resolveToken;
  t.value = Math.max(hourMs.value, Math.min(target, hourEnd.value - 1000));
  errorMsg.value = '';
  let cands = candidatesAt({ t: t.value, ch: ch.value, clips: clips.value, cache: cache.value, uniqueId: props.device.uniqueId });
  // Never wake the camera on a stale cache index: what was just streamed (or
  // is streaming now) may already be cached. Re-read it once before falling
  // back to the camera.
  if (!freshIndex && cands.length && cands.every((c) => c.kind === 'hub' || c.kind === 'remote')
      && !cands.some((c) => c.kind === 'hub' && hubChecks.has(c.url) && hubChecks.get(c.url) === true)) {
    await refreshCache();
    if (my !== resolveToken) return;
    cands = candidatesAt({ t: t.value, ch: ch.value, clips: clips.value, cache: cache.value, uniqueId: props.device.uniqueId });
  }

  const cur = source.value;
  if (cur && cur.kind !== 'remote' && cur.ch === ch.value && t.value >= cur.base && t.value < cur.end
      && cands.some((c) => c.url === cur.url)) {
    pendingSeek = (t.value - cur.base) / 1000;
    pendingPlay = autoplay;
    applySeek();
    return;
  }

  for (const c of cands) {
    if (c.kind === 'hub') {
      const ok = await hubCheck(c.url);
      if (my !== resolveToken) return;
      if (!ok) continue;
    }
    if (c.kind === 'remote') {
      await stopRemote();
      if (my !== resolveToken) return;
      setSource(null);
      if (!online.value) { status.value = 'asleep'; return; }
      if (!allowRemote) { status.value = 'tap'; return; }
      return startRemote(c, my);
    }
    await stopRemote();
    if (my !== resolveToken) return;
    setSource({ ...c, ch: ch.value, native: c.kind === 'hub' }, (t.value - c.base) / 1000, autoplay);
    return;
  }
  await stopRemote();
  if (my !== resolveToken) return;
  setSource(null);
  status.value = listing.value ? 'looking' : 'novideo';
}

async function startRemote(c, my) {
  status.value = 'loading';
  const camera = ch.value;
  remote = { ch: camera };
  try {
    // Lets the cache file this stream under the right device time.
    await labelPlayback(props.device, camera, c.base).catch(() => {});
    // Superseded (camera switch, seek, leave) while the medusa label was in
    // flight: never send this 0x9201. Whoever superseded it owns `remote`.
    if (my !== resolveToken) return;
    playbackEchoes.add(echoKey(camera, c.base, c.end));
    await sendCommand(server.value, props.device.id, playbackCommand(props.device, camera, c.base, c.end));
  } catch (err) {
    if (remote?.ch === camera && my === resolveToken) remote = null;
    if (my !== resolveToken) return;
    status.value = 'error';
    errorMsg.value = err?.status === 403 ? 'You do not have permission to play video from this camera.' : 'Could not reach the camera.';
    return;
  }
  // Camera switched / stopped while the 0x9201 was in flight: stopRemote's
  // 0x9202 may have reached the device first, so close this one again —
  // unless the same camera has been asked for since (that request replaces it).
  if (my !== resolveToken) {
    if (remote?.ch !== camera) sendCommand(server.value, props.device.id, stopPlaybackCommand(camera)).catch(() => {});
    return;
  }
  const url = liveHlsUrl(props.device, camera);
  abort = new AbortController();
  try {
    await waitForHls(url, 45_000, { signal: abort.signal });
  } catch (err) {
    if (err?.message === 'aborted' || my !== resolveToken) return;
    status.value = 'error';
    errorMsg.value = 'The video did not start. Try again.';
    await stopRemote();
    return;
  }
  if (my !== resolveToken) { await stopRemote(); return; }
  // The medusa playlist starts at the first frame the camera sent, which is
  // `c.base` on the device clock, so the video clock maps 1:1 onto it.
  pendingSeek = null;
  source.value = { kind: 'remote', url, base: c.base, end: c.end, ch: camera, native: false };
  videoSrc.value = `${url}?t=${Date.now()}`;
}

function onSourceEnd() {
  const s = source.value;
  if (!s || ending) return;
  ending = true;
  if (s.end >= hourEnd.value - 1000 && hourEnd.value <= Date.now()) {
    selectHour(hourEnd.value, { at: hourEnd.value, autoplay: true });
    return;
  }
  const nx = nextVideoStart(ranges.value, s.end);
  if (nx != null && nx < hourEnd.value) playAt(nx, { autoplay: true });
  else {
    video()?.pause();
    status.value = 'paused';
  }
}

// Video clock -> playhead, ~10 Hz is plenty for the map and the timeline.
let raf = 0;
let lastTick = 0;
function tick(now) {
  raf = requestAnimationFrame(tick);
  if (now - lastTick < 100) return;
  lastTick = now;
  const v = video();
  const s = source.value;
  if (!v || !s || scrubbing.value || pendingSeek != null || v.paused || v.seeking) return;
  const nt = s.base + v.currentTime * 1000;
  t.value = nt;
  if (nt >= s.end - 300) onSourceEnd();
}

// --- controls -----------------------------------------------------------------------------

const isPlaying = computed(() => status.value === 'playing');

function togglePlay() {
  autoStart.value = false;
  const v = video();
  if (status.value === 'playing' && v) {
    v.pause();
    // A paused camera stream still streams from the vehicle SIM until its file
    // ends. Stop it; what was watched is cached, so Play resumes from there.
    if (source.value?.kind === 'remote') {
      stopRemote();
      setSource(null);
      status.value = 'tap';
    }
    return;
  }
  if (source.value && v && status.value === 'paused') { v.play().catch(() => {}); return; }
  playAt(t.value, { autoplay: true, allowRemote: true });
}

function skip(sec) {
  autoStart.value = false;
  // Only a playing player may wake the camera; a paused one just moves.
  const go = isPlaying.value || status.value === 'loading';
  playAt(t.value + sec * 1000, { autoplay: go, allowRemote: go });
}

function pickAll() {
  allMode.value = true;
}

function pickCamera(index) {
  allMode.value = false;
  if (index === ch.value) return;
  const wasPlaying = isPlaying.value;
  ch.value = index;
  source.value = null;
  playAt(t.value, { autoplay: wasPlaying, allowRemote: wasPlaying });
}

function toggleMute() {
  muted.value = !muted.value;
  const v = video();
  if (v) v.muted = muted.value;
}

function onScrub(nt) {
  autoStart.value = false;
  scrubbing.value = true;
  t.value = nt;
}

function onSeek(nt) {
  autoStart.value = false;
  scrubbing.value = false;
  // Keep playing if it was playing; a paused player stays paused at the new time.
  playAt(nt, { autoplay: isPlaying.value, allowRemote: isPlaying.value });
}

function onMapSeek(sec) {
  autoStart.value = false;
  playAt(hourMs.value + sec * 1000, { autoplay: isPlaying.value, allowRemote: isPlaying.value });
}

function playNext() {
  const nx = nextVideoStart(ranges.value, t.value);
  if (nx != null) playAt(nx, { autoplay: true });
}
const nextVideo = computed(() => nextVideoStart(ranges.value, t.value + 1000));

// --- hour / day -------------------------------------------------------------------------------

const picker = ref(false);
const downloadOpen = ref(false);

// The sheet may stream from the camera itself, so the player lets go of it
// first: pause, and end any camera stream (a stopped stream cannot resume, so
// the player goes back to "tap to play" at the same instant).
async function openDownload() {
  autoStart.value = false;
  video()?.pause();
  resolveToken++;                 // abandon a playback still starting
  if (source.value?.kind === 'remote' || remote) {
    await stopRemote();
    setSource(null);
    status.value = online.value ? 'tap' : 'asleep';
  } else if (status.value === 'playing' || status.value === 'loading') {
    status.value = 'paused';
  }
  downloadOpen.value = true;
}

function closeDownload() {
  downloadOpen.value = false;
  refreshCache();                 // video fetched for the download now plays from the timeline
}

// An hour opens on its first video: the selected camera's, else any camera's,
// else HH:00 until a camera's list arrives (then autoStart moves it, see below).
function firstVideoOf(h) {
  const r = videoRanges({ clips: clips.value, cache: cache.value, ch: ch.value, from: h, to: h + HOUR_MS });
  if (r.length) return r[0].start;
  const any = channels.value
    .map((c) => videoRanges({ clips: clips.value, cache: cache.value, ch: c.index, from: h, to: h + HOUR_MS })[0]?.start)
    .filter((x) => x != null);
  return any.length ? Math.min(...any) : null;
}

// True from opening an hour until the user moves the playhead themselves.
// While true, video that becomes known later pulls the playhead to the
// hour's first video.
const autoStart = ref(false);

function followFirstVideo() {
  if (!autoStart.value) return;
  const first = firstVideoOf(hourMs.value);
  if (first == null || Math.abs(first - t.value) < 1000) return;
  playAt(first, { autoplay: false, allowRemote: false });
}

async function selectHour(h, { at = null, autoplay = false } = {}) {
  const day = dayStart(h);
  hourMs.value = h;
  // Abandon a check still running for the previous hour.
  listRun++;
  listing.value = false;
  socketAnswer = null;
  if (day !== dayMs.value) {
    dayMs.value = day;
    await loadDay(day);
  }
  listNote.value = '';
  await refreshCache();
  if (hourMs.value !== h) return;
  autoStart.value = at == null;
  const target = at ?? firstVideoOf(h) ?? h;
  playAt(target, { autoplay, allowRemote: false });
  ensureList();
}

function stepHour(dir) {
  userPicked.value = true;
  selectHour(hourMs.value + dir * HOUR_MS);
}

// The picker browses days on its OWN copy of the GPS, so looking at another
// day never changes the hour that is open behind it. Only Open switches.
const pickerDay = ref(dayMs.value);
const pickerTrack = ref([]);
const pickerLoading = ref(false);
const pickerHours = computed(() => hoursFor(pickerTrack.value, pickerDay.value));
let pickerToken = 0;

function openPicker() {
  pickerDay.value = dayMs.value;
  pickerTrack.value = track.value;
  pickerLoading.value = loadingDay.value;
  picker.value = true;
}

async function pickDay(day) {
  if (day === pickerDay.value) return;
  const my = ++pickerToken;
  pickerDay.value = day;
  if (day === dayMs.value) {
    pickerTrack.value = track.value;
    pickerLoading.value = false;
    return;
  }
  pickerTrack.value = [];
  pickerLoading.value = true;
  try {
    const pos = await fetchPositions(server.value, props.device.id, day, addDays(day, 1));
    if (my !== pickerToken) return;
    pickerTrack.value = toTrack(pos);
    addClips(clipsFromPositions(pos, tz.value));
  } catch {
    if (my === pickerToken) pickerTrack.value = [];
  } finally {
    if (my === pickerToken) pickerLoading.value = false;
  }
}

function pickHour(h) {
  picker.value = false;
  userPicked.value = true;
  const day = dayStart(h);
  if (day !== dayMs.value && day === pickerDay.value && !pickerLoading.value) {
    // Already fetched for the picker: hand it over instead of fetching again.
    dayToken++;
    dayMs.value = day;
    track.value = pickerTrack.value;
    loadingDay.value = false;
  }
  selectHour(h);
}

// --- lifecycle --------------------------------------------------------------------------------

let cacheTimer = null;

onMounted(async () => {
  raf = requestAnimationFrame(tick);
  loadDailyKm();
  await Promise.all([loadDay(dayMs.value), refreshCache()]);
  if (userPicked.value) return;
  // Open on the latest hour with driving today, else the current hour.
  const now = Date.now();
  const lastDriving = [...hours.value].reverse().find((h) => h.minutes > 0 && h.hour <= now);
  selectHour(lastDriving ? lastDriving.hour : hourStart(now));
  cacheTimer = setInterval(refreshCache, 30_000);
});

// resolveToken++ abandons a camera stream still starting, so startRemote
// closes it once its 0x9201 lands instead of going on to play it.
onBeforeRouteLeave(() => { resolveToken++; stopRemote(); });

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  clearInterval(cacheTimer);
  resolveToken++;
  stopRemote();
});

watch(online, (on) => {
  if (on && listNote.value === 'asleep') ensureList();
  if (on && status.value === 'asleep') status.value = 'tap';
});
</script>

<template>
  <!-- Stacked on narrow screens, side by side from 1024 px: dashcamLayout.css -->
  <div class="dc-layout pb-layout" :style="{ '--dc-aspect': boxAspect }">
    <!-- Hour bar: first row when stacked; top of the map column side by side. -->
    <div class="pb-hourbar bg-white border-b border-gray-200 px-2 py-2">
      <div class="flex items-center gap-0.5 bg-gray-100 rounded-2xl p-0.5 max-w-xl mx-auto">
        <button type="button" @click="stepHour(-1)" class="w-11 h-11 rounded-xl text-gray-700 flex items-center justify-center" aria-label="Previous hour">
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <button type="button" @click="openPicker" class="flex-1 h-11 rounded-xl bg-white shadow-sm flex flex-col items-center justify-center" aria-label="Choose day and hour">
          <span class="text-sm font-bold text-gray-800 leading-tight">{{ hourLabel }}</span>
          <span class="text-[11px] text-gray-500 leading-tight">{{ dayLabel }}</span>
        </button>
        <button type="button" @click="stepHour(1)" :disabled="!canNext" class="w-11 h-11 rounded-xl text-gray-700 flex items-center justify-center disabled:opacity-30" aria-label="Next hour">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
    </div>

    <div class="dc-media">

    <div class="bg-black">
    <div class="pb-video dc-video relative mx-auto w-full bg-black">
    <div class="absolute inset-0" :class="grid ? 'grid grid-cols-2 auto-rows-fr gap-0.5' : ''">
    <div class="relative w-full h-full overflow-hidden">
      <HlsVideo
        v-if="videoSrc"
        ref="playerRef"
        :src="videoSrc"
        :native="!!source?.native"
        :muted="muted"
        :controls="false"
        class="absolute inset-0"
        @loadedmetadata="onLoadedMeta"
        @playing="onPlaying"
        @pause="onPause"
        @ended="onSourceEnd"
        @error="onPlayerError"
        @aspect="onAspect"
      />
      <button v-if="videoSrc && (status === 'playing' || status === 'paused')" type="button" class="absolute inset-0 w-full h-full" @click="togglePlay" :aria-label="isPlaying ? 'Pause' : 'Play'"></button>

      <div v-if="channels.length > 1" class="absolute top-2.5 left-2.5 right-2.5 flex flex-wrap gap-1.5 z-10">
        <button
          v-for="c in channels"
          :key="c.index"
          type="button"
          @click="pickCamera(c.index)"
          class="h-[30px] px-3 rounded-full text-xs font-bold"
          :class="!allMode && c.index === ch ? 'bg-white text-gray-800' : 'bg-black/55 text-white'"
        >{{ c.name }}</button>
        <button
          type="button"
          @click="pickAll"
          class="h-[30px] px-3 rounded-full text-xs font-bold flex items-center gap-1"
          :class="allMode ? 'bg-white text-gray-800' : 'bg-black/55 text-white'"
        ><i class="fa-solid fa-table-cells-large text-[10px]"></i> All ({{ channels.length }})</button>
      </div>
      <span v-if="grid" class="absolute left-2.5 top-11 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">{{ camName(ch) }}</span>

      <span class="absolute right-2.5 bottom-2.5 text-[13px] font-bold text-white bg-black/60 px-2 py-1 rounded-md tabular-nums">{{ fmtHMS(t) }}</span>
      <span v-if="fixNow" class="absolute left-2.5 bottom-2.5 text-xs font-semibold text-white bg-black/60 px-2 py-1 rounded-md">{{ Math.round(fixNow.kmh) }} km/h</span>

      <div v-if="status === 'loading' || status === 'looking'" class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 text-white pointer-events-none">
        <InlineLoader size="2xl" class="text-white" />
        <p class="text-sm font-bold">{{ status === 'looking' ? 'Looking for video…' : 'Loading video…' }}</p>
      </div>
      <div v-else-if="status === 'tap'" class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
        <button type="button" @click="togglePlay" class="w-16 h-16 rounded-full bg-white/90 text-brand flex items-center justify-center" aria-label="Play">
          <i class="fa-solid fa-play text-2xl ml-1"></i>
        </button>
        <p class="text-xs font-semibold bg-black/50 px-2 py-1 rounded">Video at {{ fmtHMS(t) }}</p>
      </div>
      <div v-else-if="status === 'novideo' || status === 'idle'" class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-200 px-6 text-center">
        <i class="fa-solid fa-video-slash text-2xl text-gray-500"></i>
        <p class="text-sm font-semibold">No video at {{ fmtHM(t) }}</p>
        <button v-if="nextVideo != null && nextVideo < hourEnd" type="button" @click="playNext" class="h-10 px-4 rounded-full bg-white text-gray-800 text-sm font-bold">
          Next video {{ fmtHM(nextVideo) }}
        </button>
      </div>
      <div v-else-if="status === 'asleep'" class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-200 px-6 text-center">
        <i class="fa-solid fa-moon text-2xl text-amber-300"></i>
        <p class="text-sm font-semibold">The camera is off</p>
        <p class="text-xs text-gray-400">This part of the video loads when the vehicle is on.</p>
      </div>
      <div v-else-if="status === 'error'" class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-200 px-6 text-center">
        <i class="fa-solid fa-triangle-exclamation text-2xl text-amber-400"></i>
        <p class="text-sm font-semibold">{{ errorMsg }}</p>
        <button type="button" @click="playAt(t, { autoplay: true })" class="h-10 px-4 rounded-full bg-white text-gray-800 text-sm font-bold">Try again</button>
      </div>
    </div>
    <PlaybackTile
      v-for="c in followers"
      :key="c.index"
      :device="device"
      :server="server || ''"
      :ch="c.index"
      :name="c.name"
      :t="t"
      :playing="isPlaying && !downloadOpen"
      :allow-remote="isPlaying && !downloadOpen"
      :online="online"
      :clips="clips"
      :cache="cache"
      :hub-check="hubCheck"
    />
    </div>
    </div>
    </div>

    <div class="bg-white border-b border-gray-200 pt-2.5 pb-1">
      <PlaybackTimeline
        :from="hourMs"
        :to="hourEnd"
        :t="t"
        :ranges="ranges"
        :speeds="speeds"
        :alarms="alarms"
        :checking="listing"
        @scrub="onScrub"
        @seek="onSeek"
      />
    </div>

    <div class="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-1.5">
      <button type="button" @click="skip(-10)" class="w-11 h-11 rounded-full border border-gray-200 text-[11px] font-bold text-gray-700" aria-label="Back 10 seconds">−10</button>
      <button type="button" @click="togglePlay" class="w-12 h-12 rounded-full bg-brand text-white flex items-center justify-center" :aria-label="isPlaying ? 'Pause' : 'Play'">
        <i class="fa-solid" :class="isPlaying ? 'fa-pause' : 'fa-play ml-0.5'"></i>
      </button>
      <button type="button" @click="skip(10)" class="w-11 h-11 rounded-full border border-gray-200 text-[11px] font-bold text-gray-700" aria-label="Forward 10 seconds">+10</button>
      <button type="button" @click="toggleMute" class="w-11 h-11 rounded-full border border-gray-200 text-gray-600 flex items-center justify-center" :aria-label="muted ? 'Unmute' : 'Mute'">
        <i class="fa-solid" :class="muted ? 'fa-volume-xmark' : 'fa-volume-high'"></i>
      </button>
      <span class="flex-1"></span>
      <button
        type="button"
        @click="openDownload"
        class="h-11 px-3.5 rounded-xl bg-brand-light text-brand-dark text-[13px] font-bold flex items-center gap-1.5"
      >
        <i class="fa-solid fa-download"></i>
        Download
      </button>
    </div>

    <div v-if="listMessage" class="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
      <p class="flex-1 text-xs text-amber-900 leading-snug">{{ listMessage }}</p>
      <button v-if="['asleep', 'noanswer', 'partial'].includes(listNote)" type="button" @click="ensureList({ force: true })" class="h-9 px-3 rounded-lg bg-white border border-amber-200 text-xs font-bold text-amber-900 shrink-0">
        {{ listNote === 'asleep' ? 'Check when on' : 'Try again' }}
      </button>
    </div>
    </div>

    <div class="dc-map">
      <!-- absolute: the wrapper's height comes from flex/min-height only, so
           TrackMap's h-full would resolve to 0 without a positioned box. -->
      <div class="absolute inset-0">
        <TrackMap :points="points" :position="mapPosition" mode="playback" @seek="onMapSeek" />
      </div>
      <div v-if="!points.length && !loadingDay" class="absolute inset-x-0 top-3 flex justify-center pointer-events-none z-[500]">
        <span class="text-xs font-semibold text-gray-600 bg-white/90 px-2.5 py-1 rounded-full shadow-sm">No GPS for this hour</span>
      </div>
    </div>

    <DayHourPicker
      v-if="picker"
      :day-ms="pickerDay"
      :hour-ms="hourMs"
      :hours="pickerHours"
      :daily-km="dailyKm"
      :loading="pickerLoading"
      @close="picker = false"
      @day="pickDay"
      @pick="pickHour"
    />
    <DownloadSheet
      v-if="downloadOpen"
      :device="device"
      :server="server"
      :online="online"
      :channels="channels"
      :ch="ch"
      :t="t"
      :clips="clips"
      :cache="cache"
      :hub-check="hubCheck"
      @close="closeDownload"
    />
  </div>
</template>

<style src="./dashcamLayout.css"></style>
<style scoped>
/* Media column below the video: timeline (131) + controls (65). The hour bar
   (65) is above the video when stacked, above the map side by side. */
.pb-layout { --dc-below: 196px; --dc-map-min: 160px; }
@media (min-width: 1024px) {
  .pb-layout {
    display: grid;
    grid-template-columns: max(420px, min(60%, calc((100dvh - var(--dc-chrome) - var(--dc-below)) * var(--dc-aspect)))) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }
  .pb-layout > .dc-media { grid-column: 1; grid-row: 1 / span 2; width: auto; }
  .pb-layout > .pb-hourbar { grid-column: 2; grid-row: 1; }
  .pb-layout > .dc-map { grid-column: 2; grid-row: 2; }
}
/* Stacked: the box (height = width / aspect) is at most half the screen tall
   and leaves room for header + hour bar + timeline + controls + nav + a 160 px
   map; never below 180 px tall. */
.pb-video {
  max-width: min(calc(50dvh * var(--dc-aspect)), max(calc(180px * var(--dc-aspect)), calc((100dvh - 592px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)) * var(--dc-aspect))));
}
@media (min-width: 1024px) {
  .pb-video { max-width: none; }
}
</style>
