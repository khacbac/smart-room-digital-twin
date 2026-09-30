#pragma once

// LCD 16x2 row text (§7.7). Pure formatting, so the 16-char rules are unit-tested;
// src/display.* pads each row to 16 chars when it writes it.

#include <stddef.h>

#include "edge_rules.h"

namespace edge {

// "T31.2 H75 A680", "T--.- H-- A680" before the first valid DHT22 reading, "DHT ERR A680"
// during a DHT fault. Drops the temperature decimal if the row would exceed 16 chars.
// `out` needs at least 24 bytes.
void formatLcdRow0(const Engine& engine, char* out, size_t size);

// "WARNING  NET OV": state label padded to 8, NET/OFF, OV while any override is active.
void formatLcdRow1(const Engine& engine, bool netOnline, char* out, size_t size);

}  // namespace edge
