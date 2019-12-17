import * as path from 'path'
import {readFileSync, writeFile} from 'fs'
import {promisify} from 'util'
import uuid from 'uuid/v4'

const writeFileAsync = promisify(writeFile);

const UUIDS_FILE = path.join(process.cwd(), "uuids.json");

let uuids: Map<string, string>;
let ruleIds = new Map<string, string>();

let config: any;
try {
    config = require(path.join(process.cwd(), 'config'))
} catch (ex) {
    config = {
        "host": process.env.MQTTHOST,
        "port": process.env.MQTTPORT,
        "pfsense_prefix": process.env.MQTTPFSENSETOPIC,
        "pfsense_rules": JSON.parse(process.env.PFSENSERULES || "[]"),
        "pfsense_host": process.env.PFSENSEHOST,
        "pfsense_apikey": process.env.PFSENSEAPIKEY,
        "pfsense_apisecret": process.env.PFSENSEAPISECRET,
        "hass_discovery_prefix": process.env.HASSDISCOVERYPREFIX,
        "hass_topic": process.env.HASSTOPIC,
        "mqtt_user": process.env.MQTTUSER,
        "mqtt_pass": process.env.MQTTPASSWORD,
    }
}
config["pfsense_prefix"] = config["pfsense_prefix"] || "pfsense";
config["hass_discovery_prefix"] = config["hass_discovery_prefix"] || "homeassistant"
config["hass_topic"] = config["hass_topic"] || "hass/status"
try {
    uuids = new Map(JSON.parse(readFileSync(UUIDS_FILE, {encoding: 'utf8'})))
    for (let [ruleId, uuid] of uuids.entries()) {
        ruleIds.set(uuid, ruleId)
    }
} catch (ex) {
    uuids = new Map()
}

export async function saveUuids() {
    return writeFileAsync(UUIDS_FILE, JSON.stringify(Array.from(uuids.entries())))
        .catch(err => console.error("Error while saving UUIDs:", err));
}

export function getRuleUuid(ruleId: string): string {
    if (!uuids.has(ruleId)) {
        const ruleUuid = uuid()
        uuids.set(ruleId, ruleUuid)
        ruleIds.set(ruleUuid, ruleId)
        saveUuids()
    }
    return uuids.get(ruleId)
}

export function getRuleId(ruleUuid: string): string {
    return ruleIds.get(ruleUuid)
}

export default config;