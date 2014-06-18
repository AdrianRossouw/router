FROM ubuntu
RUN sudo apt-get update
RUN sudo apt-get install -y software-properties-common
RUN sudo add-apt-repository ppa:chris-lea/node.js
RUN sudo apt-get update
RUN sudo apt-get install -y python g++ make nodejs
RUN sudo npm install -g supervisor
ADD . /app
WORKDIR /app
EXPOSE 80
ENV PORT 80
ENTRYPOINT supervisor index.js
