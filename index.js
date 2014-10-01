'use strict';

var redis      = require('redis');
var async      = require('async');
var request    = require('request');
var url        = require('url');
var http       = require('http');
var prettyjson = require('prettyjson');
var _          = require('lodash');

var PORT      = process.env.PORT || 3000;
var INSTANCES = {};
var ENVS      = {};
var UNHEALTHY = {};

http.globalAgent.maxSockets = Infinity;

function createRedisClient() {
  var client = redis.createClient(process.env.REDIS_PORT, process.env.REDIS_HOST);

  client.on('error', function(err) {
    console.log('Redis connection error. Aborting.');
    console.log(err);
    process.exit(1);
  });

  client.on('end', function() {
    console.log('Redis connection closed. Aborting.');
    process.exit(1);
  });

  return client;
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

function markHostHealth(app, host, healthy) {
  if (healthy) {
    delete UNHEALTHY[host];
  } else {
    console.log(('[' + app + '] Could not reach ' + host).red);
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

function healthCheckHost(app, host, fn) {
  request({
    url: 'http://' + host + '/ping',
    timeout: 5000,
  }, function(err, res) {
    if (err) {
      return fn(err);
    }
    markHostHealth(app, host, res.statusCode == 200);
    fn();
  }).on('error', function(err) {
    markHostHealth(app, host, false);
    fn();
  });
}

function healthCheckInstances(fn) {
  fn = fn || _.noop;
  var apps = Object.keys(INSTANCES);
  async.each(apps, function(app, fn) {
    async.eachLimit(INSTANCES[app], 5, function(host, fn) {
      healthCheckHost(app, host, fn);
    }, fn);
  }, fn);
}

function initRoutingTable(fn) {
  fn = fn || _.noop;
  loadApps(function(err, apps) {
    if (err) {
      return fn(err);
    }
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

var server = http.createServer(function(req, res) {

  // Allow to run locally on a different port than 80.
  var app = req.headers.host.split(':')[0];

  if (req.url == '/_ping') {
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
  var options = {
    hostname: parts[0],
    port: parts[1],
    method: req.method,
    path: req.url,
    headers: req.headers,
  };

  var proxy = http.request(options, function(proxyRes) {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, {
      end: true,
    });
  });

  proxy.on('error', function(err) {
    res.writeHead(500, { 'Content-type': 'json' });
    res.end(JSON.stringify({error: err}));
  });

  req.pipe(proxy, {
    end: true,
  });

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
