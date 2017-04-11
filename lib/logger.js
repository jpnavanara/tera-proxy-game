function c(method) {
  // eslint-disable-next-line no-console
  return (...args) => console[method](...args);
}

try {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  module.exports = require('baldera-logger')('tera-proxy-game');
} catch (err) {
  module.exports = {
    trace: () => {},
    debug: () => {},
    info: c('log'),
    warn: c('warn'),
    error: c('error'),
    fatal: c('error'),
  };
}
