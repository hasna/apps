const recordingIntervals = new Map<string, ReturnType<typeof setInterval>>();

export function trackTuiRecording(sessionId: string, intervalId: ReturnType<typeof setInterval>): void {
  stopTuiRecording(sessionId);
  recordingIntervals.set(sessionId, intervalId);
}

export function stopTuiRecording(sessionId: string): void {
  const intervalId = recordingIntervals.get(sessionId);
  if (!intervalId) return;
  clearInterval(intervalId);
  recordingIntervals.delete(sessionId);
}
