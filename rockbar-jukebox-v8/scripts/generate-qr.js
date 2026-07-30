/**
 * Genera un archivo qr-para-imprimir.png en la raiz del proyecto, listo para
 * imprimir y pegar en las mesas del bar. Usa PUBLIC_URL del .env.
 *
 * Uso: npm run qr
 */
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const config = require('../lib/config');

async function main() {
  const url = config.publicUrl;
  if (!url) {
    console.error('Falta configurar PUBLIC_URL en el archivo .env antes de generar el QR.');
    process.exit(1);
  }

  const outPath = path.join(__dirname, '..', 'qr-para-imprimir.png');
  await QRCode.toFile(outPath, url, { width: 1000, margin: 2 });

  console.log('QR generado en:', outPath);
  console.log('Apunta a:', url);
}

main().catch((err) => {
  console.error('Error generando el QR:', err.message);
  process.exit(1);
});
