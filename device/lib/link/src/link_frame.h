#pragma once

// Gateway ⇄ node link (docs/link-protocol.md §3): frame layout, CRC, COBS, stream decoder.
//
// Plain C++ (no Arduino, no JSON, no heap), shared by the node and the gateway
// firmware and built by `pio test -e native`. The namespace is `lnk` because `link`
// clashes with POSIX link() from <unistd.h>.

#include <stddef.h>
#include <stdint.h>

#ifndef LINK_PAYLOAD_MAX
#define LINK_PAYLOAD_MAX 1024  // = MQTT_PAYLOAD_MAX: the gateway publishes a payload as-is
#endif

namespace lnk {

const uint8_t kVersion = 1;

// Bit 7 is the direction: 0 node → gateway, 1 gateway → node (doc §4).
enum class Type : uint8_t {
    Telemetry = 0x01,
    Status = 0x02,
    Event = 0x03,
    Ack = 0x04,
    Hello = 0x05,
    Heartbeat = 0x06,
    Command = 0x81,
    Time = 0x82,
    LinkState = 0x83,
    HelloRequest = 0x84,
};

bool isKnownType(uint8_t t);
inline bool fromNode(Type t) { return ((uint8_t)t & 0x80) == 0; }
const char* typeName(Type t);  // "TELEMETRY" …, "?" when unknown

// Hands one frame to the transport. The payload is only valid during the call.
using FrameSink = void (*)(Type type, uint8_t seq, const uint8_t* payload, size_t len);

const size_t kHeaderSize = 3;  // version, type, seq
const size_t kCrcSize = 2;
const size_t kRawMax = kHeaderSize + LINK_PAYLOAD_MAX + kCrcSize;

// COBS adds at most one byte per 254 plus one; a stream frame adds the 0x00 delimiter.
constexpr size_t cobsMaxEncoded(size_t n) { return n + n / 254 + 1; }
const size_t kWireMax = cobsMaxEncoded(kRawMax) + 1;

struct Frame {
    uint8_t version;
    Type type;
    uint8_t seq;
    const uint8_t* payload;  // points into the buffer that was decoded
    size_t len;
};

enum class DecodeError : uint8_t { None, TooShort, TooLong, BadCobs, BadCrc, BadVersion, UnknownType };
const char* decodeErrorName(DecodeError e);

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection): "123456789" → 0x29B1.
uint16_t crc16(const uint8_t* data, size_t len, uint16_t crc = 0xFFFF);

// Both return the output length, or 0 when `out` is too small or the input is
// malformed. A valid raw frame is never empty, so 0 is unambiguous here.
size_t cobsEncode(const uint8_t* in, size_t len, uint8_t* out, size_t size);
size_t cobsDecode(const uint8_t* in, size_t len, uint8_t* out, size_t size);

// Raw frame: version | type | seq | payload | crc16 (little endian) over everything
// before it. The MQTT tunnel sends it as-is (doc §6.3).
// Returns the length, or 0 when the payload is longer than LINK_PAYLOAD_MAX or `out`
// is too small.
size_t encodeRaw(Type type, uint8_t seq, const uint8_t* payload, size_t len, uint8_t* out, size_t size);
DecodeError decodeRaw(const uint8_t* raw, size_t len, Frame& out);

// Stream frame (UART, USB serial): COBS(raw frame) followed by 0x00. Builds the raw
// frame on the stack (kRawMax bytes).
size_t encodeStream(Type type, uint8_t seq, const uint8_t* payload, size_t len, uint8_t* out, size_t size);

// Reassembles stream frames byte by byte. Noise and partial frames are dropped at the
// next 0x00, so the reader resyncs by itself after a glitch or a peer reboot.
class StreamDecoder {
public:
    struct Stats {
        uint32_t frames;     // valid frames
        uint32_t errors;     // dropped frames (lastError() says why)
        uint32_t overflows;  // more than kWireMax bytes without a delimiter
    };

    // true when frame() holds a new valid frame. Its payload stays valid until the
    // next push().
    bool push(uint8_t b);
    const Frame& frame() const { return frame_; }
    DecodeError lastError() const { return error_; }
    const Stats& stats() const { return stats_; }

private:
    uint8_t wire_[kWireMax - 1];  // without the delimiter
    size_t wireLen_ = 0;
    bool overflow_ = false;
    uint8_t raw_[kRawMax];
    Frame frame_{};
    DecodeError error_ = DecodeError::None;
    Stats stats_{};
};

}  // namespace lnk
