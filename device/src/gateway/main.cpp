// Gateway board of the 2-board split (docs/link-protocol.md §5, §6.1): no sensors, no
// edge rules. Wi-Fi, NTP and MQTT are net_task.cpp, the single-board uplink (same
// topics, Last Will and backoff, in its own task on core 0). lnk::GatewayLink bridges
// it to the node on UART1:
//
//   node ─UART1─▶ StreamDecoder ─▶ GatewayLink ─publish─▶ net::publish ─▶ net_task ─▶ MQTT
//   MQTT command ─▶ net_task ─▶ net::popCommand ─▶ GatewayLink::onCommand ─UART1─▶ node
//
// loop() owns the link and the UART; only net_task touches MQTT. The serial console
// has `stats` and `help`.

#include <Arduino.h>
#include <esp_system.h>
#include <sys/time.h>

#include "config.h"
#include "link_frame.h"
#include "link_gateway.h"
#include "net.h"

static HardwareSerial& port = Serial1;
static lnk::StreamDecoder decoder;
static lnk::GatewayLink gw;
static const char kNodeId[] = DEVICE_ID;  // the node this gateway speaks for

static uint32_t reportedErrors = 0;
static uint32_t rssiAt = 0;

// ---- GatewayLink callbacks ------------------------------------------------------------

static void writeFrame(lnk::Type type, uint8_t seq, const uint8_t* payload, size_t len) {
    static uint8_t wire[lnk::kWireMax];
    const size_t n = lnk::encodeStream(type, seq, payload, len, wire, sizeof(wire));
    if (n) port.write(wire, n);  // fits the 2 KB TX buffer: does not wait
}

static Channel channelFor(lnk::Uplink u) {
    switch (u) {
        case lnk::Uplink::Telemetry: return Channel::Telemetry;
        case lnk::Uplink::Status: return Channel::Status;
        case lnk::Uplink::Event: return Channel::Event;
        case lnk::Uplink::Ack: return Channel::Ack;
    }
    return Channel::Telemetry;
}

// Status goes out retained (net_task). PubSubClient only publishes QoS 0.
static bool publishUplink(lnk::Uplink topic, const uint8_t* payload, size_t len) {
    return net::publish(channelFor(topic), (const char*)payload, len);
}

// The node has no NTP: TIME carries ours, once synced.
static bool wallClock(int64_t& ms) {
    if (!net::timeSynced()) return false;
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    ms = (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
    return true;
}

// ---- Link ---------------------------------------------------------------------------

static void onNodeFrame(const lnk::Frame& f, uint32_t now) {
    const lnk::GwRx rx = gw.onFrame(f, now);
    if (gw.cameUp()) Serial.println("[link] node up");
    switch (rx) {
        case lnk::GwRx::Hello:
            Serial.printf("[link] HELLO %s boot %s fw %s%s\n", gw.hello().deviceId, gw.hello().bootId, gw.hello().fw,
                          gw.rebooted() ? " (node rebooted)" : "");
            break;
        case lnk::GwRx::HelloRefused:
            Serial.printf("[link] HELLO refused: invalid, or not from %s\n", kNodeId);
            break;
        case lnk::GwRx::NotRegistered:
            Serial.printf("[link] %s before HELLO, dropped (HELLO_REQUEST)\n", lnk::typeName(f.type));
            break;
        case lnk::GwRx::Invalid:
            Serial.printf("[link] ignored %s #%u (wrong direction)\n", lnk::typeName(f.type), f.seq);
            break;
        case lnk::GwRx::Dropped:  // telemetry every 2 s while MQTT is down: not logged
            if (f.type != lnk::Type::Telemetry) Serial.printf("[link] %s dropped, mqtt down\n", lnk::typeName(f.type));
            break;
        case lnk::GwRx::Published:
        case lnk::GwRx::None: break;
    }
}

static void pollLink(uint32_t now) {
    int avail = port.available();
    while (avail-- > 0) {
        if (decoder.push((uint8_t)port.read())) onNodeFrame(decoder.frame(), now);  // valid until the next push
    }
    const uint32_t errors = decoder.stats().errors;
    if (errors != reportedErrors) {
        reportedErrors = errors;
        Serial.printf("[link] dropped frame: %s (%lu so far)\n", lnk::decodeErrorName(decoder.lastError()),
                      (unsigned long)errors);
    }
}

// MQTT up/down → LINK_STATE. Up only on the connect notification: net_task sets online()
// just before it, so reading online() for "up" too would flip the node up, down, up on
// every connect. A notification while already up is a reconnect we never saw as down
// (between two loops): down then up, so the node re-sends the status our Last Will replaced.
static void syncMqtt(uint32_t now) {
    if (net::takeConnected()) {
        const bool missedDrop = gw.mqttUp();
        if (missedDrop) gw.setMqtt(false, now);
        gw.setMqtt(true, now);
        Serial.printf("[link] mqtt up%s → LINK_STATE%s\n", missedDrop ? " (reconnected)" : "",
                      gw.nodeUp() ? "" : ", offline status (node down)");
    } else if (gw.mqttUp() && !net::online()) {
        gw.setMqtt(false, now);
        Serial.println("[link] mqtt down → LINK_STATE");
    }
}

static const char* cmdResultName(lnk::GwCmd r) {
    switch (r) {
        case lnk::GwCmd::Forwarded: return "forwarded";
        case lnk::GwCmd::MqttDown: return "mqtt down";
        case lnk::GwCmd::NodeDown: return "node down";
        case lnk::GwCmd::TooLong: return "too long";
    }
    return "?";
}

static void forwardCommands(uint32_t now) {
    static NetCommand cmd;
    while (net::popCommand(cmd)) {
        const lnk::GwCmd r = gw.onCommand((const uint8_t*)cmd.payload, cmd.len, now);
        Serial.printf("[cmd] %s: %.96s\n", cmdResultName(r), cmd.payload);
    }
}

// ---- Serial console -------------------------------------------------------------------

static void printStats() {
    const lnk::GatewayLink::Counters& c = gw.counters();
    const lnk::StreamDecoder::Stats& s = decoder.stats();
    Serial.printf("[link] node %s %s%s, mqtt %s | uplink=%lu published=%lu dropped=%lu commands=%lu invalid=%lu | "
                  "rx frames=%lu errors=%lu lost=%lu dup=%lu\n",
                  kNodeId, gw.nodeUp() ? "up" : "down", gw.registered() ? "" : " (no HELLO)",
                  gw.mqttUp() ? "up" : "down", (unsigned long)c.uplink, (unsigned long)c.published,
                  (unsigned long)c.dropped, (unsigned long)c.commands, (unsigned long)c.invalid,
                  (unsigned long)s.frames, (unsigned long)s.errors, (unsigned long)gw.node().lost(),
                  (unsigned long)gw.node().duplicates());
    if (gw.registered()) Serial.printf("[link] boot %s fw %s\n", gw.hello().bootId, gw.hello().fw);
    net::printStats();
}

static void runConsole(const char* line) {
    if (strcmp(line, "stats") == 0 || strcmp(line, "net") == 0) printStats();
    else if (strcmp(line, "help") == 0) Serial.println("[gw] commands: stats | help");
    else Serial.printf("[gw] unknown: %s (type help)\n", line);
}

static void pollConsole() {
    static char buf[32];
    static size_t n = 0;
    while (Serial.available()) {
        const char c = (char)Serial.read();
        if (c == '\r' || c == '\n') {
            if (n == 0) continue;
            buf[n] = '\0';
            n = 0;
            runConsole(buf);
        } else if (n < sizeof(buf) - 1) {
            buf[n++] = c;
        }
    }
}

// ---- Arduino ------------------------------------------------------------------------

static const char* resetReasonName(esp_reset_reason_t r) {
    switch (r) {
        case ESP_RST_POWERON: return "POWERON";
        case ESP_RST_EXT: return "EXT";
        case ESP_RST_SW: return "SW";
        case ESP_RST_PANIC: return "PANIC";
        case ESP_RST_INT_WDT: return "INT_WDT";
        case ESP_RST_TASK_WDT: return "TASK_WDT";
        case ESP_RST_WDT: return "WDT";
        case ESP_RST_BROWNOUT: return "BROWNOUT";
        default: return "UNKNOWN";
    }
}

void setup() {
    Serial.begin(115200);
    port.setRxBufferSize(LINK_UART_BUFFER);  // core 2.x: before begin()
    port.setTxBufferSize(LINK_UART_BUFFER);
    port.begin(LINK_BAUD, SERIAL_8N1, PIN_LINK_RX, PIN_LINK_TX);
    port.write((uint8_t)0);  // flush garbage on the node's decoder (§3.2)
    // After UART1, so the Wokwi build (src/console_tee.cpp) copies it onto the link too.
    Serial.printf("\n[boot] gateway fw=%s for node %s reset=%s\n", FW_VERSION, kNodeId,
                  resetReasonName(esp_reset_reason()));
    Serial.printf("[link] UART1 rx=%d tx=%d @%d\n", PIN_LINK_RX, PIN_LINK_TX, LINK_BAUD);

    gw.begin(kNodeId, writeFrame, publishUplink, wallClock, millis());  // HELLO_REQUEST
    net::begin("");  // net_task has no bootId of its own; the node's is in its payloads
}

void loop() {
    const uint32_t now = millis();
    pollLink(now);
    syncMqtt(now);
    forwardCommands(now);
    if (now - rssiAt >= 1000) {
        rssiAt = now;
        const int rssi = net::rssi();
        if (rssi != 0) gw.setRssi(rssi);
        else gw.clearRssi();
    }
    if (gw.tick(now) == lnk::PeerChange::Down) Serial.println("[link] node lost (no frame for 15 s) → offline status");
    pollConsole();
    delay(1);
}
