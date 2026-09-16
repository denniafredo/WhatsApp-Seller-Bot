// State percakapan "cek ongkir" per penanya.
//
// Disimpan di memori saja (seperti buffer pesan grup di index.js): sesi hanya
// hidup beberapa menit, dan kalau bot restart di tengah percakapan, pengirim
// tinggal mengulang perintahnya - tidak ada yang perlu diselamatkan ke disk.
//
// Kunci sesi memakai chat + pengirim, bukan chat saja, supaya di grup dua orang
// bisa bertanya bergantian tanpa jawaban yang satu diambil yang lain.

const STEP_ORIGIN = 'origin';
const STEP_DESTINATION = 'destination';

const defaultTtlMs = Math.max(Number(process.env.ONGKIR_SESSION_TTL_MS) || 10 * 60 * 1000, 60 * 1000);

function sessionKey(message) {
  const chatId = message?.from || '';
  const senderId = message?.author || message?.from || '';
  return `${chatId}|${senderId}`;
}

function createOngkirSessions({ ttlMs = defaultTtlMs } = {}) {
  const sessions = new Map();

  function isExpired(session) {
    return Date.now() - session.updatedAtMs > ttlMs;
  }

  // Dibersihkan saat diakses; tidak ada timer supaya proses bisa keluar bersih.
  function sweep() {
    for (const [key, session] of sessions) {
      if (isExpired(session)) {
        sessions.delete(key);
      }
    }
  }

  return {
    get(message) {
      sweep();
      const session = sessions.get(sessionKey(message));
      return session && !isExpired(session) ? session : null;
    },

    startOriginStep(message) {
      sweep();
      const session = {
        step: STEP_ORIGIN,
        originAlias: null,
        originQuery: null,
        updatedAtMs: Date.now(),
        promptCount: 1,
      };
      sessions.set(sessionKey(message), session);
      return session;
    },

    setOrigin(message, { alias, query }) {
      const session = sessions.get(sessionKey(message));
      if (!session) return null;

      session.step = STEP_DESTINATION;
      session.originAlias = alias;
      session.originQuery = query;
      session.updatedAtMs = Date.now();
      session.promptCount = 1;
      return session;
    },

    // Dipakai saat jawaban tidak dikenali, supaya bot tidak bertanya tanpa henti.
    countPrompt(message) {
      const session = sessions.get(sessionKey(message));
      if (!session) return 0;

      session.promptCount += 1;
      session.updatedAtMs = Date.now();
      return session.promptCount;
    },

    clear(message) {
      sessions.delete(sessionKey(message));
    },

    get size() {
      sweep();
      return sessions.size;
    },
  };
}

module.exports = {
  createOngkirSessions,
  sessionKey,
  STEP_ORIGIN,
  STEP_DESTINATION,
};
