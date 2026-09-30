#include "display.h"

#include <stdio.h>
#include <Wire.h>
#include <string.h>

#include "config.h"

#if defined(BOARD_KIT)
#include <Adafruit_SSD1306.h>
#else
#include <LiquidCrystal_I2C.h>
#endif

static char shown[LCD_ROWS][LCD_COLS + 1];

#if defined(BOARD_KIT)

// OLED 0.96" SSD1306: the same two 16-char rows as the LCD (§7.7), in the 6x8 font.
// Row 0 at the top, row 1 (state) at double size below it. The panel is redrawn from
// `shown` whenever a row changes.
static Adafruit_SSD1306 oled(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
static bool oledOk = false;

static void redraw() {
    if (!oledOk) return;
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    oled.setTextSize(1);
    oled.setCursor(0, 4);
    oled.print(shown[0]);
    // Row 1 is "WARNING  NET OV": state label large, the NET/OV slot small under it.
    char label[9];
    snprintf(label, sizeof(label), "%.8s", shown[1]);
    oled.setTextSize(2);
    oled.setCursor(0, 24);
    oled.print(label);
    oled.setTextSize(1);
    oled.setCursor(0, 50);
    oled.print(shown[1] + strlen(label));
    oled.display();
}

namespace display {

void begin() {
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
    oledOk = oled.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR);
    if (!oledOk) Serial.printf("[oled] no SSD1306 at 0x%02X\n", OLED_I2C_ADDR);
    memset(shown, 0, sizeof(shown));
    redraw();
}

void setRow(int row, const char* text) {
    if (row < 0 || row >= LCD_ROWS) return;
    char padded[LCD_COLS + 1];
    snprintf(padded, sizeof(padded), "%-16.16s", text);
    if (strcmp(padded, shown[row]) == 0) return;
    memcpy(shown[row], padded, sizeof(padded));
    redraw();
}

}  // namespace display

#else

static LiquidCrystal_I2C lcd(LCD_I2C_ADDR, LCD_COLS, LCD_ROWS);

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

#endif
