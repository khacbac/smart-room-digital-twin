#pragma once

// Network task (spec §6.4, D11): Wi-Fi, NTP and MQTT run in a FreeRTOS task pinned
// to core 0, so a blocking connect never stalls the sensor/rule loop on core 1.
// Only this task touches the PubSubClient. loop() talks to it through queues:
//
//   loop() ── net::publish() ──▶ outQueue (16, drop oldest) ──▶ MQTT publish
//   MQTT command topic ──▶ cmdQueue (4) ── net::popCommand() ──▶ loop()
//
// The net task never builds payloads (only the static LWT) and empties outQueue when
// the connection drops, so nothing stale is sent on reconnect (D8).

#include <stddef.h>
#include <stdint.h>

#include "config.h"

struct NetMessage {
    char topic[MQTT_TOPIC_MAX];
    char payload[MQTT_PAYLOAD_MAX];
    uint16_t len;
    bool retain;
};

namespace net {

// Creates the queues and starts the task. Call from setup(); the calling task
// (loopTask) receives the connect notification.
void begin();

bool online();      // MQTT connected (LCD NET/OFF, and whether loop() publishes at all)
bool timeSynced();  // NTP synced at least once
int rssi();         // last Wi-Fi RSSI, 0 while Wi-Fi is down

// Connect handshake: true once after every successful MQTT connect + subscribe.
// loop() then publishes the status (and the BOOT event on the first connect).
bool takeConnected();

// Queue one message (loop side, never blocks). Drops the oldest queued message when
// the queue is full. Returns false if the topic or payload does not fit.
bool publish(const char* topic, const char* payload, size_t len, bool retain);

// Next received command payload (NUL-terminated), if any.
bool popCommand(NetMessage& out);

// Messages dropped because outQueue was full (serial `net` command).
uint32_t droppedCount();

}  // namespace net
