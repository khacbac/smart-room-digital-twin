#include "lcd_format.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

namespace edge {

void formatLcdRow0(const Engine& engine, char* out, size_t size) {
    const long aq = lroundf(engine.airQuality());
    const float t = engine.temperature();
    const float h = engine.humidity();
    if (engine.dhtFault()) {
        snprintf(out, size, "DHT ERR A%ld", aq);
    } else if (isnan(t) || isnan(h)) {
        snprintf(out, size, "T--.- H-- A%ld", aq);
    } else {
        snprintf(out, size, "T%.1f H%.0f A%ld", t, h, aq);
        if (strlen(out) > 16) snprintf(out, size, "T%.0f H%.0f A%ld", t, h, aq);
    }
}

void formatLcdRow1(const Engine& engine, bool netOnline, char* out, size_t size) {
    const bool overridden = engine.windowOverridden() || engine.buzzerOverridden();
    snprintf(out, size, "%-8s %s%s", stateLabel(engine.state()), netOnline ? "NET" : "OFF",
             overridden ? " OV" : "");
}

}  // namespace edge
