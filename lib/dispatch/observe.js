module.exports = function observe(obj, cb) {
  let changed = false;

  const markChange = () => {
    changed = true;
    cb();
  };

  const setProxy = (obj, prop, val) => {
    if (!changed) markChange();
    obj[prop] = val;
    return true;
  };

  const funcProxy = {
    apply: (target, thisArg, args) => {
      if (!changed) markChange();
      return target.apply(thisArg, args);
    },
  };

  const arrayMutators = [
    'copyWithin',
    'fill',
    'pop',
    'push',
    'reverse',
    'shift',
    'sort',
    'splice',
    'unshift',
  ].map(func => Array.prototype[func]);

  const arrayProxy = {
    get: (obj, prop) => {
      const val = obj[prop];

      switch (typeof val) {
        case 'function': {
          if (arrayMutators.includes(val)) return new Proxy(val, funcProxy);
          break;
        }

        case 'object': {
          return new Proxy(val, Array.isArray(val) ? arrayProxy : objectProxy);
        }
      }

      return val;
    },

    set: setProxy,
  };

  const objectProxy = {
    get: (obj, prop) => {
      const val = obj[prop];
      if (typeof val === 'object') {
        return new Proxy(val, Array.isArray(val) ? arrayProxy : objectProxy);
      }
      return val;
    },

    set: setProxy,
  };

  return new Proxy(obj, objectProxy);
};
