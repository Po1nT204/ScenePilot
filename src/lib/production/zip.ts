// Minimal ZIP32 STORE writer. No compression, extraction, filesystem access or ZIP64.
// Each entry is loaded separately; the full archive is never buffered on the server.
export type ZipEntry = { name: string; size: number; load: () => Promise<Uint8Array> };
export const zipMaxBytes = 256 * 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipSize(entries: ZipEntry[]) {
  const names = new Set<string>();
  if (!entries.length || entries.length > 512) throw new Error('Некорректное число файлов пакета.');
  let size = 22;
  for (const entry of entries) {
    if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(entry.name) || entry.name.length > 180 || names.has(entry.name) ||
        !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Некорректный файл пакета.');
    names.add(entry.name);
    size += 30 + 46 + Buffer.byteLength(entry.name) * 2 + entry.size;
  }
  if (size > zipMaxBytes) throw new Error('Пакет превышает 256 МиБ. Скачайте отдельные кадры.');
  return size;
}
export async function* streamZip(entries: ZipEntry[]) {
  zipSize(entries);
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = await entry.load();
    if (data.byteLength !== entry.size) throw new Error('Материал изменился во время скачивания.');
    const name = Buffer.from(entry.name), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); local.writeUInt16LE(0x21, 12); // UTF-8, 1980-01-01
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    yield local; yield name; yield data;
    offset += local.length + name.length + data.length;
  }
  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  for (const part of directory) yield part;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(offset, 16);
  yield end;
}
