#pragma once

#include <stdint.h>

// Hardware access for every input (§4.2). The Wokwi-specific value mapping (§4.6)
// lives in sensors.cpp only, so a real sensor later changes only that file.

struct AnalogReading {
    uint16_t adcLdr;
    uint16_t adcPot;
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

// Debounced; call every loop. Long fires once when held for BUTTON_LONG_PRESS_MS,
// Short fires on release before that.
ButtonEvent pollButton(uint32_t nowMs);

}  // namespace sensors
