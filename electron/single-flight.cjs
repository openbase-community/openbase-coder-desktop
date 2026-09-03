function createSingleFlight(operation) {
  let inFlight = null;

  return (...args) => {
    if (!inFlight) {
      inFlight = Promise.resolve()
        .then(() => operation(...args))
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };
}

module.exports = { createSingleFlight };
