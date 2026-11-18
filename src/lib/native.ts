/** Present when Folio runs inside its Android app (android/), which adds what a WebView lacks. */
interface Bridge {
  ready(): void;
  save(name: string, mime: string, base64: string): void;
  share(name: string, mime: string, base64: string): void;
  version(): string;
  checkForUpdate(): void;
  installUpdate(): void;
  setDark?(dark: boolean): void;
}

export const native: Bridge | undefined = (window as unknown as { FolioAndroid?: Bridge }).FolioAndroid;

export async function toBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(data: string, name: string, type: string): File {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
}
