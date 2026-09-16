// Cari id chat grup dari namanya. Dipakai fitur yang harus membaca atau
// mengirim ke grup lain, bukan grup tempat perintahnya diketik.
//
// Nama grup bisa berubah kapan saja dan pencocokannya tidak pernah pasti,
// jadi id yang diisi di .env selalu menang: itu satu-satunya cara memilih
// grup tanpa menebak.

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function groupNotFound(message) {
  const error = new Error(message);
  error.code = 'GROUP_NOT_FOUND';
  return error;
}

async function resolveGroupId(client, { message, groupId, groupName, envHint = '' } = {}) {
  if (groupId) {
    return groupId;
  }

  const wantedName = normalizeName(groupName);
  if (!wantedName) {
    throw groupNotFound(`Nama grup tujuan belum diatur. ${envHint}`.trim());
  }

  // Kalau perintahnya memang dikirim dari grup itu sendiri, tidak perlu
  // menelusuri daftar chat sama sekali.
  const currentChatId = String(message?.from || '');
  if (currentChatId.endsWith('@g.us')) {
    const currentName = normalizeName(
      message?.chat?.name || message?.chat?.formattedTitle || message?.notifyName
    );
    if (currentName && currentName === wantedName) {
      return currentChatId;
    }
  }

  const groups = await client.listChats({ onlyGroups: true }).catch(async (error) => {
    console.error('listChats gagal, coba getAllGroups:', error.message);
    return client.getAllGroups(false).catch(() => []);
  });

  const match = (groups || []).find((chat) => {
    const name = normalizeName(chat?.name || chat?.formattedTitle || chat?.contact?.name);
    return name === wantedName;
  });

  if (match) {
    return match.id?._serialized || match.id;
  }

  const partial = (groups || []).find((chat) =>
    normalizeName(chat?.name || chat?.formattedTitle).includes(wantedName)
  );

  if (partial) {
    return partial.id?._serialized || partial.id;
  }

  const available = (groups || [])
    .map((chat) => chat?.name || chat?.formattedTitle)
    .filter(Boolean)
    .slice(0, 15)
    .join(', ');

  throw groupNotFound(
    `Grup "${groupName}" tidak ditemukan. Grup yang terbaca: ${available || '(tidak ada)'}. ${envHint}`.trim()
  );
}

module.exports = {
  normalizeName,
  resolveGroupId,
};
