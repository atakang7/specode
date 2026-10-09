/** Small event emitter shared by Node and browsers; no Node polyfills required. */
export class Emitter {
  private readonly listeners = new Map<string, Set<(...args: any[]) => void>>();

  on(event: string, listener: (...args: any[]) => void): this {
    const callbacks = this.listeners.get(event) ?? new Set();
    callbacks.add(listener);
    this.listeners.set(event, callbacks);
    return this;
  }

  off(event: string, listener: (...args: any[]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  protected emit(event: string, ...args: any[]): boolean {
    const callbacks = this.listeners.get(event);
    if (!callbacks?.size) return false;
    for (const callback of [...callbacks]) callback(...args);
    return true;
  }
}
