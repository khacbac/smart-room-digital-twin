import * as Haptics from "expo-haptics";

// One place maps app moments to vibration kinds (mobile/specs/03-design-system.md §7).
// Failures are ignored: haptics are a nicety, never a reason for an error.

const safe = (p: Promise<void>) => void p.catch(() => undefined);

export const haptics = {
  press: () => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  warning: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  tick: () => safe(Haptics.selectionAsync()),
  listenStart: () => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  listenStop: () => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
};
