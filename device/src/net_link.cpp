// Node-board uplink (docs/link-protocol.md §4.3, §6.1): no Wi-Fi, every §5 payload
// goes to the gateway as a stream frame on UART1, and the gateway publishes it as-is.
// lnk::NodeLink decides what may be sent (mqttUp) and when a status is owed; this
// file is the Arduino glue: UART bytes ⇄ frames, TIME → system clock, COMMAND → queue.
//
// Everything runs from loop() (net::poll), so there are no tasks or locks here. The
// UART buffers hold a full frame each way, so poll() and publish() never wait.

#include "net.h"

#include <Arduino.h>
#include <sys/time.h>

#include "link_frame.h"
#include "link_node.h"

static HardwareSerial& port = Serial1;
static lnk::StreamDecoder decoder;
static lnk::NodeLink node;

static const char kDeviceId[] = DEVICE_ID;
static const char kFw[] = FW_VERSION;
static char bootId[lnk::kBootIdLen + 1];

// Commands from the gateway, popped by loop() right after poll().
static NetCommand cmdQueue[CMD_QUEUE_DEPTH];
static uint8_t cmdHead = 0;
static uint8_t cmdCount = 0;
static uint32_t cmdDropped = 0;

static bool clockSet = false;
static uint32_t reportedErrors = 0;

// For state-change log lines.
static bool lastGatewayUp = false;
static bool lastMqttUp = false;

static void writeFrame(lnk::Type type, uint8_t seq, const uint8_t* payload, size_t len) {
    static uint8_t wire[lnk::kWireMax];
    const size_t n = lnk::encodeStream(type, seq, payload, len, wire, sizeof(wire));
    if (n) port.write(wire, n);
}

static void queueCommand(const lnk::Frame& f) {
    if (cmdCount == CMD_QUEUE_DEPTH) {
        cmdDropped++;
        Serial.println("[link] command queue full, dropped");
        return;
    }
    NetCommand& c = cmdQueue[(cmdHead + cmdCount) % CMD_QUEUE_DEPTH];
    // Longer than the queue item → truncated, so it fails JSON parsing → COMMAND_REJECTED
    // (same as net_task).
    const size_t n = min<size_t>(f.len, sizeof(c.payload) - 1);
    memcpy(c.payload, f.payload, n);
    c.payload[n] = '\0';
    c.len = n;
    cmdCount++;
}

// TIME from the gateway (§4.3): the node's stand-in for NTP, meta() reads gettimeofday().
static void setClock(int64_t ts) {
    const struct timeval tv{(time_t)(ts / 1000), (suseconds_t)((ts % 1000) * 1000)};
    settimeofday(&tv, nullptr);
    if (!clockSet) Serial.printf("[link] clock set from gateway, ts=%lld\n", (long long)ts);
    clockSet = true;
}

static void logChanges() {
    if (node.gatewayUp() != lastGatewayUp) {
        lastGatewayUp = node.gatewayUp();
        Serial.printf("[link] gateway %s\n", lastGatewayUp ? "up" : "lost (no frame for 15 s)");
    }
    if (node.mqttUp() != lastMqttUp) {
        lastMqttUp = node.mqttUp();
        Serial.printf("[link] mqtt path %s\n", lastMqttUp ? "up" : "down");
    }
    const uint32_t errors = decoder.stats().errors;
    if (errors != reportedErrors) {
        reportedErrors = errors;
        Serial.printf("[link] dropped frame: %s (%lu so far)\n", lnk::decodeErrorName(decoder.lastError()),
                      (unsigned long)errors);
    }
}

namespace net {

void begin(const char* id) {
    strlcpy(bootId, id, sizeof(bootId));
    port.setRxBufferSize(LINK_UART_BUFFER);  // core 2.x: before begin()
    port.setTxBufferSize(LINK_UART_BUFFER);
    port.begin(LINK_BAUD, SERIAL_8N1, PIN_LINK_RX, PIN_LINK_TX);
    port.write((uint8_t)0);  // flush garbage on the gateway's decoder (§3.2)
    Serial.printf("[link] UART1 rx=%d tx=%d @%d, HELLO as %s\n", PIN_LINK_RX, PIN_LINK_TX, LINK_BAUD, kDeviceId);
    node.begin(kDeviceId, bootId, kFw, writeFrame, millis());
}

void poll(uint32_t nowMs) {
    int avail = port.available();
    while (avail-- > 0) {
        if (!decoder.push((uint8_t)port.read())) continue;
        const lnk::Frame& f = decoder.frame();  // valid until the next push()
        switch (node.onFrame(f, nowMs)) {
            case lnk::NodeRx::Command: queueCommand(f); break;
            case lnk::NodeRx::Time: setClock(node.timeMs()); break;
            case lnk::NodeRx::Invalid:
                Serial.printf("[link] ignored %s #%u\n", lnk::typeName(f.type), f.seq);
                break;
            case lnk::NodeRx::None: break;
        }
    }
    node.tick(nowMs);
    logChanges();
}

bool online() { return node.mqttUp(); }
bool timeSynced() { return clockSet; }
int rssi() { return node.linkState().hasRssi ? node.linkState().rssi : 0; }

bool takeConnected() { return node.takeStatusDue(); }

bool publish(Channel ch, const char* payload, size_t len) {
    lnk::Type type = lnk::Type::Telemetry;
    switch (ch) {
        case Channel::Telemetry: type = lnk::Type::Telemetry; break;
        case Channel::Status: type = lnk::Type::Status; break;
        case Channel::Event: type = lnk::Type::Event; break;
        case Channel::Ack: type = lnk::Type::Ack; break;
    }
    return node.send(type, (const uint8_t*)payload, len, millis());
}

bool popCommand(NetCommand& out) {
    if (cmdCount == 0) return false;
    out = cmdQueue[cmdHead];
    cmdHead = (cmdHead + 1) % CMD_QUEUE_DEPTH;
    cmdCount--;
    return true;
}

void printStats() {
    const lnk::StreamDecoder::Stats& s = decoder.stats();
    Serial.printf("[net] link gateway=%s mqtt=%s clock=%s rssi=%d | rx frames=%lu errors=%lu lost=%lu dup=%lu "
                  "ignored=%lu hellos=%lu cmdDropped=%lu\n",
                  node.gatewayUp() ? "up" : "down", node.mqttUp() ? "up" : "down", clockSet ? "set" : "no", rssi(),
                  (unsigned long)s.frames, (unsigned long)s.errors, (unsigned long)node.gateway().lost(),
                  (unsigned long)node.gateway().duplicates(), (unsigned long)node.invalid(),
                  (unsigned long)node.hellos(), (unsigned long)cmdDropped);
}

}  // namespace net
