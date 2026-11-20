/**
 * Procedural Web Audio synthesizer for gentle Vietnamese-inspired UI feedback
 * (warm bronze bell chime for reminders, crisp woodblock tap for completion).
 */
export class ChimeSynthesizer {
  private ctx: AudioContext | null = null;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as {webkitAudioContext?: typeof AudioContext})
        .webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /** Warm pentatonic bronze bell tone for Daily Review reminders & selections. */
  playReminderBell(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const partials = [
      {freq: 523.25, gain: 0.14, decay: 1.4}, // C5
      {freq: 783.99, gain: 0.07, decay: 1.0}, // G5
      {freq: 1046.5, gain: 0.04, decay: 0.65}, // C6
    ];

    for (const p of partials) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.freq, now);

      amp.gain.setValueAtTime(0.0001, now);
      amp.gain.exponentialRampToValueAtTime(p.gain, now + 0.015);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);

      osc.connect(amp);
      amp.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + p.decay + 0.05);
    }
  }

  /** Crisp positive double-chime when marking an event as attended ("Đã đi"). */
  playComplete(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [587.33, 880.0]; // D5 -> A5
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.075;
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(0.11, t + 0.01);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);

      osc.connect(amp);
      amp.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    });
  }

  /** Subtle muted click for toggling status, filters, or adding a task. */
  playTap(pitch = 440): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.72, now + 0.07);

    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(0.08, now + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
