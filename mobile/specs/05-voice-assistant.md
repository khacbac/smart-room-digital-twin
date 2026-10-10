# 05. Voice assistant (M5)

Người dùng nói "mở cửa sổ một nửa" hoặc "phòng giờ thế nào?". App chuyển thành chữ, backend dùng LLM hiểu ý, gửi
lệnh thật tới thiết bị (hoặc trả lời câu hỏi), app đọc câu trả lời và hiện trạng thái lệnh live.

## 1. Luồng

```mermaid
sequenceDiagram
    autonumber
    participant U as Người dùng
    participant A as App (voice sheet)
    participant S as server /assistant
    participant L as LLM (Gemini)
    participant C as CommandService
    participant D as Thiết bị

    U->>A: chạm mic, nói
    A->>A: expo-speech-recognition (vi-VN / en-US), hiện chữ tạm thời
    A->>S: POST /api/devices/room-01/assistant {text, locale, history}
    S->>S: lấy twin hiện tại (device + telemetry mới nhất)
    S->>L: prompt hệ thống + trạng thái phòng + câu nói → JSON có schema
    L-->>S: {intent, commands[], reply, confirm}
    S->>S: kiểm tra từng lệnh bằng CommandRequest (contracts), kẹp value 1–90
    S->>C: create(device, {action, value, source: "ai"})
    C->>D: MQTT command (QoS 1)
    S-->>A: {intent, reply, commands[{commandId, status}], pendingConfirmation[]}
    A->>U: expo-speech đọc reply; thẻ kết quả theo dõi commandId
    D-->>C: ack
    C-->>A: SSE "command" (executed) → thẻ chuyển ✓, rung success
```

Vì sao LLM đặt ở server (D12):

- API key không nằm trong APK.
- Lệnh của AI đi qua đúng các bước như lệnh tay: validate bằng contracts, rate limit 10 lệnh/phút, theo dõi ack và
  timeout, ghi lịch sử. Dashboard thấy ngay lệnh có `source: "ai"`.
- Server có sẵn trạng thái twin mới nhất để đưa vào prompt, app không phải gửi lên.

Vì sao **một** lần gọi LLM với output JSON có schema, không dùng vòng lặp tool-calling: chỉ có một "tool" (gửi
lệnh) và trạng thái phòng đã nằm sẵn trong prompt, nên một lượt là đủ. Nhanh hơn (một round trip) và dễ test hơn.
Server tự soạn câu trả lời khi lệnh thất bại (§3.4), không cần gọi LLM lần hai.

## 2. Contract (`packages/contracts/src/assistant.ts`)

```ts
export const AssistantLocale = z.enum(["vi-VN", "en-US"]);

export const AssistantTurn = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(500),
});

// Body of `POST /api/devices/:code/assistant`
export const AssistantRequest = z.object({
  text: z.string().trim().min(1).max(500),
  locale: AssistantLocale,
  /** Last turns of this voice session, oldest first, so follow-ups ("a bit more") work. */
  history: z.array(AssistantTurn).max(6).default([]),
});

export type AssistantIntent = "command" | "query" | "clarify" | "unsupported";

export interface AssistantCommandResult {
  action: CommandAction;
  value: number | null;
  /** null when the command was not created (rate limited, invalid). */
  commandId: string | null;
  /** Status at response time; the app follows the rest over SSE. */
  status: CommandStatus | null;
  /** API error code when it could not be sent: DEVICE_OFFLINE, RATE_LIMITED, BROKER_DISCONNECTED. */
  error: string | null;
}

export interface AssistantResponse {
  intent: AssistantIntent;
  /** Text to show and speak, in the request locale. */
  reply: string;
  commands: AssistantCommandResult[];
  /** Commands the model proposed but that need the user's OK first (BUZZER_ON). */
  pendingConfirmation: { action: CommandAction; value: number | null }[];
}
```

### Endpoint

`POST /api/devices/:code/assistant`

| Status | Khi |
|---|---|
| `200` | `AssistantResponse` (kể cả khi lệnh không gửi được: lỗi nằm trong `commands[].error` và `reply`) |
| `400 INVALID_REQUEST` | Body sai schema |
| `404 DEVICE_NOT_FOUND` | Như các route khác |
| `429 RATE_LIMITED` | Quá **20 lượt hỏi/phút/thiết bị** (bộ đếm riêng với lệnh, dùng lại `RateLimiter`) |
| `502 ASSISTANT_UPSTREAM` | LLM lỗi hoặc trả JSON sai schema sau 1 lần thử lại |
| `503 ASSISTANT_DISABLED` | Server chưa cấu hình provider (thiếu key) |
| `504 ASSISTANT_TIMEOUT` | LLM không trả lời trong **10 s** |

## 3. Server (`server/src/assistant/`)

```
server/src/assistant/
├─ assistant.service.ts   build context → model.plan() → validate → CommandService.create → AssistantResponse
├─ model.ts               interface AssistantModel + AssistantPlan (zod)
├─ gemini.model.ts        @google/genai, structured output (responseSchema), timeout qua AbortSignal
├─ rules.model.ts         model không cần mạng, theo từ khoá (test + demo offline)
├─ prompt.ts              system prompt + format trạng thái phòng
└─ replies.ts             câu trả lời mẫu (vi/en) cho lỗi: offline, rate limit, broker, không hiểu
```

### 3.1 Interface

```ts
export const AssistantPlan = z.object({
  intent: z.enum(["command", "query", "clarify", "unsupported"]),
  commands: z.array(z.object({ action: CommandAction, value: z.number().nullable() })).max(2),
  reply: z.string().min(1).max(400),
});

export interface AssistantModel {
  readonly name: string;
  plan(input: { text: string; locale: AssistantLocale; history: AssistantTurn[]; room: RoomContext },
       signal: AbortSignal): Promise<AssistantPlan>;
}
```

`RoomContext` là bản tóm tắt gọn (không gửi cả mảng telemetry): online, edgeState, mlState/aiControl, nhiệt độ, độ
ẩm, ánh sáng, AQ, có người, windowAngle, buzzer, override (+ số giây còn lại), sensorFault, các ngưỡng (từ
twin-core) để LLM giải thích được "vì sao Warning".

### 3.2 Cấu hình (`server/.env`)

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `ASSISTANT_PROVIDER` | `gemini` | `gemini` / `rules` / `off` |
| `GEMINI_API_KEY` | (trống) | Thiếu key mà provider `gemini` → endpoint trả `503` |
| `ASSISTANT_MODEL` | bản Gemini **Flash** mới nhất lúc làm M5 | Cần nhanh (< 2 s), không cần bản Pro như lúc gán nhãn dữ liệu ML |
| `ASSISTANT_TIMEOUT_SEC` | `10` | |

### 3.3 Prompt (nội dung chính, viết ở `prompt.ts`)

- Vai trò: trợ lý của một phòng thông minh, chỉ điều khiển được **cửa sổ** (góc 1–90°, đóng) và **còi báo động**
  (bật/tắt), và **trả lại chế độ tự động**. Không có đèn, điều hoà, quạt; được hỏi thì nói rõ là không có
  (`unsupported`).
- Action hợp lệ và ý nghĩa: `OPEN_WINDOW` (value 1–90), `CLOSE_WINDOW`, `BUZZER_ON`, `BUZZER_OFF`, `CLEAR_OVERRIDE`.
  Không dùng `PING`.
- Quy đổi lời nói ra góc: "hé / một chút / a bit" = 25; "một nửa / half" = 45; "mở / mở hết / fully" = 90; "thêm
  chút nữa / a bit more" = góc hiện tại + 20 (tối đa 90); "khép bớt" = góc hiện tại − 20 (≤ 0 thì `CLOSE_WINDOW`).
- Lệnh tay giữ 2 phút rồi thiết bị tự quay về tự động; nói cho người dùng biết khi họ ra lệnh.
- Câu hỏi về phòng → `query`, trả lời bằng số liệu trong `RoomContext`, ngắn (≤ 2 câu), có đơn vị.
- Mơ hồ ("làm gì đó đi") → `clarify` + một câu hỏi lại.
- Trả lời đúng ngôn ngữ `locale`, giọng thân thiện, ngắn vì sẽ được đọc to. Không dùng markdown, emoji.
- `reply` viết như thể lệnh **đang được thực hiện** ("Mình đang mở cửa sổ 45 độ."), vì ack về sau.
- Thiết bị offline → không đề xuất lệnh, `reply` báo thiết bị đang offline.

### 3.4 Xử lý sau khi có plan

1. Parse `AssistantPlan` bằng zod. Sai schema → thử lại 1 lần → vẫn sai thì `502`.
2. Mỗi lệnh:
   - Bỏ lệnh không có trong 5 action hợp lệ.
   - `OPEN_WINDOW`: làm tròn, kẹp `value` vào 1–90; thiếu value thì 90.
   - Bỏ lệnh trùng hoặc vô nghĩa (đóng cửa khi cửa đang 0°, tắt còi khi còi đang tắt). Lệnh bị bỏ không xuất hiện
     trong kết quả; `reply` của model vẫn đúng ("cửa sổ đã đóng sẵn rồi").
   - `BUZZER_ON` **không gửi**, đưa vào `pendingConfirmation`; reply = "Bạn có chắc muốn bật còi báo động không?".
   - Còn lại → `CommandService.create(device, { action, value, source: "ai" })`, map `CreateResult` sang
     `AssistantCommandResult` (`device_offline` → `error: "DEVICE_OFFLINE"`…).
3. Có lệnh lỗi → thay `reply` bằng câu mẫu trong `replies.ts` theo `locale` (ví dụ "Thiết bị đang offline nên mình
   chưa mở được cửa sổ.").
4. Log (pino): `text`, `intent`, các action, thời gian LLM. Không log key.

Lệnh `BUZZER_ON` sau khi người dùng xác nhận: app gọi thẳng `POST /commands` với `source: "ai"` (contracts đã cho
phép), không đi qua LLM lần nữa.

### 3.5 Test (`server/test/assistant.test.ts`, vitest, dùng `rules.model.ts` hoặc model giả)

- Offline → không tạo command, `error = DEVICE_OFFLINE`, reply tiếng Việt đúng mẫu.
- `value` 120 → gửi 90; `value` null → 90.
- `BUZZER_ON` → nằm trong `pendingConfirmation`, không có command nào được tạo.
- Model trả JSON sai hai lần → `502`.
- Model treo → `504` sau timeout (dùng fake timers).
- Rate limit lượt hỏi → `429`.
- Lệnh tạo ra có `source: "ai"` và được publish lên hub (dashboard thấy).

Eval với LLM thật: `server/scripts/assistant-eval.ts` chạy bảng §6 (lưu ở `server/scripts/assistant-eval.jsonl`)
qua model thật, in tỉ lệ đúng action + value. Mục tiêu **≥ 90%** đúng action, value lệch ≤ 5°.

## 4. App: nhận diện và đọc giọng nói

| Mảng | Cách làm |
|---|---|
| STT | `expo-speech-recognition`: `start({ lang, interimResults: true, continuous: false, addsPunctuation: true, volumeChangeEventOptions: { enabled: true, intervalMillis: 100 } })`. Nghe các event `result` (chữ tạm thời + chữ cuối), `volumechange` (sóng âm), `end`, `error` |
| Quyền | `RECORD_AUDIO`, xin lần đầu chạm mic. Bị từ chối vĩnh viễn → sheet hướng dẫn + nút mở cài đặt hệ thống |
| Ngôn ngữ | `voiceLocaleAtom` (mặc định `vi-VN`). Android dùng dịch vụ nhận diện của Google: tiếng Việt cần mạng; kiểm `getSupportedLocales()` lúc mở sheet, không hỗ trợ thì gợi ý chuyển English |
| Tự dừng | Hết giọng nói ~1.5 s thì Android tự kết thúc; thêm giới hạn cứng 15 s |
| TTS | `expo-speech` `speak(reply, { language: locale, rate: 1.0 })` nếu `voiceSpeakRepliesAtom`. Dừng đọc khi người dùng chạm mic lại hoặc đóng sheet |
| Gõ thay nói | Ô nhập chữ trong sheet (icon bàn phím): tiện trên emulator và khi ở chỗ đông người |
| Mutation | `askAssistantAtom` (`features/voice/_atoms/mutations.ts`) theo cùng khuôn với `sendCommandAtom`: không throw, map lỗi API ra text |
| Phiên | `voiceSessionAtom`: tối đa 3 lượt gần nhất (6 `AssistantTurn`), xoá khi đóng sheet |

Emulator: phải bật micro host (Extended controls → Microphone → "Virtual microphone uses host audio input"), hoặc
dùng ô gõ chữ.

## 5. UI: voice sheet (`app/voice.tsx`, `features/voice/components/`)

Mở bằng nút mic nổi ở tab bar, rồi **tự bắt đầu nghe**. Bottom sheet cao ~70% màn, nền `surface`, có thể kéo xuống
để đóng.

| Trạng thái | Hiển thị |
|---|---|
| **Idle** | Nút mic to (72 dp, accent) ở giữa, "Tap to talk" · 3 chip gợi ý chạm để gửi luôn: "Open the window halfway" / "Phòng đang thế nào?" / "Tắt còi đi" (đổi theo locale) · icon bàn phím |
| **Listening** | Nút mic đổi thành vòng sóng âm theo âm lượng (5 cột cao thấp, Reanimated) · chữ tạm thời to (`title`), chữ chưa chốt màu `muted` · "Listening…" · chạm để dừng · rung Medium khi bắt đầu |
| **Thinking** | Câu đã chốt ở trên (dạng bong bóng người dùng) · 3 chấm nhảy "Thinking…" |
| **Result** | Bong bóng trả lời (icon `Sparkles`) · dưới là **thẻ lệnh**, mỗi lệnh một thẻ: tên lệnh + value, `Pill` status đọc live từ `commandsAtom` theo `commandId` (pending → sent → executed ✓ / timeout ✗), rung theo kết quả · nếu có `pendingConfirmation`: thẻ cảnh báo màu danger với nút "Turn on alarm" / "Cancel" · nút mic nhỏ "Ask again" |
| **Speaking** | Như Result + icon loa nhấp nháy cạnh bong bóng trả lời; chạm để dừng đọc |
| **Error** | Thông báo + hành động: không nghe thấy gì → "I didn't catch that. Try again?"; mất mạng / backend → text lỗi + "Retry"; `ASSISTANT_DISABLED` → "Voice control isn't set up on the server (GEMINI_API_KEY)."; thiết bị offline → reply của server |

Lịch sử các lượt trong phiên hiện như chat (cuộn), lượt mới nhất ở dưới.

## 6. Bảng câu mẫu (dùng cho prompt, test, eval)

| Câu nói | intent | Lệnh mong đợi |
|---|---|---|
| "Mở cửa sổ" | command | `OPEN_WINDOW 90` |
| "Mở hé cửa sổ ra" | command | `OPEN_WINDOW 25` |
| "Mở cửa sổ một nửa" / "Open the window halfway" | command | `OPEN_WINDOW 45` |
| "Mở cửa sổ 60 độ" | command | `OPEN_WINDOW 60` |
| (cửa đang 45°) "Mở thêm chút nữa" | command | `OPEN_WINDOW 65` |
| "Đóng cửa sổ lại" / "Close the window" | command | `CLOSE_WINDOW` |
| "Tắt còi đi" / "Silence the alarm" | command | `BUZZER_OFF` |
| "Bật còi báo động" | command | — (`pendingConfirmation: BUZZER_ON`) |
| "Cho nó tự động lại" / "Back to automatic" | command | `CLEAR_OVERRIDE` |
| "Đóng cửa và tắt còi" | command | `CLOSE_WINDOW`, `BUZZER_OFF` |
| "Phòng đang thế nào?" | query | — (đọc nhiệt độ, độ ẩm, trạng thái) |
| "Sao lại báo Warning?" | query | — (giải thích theo ngưỡng vượt) |
| "Trong phòng có ai không?" | query | — |
| "Nóng quá" (31 °C, cửa đóng) | command | `OPEN_WINDOW 90` + reply giải thích |
| "Bật điều hoà" | unsupported | — |
| "Làm gì đó đi" | clarify | — |

## 7. Bảo mật và riêng tư

- Câu nói được gửi tới Google (Gemini) qua server. Ghi rõ trong Settings → Voice: "Your voice is transcribed on the
  phone; the text is sent to the server and to Google Gemini."
- App không tự gửi âm thanh đi đâu: việc nhận diện do dịch vụ của Android (Google) đảm nhận. Với tiếng Việt, dịch vụ
  này thường nhận diện online, nghĩa là âm thanh được gửi lên Google. Ghi điều này vào cùng dòng thông báo ở trên.
- Không auth (giống toàn hệ thống hiện tại): ai trong LAN cũng gọi được `/assistant`. Rate limit 20 lượt/phút để
  không đốt quota.
