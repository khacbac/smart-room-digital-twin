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
static bool messageOn = false;

// Greedy word wrap of `text` into lines of at most `cols` chars (words longer than a
// line are cut). Returns the number of lines written, at most `maxLines`.
static int wrap(const char* text, int cols, char lines[][LCD_COLS * 2 + 1], int maxLines) {
    int n = 0;
    const char* p = text;
    while (*p && n < maxLines) {
        while (*p == ' ') p++;
        if (!*p) break;
        int len = (int)strlen(p);
        int take = len <= cols ? len : cols;
        if (len > cols) {
            int cut = take;
            while (cut > 0 && p[cut] != ' ') cut--;
            if (cut > 0) take = cut;
        }
        memcpy(lines[n], p, take);
        lines[n][take] = '\0';
        while (take > 0 && lines[n][take - 1] == ' ') lines[n][--take] = '\0';
        p += take;
        n++;
    }
    return n;
}

#if defined(BOARD_KIT)

// OLED 0.96" SSD1306: the same two 16-char rows as the LCD (§7.7), in the 6x8 font.
// Row 0 at the top, row 1 (state) at double size below it. The panel is redrawn from
// `shown` whenever a row changes.
static Adafruit_SSD1306 oled(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
static bool oledOk = false;

static void redraw() {
    if (!oledOk || messageOn) return;
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

// Title small and inverted on top, the text below at double size (10 chars x 3 lines),
// or at normal size (21 x 5) when it does not fit.
void showMessage(const char* title, const char* text) {
    messageOn = true;
    if (!oledOk) return;
    char lines[5][LCD_COLS * 2 + 1];
    int size = 2, cols = 10, maxLines = 3;
    int n = wrap(text, cols, lines, maxLines + 1);
    if (n > maxLines) {
        size = 1, cols = 21, maxLines = 5;
        n = wrap(text, cols, lines, maxLines);
    }
    oled.clearDisplay();
    oled.fillRect(0, 0, OLED_WIDTH, 11, SSD1306_WHITE);
    oled.setTextColor(SSD1306_BLACK);
    oled.setTextSize(1);
    oled.setCursor(2, 2);
    oled.print(title);
    oled.setTextColor(SSD1306_WHITE);
    oled.setTextSize(size);
    const int lineH = 8 * size + 2;
    for (int i = 0; i < n; i++) {
        oled.setCursor(0, 15 + i * lineH);
        oled.print(lines[i]);
    }
    oled.display();
}

void endMessage() {
    if (!messageOn) return;
    messageOn = false;
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
    if (messageOn) return;
    lcd.setCursor(0, row);
    lcd.print(padded);
}

// 16x2 has no room for the title: the text alone, word-wrapped on both rows.
void showMessage(const char* title, const char* text) {
    (void)title;
    messageOn = true;
    char lines[LCD_ROWS][LCD_COLS * 2 + 1] = {};
    wrap(text, LCD_COLS, lines, LCD_ROWS);
    for (int row = 0; row < LCD_ROWS; row++) {
        char padded[LCD_COLS + 1];
        snprintf(padded, sizeof(padded), "%-16.16s", lines[row]);
        lcd.setCursor(0, row);
        lcd.print(padded);
    }
}

void endMessage() {
    if (!messageOn) return;
    messageOn = false;
    for (int row = 0; row < LCD_ROWS; row++) {
        lcd.setCursor(0, row);
        lcd.print(shown[row]);
    }
}

}  // namespace display

#endif
