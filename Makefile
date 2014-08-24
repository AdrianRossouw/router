all: build push

build:
	docker build -t longshoreman/router .

push:
	docker push longshoreman/router

.PHONY: build push
