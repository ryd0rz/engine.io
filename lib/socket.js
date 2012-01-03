
/**
 * Module dependencies.
 */

var EventEmitter = require('events').EventEmitter

/**
 * Module exports.
 */

module.exports = Socket;

/**
 * Client class (abstract).
 *
 * @api private
 */

function Socket (id, server, transport) {
  this.id = id;
  this.server = server;
  this.upgraded = false;
  this.readyState = 'opening';

  // keep some event handlers references around for later
  this.onClose = this.onClose.bind(this);
  this.onError = this.onError.bind(this);
  this.onPacket = this.onPacket.bind(this);

  this.setTransport(transport);
}

/**
 * Inherits from EventEmitter.
 */

Socket.prototype.__proto__ = EventEmitter.prototype;

/**
 * Called upon transport considered open.
 *
 * @api private
 */

Socket.prototype.onOpen = function () {
  this.readyState = 'open';

  // sends an `open` packet
  this.transport.send({
      type: 'open'
    , data: JSON.stringify({
          upgrades: this.server.upgrades()
        , pingTimeout: this.server.pingTimeout
        , pingInterval: this.server.pingInterval
      })
  });

  this.emit('open');
  this.ping();
};

/**
 * Called upon transport packet.
 *
 * @param {Object} packet
 * @api private
 */

Socket.prototype.onPacket = function (packet) {
  switch (packet.type) {
    case 'close':
      this.onClose();
      break;

    case 'pong':
      this.emit('heartbeat');
      this.ping();
      break;

    case 'error':
      this.onClose('parse error');
      break;

    case 'message':
      this.emit('message', packet.data);
      break;
  }
};

Socket.prototype.onError = function (err) {
  this.onClose('transport error', err);
};

/**
 * Pings a client.
 *
 * @api private
 */

Socket.prototype.ping = function () {
  clearTimeout(this.pingTimeoutTimer);

  var self = this;
  this.pingTime = Date.now();
  this.pingIntervalTimer = setTimeout(function () {
    self.transport.send({ type: 'pong' });
    self.pingTimeoutTimer = function () {
      self.onClose('ping timeout', Date.now() - self.pingTime);
    }
  }, this.server.pingInterval);
};

/**
 * Attaches handlers for the given transport.
 *
 * @param {Transport} transport
 * @api private
 */

Socket.prototype.setTransport = function (transport) {
  this.transport = transport;
  this.transport.once('open', this.onOpen.bind(this));
  this.transport.once('error', this.onError);
  this.transport.on('packet', this.onPacket);
  this.transport.once('close', this.onClose);
};

/**
 * Upgrades socket to the given transport
 *
 * @param {Transport} transport
 * @api private
 */

Socket.prototype.upgrade = function (transport) {
  // assert: !this.upgraded, 'we cant upgrade twice'
  this.upgraded = true;
  this.clearTransport();

  // the transport is already opened if we're upgrading to it
  // therefore we don't worry about the `open` event
  this.setTransport(transport);
  this.ping();
}

/**
 * Clears listeners and timers associated with current transport.
 *
 * @api private
 */

Socket.prototype.clearTransport = function () {
  clearTimeout(this.pingIntervalTimer);
  clearTimeout(this.pingTimeoutTimer);

  this.transport.removeListener('error', this.onError);
  this.transport.removeListener('close', this.onClose);
  this.transport.removeListener('packet', this.onPacket);
};

/**
 * Called upon transport considered closed.
 * Possible reasons: `ping timeout`, `client error`, `parse error`,
 * `transport error`, `client close`, `server close`
 */

Socket.prototype.onClose = function (reason, description) {
  this.clearTransport();
  this.readyState = 'close';
  this.emit('close', reason, description);
};

/**
 * Sends a message packet.
 *
 * @param {String} message
 * @api public
 */

Socket.prototype.send = function (data) {
  this.transport.send({ type: 'message', data: data });
};

/**
 * Closes the socket and underlying transport.
 *
 * @return {Socket} for chaining
 * @api public
 */

Socket.prototype.close = function () {
  // we trigger the `close` event immediately and ignore
  // the transport one, but we still clean up connections
  this.onClose('server close');
  this.transport.close();
};