'use strict';

function stamp() {
  return new Date().toISOString();
}

module.exports = {
  info: (msg) => console.log(`${stamp()} INFO  ${msg}`),
  warn: (msg) => console.warn(`${stamp()} WARN  ${msg}`),
  error: (msg) => console.error(`${stamp()} ERROR ${msg}`),
};
