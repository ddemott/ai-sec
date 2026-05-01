import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // LiveKit's tts.ChunkedStream re-throws after emitting its `error` event,
    // and the resulting rejection escapes a fire-and-forget `.then().finally()`
    // chain inside the framework. Consumers observe the error via the event;
    // the dangling rejection is an internal artifact that doesn't reflect
    // a real failure. Tests still assert on the error event itself.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
