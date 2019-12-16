import {FauxApiClient} from "faux-api-client";
import {connect} from "mqtt";
import config from "./config"

export const mqttClient = connect({
    host: config.host,
    port: config.port,
    username: config.mqtt_user,
    password: config.mqtt_pass
});


export const fauxApiClient = new FauxApiClient(
    config.pfsense_host,
    config.pfsense_apikey,
    config.pfsense_apisecret
);