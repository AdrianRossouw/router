var redis      = require('redis');
var async      = require('async');
var request    = require('request');
var url        = require('url');
var bouncy     = require('bouncy');
var prettyjson = require('prettyjson');
var _          = require('lodash');

var PORT      = process.env.PORT || 3000;
var INSTANCES = {};
var ENVS      = {};
var UNHEALTHY = {};

require('http').globalAgent.maxSockets = Infinity;

function createRedisClient() {
  return redis.createClient(process.env.REDIS_PORT, process.env.REDIS_HOST);
}

function redisCmd() {
  var args = _.toArray(arguments);
  var cmd = args.shift();
  var client = createRedisClient();
  client[cmd].apply(client, args);
}

function loadAppInstances(app, fn) {
  redisCmd('smembers', app + ':instances', fn);
}

function loadApps(fn) {
  redisCmd('smembers', 'apps', fn);
}

function getAllInstances() {
  return _(INSTANCES).values().flatten().value();
}

function markHostHealth(host, healthy) {
  if (healthy) {
    delete UNHEALTHY[host];
  } else {
    UNHEALTHY[host] = 1;
  }
}

function subscribeToUpdates() {
  var client = createRedisClient();
  client.on('message', function(channel, message) {
    if (channel == 'updates') {
      initRoutingTable();
    }
  });
  client.subscribe('updates');
}

function healthCheckHost(host, fn) {
  request({
    url: 'http://' + host + '/ping',
    timeout: 5000,
  }, function(err, res) {
    if (err) {
      return fn(err);
    }
    markHostHealth(host, res.statusCode == 200);
    fn();
  }).on('error', function(err) {
    markHostHealth(host, false);
    fn();
  });
}

function healthCheckInstances(fn) {
  fn = fn || _.noop;
  var instances = getAllInstances();
  async.eachLimit(instances, 5, function(host, fn) {
    healthCheckHost(host, fn);
  }, fn);
}

function initRoutingTable(fn) {
  fn = fn || _.noop;
  loadApps(function(err, apps) {
    async.map(apps, function(app, fn) {
      loadAppInstances(app, function(err, instances) {
        if (err) {
          return fn(err);
        }
        INSTANCES[app] = instances;
        fn(null);
      });
    }, function(err, results) {
      if (err) {
        console.error(err);
        return fn(err);
      }
      console.log("\nLoading routing table.");
      console.log(prettyjson.render(INSTANCES) + "\n");
      fn(null, INSTANCES);
    });
  });
}

function selectAppInstance(app) {
  return _(INSTANCES[app]).difference(Object.keys(UNHEALTHY)).sample();
}

var server = bouncy(function(req, res, bounce) {

  var app = req.headers.host;

  if (req.url == '/ping') {
    res.statusCode = 200;
    res.end('pong');
    return;
  }

  if (!app) {
    res.statusCode = 400;
    res.end('Invalid hostname');
    return;
  }

  if (!INSTANCES[app]) {
    res.statusCode = 404;
    res.end('No backend found for ' + app);
    return;
  }

  if (_.isEmpty(INSTANCES[app])) {
    res.statusCode = 503;
    res.end('No available backend for ' + app);
    return;
  }

  var randomInstance = selectAppInstance(app);

  if (!randomInstance) {
    res.statusCode = 503;
    res.end('No available backend for ' + app);
    return;
  }

  var parts = randomInstance.split(':');
  bounce(parts[0], parts[1]);
});

server.listen(PORT, function() {
  console.log('Listening on ' + PORT);
});

initRoutingTable();
subscribeToUpdates();

setInterval(function() {
  healthCheckInstances();
}, 10000);

process.on('uncaughtException', function(err) {
  console.log('Caught exception: ' + err, err.stack);
  process.exit(1);
});
