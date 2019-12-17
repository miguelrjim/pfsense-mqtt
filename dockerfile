ARG BUILD_FROM
FROM $BUILD_FROM

ENV LANG C.UTF-8
RUN apk add --no-cache nodejs npm
COPY . /pfsense-mqtt/
RUN chmod +x /pfsense-mqtt/run.sh

CMD [ "/pfsense-mqtt/run.sh" ]