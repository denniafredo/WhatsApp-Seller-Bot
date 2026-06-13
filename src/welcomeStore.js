const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'welcomed-chats.json');

function loadWelcomedChats() {
  try {
    const rawValue = fs.readFileSync(STORE_PATH, 'utf8');
    const parsedValue = JSON.parse(rawValue);

    if (!Array.isArray(parsedValue)) {
      return new Set();
    }

    return new Set(parsedValue);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to read welcome store:', error);
    }

    return new Set();
  }
}

function saveWelcomedChats(chatIds) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify([...chatIds], null, 2));
}

function createWelcomeStore() {
  const welcomedChats = loadWelcomedChats();

  return {
    has(chatId) {
      return welcomedChats.has(chatId);
    },
    add(chatId) {
      welcomedChats.add(chatId);
      saveWelcomedChats(welcomedChats);
    },
  };
}

module.exports = {
  createWelcomeStore,
};
