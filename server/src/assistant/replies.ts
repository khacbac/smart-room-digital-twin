import type { AssistantLocale } from "@srdt/contracts";

// Fixed sentences the server says itself, when it overrides the model's reply.

type Key = "offline" | "rateLimited" | "broker" | "confirmBuzzer" | "failed" | "alreadyDone";

const TEXT: Record<AssistantLocale, Record<Key, string>> = {
  "vi-VN": {
    offline: "Thiết bị đang offline nên mình chưa điều khiển được. Mình sẽ làm được khi nó kết nối lại.",
    rateLimited: "Bạn gửi hơi nhiều lệnh trong một phút rồi, đợi chút rồi thử lại nhé.",
    broker: "Máy chủ đang mất kết nối với thiết bị, mình chưa gửi lệnh được.",
    confirmBuzzer: "Bạn có chắc muốn bật còi báo động không? Còi sẽ kêu thật trong phòng.",
    failed: "Mình chưa gửi được lệnh, bạn thử lại nhé.",
    alreadyDone: "Phòng đang đúng như vậy rồi, mình không cần làm gì thêm.",
  },
  "en-US": {
    offline: "The device is offline, so I can't do that right now. I'll be able to once it reconnects.",
    rateLimited: "That's a lot of commands in a minute. Give it a moment and try again.",
    broker: "The server has lost its link to the device, so I couldn't send that.",
    confirmBuzzer: "Do you really want to sound the room alarm? It will ring in the room.",
    failed: "I couldn't send that command. Please try again.",
    alreadyDone: "The room is already like that, so there's nothing to change.",
  },
};

export function reply(locale: AssistantLocale, key: Key): string {
  return TEXT[locale][key];
}
