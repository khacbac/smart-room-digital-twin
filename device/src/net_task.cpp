// Single-board uplink (spec §6.4, D11): Wi-Fi, NTP and MQTT run in a FreeRTOS task
// pinned to core 0, so a blocking connect never stalls the sensor/rule loop on core 1.
// Only this task touches the PubSubClient. loop() talks to it through queues:
//
//   loop() ── net::publish() ──▶ outQueue (16, drop oldest) ──▶ MQTT publish
//   MQTT command topic ──▶ cmdQueue (4) ── net::popCommand() ──▶ loop()
//
// The net task never builds payloads (only the static LWT) and empties outQueue when
// the connection drops, so nothing stale is sent on reconnect (D8).

#include "net.h"

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <atomic>
#include <time.h>

struct NetMessage {
    char topic[MQTT_TOPIC_MAX];
    char payload[MQTT_PAYLOAD_MAX];
    uint16_t len;
    bool retain;
};

static WiFiClient wifiClient;
static PubSubClient mqtt(wifiClient);

static QueueHandle_t outQueue = nullptr;
static QueueHandle_t cmdQueue = nullptr;
static TaskHandle_t loopTask = nullptr;

static std::atomic<bool> netOnline{false};
static std::atomic<bool> ntpSynced{false};
static std::atomic<int> lastRssi{0};
static std::atomic<uint32_t> dropped{0};

static char statusTopic[MQTT_TOPIC_MAX];
static char commandTopic[MQTT_TOPIC_MAX];
static char telemetryTopic[MQTT_TOPIC_MAX];
static char eventTopic[MQTT_TOPIC_MAX];
static char ackTopic[MQTT_TOPIC_MAX];
static const char kClientId[] = "dev-" DEVICE_ID;
static const char kLwtPayload[] = "{\"v\":1,\"deviceId\":\"" DEVICE_ID "\",\"online\":false}";

// Only the net task uses these (the MQTT callback runs inside mqtt.loop()).
static NetMessage txItem;
static NetCommand rxItem;

// Wrap-safe "now has reached `at`".
static bool due(uint32_t now, uint32_t at) { return (int32_t)(now - at) >= 0; }

// §6.4: 1 s → 2 s → 4 s … capped at 30 s.
struct Backoff {
    uint32_t delayMs = NET_BACKOFF_MIN_MS;
    uint32_t nextAt = 0;
    void reset(uint32_t now) {
        delayMs = NET_BACKOFF_MIN_MS;
        nextAt = now;
    }
    void fail(uint32_t now) {
        nextAt = now + delayMs;
        delayMs = min<uint32_t>(delayMs * 2, NET_BACKOFF_MAX_MS);
    }
};

// ---- MQTT ----------------------------------------------------------------------

static void onMessage(char* topic, byte* payload, unsigned int len) {
    if (strcmp(topic, commandTopic) != 0) return;
    // Longer than the queue item → truncated, so it fails JSON parsing → COMMAND_REJECTED.
    const size_t n = min<size_t>(len, sizeof(rxItem.payload) - 1);
    memcpy(rxItem.payload, payload, n);
    rxItem.payload[n] = '\0';
    rxItem.len = n;
    if (xQueueSend(cmdQueue, &rxItem, 0) != pdTRUE) Serial.println("[mqtt] command queue full, dropped");
}

static bool mqttUp = false;
static Backoff mqttBackoff;

// Connection lost (MQTT or Wi-Fi). Stops the socket without a DISCONNECT packet, so the
// broker still publishes the Last Will.
static void mqttLost(const char* why) {
    if (!mqttUp) return;
    mqttUp = false;
    netOnline = false;
    wifiClient.stop();
    xQueueReset(outQueue);  // §6.4: no burst of stale messages on reconnect
    Serial.printf("[mqtt] lost (%s, state=%d)\n", why, mqtt.state());
    mqttBackoff.reset(millis());
}

static void mqttConnect(uint32_t now) {
    Serial.printf("[mqtt] connecting to %s:%d as %s\n", MQTT_HOST, MQTT_PORT, kClientId);
    // Blocking (DNS + TCP ≤ MQTT_SOCKET_TIMEOUT_SEC + CONNACK), but only this task waits.
    const bool ok = mqtt.connect(kClientId, nullptr, nullptr, statusTopic, 1, true, kLwtPayload, true);
    if (ok && mqtt.subscribe(commandTopic, 1)) {
        mqttUp = true;
        mqttBackoff.reset(millis());
        xQueueReset(outQueue);
        netOnline = true;
        Serial.printf("[mqtt] connected, subscribed %s\n", commandTopic);
        xTaskNotifyGive(loopTask);  // connect handshake (§6.4)
        return;
    }
    if (ok) wifiClient.stop();  // connected but subscribe failed: start over
    mqttBackoff.fail(now);
    Serial.printf("[mqtt] connect failed state=%d, retry in %lu ms\n", mqtt.state(),
                  (unsigned long)(mqttBackoff.nextAt - now));
}

static void mqttService(uint32_t now) {
    if (!mqtt.connected()) {
        mqttLost("disconnected");
        if (due(now, mqttBackoff.nextAt)) mqttConnect(now);
        return;
    }
    mqtt.loop();
    while (mqtt.connected() && xQueueReceive(outQueue, &txItem, 0) == pdTRUE) {
        if (!mqtt.publish(txItem.topic, (const uint8_t*)txItem.payload, txItem.len, txItem.retain)) {
            Serial.printf("[mqtt] publish failed %s (%u B)\n", txItem.topic, txItem.len);
        }
    }
}

// ---- NTP -------------------------------------------------------------------------

static uint32_t ntpRequestedAt = 0;
static bool ntpRequested = false;

static void ntpService(uint32_t now) {
    if (ntpSynced) return;
    if (!ntpRequested || (uint32_t)(now - ntpRequestedAt) >= NTP_RETRY_MS) {
        configTime(0, 0, NTP_SERVER);  // UTC; SNTP runs in the background
        ntpRequested = true;
        ntpRequestedAt = now;
        return;
    }
    struct tm tm;
    if (getLocalTime(&tm, 0)) {  // 0 = don't wait (the default waits 5 s, §16)
        ntpSynced = true;
        Serial.printf("[ntp] synced %04d-%02d-%02d %02d:%02d:%02d UTC\n", tm.tm_year + 1900, tm.tm_mon + 1,
                      tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec);
    }
}

// ---- Wi-Fi -----------------------------------------------------------------------

enum class WifiState { Waiting, Connecting, Up };
static WifiState wifiState = WifiState::Waiting;
static Backoff wifiBackoff;
static uint32_t wifiAttemptAt = 0;
static uint32_t rssiAt = 0;

static void wifiService(uint32_t now) {
    const bool connected = WiFi.status() == WL_CONNECTED;
    switch (wifiState) {
        case WifiState::Waiting:
            if (!due(now, wifiBackoff.nextAt)) break;
            Serial.printf("[wifi] connecting to %s\n", WIFI_SSID);
            WiFi.disconnect();
            WiFi.begin(WIFI_SSID, WIFI_PASSWORD, WIFI_CHANNEL);
            wifiAttemptAt = now;
            wifiState = WifiState::Connecting;
            break;
        case WifiState::Connecting:
            if (connected) {
                wifiState = WifiState::Up;
                wifiBackoff.reset(now);
                mqttBackoff.reset(now);
                lastRssi = WiFi.RSSI();
                Serial.printf("[wifi] ip=%s rssi=%d\n", WiFi.localIP().toString().c_str(), (int)lastRssi);
            } else if ((uint32_t)(now - wifiAttemptAt) >= WIFI_CONNECT_TIMEOUT_MS) {
                WiFi.disconnect();
                wifiBackoff.fail(now);
                wifiState = WifiState::Waiting;
                Serial.printf("[wifi] timeout, retry in %lu ms\n", (unsigned long)(wifiBackoff.nextAt - now));
            }
            break;
        case WifiState::Up:
            if (!connected) {
                mqttLost("wifi down");
                lastRssi = 0;
                wifiBackoff.fail(now);
                wifiState = WifiState::Waiting;
                Serial.printf("[wifi] lost, retry in %lu ms\n", (unsigned long)(wifiBackoff.nextAt - now));
            } else if ((uint32_t)(now - rssiAt) >= 1000) {
                rssiAt = now;
                lastRssi = WiFi.RSSI();
            }
            break;
    }
}

static void netTask(void*) {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(false);  // reconnect with our own backoff instead
    mqtt.setServer(MQTT_HOST, MQTT_PORT);
    mqtt.setKeepAlive(MQTT_KEEPALIVE_SEC);
    mqtt.setBufferSize(MQTT_BUFFER_SIZE);
    mqtt.setSocketTimeout(MQTT_SOCKET_TIMEOUT_SEC);
    mqtt.setCallback(onMessage);
    wifiClient.setTimeout(MQTT_SOCKET_TIMEOUT_SEC);  // core 2.x: seconds, not ms

    for (;;) {
        const uint32_t now = millis();
        wifiService(now);
        if (wifiState == WifiState::Up) {
            ntpService(now);
            mqttService(now);
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

// ---- API (loop side) --------------------------------------------------------------

namespace net {

void begin(const char*) {
    snprintf(statusTopic, sizeof(statusTopic), "%s/%s/status", MQTT_TOPIC_PREFIX, DEVICE_ID);
    snprintf(commandTopic, sizeof(commandTopic), "%s/%s/command", MQTT_TOPIC_PREFIX, DEVICE_ID);
    snprintf(telemetryTopic, sizeof(telemetryTopic), "%s/%s/telemetry", MQTT_TOPIC_PREFIX, DEVICE_ID);
    snprintf(eventTopic, sizeof(eventTopic), "%s/%s/event", MQTT_TOPIC_PREFIX, DEVICE_ID);
    snprintf(ackTopic, sizeof(ackTopic), "%s/%s/command/ack", MQTT_TOPIC_PREFIX, DEVICE_ID);
    loopTask = xTaskGetCurrentTaskHandle();
    outQueue = xQueueCreate(OUT_QUEUE_DEPTH, sizeof(NetMessage));
    cmdQueue = xQueueCreate(CMD_QUEUE_DEPTH, sizeof(NetCommand));
    xTaskCreatePinnedToCore(netTask, "net_task", NET_TASK_STACK, nullptr, NET_TASK_PRIORITY, nullptr,
                            NET_TASK_CORE);
}

void poll(uint32_t) {}

bool online() { return netOnline; }
bool timeSynced() { return ntpSynced; }
int rssi() { return lastRssi; }

void printStats() {
    Serial.printf("[net] mqtt=%s ntp=%s rssi=%d dropped=%lu\n", netOnline ? "up" : "down",
                  ntpSynced ? "synced" : "no", (int)lastRssi, (unsigned long)dropped);
}

bool takeConnected() { return ulTaskNotifyTake(pdTRUE, 0) > 0; }

static const char* topicFor(Channel ch) {
    switch (ch) {
        case Channel::Telemetry: return telemetryTopic;
        case Channel::Status: return statusTopic;
        case Channel::Event: return eventTopic;
        case Channel::Ack: return ackTopic;
    }
    return telemetryTopic;
}

bool publish(Channel ch, const char* payload, size_t len) {
    static NetMessage item;  // loop() is the only producer
    if (len > sizeof(item.payload)) return false;
    strcpy(item.topic, topicFor(ch));
    memcpy(item.payload, payload, len);
    item.len = len;
    item.retain = ch == Channel::Status;
    if (xQueueSend(outQueue, &item, 0) != pdTRUE) {
        static NetMessage oldest;  // §6.4 "drop oldest": receive one, then send again
        if (xQueueReceive(outQueue, &oldest, 0) == pdTRUE) dropped++;
        if (xQueueSend(outQueue, &item, 0) != pdTRUE) dropped++;
    }
    return true;
}

bool popCommand(NetCommand& out) { return xQueueReceive(cmdQueue, &out, 0) == pdTRUE; }

}  // namespace net
