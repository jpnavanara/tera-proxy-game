// Int64
function Int64(low, high) {
  this.low = low;
  this.high = high;
}

Int64.prototype.equals = function(n) {
  return this.low === n.low && this.high === n.high;
};

// Readable
function Readable(buffer, position) {
  this.buffer = buffer;
  this.position = position || 0;
}

Readable.prototype.seek = function(n) {
  return this.position = n;
};

Readable.prototype.skip = function(n) {
  return this.position += n;
};

Readable.prototype.byte = function() {
  return this.buffer[this.position++];
};

Readable.prototype.bytes = function(n) {
  return this.buffer.slice(this.position, this.position += n);
};

Readable.prototype.uint16 = function() {
  var ret = this.buffer.readUInt16LE(this.position);
  this.position += 2;
  return ret;
};

Readable.prototype.uint32 = function() {
  var ret = this.buffer.readUInt32LE(this.position);
  this.position += 4;
  return ret;
};

Readable.prototype.uint64 = function() {
  return new Int64(this.uint32(), this.uint32());
};

Readable.prototype.int16 = function() {
  var ret = this.buffer.readInt16LE(this.position);
  this.position += 2;
  return ret;
};

Readable.prototype.int32 = function() {
  var ret = this.buffer.readInt32LE(this.position);
  this.position += 4;
  return ret;
};

Readable.prototype.int64 = function() {
  return new Int64(this.uint32(), this.int32());
};

Readable.prototype.float = function() {
  var ret = this.buffer.readFloatLE(this.position);
  this.position += 4;
  return ret;
};

Readable.prototype.string = function() {
  var c, ret = '';
  while (c = this.uint16()) {
    ret += String.fromCharCode(c);
  }
  return ret;
};

// Writeable
function Writeable(length) {
  this.length = length;
  this.buffer = new Buffer(this.length);
  this.position = 0;
}

Writeable.prototype.seek = function(n) {
  return this.position = n;
};

Writeable.prototype.skip = function(n) {
  return this.position += n;
};

Writeable.prototype.byte = function(n) {
  return this.buffer[this.position++] = n;
};

Writeable.prototype.bytes = function(buf) {
  buf.copy(this.buffer, this.position);
  return this.position += buf.length;
};

Writeable.prototype.uint16 = function(n) {
  this.buffer.writeUInt16LE(n, this.position);
  return this.position += 2;
};

Writeable.prototype.uint32 = function(n) {
  if (-0x80000000 <= n && n < 0) n >>>= 0; // cast to unsigned
  this.buffer.writeUInt32LE(n, this.position);
  return this.position += 4;
};

Writeable.prototype.uint64 = function(obj) {
  this.uint32(obj.low);
  return this.uint32(obj.high);
};

Writeable.prototype.int16 = function(n) {
  this.buffer.writeInt16LE(n, this.position);
  return this.position += 2;
};

Writeable.prototype.int32 = function(n) {
  if (0x80000000 <= n && n <= 0xFFFFFFFF) n |= 0; // cast to signed
  this.buffer.writeInt32LE(n, this.position);
  return this.position += 4;
};

Writeable.prototype.int64 = function(obj) {
  this.uint32(obj.low);
  return this.int32(obj.high);
};

Writeable.prototype.float = function(n) {
  this.buffer.writeFloatLE(n, this.position);
  return this.position += 4;
};

Writeable.prototype.string = function(str) {
  for (var i = 0, len = str.length; i < len; i++) {
    this.uint16(str.charCodeAt(i));
  }
  return this.uint16(0);
};

// exports
module.exports = {
  Readable: Readable,
  Writeable: Writeable,
};
