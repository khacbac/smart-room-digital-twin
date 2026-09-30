#pragma once

// Gateway status LED (docs/link-protocol.md §5.5), on the onboard WS2812 (PIN_STATUS_RGB):
//
//   red     no Wi-Fi
//   yellow  Wi-Fi, no MQTT (or backing off)
//   green   MQTT up
//   blinking at 1 Hz (same colour): node lost, or no HELLO yet
//
// Only reads state that net_task and GatewayLink already keep; call every loop().

#include <stdint.h>

namespace status_led {

void begin();
void update(bool wifiUp, bool mqttUp, bool nodeUp, uint32_t nowMs);

}  // namespace status_led
