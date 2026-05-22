export interface STTProvider {
  transcribe(audio: Buffer, mimeType: string): Promise<string>;
}
