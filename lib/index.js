var fs = require('fs');
var net = require('net');
var path = require('path');

var Dispatch = require('./dispatch');
var Connection = require('./connection');

function createServer(connectOpts, cb) {
  return net.createServer(function(socket) {
    var dispatch = new Dispatch;
    var proxy = new Connection(socket, dispatch);

    proxy.connect(connectOpts);
    dispatch.connection = proxy;

    cb(dispatch);
  });
};

module.exports = {
  createServer: createServer
};
