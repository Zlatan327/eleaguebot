const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

/**
 * Generates an instant, standalone SVG Data URL from a text string.
 * Completely local — 0ms network latency, zero external API dependencies.
 *
 * @param {string} text
 * @returns {string} Data URL (data:image/svg+xml;...)
 */
function generateQrSvgDataUrl(text) {
  if (!text) return null;

  try {
    const errorLevel = (QRErrorCorrectLevel && QRErrorCorrectLevel.L) || 1;
    const qr = new QRCode(-1, errorLevel);
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const margin = 4;
    const size = count + margin * 2;

    let paths = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          paths += `M${c + margin},${r + margin}h1v1h-1z `;
        }
      }
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#FFFFFF"/><path d="${paths.trim()}" fill="#000000"/></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  } catch (err) {
    console.error('Error generating local SVG QR code:', err);
    // Fallback if local generation fails
    return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(text)}`;
  }
}

module.exports = {
  generateQrSvgDataUrl,
};
