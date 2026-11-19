// Usable GPS coordinates. A no-fix report from some trackers (Tenet DCAM009 on
// jt808) carries 0,0 or near-zero junk such as 0.008068,0.00x instead of a
// location — the "device in the ocean off Africa" bug (2026-11-19). Nothing we
// track sits within 1 degree of Null Island (it is open sea in the Gulf of
// Guinea), so that whole box counts as "no location".
export const NULL_ISLAND_BOX_DEG = 1;

export function hasRealCoords(lat, lng) {
  const la = Number(lat);
  const lo = Number(lng);
  if (lat == null || lng == null || !Number.isFinite(la) || !Number.isFinite(lo)) return false;
  return !(Math.abs(la) < NULL_ISLAND_BOX_DEG && Math.abs(lo) < NULL_ISLAND_BOX_DEG);
}
