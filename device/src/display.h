#pragma once

// LCD 16x2 I2C (§4.3, §7.7), or the OLED 0.96" SSD1306 on BOARD_KIT with the same two
// rows. Rows are padded to 16 chars so old characters are overwritten, and truncated
// if longer. A row is only rewritten when it changed.
//
// showMessage() takes over the screen (SHOW_MESSAGE / IDENTIFY): setRow() keeps the rows
// up to date but does not draw them until endMessage() puts them back.

namespace display {

void begin();
void setRow(int row, const char* text);

void showMessage(const char* title, const char* text);  // text word-wrapped, up to 32 chars
void endMessage();

}  // namespace display
