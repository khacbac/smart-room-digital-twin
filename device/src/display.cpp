#include "display.h"

#include <LiquidCrystal_I2C.h>
#include <stdio.h>
#include <Wire.h>
#include <string.h>

#include "config.h"

static LiquidCrystal_I2C lcd(LCD_I2C_ADDR, LCD_COLS, LCD_ROWS);
static char shown[LCD_ROWS][LCD_COLS + 1];

namespace display {

void begin() {
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
    lcd.init();  // its Wire.begin() is a no-op now that the bus is started
    lcd.backlight();
    lcd.clear();
    memset(shown, 0, sizeof(shown));
}

void setRow(int row, const char* text) {
    if (row < 0 || row >= LCD_ROWS) return;
    char padded[LCD_COLS + 1];
    snprintf(padded, sizeof(padded), "%-16.16s", text);
    if (strcmp(padded, shown[row]) == 0) return;
    memcpy(shown[row], padded, sizeof(padded));
    lcd.setCursor(0, row);
    lcd.print(padded);
}

}  // namespace display
