import { describe, expect, it } from "vitest";
import { MicController } from "../../src/client/audio/mic";

describe("MicController", () => {
  it("initializes in idle state", () => {
    const mic = new MicController({ lang: "pl-PL" });
    expect(mic.isRecording).toBe(false);
    expect(mic.language).toBe("pl-PL");
  });

  it("handles speech callback when speech is recognized", () => {
    let recognizedText = "";
    const mic = new MicController({
      lang: "pl-PL",
      onSpeech: (text) => {
        recognizedText = text;
      },
    });

    mic.handleTranscript("Cześć Mina, daj mi deski!");
    expect(recognizedText).toBe("Cześć Mina, daj mi deski!");
  });
});
