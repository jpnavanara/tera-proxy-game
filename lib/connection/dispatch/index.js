const protocol = require('tera-data').protocol;
const Wrapper = require('./dispatchWrapper');

const moduleNameSymbol = Symbol('moduleName');

function tryIt(func) {
  try {
    return func();
  } catch (e) {
    return e;
  }
}

function nameFromCode(code) {
  return protocol.map.code.get(code) || `opcode ${code}`;
}

function errMsg(msg, err, data) {
  if (Array.isArray(msg)) msg = msg.join('\n');
  console.error(msg);

  if (!err) err = new Error();
  console.error(err.stack);

  if (data) {
    console.error('data:');
    console.error(data);
  }
}

class Dispatch {
  constructor(connection) {
    this.connection = connection;
    this.modules = new Map();
    this.hooks = { raw: {}, pre: {} };
  }

  reset() {
    for (const name of this.modules.keys()) {
      this.unload(name);
    }

    // ensure empty objects
    this.modules.clear();
    this.hooks = { raw: {}, pre: {} };
  }

  load(name, from = module, ...args) {
    const mod = this.modules.get(name);
    if (mod) return mod;

    if (typeof from.require !== 'function' && typeof from === 'function') {
      // `from` is a function, so use itself the module constructor
      from = { require: (ModuleConstructor => () => ModuleConstructor)(from) };
    }

    try {
      const ModuleConstructor = from.require(name);
      const wrapper = new Wrapper(this, name);
      const mod = new ModuleConstructor(wrapper, ...args);
      this.modules.set(name, mod);

      console.log('[dispatch] loaded "%s"', name);
      return mod;
    } catch (e) {
      errMsg(`[dispatch] load: error initializing module "${name}"`, e);
    }
  }

  unload(name) {
    const mod = this.modules.get(name);

    if (!mod) {
      console.warn('[dispatch] unload: cannot unload non-loaded module "%s"', name);
      return false;
    }

    for (const type in this.hooks) {
      if (!{}.hasOwnProperty.call(this.hooks, type)) continue; // for..in guard

      const hooks = this.hooks[type];
      for (const code in hooks) {
        if (!{}.hasOwnProperty.call(hooks, code)) continue;

        hooks[code] = hooks[code].filter(cb => cb[moduleNameSymbol] !== name);
      }
    }

    if (typeof mod.destructor === 'function') {
      try {
        mod.destructor();
      } catch (e) {
        errMsg(`[dispatch] unload: error running destructor for module "${name}"`, e);
      }
    }

    this.modules.delete(name);
    return true;
  }

  _resolveHook(name, type, cb) {
    // optional arg `type` defaults 'pre'
    if (!cb) {
      cb = type;
      type = 'pre';
    }

    let code;
    if (name === '*') {
      type = 'raw';
      code = name;
    } else {
      code = protocol.map.name.get(name);
      if (code == null) {
        console.warn(new Error(`unrecognized hook target "${name}"`));
        code = '_unknown';
      }
    }

    let hooks = this.hooks[type];
    if (!hooks) {
      console.warn(new Error(`unrecognized hook type "${type}"`));
      hooks = this.hooks.pre;
    }

    if (typeof cb !== 'function') {
      console.warn(new Error(`last argument not a function (given ${typeof cb})`));
      cb = () => {};
    }

    return { hooks, code, cb };
  }

  hook(...args) {
    const { hooks, code, cb } = this._resolveHook(...args);

    if (!hooks[code]) {
      hooks[code] = [];
    }

    hooks[code].push(cb);
  }

  hookFromModule(name, ...args) {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      cb[moduleNameSymbol] = name;
    }
    this.hook(...args);
  }

  unhook(...args) {
    const { hooks, code, cb } = this._resolveHook(...args);

    const index = hooks[code].indexOf(cb);
    if (index === -1) {
      return false;
    }

    return hooks[code].splice(index, 1);
  }

  write(outgoing, name, data) {
    if (!this.connection) return false;

    if (Buffer.isBuffer(name)) {
      data = name;
    } else {
      try {
        data = protocol.write(name, data);
      } catch (e) {
        errMsg(`[dispatch] write: failed to generate "${name}"`, e, data);
        return false;
      }
    }
    this.connection[outgoing ? 'sendServer' : 'sendClient'](data);
    return true;
  }

  handle(code, data, fromServer) {
    // raw hooks
    for (const type of ['*', code]) {
      const hooks = this.hooks.raw[type];
      if (!hooks) continue;

      for (const hook of hooks) {
        const result = tryIt(() => hook(code, data, fromServer));

        if (result instanceof Error) {
          errMsg(
            [
              `[dispatch] handle: error running raw hook for ${nameFromCode(code)}`,
              `module: ${hook[moduleNameSymbol] || '<unknown>'}`,
            ],
            result,
            data.toString('hex')
          );
          continue;
        } else if (Buffer.isBuffer(result)) {
          data = result;
        } else if (result === false) {
          return false;
        }
      }
    }

    // pre hooks
    const hooks = this.hooks.pre[code];
    if (hooks) {
      const event = tryIt(() => protocol.parse(code, data));

      if (event instanceof Error) {
        errMsg(`[dispatch] handle: failed to parse ${nameFromCode(code)}`, event, data.toString('hex'));
        return data;
      }

      let changed = false;

      for (const hook of hooks) {
        const result = tryIt(() => hook(event));
        if (result instanceof Error) {
          errMsg(
            [
              `[dispatch] handle: error running pre hook for ${nameFromCode(code)}`,
              `module: ${hook[moduleNameSymbol] || '<unknown>'}`,
            ],
            result,
            event
          );
        } else if (result === true) {
          changed = true;
        } else if (result === false) {
          return false;
        }
      }

      if (changed) {
        try {
          data = protocol.write(code, event);
        } catch (e) {
          errMsg(`[dispatch] handle: failed to generate "${nameFromCode(code)}"`, e, event);
        }
      }
    }

    // return value
    return data;
  }
}

module.exports = Dispatch;
