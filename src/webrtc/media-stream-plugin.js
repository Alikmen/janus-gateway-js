var Promise = require('bluebird');
var Helpers = require('../helpers');
var PluginResponse = require('../plugin-response');
var MediaEntityPlugin = require('./media-entity-plugin');

function MediaStreamPlugin() {
  MediaStreamPlugin.super_.apply(this, arguments);
}

Helpers.inherits(MediaStreamPlugin, MediaEntityPlugin);

/**
 * @param {string|number} id
 * @param {Object} options
 * @returns {Promise}
 * @fulfilled {PluginResponse} response
 */
MediaStreamPlugin.prototype._create = function(id, options) {
  options = Helpers.extend({id: id}, options);
  return MediaStreamPlugin.super_.prototype._create.call(this, options)
    .then(function(response) {
      if (this.hasCurrentEntity(id)) {
        this.resetCurrentEntity();
      }
      return response;
    }.bind(this));
};

/**
 * @param {string|number} id
 * @param {Object} options
 * @returns {Promise}
 * @fulfilled {PluginResponse} response
 */
MediaStreamPlugin.prototype._destroy = function(id, options) {
  options = Helpers.extend({id: id}, options);
  return MediaStreamPlugin.super_.prototype._destroy.call(this, options)
    .then(function(response) {
      if (this.hasCurrentEntity(id)) {
        this.resetCurrentEntity();
      }
      return response;
    }.bind(this));
};

/**
 * @param {string|number} id
 * @param {Object} [watchOptions]
 * @param {Object} [answerOptions]
 * @returns {Promise}
 * @fulfilled {PluginResponse} response
 */
MediaStreamPlugin.prototype._watch = function(id, watchOptions, answerOptions) {
  var plugin = this;
  var body = Helpers.extend({request: 'watch', id: id}, watchOptions);
  return this.sendWithTransaction({body: body})
    .then(function(response) {
      var jsep = response.get('jsep');
      if (!jsep || 'offer' != jsep['type']) {
        throw new Error('Expect offer response on watch request')
      }
      plugin.setCurrentEntity(id);
      return plugin._startMediaStreaming(jsep, answerOptions).return(response);
    });
};

/**
 * @param {RTCSessionDescription} [jsep]
 * @returns {Promise}
 * @fulfilled {PluginResponse} response
 */
MediaStreamPlugin.prototype._start = function(jsep) {
  var message = {body: {request: 'start'}};
  if (jsep) {
    message.jsep = jsep;
  }
  return this.sendWithTransaction(message);
};

/**
 * @returns {Promise}
 * @fulfilled {PluginResponse} response
 */
MediaStreamPlugin.prototype._stop = function() {
  return this.sendWithTransaction({body: {request: 'stop'}})
    .then(function(response) {
      this.resetCurrentEntity();
      return response;
    }.bind(this));
};

/**
 * @returns {Promise}
 * @fulfilled {PluginResponse} response
 */
MediaStreamPlugin.prototype._pause = function() {
  return this.sendWithTransaction({body: {request: 'pause'}});
};

/**
 * @param {string|number} id
 * @param {Object} [options]
 * @returns {Promise}
 * @fulfilled {PluginResponse} response
 */
MediaStreamPlugin.prototype._switch = function(id, options) {
  var body = Helpers.extend({
    request: 'switch',
    id: id
  }, options);
  return this.sendWithTransaction({body: body})
    .then(function(response) {
      this.setCurrentEntity(id);
      return response;
    }.bind(this));
};

/**
 * @param {string|number} id
 * @param {Object} [watchOptions]
 * @param {Object} [answerOptions]
 * @returns {Promise}
 * @fulfilled {PluginResponse} response
 */
MediaStreamPlugin.prototype.connect = function(id, watchOptions, answerOptions) {
  if (this.hasCurrentEntity(id)) {
    return Promise.resolve(new PluginResponse({}));
  }
  if (this.hasCurrentEntity()) {
    return this._switch(id, watchOptions);
  }
  return this._watch(id, watchOptions, answerOptions);
};

/**
 * @param {RTCSessionDescription} jsep
 * @param {RTCAnswerOptions} [answerOptions]
 * @returns {Promise}
 * @fulfilled {PluginResponse} response
 */
MediaStreamPlugin.prototype._startMediaStreaming = function(jsep, answerOptions) {
  var self = this;
  return Promise
    .try(function() {
      self.createPeerConnection();
    })
    .then(function() {
      return self.createAnswer(jsep, answerOptions);
    })
    .then(function(jsep) {
      return self.send({janus: 'message', body: {request: 'start'}, jsep: jsep});
    });
};

module.exports = MediaStreamPlugin;
