# Mobile app (Android)

App Android cho Smart Room Digital Twin: xem phòng live (room twin SVG, số đo, trạng thái), biểu đồ 15 phút, điều
khiển cửa sổ/còi, nhật ký, và hỏi phòng bằng giọng nói (LLM ở server). Expo SDK 55 + expo-router + dev client +
NativeWind + Jotai, cùng stack với request-app. Đặc tả và các quyết định: [`specs/README.md`](specs/README.md).

## Chạy trên emulator

Cần: Android Studio (SDK 36, một AVD arm64), JDK 17–21 (`JAVA_HOME` trỏ vào JBR của Android Studio là được).

```sh
# terminal 1 + 2: broker và backend như README gốc (§3), cộng một thiết bị
pnpm dev:server
pnpm --filter @srdt/server fake-device          # hoặc Wokwi / mạch thật

# terminal 3: build dev client (lần đầu ~10 phút) rồi mở app trên emulator
pnpm mobile:android
```

Lần sau chỉ cần `pnpm mobile` (Metro) và mở app **Smart Room (Dev)** trên emulator; chỉ build lại khi thêm/đổi
package native hoặc `app.config.ts`.

Mặc định app gọi backend ở `http://10.0.2.2:4000` (`10.0.2.2` là máy host nhìn từ emulator). Đổi trong app:
**Settings → Connection** (lưu trên máy), hoặc đặt mặc định bằng `mobile/.env` (xem `.env.example`).

Cổng Metro 8081 bị chiếm (dự án khác đang chạy)? `pnpm mobile --port 8082`, rồi `adb reverse tcp:8082
tcp:8082` và mở `exp+smart-room://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8082`.

## Chạy trên điện thoại thật

| Cách nối | Backend URL trong Settings | Server |
|---|---|---|
| Cùng Wi-Fi | `http://<IP LAN của máy chạy server>:4000` | `HOST=0.0.0.0` trong `server/.env`, mở firewall cổng 4000 |
| Cáp USB | `http://127.0.0.1:4000` | `adb reverse tcp:4000 tcp:4000` |

Nút **Test connection** trong Settings gọi `/health` và gợi ý cách sửa khi không kết nối được.

## Voice

Nút mic giữa tab bar → nói (hoặc gõ) → LLM ở server đoán ý từ câu nói + số liệu phòng ("đi ngủ" → đóng cửa, "nóng
quá" → mở cửa) và gửi lệnh với `source: "ai"` → app đọc câu trả lời, theo dõi lệnh live rồi **nói lại kết quả** khi
thiết bị xác nhận. Việc phòng không làm được (bật đèn, quạt…) thì trợ lý đề nghị việc gần nhất và tự bật mic nghe
"có/không". Server cần một provider (`server/.env`):

| `ASSISTANT_PROVIDER` | Cần | Hiểu được |
|---|---|---|
| `gemini` (mặc định) | `GEMINI_API_KEY` | Câu tự do tiếng Việt/Anh, hỏi về phòng, giải thích trạng thái |
| `anthropic` | `ANTHROPIC_API_KEY` (model mặc định `claude-haiku-5-5`) | Như `gemini`; eval 24/24 |
| `rules` | không | Các câu mẫu trong `specs/05-voice-assistant.md` §6 (demo offline, test) |

Kiểm chất lượng: `pnpm --filter @srdt/server assistant-eval` (mục tiêu ≥ 90 % đúng lệnh).

Trên emulator, micro cần bật *Extended controls → Microphone → Virtual microphone uses host audio input*; không thì
dùng ô gõ chữ (icon bàn phím) hoặc các câu gợi ý.

## Build APK để cài thử

```sh
cd mobile
EAS_BUILD_PROFILE=preview npx expo prebuild --platform android --clean
cd android && ./gradlew app:assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk (ký bằng debug keystore, chỉ để cài thử)
```

Hoặc `pnpm --filter @srdt/mobile build:apk` (EAS build local, cần `eas-cli` và đăng nhập Expo).

## Cấu trúc

```
src/app/            route (expo-router): (tabs) Home/Trends/Controls/Activity, settings
src/features/       twin (stream + atoms + room), controls, trends, activity, settings, voice
src/components/     UI dùng chung (Text, Card, Button, SegmentedControl, TabBar, Toast…)
src/lib/            api, datasource (SSE), theme (tokens.js), storage (MMKV), haptics, toast
```

Logic dùng chung với dashboard (ngưỡng, nhãn, reducer twin, luật xung đột lệnh) nằm ở `packages/twin-core`.

## Ghi chú kỹ thuật

- `Pressable` với `style={({ pressed }) => …}` mất style dưới NativeWind: dùng `components/touchable.tsx`.
- `react-native-sse` không báo gì khi server đóng stream bình thường (server restart): `lib/datasource/rn-sse.ts`
  tự bắt và kết nối lại, kèm watchdog 60 s.
- Giọng đọc offline mặc định của Google TTS (`…-seanet-embedded`) hay không phát ra tiếng trên emulator nhưng vẫn báo
  "đọc xong", nên `features/voice/use-voice-out.ts` chọn sẵn giọng `…-network` của ngôn ngữ (mất mạng thì Google tự
  dùng giọng offline).
- `expo-speech-recognition` ghim bản `3.1.3` (dist-tag `sdk-55`); bản 57.x cần SDK 57.
- Lần mở đầu tiên sau khi cài APK debug có thể báo "isn't responding" vài giây (ART đang verify), mở lại là ổn.
