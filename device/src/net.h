#pragma once

// Uplink seen from loop(): how §5 payloads leave the board and commands come in.
// Two implementations, picked by the PlatformIO env (build_src_filter):
//
//   net_task.cpp  env:esp32-s3  single board: Wi-Fi + MQTT + NTP in a task on core 0 (D11)
//                 env:gateway   the same, driven by src/gateway/main.cpp instead of main.cpp
//   net_link.cpp  env:node      node board: frames to the gateway over UART
//                               (docs/link-protocol.md), serviced from loop()
//
// loop() only builds payloads (lib/protocol) and never touches topics, sockets or
// frames. "online" means a payload can reach the broker now; nothing is built or
// queued while offline (D8).

#include <stddef.h>
#include <stdint.h>

#include "config.h"

enum class Channel : uint8_t { Telemetry, Status, Event, Ack };

struct NetCommand {
    char payload[MQTT_PAYLOAD_MAX];  // NUL-terminated
    uint16_t len;
};

namespace net {

// Call from setup(), after the engine: commands may arrive right away.
void begin(const char* bootId);
// Call at the top of every loop() (no-op for net_task).
void poll(uint32_t nowMs);

bool online();      // payloads reach the broker (LCD NET/OFF, and whether loop() publishes at all)
bool timeSynced();  // wall clock set (NTP, or TIME from the gateway)
int rssi();         // Wi-Fi RSSI (the gateway's on the node), 0 while unknown

// Connect handshake: true once every time the path to the broker comes (back) up.
// loop() then publishes the status (and the BOOT event on the first one).
bool takeConnected();

// Hand one payload to the uplink (never blocks). Status is published retained.
// Returns false if it does not fit or cannot be sent.
bool publish(Channel ch, const char* payload, size_t len);

// Next received command payload, if any.
bool popCommand(NetCommand& out);

// One line for the serial `net` command.
void printStats();

}  // namespace net
