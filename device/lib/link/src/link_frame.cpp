#include "link_frame.h"

#include <string.h>

namespace lnk {

bool isKnownType(uint8_t t) {
    switch ((Type)t) {
        case Type::Telemetry:
        case Type::Status:
        case Type::Event:
        case Type::Ack:
        case Type::Hello:
        case Type::Heartbeat:
        case Type::Command:
        case Type::Time:
        case Type::LinkState:
        case Type::HelloRequest:
            return true;
    }
    return false;
}

const char* typeName(Type t) {
    switch (t) {
        case Type::Telemetry: return "TELEMETRY";
        case Type::Status: return "STATUS";
        case Type::Event: return "EVENT";
        case Type::Ack: return "ACK";
        case Type::Hello: return "HELLO";
        case Type::Heartbeat: return "HEARTBEAT";
        case Type::Command: return "COMMAND";
        case Type::Time: return "TIME";
        case Type::LinkState: return "LINK_STATE";
        case Type::HelloRequest: return "HELLO_REQUEST";
    }
    return "?";
}

const char* decodeErrorName(DecodeError e) {
    switch (e) {
        case DecodeError::None: return "NONE";
        case DecodeError::TooShort: return "TOO_SHORT";
        case DecodeError::TooLong: return "TOO_LONG";
        case DecodeError::BadCobs: return "BAD_COBS";
        case DecodeError::BadCrc: return "BAD_CRC";
        case DecodeError::BadVersion: return "BAD_VERSION";
        case DecodeError::UnknownType: return "UNKNOWN_TYPE";
    }
    return "?";
}

uint16_t crc16(const uint8_t* data, size_t len, uint16_t crc) {
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (int b = 0; b < 8; b++) crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    }
    return crc;
}

// ---- COBS ------------------------------------------------------------------------

size_t cobsEncode(const uint8_t* in, size_t len, uint8_t* out, size_t size) {
    if (size < cobsMaxEncoded(len)) return 0;
    size_t codeAt = 0;  // where the current block's code byte goes
    size_t o = 1;
    uint8_t code = 1;
    for (size_t i = 0; i < len; i++) {
        if (in[i] == 0) {
            out[codeAt] = code;
            codeAt = o++;
            code = 1;
            continue;
        }
        out[o++] = in[i];
        if (++code == 0xFF) {  // full block of 254 data bytes, no implicit zero
            out[codeAt] = code;
            codeAt = o++;
            code = 1;
        }
    }
    out[codeAt] = code;
    return o;
}

size_t cobsDecode(const uint8_t* in, size_t len, uint8_t* out, size_t size) {
    size_t i = 0, o = 0;
    while (i < len) {
        const uint8_t code = in[i++];
        if (code == 0) return 0;
        for (uint8_t k = 1; k < code; k++) {
            if (i >= len || o >= size || in[i] == 0) return 0;
            out[o++] = in[i++];
        }
        // Every block except a full one and the last ends with an implicit zero.
        if (code != 0xFF && i < len) {
            if (o >= size) return 0;
            out[o++] = 0;
        }
    }
    return o;
}

// ---- Raw / stream frames ------------------------------------------------------------

size_t encodeRaw(Type type, uint8_t seq, const uint8_t* payload, size_t len, uint8_t* out, size_t size) {
    if (len > LINK_PAYLOAD_MAX) return 0;
    const size_t total = kHeaderSize + len + kCrcSize;
    if (size < total) return 0;
    out[0] = kVersion;
    out[1] = (uint8_t)type;
    out[2] = seq;
    if (len > 0) memcpy(out + kHeaderSize, payload, len);
    const uint16_t crc = crc16(out, kHeaderSize + len);
    out[kHeaderSize + len] = (uint8_t)(crc & 0xFF);
    out[kHeaderSize + len + 1] = (uint8_t)(crc >> 8);
    return total;
}

DecodeError decodeRaw(const uint8_t* raw, size_t len, Frame& out) {
    if (len < kHeaderSize + kCrcSize) return DecodeError::TooShort;
    if (len > kRawMax) return DecodeError::TooLong;
    const size_t body = len - kCrcSize;
    const uint16_t crc = (uint16_t)(raw[body] | (raw[body + 1] << 8));
    if (crc16(raw, body) != crc) return DecodeError::BadCrc;
    if (raw[0] != kVersion) return DecodeError::BadVersion;
    if (!isKnownType(raw[1])) return DecodeError::UnknownType;
    out.version = raw[0];
    out.type = (Type)raw[1];
    out.seq = raw[2];
    out.payload = raw + kHeaderSize;
    out.len = body - kHeaderSize;
    return DecodeError::None;
}

size_t encodeStream(Type type, uint8_t seq, const uint8_t* payload, size_t len, uint8_t* out, size_t size) {
    uint8_t raw[kRawMax];
    const size_t n = encodeRaw(type, seq, payload, len, raw, sizeof(raw));
    if (n == 0 || size < 1) return 0;
    const size_t m = cobsEncode(raw, n, out, size - 1);
    if (m == 0) return 0;
    out[m] = 0;
    return m + 1;
}

bool StreamDecoder::push(uint8_t b) {
    if (b != 0) {
        if (wireLen_ < sizeof(wire_)) {
            wire_[wireLen_++] = b;
        } else {
            overflow_ = true;
        }
        return false;
    }

    // Delimiter. Empty frames are idle bytes (a sender may send 0x00 to flush the line).
    const size_t n = wireLen_;
    const bool overflow = overflow_;
    wireLen_ = 0;
    overflow_ = false;
    if (overflow) {
        stats_.overflows++;
        stats_.errors++;
        error_ = DecodeError::TooLong;
        return false;
    }
    if (n == 0) return false;

    const size_t rawLen = cobsDecode(wire_, n, raw_, sizeof(raw_));
    error_ = rawLen == 0 ? DecodeError::BadCobs : decodeRaw(raw_, rawLen, frame_);
    if (error_ != DecodeError::None) {
        stats_.errors++;
        return false;
    }
    stats_.frames++;
    return true;
}

}  // namespace lnk
