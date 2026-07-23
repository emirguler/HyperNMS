// Bellek-içi kullanıcı presence takibi (KALICI DEĞİL — restart'ta sıfırlanır; presence doğası gereği geçicidir).
// Her kimlik doğrulamalı istekte touch edilir. Frontend ~4 sn'de bir polling yaptığından,
// uygulaması açık olan kullanıcının lastSeen'i taze kalır. Son ACTIVE_WINDOW_MS içinde görülen = "aktif".
const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 dk
const lastSeen = new Map(); // String(userId) -> timestamp(ms)

function touch(userId) {
  if (userId == null) return;
  lastSeen.set(String(userId), Date.now());
}

function isActive(userId) {
  const ts = lastSeen.get(String(userId));
  return ts != null && (Date.now() - ts) < ACTIVE_WINDOW_MS;
}

function lastSeenAt(userId) {
  const ts = lastSeen.get(String(userId));
  return ts != null ? ts : null;
}

module.exports = { touch, isActive, lastSeenAt, ACTIVE_WINDOW_MS };
