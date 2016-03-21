// requires
var fs = require('fs');
var path = require('path');

var Stream = require('./stream');

// constants
var PATH_DEFS = path.join(__dirname, '../../def');
var FILE_MAPDEF = '_map.def';

// helpers
function getLength(message, data) {
  var length = 0;

  for (var i = 0, len = message.length; i < len; i++) {
    var field = message[i];
    var key = field[0];
    var type = field[1];
    if (typeof type === 'object') {
      // array, so recurse
      var arr = data[key];
      for (var j = 0, len2 = arr.length; j < len2; j++) {
        length += 4 + getLength(type, arr[j]);
      }
    } else {
      switch (type) {
        case 'byte':
          length += 1;
          break;
        case 'bytes':
          length += data[key].length;
          break;
        case 'int16':
        case 'uint16':
        case 'count':
        case 'offset':
          length += 2;
          break;
        case 'int32':
        case 'uint32':
        case 'float':
          length += 4;
          break;
        case 'int64':
        case 'uint64':
        case 'double':
          length += 8;
          break;
        case 'string':
          length += (data[key].length + 1) * 2;
          break;
        default:
          console.error('unknown type ' + type);
          return;
      }
    }
  }

  return length;
};

// exports
var _module = module.exports = {
  map: { name: {}, code: {} },
  messages: {},

  load: function load() {
    var i, len;

    // reset map and messages
    var map = _module.map = { name: {}, code: {} };
    var messages = _module.messages = {};

    // read map
    var filepath = path.join(PATH_DEFS, FILE_MAPDEF);
    var data = fs.readFileSync(filepath, { encoding: 'utf8' }).split(/\r?\n/);
    for (i = 0, len = data.length; i < len; i++) {
      // clean line
      var line = data[i].replace(/#.*$/, '').trim();
      if (line === '') continue;

      // match syntax
      line = line.match(/^(\S+)\s+(\S+)$/);
      if (!line) {
        console.error('parse error: malformed line (%s:%d)', FILE_MAPDEF, i);
        return false;
      }

      // parse line
      var name = line[1];
      var code = parseInt(line[2]);
      if (isNaN(code)) {
        console.error('parse error: non-numeric opcode (%s:%d)', FILE_MAPDEF, i);
        return false;
      }

      // update mapping
      map.name[name] = code;
      map.code[code] = name;
    }

    // read directory
    var files = fs.readdirSync(PATH_DEFS);
    for (i = 0, len = files.length; i < len; i++) {
      var file = files[i];
      if (file === FILE_MAPDEF || path.extname(file) !== '.def') {
        continue;
      }

      filepath = path.join(PATH_DEFS, file);
      data = fs.readFileSync(filepath, { encoding: 'utf8' }).split(/\r?\n/);

      var message = [];
      var order = [];
      var top = message;
      var name = path.basename(file, '.def');

      for (var j = 0, len2 = data.length; j < len2; j++) {
        var line = data[j].replace(/#.*$/, '').trim();
        if (line === '') continue;

        line = line.match(/^((?:\s*-)*)?\s*(\S+)\s*(\S+)$/);
        if (!line) {
          console.error('parse error: malformed line (%s:%d)', file, j);
          return false;
        }

        var depth = (line[1] != null) ? line[1].replace(/[^-]/g, '').length : 0;
        var type = line[2];
        var key = line[3];
        if (depth > order.length) {
          if (depth !== order.length + 1) {
            console.warn('parse warning: array nesting too deep (%s:%d)', name, j);
          }
          var id = top.length - 1;
          top = top[id][1];
          order.push(id);
        } else if (depth < order.length) {
          while (depth < order.length) {
            order.pop();
          }
          top = message;
          for (var k = 0, len3 = order.length; k < len3; k++) {
            top = top[order[k]][1];
          }
        }
        top.push([key, type === 'array' ? [] : type]);
      }

      // set message
      messages[name] = message;
      if (map.name[name] == null) {
        console.warn('[protocol] unmapped message "%s"', name);
      }
    }

    return true;
  },

  parse: function parse(message, reader, name) {
    var data = {};

    // optional arg `name` is metadata for error messages
    if (name == null) name = '<Object>';

    // convert `message` to definition object
    switch (typeof message) {
      case 'object':
        // this is what we want; no further action needed
        break;

      case 'string':
        name = message;
        message = _module.messages[name];
        if (message == null) {
          console.error('[protocol] parse: unknown message "%s"', name);
          return;
        }
        break;

      case 'number':
        var code = message;
        name = _module.map.code[code];
        if (name == null) {
          console.error('[protocol] parse: unknown code %d (0x%s)', code, code.toString(16));
          return;
        }
        message = _module.messages[name];
        if (message == null) {
          console.error('[protocol] parse: unknown message "%s"', name);
          return;
        }
        break;

      default:
        console.error('[protocol] parse: invalid message type %s', typeof message);
        return;
    }

    // convert `reader` to a stream
    if (reader.constructor === Buffer) {
      reader = new Stream.Readable(reader, 4);
    }

    // begin parsing
    var count = {};
    var offset = {};
    for (var i = 0, len = message.length; i < len; i++) {
      var field = message[i];
      var key = field[0];
      var type = field[1];
      if (typeof type === 'object') {
        var array = Array(count[key]);
        var index = 0;
        var next = offset[key];

        while (next) {
          var pos = reader.position;
          if (pos !== next) {
            console.warn(
              '[protocol] parse (%s): offset mismatch for array "%s" at %d (expected %d)',
              name, key, reader.position, next
            );
            reader.seek(next);
            pos = next;
          }

          var here = reader.uint16();
          if (pos !== here) {
            console.error(
              '[protocol] parse (%s): cannot find next element of array "%s" at %d (found value %d)',
              name, key, pos, here
            );
            return;
          }

          next = reader.uint16();
          array[index++] = _module.parse(type, reader, name + '.' + key);
        }

        data[key] = array;
      } else {
        switch (type) {
          case 'count':
            count[key] = reader.uint16();
            break;

          case 'offset':
            offset[key] = reader.uint16();
            break;

          default:
            if (offset[key] != null && reader.position !== offset[key]) {
              console.warn(
                '[protocol] parse (%s): offset mismatch for "%s" at %d (expected %d)',
                name, key, reader.position, offset[key]
              );
              reader.seek(offset[key]);
            }

            data[key] = reader[type](count[key]);
        }
      }
    }

    return data;
  },

  write: function write(message, data, writer, name) {
    var code, name;

    // convert `message` to definition object
    switch (typeof message) {
      case 'object':
        // this is what we want; no further action needed
        // if `code` is not given, we will error later
        if (name == null) name = '<Object>';
        break;

      case 'string':
        name = message;
        code = _module.map.name[message];
        message = _module.messages[message];
        if (code == null) {
          console.warn('[protocol] write: code not known for message "%s"', message);
          // `code` may not be needed; error later if it is
        }
        break;

      case 'number':
        code = message;
        name = '[' + code + ']';
        message = _module.messages[_module.map.code[message]];
        break;

      default:
        console.error('[protocol] write: invalid message type %s', typeof message);
        return;
    }

    // set up optional arg `writer`
    if (writer == null) {
      // make sure `code` is valid
      if (code == null || code < 0) {
        console.error('[protocol] write (%s): invalid code "%s"', name, code);
        return;
      }

      // set up stream
      var length = 4 + getLength(message, data);
      writer = new Stream.Writeable(length);
      writer.uint16(length);
      writer.uint16(code);
    }

    // begin writing
    var count = {};
    var offset = {};
    for (var i = 0, len = message.length; i < len; i++) {
      var field = message[i];
      var key = field[0];
      var type = field[1];
      if (typeof type === 'object') {
        var array = data[key];
        var length = array.length;
        if (length !== 0) {
          var here = writer.position;
          writer.seek(count[key]);
          writer.uint16(length);
          writer.seek(here);
          var last = offset[key];
          for (var j = 0; j < length; j++) {
            var element = array[j];
            here = writer.position;
            writer.seek(last);
            writer.uint16(here);
            writer.seek(here);
            writer.uint16(here);
            last = writer.position;
            writer.uint16(0);
            _module.write(type, element, writer, name + '.' + key);
          }
        }
      } else {
        switch (type) {
          case 'count':
            count[key] = writer.position;
            writer.uint16(0);
            break;

          case 'offset':
            offset[key] = writer.position;
            writer.uint16(0);
            break;

          default:
            if (count[key] != null) {
              var here = writer.position;
              writer.seek(count[key]);
              writer.uint16(data[key].length);
              writer.seek(here);
            }

            if (offset[key] != null) {
              var here = writer.position;
              writer.seek(offset[key]);
              writer.uint16(here);
              writer.seek(here);
            }

            writer[type](data[key]);
        }
      }
    }

    return writer.buffer;
  }
};

_module.load();
