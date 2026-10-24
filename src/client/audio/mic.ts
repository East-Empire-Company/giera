export type MicCallbacks = {
  onSpeech?: (text: string) => void;
  onError?: (error: string) => void;
  onStateChange?: (isRecording: boolean) => void;
};

// Interface for Web Speech API SpeechRecognition
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent {
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
}

export class MicController {
  readonly language: string;
  private recording = false;
  private recognition: SpeechRecognitionInstance | null = null;
  private readonly callbacks: MicCallbacks;

  constructor(options?: { lang?: string; onSpeech?: (text: string) => void; onError?: (err: string) => void; onStateChange?: (r: boolean) => void }) {
    this.language = options?.lang ?? "pl-PL";
    this.callbacks = {
      onSpeech: options?.onSpeech,
      onError: options?.onError,
      onStateChange: options?.onStateChange,
    };

    if (typeof window !== "undefined") {
      const SpeechRecognition =
        (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).webkitSpeechRecognition;

      if (SpeechRecognition) {
        try {
          this.recognition = new SpeechRecognition();
          this.recognition.continuous = true;
          this.recognition.interimResults = false;
          this.recognition.lang = this.language;

          this.recognition.onresult = (event) => {
            const last = event.results[event.results.length - 1];
            if (last && last[0]) {
              const text = last[0].transcript.trim();
              if (text) {
                this.handleTranscript(text);
              }
            }
          };

          this.recognition.onerror = (e) => {
            this.callbacks.onError?.(e.error ?? "Błąd mikrofonu");
          };

          this.recognition.onend = () => {
            if (this.recording) {
              // Restart if still intended to record
              try {
                this.recognition?.start();
              } catch {
                this.setRecording(false);
              }
            } else {
              this.setRecording(false);
            }
          };
        } catch (e) {
          console.warn("SpeechRecognition initialization failed:", e);
        }
      }
    }
  }

  static isSupported(): boolean {
    if (typeof window === "undefined") return false;
    return !!(
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    );
  }

  get isRecording(): boolean {
    return this.recording;
  }

  private setRecording(value: boolean): void {
    this.recording = value;
    this.callbacks.onStateChange?.(value);
  }

  async start(): Promise<boolean> {
    if (!this.recognition) {
      this.callbacks.onError?.("Przeglądarka nie obsługuje rozpoznawania mowy.");
      return false;
    }
    if (this.recording) return true;

    try {
      this.setRecording(true);
      this.recognition.start();
      return true;
    } catch (e) {
      console.warn("Could not start microphone speech recognition:", e);
      this.setRecording(false);
      this.callbacks.onError?.("Nie udało się uruchomić mikrofonu.");
      return false;
    }
  }

  stop(): void {
    this.setRecording(false);
    try {
      this.recognition?.stop();
    } catch {
      // Ignored
    }
  }

  handleTranscript(text: string): void {
    this.callbacks.onSpeech?.(text);
  }
}
