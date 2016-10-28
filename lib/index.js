const fs = require('fs');
const net = require('net');
const path = require('path');

const Dispatch = require('./dispatch');
const Connection = require('./connection');

function createServer(connectOpts, cb) {
  return net.createServer((socket) => {
    const dispatch = new Dispatch;
    const proxy = new Connection(socket, dispatch);

    proxy.connect(connectOpts);

    cb(dispatch);
  });
};

module.exports = { createServer };
