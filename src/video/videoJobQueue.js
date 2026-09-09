function createJobQueue({ concurrency = 1, maxPending = 5 } = {}) {
  const waiting = [];
  let active = 0;

  function runNext() {
    if (active >= concurrency) {
      return;
    }

    const next = waiting.shift();
    if (!next) {
      return;
    }

    active += 1;
    Promise.resolve()
      .then(next.task)
      .then(next.resolve, next.reject)
      .finally(() => {
        active -= 1;
        runNext();
      });
  }

  function push(task) {
    if (waiting.length >= maxPending) {
      const error = new Error(`Antrean penuh (${maxPending} menunggu).`);
      error.code = 'QUEUE_FULL';
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      runNext();
    });
  }

  return {
    push,
    get pending() {
      return waiting.length;
    },
    get active() {
      return active;
    },
    get isFull() {
      return waiting.length >= maxPending;
    },
  };
}

module.exports = { createJobQueue };
