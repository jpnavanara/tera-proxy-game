const protocol = require('tera-data').protocol;

class Dispatch {
  constructor() {
    this.connection = null;
    this.modules = {};
    this.hooks = { raw: {}, pre: {} };
  }

  close() { // TODO rename reset
    for (let name in this.modules) {
      this.unload(name);
    }

    // ensure empty objects
    this.modules = {};
    this.hooks = { raw: {}, pre: {} };
  }

  load(name, from) {
    if (!from) from = module;

    try {
      if (this.modules[name]) throw new Error('Module already loaded');

      const mod = from.require(name);
      this.modules[name] = new mod(this);

      console.log('[dispatch] loaded "%s"', name);
      return true;
    } catch (e) {
      console.error('[dispatch] load: error initializing module "%s"', name);
      console.error(e.stack);
      return false;
    }
  }

  unload(name) {
    const mod = this.modules[name];

    if (mod == null) {
      console.warn('[dispatch] unload: cannot unload non-loaded module "%s"', name);
      return false;
    }

    if (typeof mod.destructor === 'function') {
      mod.destructor();
    }

    delete this.modules[name];
    return true;
  }

  hook(name, type, cb) {
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
      code = protocol.map.name[name];
    }

    let hooks = this.hooks[type];
    if (!hooks) {
      console.warn('[dispatch] hook: unexpected hook type "%s"', type);
      hooks = this.hooks.pre;
    }

    if (!hooks[code]) {
      hooks[code] = [];
    }

    hooks[code].push(cb);
  }

  unhook(name, type, cb) {
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
      code = protocol.map.name[name];
    }

    let hooks = this.hooks[type];
    if (!hooks) {
      console.warn('[dispatch] unhook: unexpected hook type "%s"', type);
      hooks = this.hooks.pre;
    }

    const index = hooks[code].indexOf(cb);
    if (index === -1) {
      console.error('[dispatch] unhook: could not find cb');
      return;
    }

    return hooks[code].splice(index, 1);
  }

  toClient(name, data) {
    if (!this.connection) return false;
    if (name.constructor === Buffer) {
      data = name;
    } else {
      try {
        data = protocol.write(name, data);
      } catch (e) {
        console.error('[dispatch] failed to generate message: %s', name);
        console.error('error: %s', e.message);
        console.error('data:');
        console.error(data);
        console.error('stack:');
        console.error(e.stack);
        return false;
      }
    }
    this.connection.sendClient(data);
    return true;
  }

  toServer(name, data) {
    if (!this.connection) return false;
    if (name.constructor === Buffer) {
      data = name;
    } else {
      try {
        data = protocol.write(name, data);
      } catch (e) {
        console.error('[dispatch] failed to generate message: %s', name);
        console.error('error: %s', e.message);
        console.error('data:');
        console.error(data);
        console.error('stack:');
        console.error(e.stack);
        return false;
      }
    }
    this.connection.sendServer(data);
    return true;
  }

  handle(code, data, fromServer) {
    let hooks;

    // raw * hooks
    hooks = this.hooks.raw['*'];
    if (hooks != null) {
      for (let hook of hooks) {
        const result = hook(code, data, fromServer);
        if (result != null) {
          if (result.constructor === Buffer) {
            data = result;
          } else if (result === false) {
            return false;
          }
        }
      }
    }

    // raw named hooks
    hooks = this.hooks.raw[code];
    if (hooks != null) {
      for (let hook of hooks) {
        const result = hook(code, data, fromServer);
        if (result != null) {
          if (result.constructor === Buffer) {
            data = result;
          } else if (result === false) {
            return false;
          }
        }
      }
    }

    // pre hooks
    hooks = this.hooks.pre[code];
    if (hooks != null) {
      const event = protocol.parse(code, data);
      let changed = false;
      for (let hook of hooks) {
        const result = hook(event);
        if (result === true) {
          changed = true;
        } else if (result === false) {
          return false;
        }
      }
      if (changed) {
        data = protocol.write(code, event);
      }
    }

    // return value
    return data;
  }
}

module.exports = Dispatch;
