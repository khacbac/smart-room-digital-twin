// Wokwi builds only (-D LINK_CONSOLE_TEE, envs node-wokwi / gateway-wokwi). Wokwi has one
// serial monitor and device/wokwi/* wire it to the link UART, so the console (UART0) is
// invisible. This copies every console write onto the link UART as its own 0x00-terminated
// chunk: link-sim prints it (docs/link-protocol.md §6.2), a real peer would drop it as a bad
// frame (§3.2), so never flash these builds on the two boards.
//
// The hook is the IDF call under HardwareSerial::write (linker --wrap=uart_write_bytes).
// Panic dumps bypass it (ROM printf): the next boot logs the reset reason instead.

#ifdef LINK_CONSOLE_TEE

#include <driver/uart.h>
#include <string.h>

extern "C" int __real_uart_write_bytes(uart_port_t port, const void* src, size_t size);

extern "C" int __wrap_uart_write_bytes(uart_port_t port, const void* src, size_t size) {
    const int n = __real_uart_write_bytes(port, src, size);
    if (port != UART_NUM_0 || !uart_is_driver_installed(UART_NUM_1)) return n;  // Serial1 = link
    const uint8_t* p = (const uint8_t*)src;
    uint8_t chunk[128];
    while (size > 0) {
        const size_t k = size < sizeof(chunk) - 1 ? size : sizeof(chunk) - 1;
        memcpy(chunk, p, k);
        chunk[k] = 0;  // text + delimiter in one write: never lands inside a frame
        __real_uart_write_bytes(UART_NUM_1, chunk, k + 1);
        p += k;
        size -= k;
    }
    return n;
}

#endif  // LINK_CONSOLE_TEE
