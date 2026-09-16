// Uji fitur cek ongkir tanpa lewat WhatsApp.
//
//   node src/cli/ongkirCli.js dashmall "Tlogosari Raya I 65c"
//   node src/cli/ongkirCli.js gudang "https://maps.app.goo.gl/..."
//
// Screenshot hasilnya ditulis ke data/ongkir-terakhir.png.

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { resolveOrigin, listOrigins } = require('../ongkir/ongkirTrigger');
const { expandLinks } = require('../ongkir/mapsLink');
const { checkOngkir } = require('../ongkir/maximDriver');
const { formatRupiah } = require('../ongkir/ongkirHandler');

async function main() {
  const [fromArg, ...toParts] = process.argv.slice(2);
  const toArg = toParts.join(' ');

  if (!fromArg || !toArg) {
    console.error('Pakai: node src/cli/ongkirCli.js <dari> <ke>');
    console.error(`Alias titik asal: ${listOrigins().join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const alias = resolveOrigin(fromArg);
  const pickup = alias ? { text: alias, resolved: [] } : await expandLinks(fromArg);
  const destination = await expandLinks(toArg);
  const placesOnly = (expanded) => expanded.resolved.map((entry) => entry.placeFull || entry.place).join(', ');

  console.log(`Dari  : "${fromArg}" -> cari "${pickup.text}"`);
  console.log(`Ke    : "${toArg}" -> cari "${destination.text}"`);
  console.log('');

  const startedAtMs = Date.now();
  const result = await checkOngkir({
    pickupQuery: pickup.text,
    pickupFallback: placesOnly(pickup),
    destinationQuery: destination.text,
    destinationFallback: placesOnly(destination),
    onProgress: async (text) => console.log(`  ${text}`),
  });

  console.log('');
  console.log(`Titik jemput : ${result.pickup}`);
  console.log(`Tujuan       : ${result.destination}`);
  console.log('');
  result.tariffs.forEach((tariff) => {
    console.log(`  ${tariff.name.padEnd(26)} ${formatRupiah(tariff.price)}`);
  });

  const target = path.join(process.cwd(), 'data', 'ongkir-terakhir.png');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, result.screenshot);

  console.log('');
  console.log(`Screenshot: ${target}`);
  console.log(`Selesai dalam ${((Date.now() - startedAtMs) / 1000).toFixed(1)} detik.`);
}

main().catch((error) => {
  console.error(`\nGagal: [${error.code || 'ERROR'}] ${error.message}`);
  process.exitCode = 1;
});
