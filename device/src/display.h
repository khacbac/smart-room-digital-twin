#pragma once

// LCD 16x2 I2C (§4.3, §7.7). Rows are padded to 16 chars so old characters are
// overwritten, and truncated if longer. A row is only rewritten when it changed.

namespace display {

void begin();
void setRow(int row, const char* text);

}  // namespace display
