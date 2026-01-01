/**
 * Generate placeholder PNG icons for Chrome Extension
 * Run: node generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// Simple PNG encoder for solid color squares
function createPNG(size, r, g, b) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = createChunk('IHDR', Buffer.from([
    (size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff,  // width
    (size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff,  // height
    8,    // bit depth
    2,    // color type (RGB)
    0,    // compression method
    0,    // filter method
    0     // interlace method
  ]));

  // IDAT chunk (image data)
  const rawData = [];
  for (let y = 0; y < size; y++) {
    rawData.push(0); // filter type (none)
    for (let x = 0; x < size; x++) {
      rawData.push(r, g, b);
    }
  }

  const zlib = require('zlib');
  const compressed = zlib.deflateSync(Buffer.from(rawData));
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuffer, data]));

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Generate icons (indigo/purple color #6366f1)
const sizes = [16, 48, 128];
const color = { r: 99, g: 102, b: 241 };  // --primary color

sizes.forEach(size => {
  const png = createPNG(size, color.r, color.g, color.b);
  const filename = path.join(__dirname, `icon${size}.png`);
  fs.writeFileSync(filename, png);
  console.log(`Created ${filename}`);
});

console.log('Done! Icons generated.');
