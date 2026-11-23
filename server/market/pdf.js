// A tiny PDF writer (no dependencies): A4 pages, Helvetica text, lines, boxes and filled rectangles.
// Enough for receipts. Text is Windows-1252 (WinAnsi); emoji and other symbols are dropped.

// Helvetica / Helvetica-Bold widths for characters 32–126 (per 1000 em), from the standard font metrics
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// Unicode → WinAnsi for the few characters outside Latin-1 that we use
const CP1252 = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };

function toBytes(str) {
  const out = [];
  for (const ch of String(str ?? '').normalize('NFC')) {
    const at = ch.codePointAt(0);
    if (CP1252[ch]) out.push(CP1252[ch]);
    else if (at === 0x2192) out.push(0x2d, 0x3e); // → as ->
    else if (at === 0x2713 || at === 0x2714) out.push(0x76); // ✓ as v
    else if ((at >= 32 && at < 127) || (at >= 160 && at <= 255)) out.push(at);
    else if (at === 10 || at === 9) out.push(32);
    // anything else (emoji, other scripts) is left out
  }
  return out;
}
// tidy text (one line, single spaces); it becomes WinAnsi bytes only when it's written
const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

function widthOf(str, size, bold) {
  const table = bold ? W_BOLD : W_REG;
  let width = 0;
  for (const toByte of toBytes(str)) width += toByte >= 32 && toByte <= 126 ? table[toByte - 32] : 556;
  return (width * size) / 1000;
}

// split text into lines that fit a width
function wrap(str, size, bold, maxW) {
  const words = clean(str).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (widthOf(next, size, bold) <= maxW || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
    // a single very long word: cut it
    while (widthOf(line, size, bold) > maxW && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && widthOf(line.slice(0, cut), size, bold) > maxW) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const hex = (text) => `<${Buffer.from(toBytes(text)).toString('hex')}>`;
const num = (number) => (Math.round(number * 100) / 100).toString();
const rgb = (value) => {
  const text = value.replace('#', '');
  return [0, 2, 4].map((item) => num(parseInt(text.slice(item, item + 2), 16) / 255)).join(' ');
};

class Pdf {
  constructor() {
    this.W = 595.28;
    this.H = 841.89;
    this.pages = [];
    this.addPage();
  }
  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
  }
  // y is measured from the top of the page (like the screen), converted here
  text(str, left, year, { size = 10, bold = false, color = '#14171f', align = 'left', width = 0 } = {}) {
    const text = clean(str);
    if (!text) return;
    let tx = left;
    if (align !== 'left' && width) {
      const widthOfResult = widthOf(text, size, bold);
      tx = align === 'right' ? left + width - widthOfResult : left + (width - widthOfResult) / 2;
    }
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${num(tx)} ${num(this.H - year - size)} Td ${hex(text)} Tj ET`);
  }
  rect(left, top, width, height, { fill, stroke, lineWidth = 0.6 } = {}) {
    const box = `${num(left)} ${num(this.H - top - height)} ${num(width)} ${num(height)} re`;
    if (fill && stroke) this.ops.push(`${rgb(fill)} rg ${rgb(stroke)} RG ${lineWidth} w ${box} B`);
    else if (fill) this.ops.push(`${rgb(fill)} rg ${box} f`);
    else this.ops.push(`${rgb(stroke || '#14171f')} RG ${lineWidth} w ${box} S`);
  }
  line(x1, y1, x2, y2, { color = '#d9dce3', lineWidth = 0.6, dash = false } = {}) {
    this.ops.push(`${rgb(color)} RG ${lineWidth} w ${dash ? '[3 3] 0 d' : '[] 0 d'} ${num(x1)} ${num(this.H - y1)} m ${num(x2)} ${num(this.H - y2)} l S [] 0 d`);
  }
  toBuffer({ title = '' } = {}) {
    const objs = [];
    const add = (body) => {
      objs.push(body);
      return objs.length;
    };
    const catalog = add(null);
    const pagesId = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const ops of this.pages) {
      const content = Buffer.from(ops.join('\n'), 'latin1');
      const cid = add({ stream: content });
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cid} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const info = add(`<< /Title ${hex(title)} /Producer (Kapu) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);

    const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    let offset = chunks[0].length;
    const offsets = [];
    objs.forEach((obj, index) => {
      offsets.push(offset);
      let other;
      if (obj && obj.stream) {
        other = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n<< /Length ${obj.stream.length} >>\nstream\n`, 'latin1'), obj.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
      } else other = Buffer.from(`${index + 1} 0 obj\n${obj}\nendobj\n`, 'latin1');
      chunks.push(other);
      offset += other.length;
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((currentOffset) => `${String(currentOffset).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}

module.exports = { Pdf, wrap, widthOf, clean };
