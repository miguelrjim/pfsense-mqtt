import {IFauxApiResponse} from 'faux-api-client';
import {mqttClient, fauxApiClient} from "./singletons";
import {default as config, getRuleUuid, getRuleId} from "./config"
import debugWrapper from 'debug'

const debug = debugWrapper('pfsense-mqtt')
const debugError = debugWrapper('error')
const debugMqtt = debugWrapper('mqtt')

const ON = "ON";
const OFF = "OFF";
const AVAILABLE = "online"
const NOT_AVAILABLE = "offline"
const REPUBLISH_DELAY = 30 // Seconds
const REFRESH_RULES_TIME = 10 // Seconds

let mqttConnected = false
let refreshRulesInterval: NodeJS.Timeout
let republishCount = 1 // Republish config/state this many times after startup or HA start/restart

// Setup Exit Handwlers
process.on('exit', processExit.bind(null, {cleanup:true, exit:true}))
process.on('SIGINT', processExit.bind(null, {cleanup:true, exit:true}))
process.on('SIGTERM', processExit.bind(null, {cleanup:true, exit:true}))
process.on('uncaughtException', processExit.bind(null, {exit:true}))

// Set unreachable status on exit 
async function processExit(options: any, exitCode: number) {
    if (refreshRulesInterval !== undefined) {
        clearInterval(refreshRulesInterval)
    }
    if (options.cleanup) {
        const rules = await filterRules(config.pfsense_rules)
        rules.forEach(rule => {
            const availabilityTopic = `${getRuleTopic(rule.descr)}/availability`
            mqttClient.publish(availabilityTopic, NOT_AVAILABLE)
        })
    }
    if (exitCode || exitCode === 0) debug('Exit code: ', exitCode)
    if (options.exit) {
        await sleep(1)
        process.exit()
    }
}

async function getRules(): Promise<Array<any>> {
    return fauxApiClient.getConfiguration()
        .then((success: IFauxApiResponse) => {
            return success.data.config.filter.rule
        });
}

async function filterRules(ruleIds: Array<string>, rules?: Array<any>) {
    if (rules === undefined) {
        rules = await getRules()
    }
    const rulesById: Map<string, any> = new Map()
    rules.forEach(obj => rulesById.set(obj.descr, obj))
    return ruleIds.map(ruleId => rulesById.get(ruleId))
}

async function updateRule(ruleId: string, disabled: boolean) {
    const rules = await getRules()
    const [rule] = await filterRules([ruleId], rules)
    if (rule === undefined) {
        return;
    }
    if (disabled) {
        rule["disabled"] = ""
    } else {
        delete rule["disabled"]
    }
    const patchedConfig = {
        filter: {
            rule: rules
        }
    } 
    await fauxApiClient.patchConfiguration(patchedConfig)
    publishRuleState(rule.descr, disabled ? OFF : ON)
}

async function sleep(sec: number) {
    return new Promise(res => setTimeout(res, sec*1000));
}

async function setup() {
    // On MQTT connect/reconnect send config/state information after delay
    mqttClient.on('connect', async function () {
        if (!mqttConnected) {
            mqttConnected = true
            if (config.hass_topic) { mqttClient.subscribe(config.hass_topic) }
            debugMqtt('MQTT connection reestablished, resending config/state information in 5 seconds.')
        }
        await sleep(5)
        processRules()
    })

    mqttClient.on('reconnect', function () {
        if (mqttConnected) {
            debugMqtt('Connection to MQTT broker lost. Attempting to reconnect...')
        } else {
            debugMqtt('Attempting to reconnect to MQTT broker...')
        }
        mqttConnected = false
    })

    mqttClient.on('error', function (error) {
        debugMqtt('Unable to connect to MQTT broker.', error.message)
        mqttConnected = false
    })

    // Process MQTT messages from subscribed command topics
    mqttClient.on('message', async function (topic, message) {
        processCommand(topic, message)
    })

    refreshRulesInterval = setInterval(refreshRules, REFRESH_RULES_TIME * 1000)
}

async function refreshRules(rules: Array<any>) {
    if (!mqttConnected) {
        return
    }
    if (rules == undefined) {
        rules = await filterRules(config.pfsense_rules)
    }
    rules.forEach(rule => {
        publishRuleState(rule.descr, rule.hasOwnProperty("disabled") ? OFF : ON)
    })
}

function getRuleTopic(ruleId: string): string {
    const uuid = getRuleUuid(ruleId)
    return `${config.pfsense_prefix}/rules/${uuid}`
}

async function processRules() {
    if (republishCount < 1) { republishCount = 1 } 
    while (republishCount > 0 && mqttConnected) {
        try {
            const rules = await filterRules(config.pfsense_rules)
            rules.forEach(rule => registerRule(rule.descr))
            rules.forEach(rule => {
                publishRuleState(rule.descr, rule.hasOwnProperty("disabled") ? OFF : ON)
            })
            await sleep(1)
            rules.forEach(rule => {
                const availabilityTopic = `${getRuleTopic(rule.descr)}/availability`
                mqttClient.publish(availabilityTopic, AVAILABLE, { qos: 1 })
            })
        } catch (error) {
            debugError(error)
        }
        await sleep(REPUBLISH_DELAY)
        republishCount--
    }
}

function registerRule(ruleId: string) {
    const uuid = getRuleUuid(ruleId)
    const deviceTopic = getRuleTopic(ruleId)
    const availabilityTopic = `${deviceTopic}/availability`
    const stateTopic = `${deviceTopic}/state`
    const commandTopic = `${deviceTopic}/command`
    const message = { 
        name: ruleId,
        unique_id: uuid,
        availability_topic: availabilityTopic,
        payload_available: AVAILABLE,
        payload_not_available: NOT_AVAILABLE,
        state_topic: stateTopic,
        payload_on: ON,
        payload_off: OFF,
        command_topic: commandTopic
    }
    const configTopic = `${config.hass_discovery_prefix}/switch/${uuid}/config`
    mqttClient.subscribe(commandTopic)
    mqttClient.publish(configTopic, JSON.stringify(message), {qos: 1})
}

function publishRuleState(ruleId: string, state: string) {
    const ruleTopic = getRuleTopic(ruleId)
    mqttClient.publish(`${ruleTopic}/state`, state)
}

// Process received MQTT command
async function processCommand(topic: string, message: any) {
    message = message.toString().trim()
    if (topic === config.hass_topic) {
        // Republish devices and state after 60 seconds if restart of HA is detected
        debug('Home Assistant state topic '+topic+' received message: '+message)
        if (message === AVAILABLE) {
            debug('Resending device config/state in 30 seconds')
            // Make sure any existing republish dies
            republishCount = 0 
            await sleep(REPUBLISH_DELAY + 5)
            // Reset republish counter and start publishing config/state
            republishCount = 1
            processRules()
            debug('Resent device config/state information')
        }
    } else {
        const ruleUuid = topic.split('/')[2]
        await updateRule(getRuleId(ruleUuid), message !== ON)
    }
}

setup()