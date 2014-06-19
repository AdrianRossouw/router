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
var UNHEALTHY = [];

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
  return _(table[domain]).difference(UNHEALTHY).sample();
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

  if (!randomHost) {
    res.statusCode = 503;
    res.end('No available backend for ' + host);
    return;
  }


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

function markHostDown(host) {
  console.log('Host down: ' + host);
  if (!_.contains(UNHEALTHY, host)) {
    UNHEALTHY.push(host);
  }
}

function markHostUp(host) {
  console.log('Host Up: ' + host);
  _.pull(UNHEALTHY, host);
}

setInterval(function() {
  var hosts = _(HOSTS).values().flatten().value();

  async.eachLimit(hosts, 5, function(host, fn) {
    http.get('http://' + host + '/ping', function(res) {
      if (res.statusCode == 200) {
        markHostUp(host);
      } else {
        markHostDown(host);
      }
      fn();
    }).on('error', function(err) {
      markHostDown(host);
      fn();
    });
  });

}, 10000);


process.on('uncaughtException', function(err) {
  console.log('Caught exception: ' + err, err.stack);
  process.exit(1);
});
