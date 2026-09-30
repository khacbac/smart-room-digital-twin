#pragma once

#include <stdint.h>

// Hardware access for every input (§4.2). The Wokwi-specific value mapping (§4.6)
// lives in sensors.cpp only, so a real sensor later changes only that file.

struct AnalogReading {
    uint16_t adcLdr;
    uint16_t adcAq;    // pot, or MQ-135 on BOARD_KIT; 0 when the kit uses the AQ buttons
    float light;       // lux, 0…100000
    int airQuality;    // AQ index, 0…1000
};

struct DhtReading {
    bool valid;        // false on read error or NaN; range filtering is in edge_rules (§7.2)
    float temperature; // °C, only meaningful when valid
    float humidity;    // %RH, only meaningful when valid
    const char* status;
};

enum class ButtonEvent { None, Short, Long };

namespace sensors {

void begin();

AnalogReading readAnalog();
DhtReading readDht();  // call at most every DHT_INTERVAL_MS
bool readPresence();

// Mode button, debounced; call every loop. Long fires once when held for
// BUTTON_LONG_PRESS_MS, Short fires on release before that. On BOARD_KIT this also
// polls the two air-quality buttons.
ButtonEvent pollButton(uint32_t nowMs);

}  // namespace sensors
