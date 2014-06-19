var http       = require('http');
var redis      = require('redis');
var async      = require('async');
var url        = require('url');
var bouncy     = require('bouncy');
var prettyjson = require('prettyjson');
var _          = require('lodash');

var PORT      = process.env.PORT || 3000;
var HOSTS     = {};
var ENVS      = {};
var UNHEALTHY = {};

require('http').globalAgent.maxSockets = Infinity;

var redisClient = redis.createClient(process.env.REDIS_PORT, process.env.REDIS_HOST);
var redisSubscriber = redis.createClient(process.env.REDIS_PORT, process.env.REDIS_HOST);

function loadRoutingForDomain(domain, fn) {
  redisClient.smembers(domain + ':hosts', fn);
}

function loadDomains(fn) {
  redisClient.smembers('domains', fn);
}

function initRoutingTable(fn) {
  console.log('Reloading routing table');
  loadDomains(function(err, domains) {
    async.map(domains, function(domain, fn) {
      loadRoutingForDomain(domain, function(err, hosts) {
        if (err) {
          return fn(err);
        }
        HOSTS[domain] = hosts;
        fn(null);
      });
    }, function(err, results) {
      if (err) {
        console.error(err);
        return fn(err);
      }

      console.log(prettyjson.render(hosts) + "\n");
      fn(null, HOSTS);
    });
  });
}

function selectHost(table, domain) {
  return _.sample(table[domain]);
}

var server = bouncy(function(req, res, bounce) {

  var host = req.headers.host;

  if (!host) {
    res.statusCode = 400;
    res.end('Invalid hostname');
    return;
  }

  if (!HOSTS[host]) {
    res.statusCode = 404;
    res.end('No backend found for ' + host);
    return;
  }

  if (_.isEmpty(HOSTS[host])) {
    res.statusCode = 503;
    res.end('No available backend for ' + host);
    return;
  }

  var randomHost = selectHost(HOSTS, host);
  var parts = url.parse('http://' + randomHost);

  bounce(parts.hostname, parts.port);
});

server.listen(PORT, function() {
  console.log('Listening on ' + PORT);
});


redisSubscriber.on('message', function(channel, message) {
  if (channel == 'updates') {
    initRoutingTable();
  }
});

redisSubscriber.subscribe('updates');

initRoutingTable();

process.on('uncaughtException', function(err) {
  console.log('Caught exception: ' + err, err.stack);
  process.exit(1);
});
