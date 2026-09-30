// Runs on the audio thread for voice chat and dictation (src/lib/useVoice.js):
// hands the microphone's samples (the first channel) to the page in 20 ms
// batches. The page turns them into turns (src/lib/voice.js Segmenter).
class AnyBotPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 50);
    this.buffer = new Float32Array(this.size);
    this.at = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (input)
      for (let i = 0; i < input.length; i++) {
        this.buffer[this.at++] = input[i];
        if (this.at === this.size) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(this.size);
          this.at = 0;
        }
      }
    return true;
  }
}
registerProcessor("anybot-pcm", AnyBotPcm);
