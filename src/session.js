var util = require('util');
var Promise = require('bluebird');
var JanusError = require('./error');
var Timer = require('./timer');
var Transaction = require('./transaction');
var TransactionGateway = require('./transaction-gateway');
var Plugin = require('./plugin');

/**
 * @param {Connection} connection
 * @param {String} id
 * @constructor
 */
function Session(connection, id) {
  Session.super_.call(this);
  this._connection = connection;
  this._id = id;
  this._plugins = {};

  if (this._connection.getOptions()['keepalive']) {
    this._startKeepAlive();
  }
}

util.inherits(Session, TransactionGateway);

/**
 * @param {Connection} connection
 * @param {String} id
 * @returns {Session}
 */
Session.create = function(connection, id) {
  return new Session(connection, id);
};

/**
 * @returns {String}
 */
Session.prototype.getId = function() {
  return this._id;
};

/**
 * @param {Object} message
 * @return {Promise}
 */
Session.prototype._send = function(message) {
  if (!this._connection) {
    return Promise.reject(new Error('Can not send message over destroyed ' + this));
  }
  //we always use own session's id in its messages
  message['session_id'] = this._id;
  if (this._keepAliveTimer) {
    this._keepAliveTimer.reset();
  }
  return this._connection.send(message)
};

/**
 * @param {String} name
 * @return {Promise}
 */
Session.prototype.attachPlugin = function(name) {
  return this.send({janus: 'attach', plugin: name});
};

/**
 * @returns {Promise}
 */
Session.prototype.destroy = function() {
  return this.send({janus: 'destroy'});
};

/**
 * @param {String} id
 * @returns {boolean}
 */
Session.prototype.hasPlugin = function(id) {
  return !!this.getPlugin(id);
};

/**
 * @param {String} id
 * @returns {Plugin}
 */
Session.prototype.getPlugin = function(id) {
  return this._plugins[id];
};

/**
 * @param {Plugin} plugin
 */
Session.prototype.addPlugin = function(plugin) {
  this._plugins[plugin.getId()] = plugin;
  plugin.once('detach', function() {
    this.removePlugin(plugin.getId())
  }.bind(this));
};

/**
 * @param {String} pluginId
 */
Session.prototype.removePlugin = function(pluginId) {
  delete this._plugins[pluginId];
};

Session.prototype.processOutcomeMessage = function(message) {
  var janusMessage = message['janus'];
  if ('attach' === janusMessage) {
    return this._onAttach(message);
  }
  if ('destroy' === janusMessage) {
    return this._onDestroy(message);
  }
  var pluginId = message['handle_id'];
  if (pluginId) {
    if (this.hasPlugin(pluginId)) {
      return this.getPlugin(pluginId).processOutcomeMessage(message);
    } else {
      return Promise.reject(new Error('Invalid plugin [' + pluginId + ']'));
    }
  }
  return Promise.resolve(message);
};

Session.prototype.processIncomeMessage = function(message) {
  var janusMessage = message['janus'];
  if ('timeout' === janusMessage) {
    return this._onTimeout(message);
  }
  var pluginId = message['handle_id'] || message['sender'];
  if (pluginId) {
    if (this.hasPlugin(pluginId)) {
      return this.getPlugin(pluginId).processIncomeMessage(message);
    } else {
      return Promise.reject(new Error('Invalid plugin [' + pluginId + ']'));
    }
  }
  return Session.prototype.super_.processIncomeMessage(message);
};

/**
 * @param {Object} outcomeMessage
 * @return {Promise}
 */
Session.prototype._onAttach = function(outcomeMessage) {
  this._transactions.add(
    new Transaction(outcomeMessage['transaction'], function(response) {
      if ('success' == response['janus']) {
        var pluginId = response['data']['id'];
        this.addPlugin(Plugin.create(this, outcomeMessage['plugin'], pluginId));
        return this.getPlugin(pluginId);
      } else {
        throw new JanusError.ConnectionError(response);
      }
    }.bind(this))
  );
  return Promise.resolve(outcomeMessage);
};

/**
 * @param {Object} incomeMessage
 * @return {Promise}
 */
Session.prototype._onTimeout = function(incomeMessage) {
  return this._destroy().return(incomeMessage);
};

/**
 * @param {Object} outcomeMessage
 * @return {Promise}
 */
Session.prototype._onDestroy = function(outcomeMessage) {
  this._transactions.add(
    new Transaction(outcomeMessage['transaction'], function(response) {
      if ('success' == response['janus']) {
        return this._destroy().return(response);
      } else {
        throw new JanusError.ConnectionError(response);
      }
    }.bind(this))
  );
  return Promise.resolve(outcomeMessage);
};

Session.prototype._destroy = function() {
  //todo destroy plugins if needed
  if (this._keepAliveTimer) {
    this._keepAliveTimer.stop();
    this._keepAliveTimer = null;
  }
  this._plugins = {};
  this._connection = null;
  this.emit('destroy');
  return Promise.resolve();
};

Session.prototype._isNaturalNumber = function(value) {
  if (isNaN(value)) {
    return false;
  }
  var x = parseFloat(value);
  return (x | 0) === x && x > 0;
};

Session.prototype._startKeepAlive = function() {
  var keepAlive = this._connection.getOptions()['keepalive'];
  if (this._isNaturalNumber(keepAlive) && keepAlive < 59000) {
    this._keepAlivePeriod = keepAlive;
  } else {
    this._keepAlivePeriod = 30000;
  }
  this._keepAliveTimer = new Timer(function() {
    this.send({janus: 'keepalive'});
  }.bind(this), this._keepAlivePeriod);
  this._keepAliveTimer.start();
};

Session.prototype.toString = function() {
  return 'Session' + JSON.stringify({id: this._id});
};


module.exports = Session;
