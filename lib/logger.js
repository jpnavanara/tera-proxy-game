// eslint-disable-next-line no-console
const c = method => console[method].bind(console);

try {
  // eslint-disable-next-line max-len
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies, import/no-unresolved
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
