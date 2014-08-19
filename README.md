## Longshoreman Router

The router application is a reverse proxy that dynamically dispatches web traffic to applications running on the Docker container cluster. A routing table is maintained by the Longshoreman controller and updates are distributed using Redis PubSub. Currently, the routing logic is based on the request Host header. The application instances are identified for the specified host and requests are distributed randomly. Multiple routers can be added to the cluster to remove potential single points of failure.

## Health Check

A simple health-check is used to account for failed appliation instances. All applications running in Longshoreman must return a 200 response for GET requests to `/ping`.

## Start a Router

Just run `sudo docker run -p 80:80 -d -e REDIS_HOST=$REDIS_HOST_IP -e REDIS_PORT=6379 longshoreman/router` on your router nodes to start directing traffic to your Docker application instances. `$REDIS_HOST_IP` is the IP address of your Redis instance.

### TODO

* Support for regex path matching in addition to exact host matching
* Notifications for unhealthy hosts
* Allow customizationed health check urls
* Improved support for logging
* Look into support for round robin instance routing
